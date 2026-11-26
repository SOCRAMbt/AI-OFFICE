/**
 * CodexAdapter - HostAdapter implementation for Codex
 *
 * Implements the universal HostAdapter interface using Codex's
 * JSON-RPC over stdio protocol (child_process spawn).
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
import {z} from 'zod'
import type { ChildProcess } from 'node:child_process';
import {spawn} from 'node:child_process'
import {once} from 'node:events'

// ============================================================================
// Type Definitions for Codex JSON-RPC Protocol
// ============================================================================

/** Codex JSON-RPC message */
interface CodexMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: any;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

/** Codex session state */
interface CodexSessionState {
  process: ChildProcess;
  pendingRequests: Map<number | string, { resolve: (value: any) => void; reject: (error: Error) => void }>;
  requestId: number;
  sessionId: string;
  cwd: string;
  model?: ModelConfig;
}

/** Tool call representation */
interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
  success: boolean;
  error?: string;
}

const WRITE_ACTIONS = new Set(['edit', 'write', 'patch', 'multiedit', 'apply_patch']);

// ============================================================================
// CodexAdapter Implementation
// ============================================================================

export class CodexAdapter implements HostAdapter {
  private session: CodexSessionState | null = null;
  private modelConfig: ModelConfig = {
    id: 'gpt-4',
    provider: 'openai',
  };
  private initialized = false;
  private cwd: string = process.cwd();

  /** Initialize Codex adapter */
  async initialize(config: InitConfig): Promise<void> {
    this.cwd = config.projectRoot;
    this.initialized = true;
  }

