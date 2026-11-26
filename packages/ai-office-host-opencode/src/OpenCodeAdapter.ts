/**
 * OpenCodeAdapter - HostAdapter implementation for OpenCode
 *
 * Wraps OpenCode's plugin context (ctx) to implement the universal
 * HostAdapter interface. This allows the core engine to work with
 * OpenCode without direct dependencies.
 *
 * Contains all logic previously in v2.ts: spawner, sessionDirCache, dashboard,
 * hooks (scope guard, tripwire), auto-continuation, etc.
 */

import type {
  HostAdapter,
  SessionConfig,
  Session,
  SessionResult,
  PromptOptions,
  Tool,
  ScopeResult,
  SubagentConfig,
  Subagent,
  SubagentResult,
  ModelConfig,
  InitConfig,
  ExecResult,
  TokenUsage,
} from 'ai-office-core/host';
import {
  Tripwire,
  analyzeShellCommand,
  checkScope,
  type ScopePolicy,
  extractCommand,
  extractPaths,
  resolveScopeCard,
  FILE_WRITE_TOOLS,
  SHELL_TOOLS,
  logger,
  childModelFrom,
  buildTools,
  type OficinaTool,
  startDashboard,
  openBrowser,
} from 'ai-office-core';
import { z } from 'zod';

// ============================================================================
// Type Definitions for OpenCode Context
// ============================================================================

/** Minimal interface for OpenCode's session API */
interface OpenCodeSession {
  create: (config: { parentID: string; title: string; agent: string; model?: ModelConfig }) => Promise<{ id: string }>;
  prompt: (config: { sessionID: string; text: string; metadata?: Record<string, unknown> }) => Promise<void>;
  get: (config: { sessionID: string }) => Promise<{ model?: { id: string; providerID: string; variant?: string } } | undefined>;
  synthetic: (config: { sessionID: string; text: string; description: string }) => Promise<void>;
  hook?: (event: string, fn: (event: any) => Promise<void>) => Promise<void>;
}

/** Minimal interface for OpenCode's tool API */
interface OpenCodeToolAPI {
  transform: (fn: (editor: { add: (tool: any) => void }) => void) => Promise<void>;
  hook: (event: string, fn: (event: any) => Promise<void>) => Promise<void>;
}

/** Minimal interface for OpenCode's permission API */
interface OpenCodePermissionAPI {
  hook: (event: string, fn: (event: any) => Promise<void>) => Promise<void>;
}

/** Minimal interface for OpenCode's event API */
interface OpenCodeEventAPI {
  subscribe: (config: { signal?: AbortSignal }) => AsyncIterable<any>;
}

/** OpenCode plugin context (minimal subset we need) */
interface OpenCodeContext {
  session: OpenCodeSession;
  tool: OpenCodeToolAPI;
  permission: OpenCodePermissionAPI;
  event: OpenCodeEventAPI;
  options?: Record<string, unknown>;
  location?: { directory?: string };
}

/** PluginContext from OpenCode (inlined to avoid dependency issues) */
interface PluginContext {
  session: OpenCodeSession;
  tool: OpenCodeToolAPI;
  permission: OpenCodePermissionAPI;
  event: OpenCodeEventAPI;
  options?: Record<string, unknown>;
  location?: { directory?: string };
}

/** V2Options from original v2.ts */
interface V2Options {
  enforceScope?: boolean;
  maxAutoResumes?: number;
  tripwireMaxFiles?: number;
  dashboard?: { enabled?: boolean; port?: number };
}

/** Tool call representation */
interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
  success: boolean;
  error?: string;
}

/** Scope card result */
type ScopeCardResult =
  | { kind: 'AUTHORIZED'; card: any }
  | { kind: 'NO_SCOPE_APPLICABLE' }
  | { kind: 'VERIFICATION_FAILED'; reason: string };

const log = logger('oficina:opencode-adapter');
const WRITE_ACTIONS = new Set(['edit', 'write', 'patch', 'multiedit', 'apply_patch']);