  /** Start Codex process and establish JSON-RPC connection */
  private async startCodexProcess(sessionId: string, model?: ModelConfig): Promise<CodexSessionState> {
    return new Promise((resolve, reject) => {
      const codexProcess = spawn('codex', ['--json-rpc'], {
        cwd: this.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          CODEX_SESSION_ID: sessionId,
          OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        },
      });

      const state: CodexSessionState = {
        process: codexProcess,
        pendingRequests: new Map(),
        requestId: 0,
        sessionId,
        cwd: this.cwd,
        model,
      };

      let stdoutBuffer = '';
      let stderrBuffer = '';

      codexProcess.stdout?.on('data', (data) => {
        stdoutBuffer += data.toString();
        this.processStdout(state, stdoutBuffer);
      });

      codexProcess.stderr?.on('data', (data) => {
        stderrBuffer += data.toString();
      });

      codexProcess.on('error', (err) => {
        reject(new Error(`Failed to start Codex: ${err.message}`));
      });

      // Wait for process to be ready
      setTimeout(() => resolve(state), 1000);
    });
  }

  /** Process stdout buffer for complete JSON-RPC messages */
  private processStdout(state: CodexSessionState, buffer: string): void {
    const lines: string[] = buffer.split('\n');
    // Keep last incomplete line in buffer
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i];
      if (!line) continue;
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const message: CodexMessage = JSON.parse(trimmed);
        this.handleMessage(state, message);
      } catch (err) {
        // Ignore incomplete JSON
      }
    }
  }

  /** Handle incoming JSON-RPC message */
  private handleMessage(state: CodexSessionState, message: CodexMessage): void {
    if (message.id !== undefined && state.pendingRequests.has(message.id)) {
      const pending = state.pendingRequests.get(message.id);
      if (!pending) return;
      const { resolve, reject } = pending;
      state.pendingRequests.delete(message.id);

      if (message.error) {
        reject(new Error(`Codex error ${message.error.code}: ${message.error.message}`));
      } else {
        resolve(message.result);
      }
    } else if (message.method) {
      // Handle notifications from Codex
      console.log('[CodexAdapter] Notification:', message.method, message.params);
    }
  }

  /** Send JSON-RPC request */
  private async sendRequest(state: CodexSessionState, method: string, params?: any): Promise<any> {
    const id = ++state.requestId;
    const message: CodexMessage = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      state.pendingRequests.set(id, { resolve, reject });
      state.process.stdin?.write(JSON.stringify(message) + '\n');

      // Timeout after 30 seconds
      setTimeout(() => {
        if (state.pendingRequests.has(id)) {
          state.pendingRequests.delete(id);
          reject(new Error('Codex request timeout'));
        }
      }, 30000);
    });
  }

  // ---------------------------------------------------------------------------
  // Session Management
  // ---------------------------------------------------------------------------

  async createSession(config: SessionConfig): Promise<Session> {
    const sessionId = config.parentID || `codex-session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const model = config.model || this.modelConfig;

    const state = await this.startCodexProcess(sessionId, model);
    this.session = state;

    return {
      id: sessionId,
      parentID: config.parentID,
      title: config.title || 'AI-OFFICE Codex Session',
      cwd: config.cwd || this.cwd,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async promptSession(sessionId: string, prompt: string, options?: PromptOptions): Promise<SessionResult> {
    if (!this.session || this.session.sessionId !== sessionId) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      const result = await this.sendRequest(this.session, 'chat', {
        message: prompt,
        model: options?.systemPrompt ? undefined : this.modelConfig.id,
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
      });

      return {
        text: result?.text || result?.response || '',
        status: 'active',
        usage: {
          input: result?.usage?.inputTokens || 0,
          output: result?.usage?.outputTokens || 0,
          total: (result?.usage?.inputTokens || 0) + (result?.usage?.outputTokens || 0),
        },
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
      { name: 'list', description: 'List directory', inputSchema: { type: 'object' }, available: true },
    ];
  }

  async checkScope(path: string, operation: 'read' | 'write' | 'exec'): Promise<ScopeResult> {
    // Codex operates within the project directory
    const fullPath = path.startsWith('/') ? path : `${this.cwd}/${path}`;

    // Check for sensitive files
    const sensitivePatterns = [
      /\.env$/,
      /\.env\./,
      /\.npmrc$/,
      /\.git\/.*/,
      /id_rsa/,
      /id_ed25519/,
      /\.pem$/,
      /\.key$/,
    ];

    if (sensitivePatterns.some(p => p.test(path))) {
      return { allowed: false, reason: 'Sensitive file', kind: 'sensitive_file' };
    }

    return { allowed: true };
  }

  // ---------------------------------------------------------------------------
  // Subagent Management
  // ---------------------------------------------------------------------------

  async spawnSubagent(config: SubagentConfig): Promise<Subagent> {
    if (!this.session) throw new Error('No active Codex session');

    const subagentId = `codex-subagent-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    // Create a new Codex process for the subagent
    const subagentSession = await this.startCodexProcess(subagentId, config.model);

    if (config.prompt) {
      await this.sendRequest(subagentSession, 'chat', {
        message: config.prompt,
        model: config.model?.id,
      });
    }

    return {
      sessionId: subagentId,
      name: config.name,
      status: 'starting',
      createdAt: new Date().toISOString(),
    };
  }

  async getSubagentResult(subagentId: string): Promise<SubagentResult> {
    // In a full implementation, we'd track subagent sessions
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
    if (this.session) {
      this.session.process.kill();
      this.session = null;
    }
    this.initialized = false;
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  async readFile(path: string): Promise<string> {
    const fs = await import('node:fs/promises');
    const fullPath = path.startsWith('/') ? path : `${this.cwd}/${path}`;
    return fs.readFile(fullPath, 'utf-8');
  }

  async writeFile(path: string, content: string): Promise<void> {
    const fs = await import('node:fs/promises');
    const fullPath = path.startsWith('/') ? path : `${this.cwd}/${path}`;
    await fs.writeFile(fullPath, content, 'utf-8');
  }

  async execCommand(cmd: string, args: string[]): Promise<ExecResult> {
    const { spawn } = await import('node:child_process');
    const { once } = await import('node:events');

    return new Promise((resolve) => {
      const child = spawn(cmd, args, {
        cwd: this.cwd,
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
}

// ============================================================================
// Factory Function for Registration
// ============================================================================

/** Creates a CodexAdapter instance */
export async function createCodexAdapter(config: InitConfig): Promise<CodexAdapter> {
  const adapter = new CodexAdapter();
  await adapter.initialize(config);
  return adapter;
}

// Auto-register when this module is loaded
import {registerAdapter} from 'ai-office-core'
registerAdapter('codex', createCodexAdapter, undefined, false);

// knip-ignore\nexport default CodexAdapter;