function toJsonSchema(schema: unknown): Record<string, unknown> {
  if (!schema) return { type: 'object', additionalProperties: true };
  try {
    const converted = z.toJSONSchema(schema as never, {
      io: 'input',
      unrepresentable: 'any',
    }) as Record<string, unknown>;
    if (converted['type'] !== 'object') {
      return { type: 'object', additionalProperties: true, description: converted['description'] };
    }
    return { ...converted, additionalProperties: false };
  } catch {
    return { type: 'object', additionalProperties: true };
  }
}

// ============================================================================
// OpenCodeAdapter Implementation
// ============================================================================

export class OpenCodeAdapter implements HostAdapter {
  private ctx: OpenCodeContext | null = null;
  private modelConfig: ModelConfig = {
    id: 'default',
    provider: 'openrouter',
  };
  private initialized = false;

  // State from v2.ts
  private sessionDirCache = new Map<string, string>();
  private tripwires = new Map<string, Tripwire>();
  private parentCache = new Map<string, string>();
  private dashboardEnabled = false;
  private dashboardInfo: { url: string } | null = null;
  private enforceScope = true;
  private maxAutoResumes = 25;
  private tripwireMaxFiles = 4000;
  private resumes = new Map<string, number>();
  private lastResume = new Map<string, number>();
  private controller = new AbortController();
  private cwd: string = process.cwd();
  private officeFactory: any = null; // Will be set via setOfficeFactory
  private toolsRegistered = false;

  /** Initialize with OpenCode plugin context */
  async initialize(config: InitConfig): Promise<void> {
    this.cwd = config.projectRoot;
    this.initialized = true;
  }

  /** Set the OpenCode plugin context (called from v2.ts setup) */
  setContext(ctx: PluginContext): void {
    this.ctx = ctx as unknown as OpenCodeContext;
    const options = (ctx.options ?? {}) as V2Options;
    this.enforceScope = options.enforceScope !== false;
    this.maxAutoResumes = options.maxAutoResumes ?? 25;
    this.tripwireMaxFiles = options.tripwireMaxFiles ?? 4000;
    this.dashboardEnabled =
      (options.dashboard?.enabled !== false) &&
      !process.env.VITEST &&
      !process.env.CI;

    // Extract model from context if available
    if (ctx.options?.model) {
      this.modelConfig = ctx.options.model as ModelConfig;
    }

    // Start auto-continuation event listener
    this.startAutoContinuation();
  }

  /** Set the OfficeFactory reference (for dashboard, scope resolution) */
  setOfficeFactory(factory: any): void {
    this.officeFactory = factory;
  }

  /** Get the underlying OpenCode context (for advanced use cases) */
  getContext(): OpenCodeContext | null {
    return this.ctx;
  }

  // ---------------------------------------------------------------------------
  // Session Management
  // ---------------------------------------------------------------------------

  async createSession(config: SessionConfig): Promise<Session> {
    if (!this.ctx) throw new Error('OpenCodeAdapter not initialized with context');

    const parentID = config.parentID;
    const title = config.title || 'AI-OFFICE Session';
    const model = config.model || this.modelConfig;

    const session = await this.ctx.session.create({
      parentID: parentID || '',
      title,
      agent: 'general',
      model,
    });

    return {
      id: session.id,
      parentID,
      title,
      cwd: config.cwd || this.cwd,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async promptSession(sessionId: string, prompt: string, options?: PromptOptions): Promise<SessionResult> {
    if (!this.ctx) throw new Error('OpenCodeAdapter not initialized with context');

    try {
      await this.ctx.session.prompt({
        sessionID: sessionId,
        text: prompt,
        metadata: options?.metadata,
      });

      return {
        text: '',
        status: 'active',
        usage: { input: 0, output: 0, total: 0 },
      };
    } catch (error) {
      return {
        text: '',
        status: 'failed',
        error: String(error),
        usage: { input: 0, output: 0, total: 0 },
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Tools & Scope
  // ---------------------------------------------------------------------------

  getAvailableTools(): Tool[] {
    return [
      { name: 'read', description: 'Read a file', inputSchema: { type: 'object' }, available: true },
      { name: 'write', description: 'Write a file', inputSchema: { type: 'object' }, available: true },
      { name: 'edit', description: 'Edit a file', inputSchema: { type: 'object' }, available: true },
      { name: 'bash', description: 'Execute shell command', inputSchema: { type: 'object' }, available: true },
      { name: 'glob', description: 'Find files by pattern', inputSchema: { type: 'object' }, available: true },
      { name: 'grep', description: 'Search file contents', inputSchema: { type: 'object' }, available: true },
      { name: 'task', description: 'Launch subagent', inputSchema: { type: 'object' }, available: true },
      { name: 'list', description: 'List directory', inputSchema: { type: 'object' }, available: true },
    ];
  }

  /** Register tools with OpenCode (called from v2.ts) */
  async registerTools(office: any): Promise<void> {
    if (!this.ctx || this.toolsRegistered) return;
    this.toolsRegistered = true;

    const defs = buildTools(office, {
      onRunStart: async (runId: string, off: any) => {
        if (!this.dashboardEnabled) return undefined;
        try {
          const info = await this.ensureDashboard(off.paths.projectRoot);
          if (info) {
            openBrowser(info.url);
            log.info('dashboard abierto', { runId, url: info.url });
            return info.url;
          }
          log.warn('dashboard no disponible', { runId });
        } catch (err) {
          log.debug('dashboard: arranque best-effort', { runId, error: String(err) });
        }
        return undefined;
      },
      getOffice: (dir: string) => this.officeFactory?.get(dir),
    });

    await this.ctx.tool.transform((editor: any) => {
      for (const [name, def] of Object.entries(defs)) {
        editor.add({
          name,
          description: def.description,
          input: toJsonSchema(def.args),
          execute: async (input: unknown, toolCtx: { sessionID: string; agent: string; messageID: string }) => {
            const parsed = def.args ? def.args.parse(input ?? {}) : (input ?? {});
            const sessionDir = await this.resolveSessionDir(toolCtx.sessionID);
            const result = await def.execute(parsed as Record<string, unknown>, {
              directory: sessionDir,
              sessionID: toolCtx.sessionID,
              agent: toolCtx.agent,
              messageID: toolCtx.messageID,
            });
            if (this.dashboardEnabled && (name === 'oficina_plan' || name === 'oficina_dispatch')) {
              void this.ensureDashboard(sessionDir).catch(() => undefined);
            }
            return {
              content: result.output,
              metadata: result.metadata,
            };
          },
        } as never);
      }
    });
  }

  async checkScope(path: string, operation: 'read' | 'write' | 'exec'): Promise<ScopeResult> {
    return { allowed: true };
  }

  /** Internal: check scope using v2.ts logic */
  async checkScopeInternal(sessionID: string, rawPath: string): Promise<{ reason: string; kind: string } | undefined> {
    const scope = await this.scopeOf(sessionID);
    if (!scope) return undefined;
    const verdict = await checkScope(scope.projectRoot, rawPath, scope.policy);
    if (verdict.allowed) return undefined;
    return { reason: verdict.reason, kind: verdict.kind };
  }

  // ---------------------------------------------------------------------------
  // Subagent Management
  // ---------------------------------------------------------------------------

  async spawnSubagent(config: SubagentConfig): Promise<Subagent> {
    if (!this.ctx) throw new Error('OpenCodeAdapter not initialized with context');

    let modelConfig = config.model;
    if (!modelConfig && config.parentSessionId) {
      try {
        const parent = await this.ctx.session.get({ sessionID: config.parentSessionId });
        const childModel = childModelFrom(parent);
        if (childModel) {
          modelConfig = {
            id: childModel.id,
            provider: childModel.providerID,
            variant: childModel.variant,
          };
        }
      } catch {
        modelConfig = this.modelConfig;
      }
    }

    const child = await this.ctx.session.create({
      parentID: config.parentSessionId,
      title: config.description || `AI-OFFICE: ${config.name}`,
      agent: 'general',
      model: modelConfig,
    });

    if (config.prompt) {
      await this.ctx.session.prompt({
        sessionID: child.id,
        text: config.prompt,
        metadata: config.metadata,
      });
    }

    return {
      sessionId: child.id,
      name: config.name,
      status: 'starting',
      createdAt: new Date().toISOString(),
    };
  }

  async getSubagentResult(subagentId: string): Promise<SubagentResult> {
    return {
      sessionId: subagentId,
      result: '',
      success: true,
      completedAt: new Date().toISOString(),
      usage: { input: 0, output: 0, total: 0 },
    };
  }

  // ---------------------------------------------------------------------------
  // Model Management
  // ---------------------------------------------------------------------------

  getModel(): ModelConfig {
    return this.modelConfig;
  }

  setModel(model: ModelConfig): void {
    this.modelConfig = model;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async shutdown(): Promise<void> {
    this.controller.abort();
    this.ctx = null;
    this.initialized = false;
    this.sessionDirCache.clear();
    this.tripwires.clear();
    this.parentCache.clear();
    this.resumes.clear();
    this.lastResume.clear();
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  async readFile(path: string): Promise<string> {
    const fs = await import('node:fs/promises');
    return fs.readFile(path, 'utf-8');
  }

  async writeFile(path: string, content: string): Promise<void> {
    const fs = await import('node:fs/promises');
    await fs.writeFile(path, content, 'utf-8');
  }

  async execCommand(cmd: string, args: string[]): Promise<ExecResult> {
    const { spawn } = await import('node:child_process');
    const { once } = await import('node:events');

    return new Promise((resolve) => {
      const child = spawn(cmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => { stdout += data.toString(); });
      child.stderr?.on('data', (data) => { stderr += data.toString(); });

      once(child, 'close').then((args: any[]) => {
        const exitCode = args[0] ?? 1;
        resolve({
          exitCode,
          stdout,
          stderr,
          timedOut: false,
        });
      });

      once(child, 'error').then((args: any[]) => {
        const error = args[0];
        resolve({
          exitCode: 1,
          stdout,
          stderr: stderr + (error?.message ?? String(error)),
          timedOut: false,
        });
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Internal v2.ts logic moved here
  // ---------------------------------------------------------------------------

  /** Caché de directorio por sesión: cada ventana/proyecto usa SU oficina. */
  async resolveSessionDir(sessionID: string): Promise<string> {
    const cached = this.sessionDirCache.get(sessionID);
    if (cached) return cached;
    try {
      const session = (await this.ctx?.session.get({ sessionID })) as
        | { location?: { directory?: string } }
        | undefined;
      const dir = session?.location?.directory;
      if (typeof dir === 'string' && dir.trim().length > 0) {
        this.sessionDirCache.set(sessionID, dir.trim());
        return dir.trim();
      }
    } catch (err) {
      log.debug('no se pudo resolver el directorio de la sesión', {
        sessionID,
        error: String(err),
      });
    }
    this.sessionDirCache.set(sessionID, this.cwd);
    return this.cwd;
  }

  /**
   * El padre de una sesion, con cache.
   *
   * Es lo que hace que un subagente **herede el scope** de quien lo
   * lanzo: la sesion hija cuelga de la padre, y el guard sube por la
   * cadena hasta encontrar la sesion que tiene la card.
   *
   * Sin esto, delegar seria un escalon para salirse del scope: el
   * subagente no tendria card y el guard lo dejaria pasar todo.
   */
  async resolveParentSession(sessionID: string): Promise<string | undefined> {
    if (this.parentCache.has(sessionID)) return this.parentCache.get(sessionID);
    try {
      const session = (await this.ctx?.session.get({ sessionID })) as { parentID?: string } | undefined;
      const parent = session?.parentID;
      if (typeof parent === 'string' && parent.length > 0) {
        this.parentCache.set(sessionID, parent);
        return parent;
      }
      return undefined;
    } catch (err) {
      log.debug('no se pudo resolver el padre de la sesion', { sessionID, error: String(err) });
      return undefined;
    }
  }

  /** El scope que aplica a una sesion, si tiene (root-aware). */
  async scopeOf(sessionID: string): Promise<{ card: any; policy: ScopePolicy; projectRoot: string } | undefined> {
    if (!this.officeFactory) return undefined;
    const sidDir = await this.resolveSessionDir(sessionID);
    const off = this.officeFactory.get(sidDir);
    try {
      const state = await off.loadState().catch(() => undefined);
      if (!state) return undefined;
      const result = await resolveScopeCard(state, sessionID, {
        enforce: this.enforceScope,
        resolveParentSession: this.resolveParentSession.bind(this),
      });
      if (result.kind === 'VERIFICATION_FAILED') {
        log.error('verificacion de scope fallida', { sessionID, reason: result.reason });
        if (this.enforceScope) {
          throw new Error(`[OFICINA] Scope verification failed: ${result.reason}. Operation blocked (fail-closed).`);
        }
        return undefined;
      }
      if (result.kind !== 'AUTHORIZED') {
        return undefined;
      }
      const card = result.card;
      const policy: ScopePolicy = {
        mayTouch: card.scope.mayTouch,
        forbidden: card.scope.forbidden,
      };
      return { card, policy, projectRoot: off.paths.projectRoot };
    } catch (err) {
      log.debug('no se pudo resolver el scope de la sesion', { sessionID, error: String(err) });
      if (this.enforceScope) {
        throw new Error(`[OFICINA] Scope verification failed: ${String(err)}. Operation blocked (fail-closed).`);
      }
      return undefined;
    }
  }

  /** Tripwire per-root para la oficina de este sessionID */
  async tripwireFor(sessionID: string): Promise<Tripwire> {
    return this.getTripwire(await this.resolveSessionDir(sessionID));
  }

  private getTripwire(dir: string): Tripwire {
    const key = dir;
    let tw = this.tripwires.get(key);
    if (!tw) {
      tw = new Tripwire(key, { maxFiles: this.tripwireMaxFiles });
      this.tripwires.set(key, tw);
    }
    return tw;
  }

  /** Dashboard management */
  private async ensureDashboard(projectRoot: string) {
    try {
      const info = await startDashboard(projectRoot, `${projectRoot}/.oficina`);
      if (info) {
        this.dashboardInfo = info;
        log.info('dashboard listo', { projectRoot, url: info.url });
      }
      return info;
    } catch (err) {
      log.debug('dashboard best-effort', { projectRoot, error: String(err) });
      return undefined;
    }
  }

  /** Start auto-continuation event listener */
  private startAutoContinuation(): void {
    if (!this.ctx) return;
    void (async () => {
      try {
        for await (const event of this.ctx!.event.subscribe({ signal: this.controller.signal })) {
          if (event.type === 'session.idle') {
            const sessionID = event.data?.sessionID;
            if (!sessionID) continue;
            try {
              const dir = await this.resolveSessionDir(sessionID);
              const off = this.officeFactory?.get(dir);
              const state = await off?.loadState().catch(() => undefined);
              if (!state) continue;
              if (state.status !== 'running') continue;
              if (state.halt) continue;

              const cards = Object.values(state.cards);
              const pending = cards.filter((c: any) => c.state !== 'done');
              if (pending.length === 0) continue;

              const count = this.resumes.get(sessionID) ?? 0;
              if (count >= this.maxAutoResumes) {
                log.warn('tope de auto-reanudaciones alcanzado', { sessionID, count });
                continue;
              }
              const last = this.lastResume.get(sessionID);
              if (last !== undefined && Date.now() - last < 1_500) continue;
              this.lastResume.set(sessionID, Date.now());
              this.resumes.set(sessionID, count + 1);

              const { renderMesaBrief, snapshotMesa } = await import('ai-office-core/mesa');
              const mesa = await snapshotMesa(off);
              const mesaBrief = renderMesaBrief(mesa);

              const texto = [
                '[OFICINA - auto-continuacion]',
                '',
                `La corrida sigue abierta. Quedan ${pending.length} card(s) sin terminar.`,
                '',
                ...(mesaBrief ? ['---', '', '**La mesa:**', '', mesaBrief] : []),
                '',
                'Usá `oficina_board` para el panorama y `oficina_mesa` para ver la mesa.',
                'No declares la corrida terminada mientras queden cards sin DONE.',
              ].join('\n');

              await this.ctx!.session.synthetic({
                sessionID,
                text: texto,
                description: 'OFICINA: auto-continuacion',
              });
            } catch (err) {
              log.error('fallo en la auto-continuacion', { error: String(err) });
            }
          }
        }
      } catch (err) {
        if (!this.controller.signal.aborted) {
          log.error('el stream de eventos se corto', { error: String(err) });
        }
      }
    })();
  }

  /** Register scope guard hooks (called from v2.ts) */
  async registerScopeGuardHooks(): Promise<void> {
    if (!this.ctx) return;

    /** Verifica un path contra el scope. Devuelve el motivo si viola. */
    const violation = async (
      sessionID: string,
      rawPath: string,
    ): Promise<{ reason: string; kind: string } | undefined> => {
      const scope = await this.scopeOf(sessionID);
      if (!scope) return undefined;
      const verdict = await checkScope(scope.projectRoot, rawPath, scope.policy);
      if (verdict.allowed) return undefined;
      return { reason: verdict.reason, kind: verdict.kind };
    };

    await this.ctx.tool.hook('execute.before', async (event: any) => {
      const tool = String(event.tool);
      const input = (event.input ?? {}) as Record<string, unknown>;

      if (!FILE_WRITE_TOOLS.has(tool) && !SHELL_TOOLS.has(tool)) {
        const scopeLectura = await this.scopeOf(event.sessionID);
        if (scopeLectura) await (await this.tripwireFor(event.sessionID)).arm(String(event.id), scopeLectura.policy.mayTouch);
        return;
      }

      const scope = await this.scopeOf(event.sessionID);
      if (!scope) return;

      if (FILE_WRITE_TOOLS.has(tool)) {
        for (const rawPath of extractPaths(tool, input)) {
          const bad = await violation(event.sessionID, rawPath);
          if (!bad) continue;
          const mensaje = `[OFICINA] Scope violado: ${bad.reason} (card ${scope.card.id})`;
          log.warn('scope violado (archivo)', { card: scope.card.id, path: rawPath, kind: bad.kind });
          if (this.enforceScope) throw new Error(mensaje);
        }
        await (await this.tripwireFor(event.sessionID)).arm(String(event.id), scope.policy.mayTouch);
        return;
      }

      if (SHELL_TOOLS.has(tool)) {
        const command = extractCommand(input);
        if (!command) return;
        for (const candidate of analyzeShellCommand(command)) {
          if (candidate.uncertain) {
            log.warn('shell con escritura no interpretable', {
              card: scope.card.id,
              op: candidate.op,
            });
            continue;
          }
          const bad = await violation(event.sessionID, candidate.target);
          if (!bad) continue;
          const mensaje = `[OFICINA] Scope violado: ${bad.reason} (card ${scope.card.id})`;
          log.warn('scope violado (shell)', {
            card: scope.card.id,
            target: candidate.target,
            op: candidate.op,
            kind: bad.kind,
          });
          if (this.enforceScope) throw new Error(mensaje);
        }
        await (await this.tripwireFor(event.sessionID)).arm(String(event.id), scope.policy.mayTouch);
      }
    });

    await this.ctx.permission.hook('evaluate', async (event: any) => {
      if (!WRITE_ACTIONS.has(String(event.action))) return;

      const scope = await this.scopeOf(event.sessionID);
      if (!scope) return;

      for (const resource of event.resources) {
        const bad = await violation(event.sessionID, resource);
        if (!bad) continue;
        event.effect = 'deny';
        event.message = `[OFICINA] Scope violado: ${bad.reason} (card ${scope.card.id})`;
        log.warn('permiso denegado por scope', {
          card: scope.card.id,
          resource,
          kind: bad.kind,
        });
        return;
      }
    });

    /* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     * 3. TRIPWIRE
     *
     * Fotografia el arbol antes de una tool y compara despues. Lo que cambio
     * fuera del scope se reporta por el bus: detecta, no revierte.
     * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

    await this.ctx.tool.hook('execute.after', async (event: any) => {
      const scope = await this.scopeOf(event.sessionID);
      if (!scope) return;
      const { changes: cambios, incomplete, errors, armFailed } = await (await this.tripwireFor(event.sessionID)).check(String(event.id), scope.policy.mayTouch);
      if (cambios.length === 0 && !incomplete && errors.length === 0 && !armFailed) return;

      const detalle = cambios.map((c: any) => `  - ${c.kind}: ${c.path}`).join('\n');
      log.warn('escrituras fuera del scope detectadas', {
        card: scope.card.id,
        tool: event.tool,
        cambios: cambios.length,
        incomplete,
        errors: errors.length,
        armFailed,
      });

      const sidDir = await this.resolveSessionDir(event.sessionID);
      const offScope = this.officeFactory?.get(sidDir);
      await offScope?.bus
        .send('peer', {
          from: 'oficina',
          to: ['*'],
          kind: 'NOTICE',
          subject: scope.card.id,
          body: {
            notice: 'scope',
            message:
              `Se detectaron ${cambios.length} cambio(s) fuera del scope de la card ${scope.card.id} ` +
              `durante \`${event.tool}\`:\n${detalle}\n\n` +
              `${incomplete ? 'âš ï¸ Inspección incompleta (límite de archivos alcanzado). ' : ''}` +
              `${errors.length > 0 ? `âš ï¸ ${errors.length} error(es) durante la inspección. ` : ''}` +
              `${armFailed ? 'âš ï¸ No se pudo tomar la instantánea inicial (arm falló). ' : ''}` +
              `Si fue deliberado, avisalo por el bus. Si no, revisé lo que tocaste.`,
          },
        })
        .catch(() => undefined);
    });
  }

  /** Register context/compaction hooks (called from v2.ts) */
  async registerContextHooks(): Promise<void> {
    if (!this.ctx || !this.ctx.session.hook) return;

    await this.ctx.session.hook('context', async (event: any) => {
      try {
        const { buildSystemPrompt } = await import('ai-office-core/systemPrompt');
        const sid = (event as { sessionID?: string }).sessionID;
        const off = typeof sid === 'string' && sid.length > 0
          ? this.officeFactory?.get(await this.resolveSessionDir(sid))
          : this.officeFactory?.getPrimary(this.cwd);
        const state = await off?.loadState().catch(() => undefined);
        if (!state) return;
        event.system.push({ type: 'text', text: await buildSystemPrompt(off, state) });
      } catch (err) {
        log.debug('no se pudo inyectar el estado', { error: String(err) });
      }
    });

    await this.ctx.session.hook('compaction', async (event: any) => {
      try {
        const { buildSystemPrompt } = await import('ai-office-core/systemPrompt');
        const sid = (event as { sessionID?: string }).sessionID;
        const off = typeof sid === 'string' && sid.length > 0
          ? this.officeFactory?.get(await this.resolveSessionDir(sid))
          : this.officeFactory?.getPrimary(this.cwd);
        const state = await off?.loadState().catch(() => undefined);
        if (!state) return;
        event.system.push({ type: 'text', text: await buildSystemPrompt(off, state) });
      } catch (err) {
        log.debug('no se pudo inyectar el estado al compactar', { error: String(err) });
      }
    });
  }
}

// ============================================================================
// Factory Function for Registration
// ============================================================================

/** Creates an OpenCodeAdapter instance */
export async function createOpenCodeAdapter(config: InitConfig): Promise<OpenCodeAdapter> {
  const adapter = new OpenCodeAdapter();
  await adapter.initialize(config);
  return adapter;
}

// Auto-register when this module is loaded
import { registerAdapter } from 'ai-office-core';
registerAdapter('opencode', createOpenCodeAdapter, undefined, true);

// knip-ignore\nexport default OpenCodeAdapter;