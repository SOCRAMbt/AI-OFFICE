/**
 * GrokAdapter - HostAdapter implementation for Grok (xAI)
 *
 * Implements the universal HostAdapter interface using OpenAI-compatible
 * client with baseURL x.ai and x-api-key header.
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
import { z } from 'zod';
import OpenAI from 'openai';

// ============================================================================
// Type Definitions
// ============================================================================

/** Tool call representation */
interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
  success: boolean;
  error?: string;
}

/** Session state */
interface GrokSessionState {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  sessionId: string;
  cwd: string;
  model?: ModelConfig;
}

// ============================================================================
// GrokAdapter Implementation
// ============================================================================

export class GrokAdapter implements HostAdapter {
  private client: OpenAI | null = null;
  private modelConfig: ModelConfig = {
    id: 'grok-beta',
    provider: 'xai',
  };
  private initialized = false;
  private session: GrokSessionState | null = null;
  private cwd: string = process.cwd();

  /** Initialize with xAI API key */
  async initialize(config: InitConfig): Promise<void> {
    this.cwd = config.projectRoot;
    const apiKey = config.platformConfig?.['GROK_API_KEY'] || config.platformConfig?.['XAI_API_KEY'] || process.env.GROK_API_KEY || process.env.XAI_API_KEY;

    if (!apiKey) {
      console.warn('[GrokAdapter] No GROK_API_KEY or XAI_API_KEY provided. Adapter will not function without it.');
    } else {
      this.client = new OpenAI({
        apiKey,
        baseURL: 'https://api.x.ai/v1',
        defaultHeaders: {
          'x-api-key': apiKey,
        },
      } as any);
    }

    this.initialized = true;
  }

  /** Set OpenAI client (for testing) */
  setClient(client: OpenAI): void {
    this.client = client;
  }

  // ---------------------------------------------------------------------------
  // Session Management
  // ---------------------------------------------------------------------------

  async createSession(config: SessionConfig): Promise<Session> {
    const sessionId = `grok-session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const model = config.model || this.modelConfig;

    this.session = {
      messages: [],
      sessionId,
      cwd: config.cwd || this.cwd,
      model,
    };

    return {
      id: sessionId,
      parentID: config.parentID,
      title: config.title || 'AI-OFFICE Grok Session',
      cwd: config.cwd || this.cwd,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async promptSession(sessionId: string, prompt: string, options?: PromptOptions): Promise<SessionResult> {
    if (!this.client) throw new Error('GrokAdapter not initialized with xAI client');
    if (!this.session || this.session.sessionId !== sessionId) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      this.session.messages.push({ role: 'user', content: prompt });

      const response = await this.client.chat.completions.create({
        model: this.modelConfig.id,
        messages: this.session.messages.map(m => ({ role: m.role, content: m.content })),
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens || 4096,
        stream: false,
      });

      const responseText = response.choices[0]?.message?.content || '';
      this.session.messages.push({ role: 'assistant', content: responseText });

      return {
        text: responseText,
        status: 'active',
        usage: {
          input: response.usage?.prompt_tokens || 0,
          output: response.usage?.completion_tokens || 0,
          total: response.usage?.total_tokens || 0,
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
      { name: 'read', description: 'Read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } }, available: true },
      { name: 'write', description: 'Write a file', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } }, available: true },
      { name: 'edit', description: 'Edit a file', inputSchema: { type: 'object', properties: { path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' } } }, available: true },
      { name: 'bash', description: 'Execute shell command', inputSchema: { type: 'object', properties: { command: { type: 'string' } } }, available: true },
      { name: 'glob', description: 'Find files by pattern', inputSchema: { type: 'object', properties: { pattern: { type: 'string' } } }, available: true },
      { name: 'grep', description: 'Search file contents', inputSchema: { type: 'object', properties: { pattern: { type: 'string' } } }, available: true },
      { name: 'list', description: 'List directory', inputSchema: { type: 'object', properties: { path: { type: 'string' } } }, available: true },
    ];
  }

  async checkScope(path: string, operation: 'read' | 'write' | 'exec'): Promise<ScopeResult> {
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
    const subagentId = `grok-subagent-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    return {
      sessionId: subagentId,
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
    this.client = null;
    this.session = null;
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

/** Creates a GrokAdapter instance */
export async function createGrokAdapter(config: InitConfig): Promise<GrokAdapter> {
  const adapter = new GrokAdapter();
  await adapter.initialize(config);
  return adapter;
}

// Auto-register when this module is loaded
import { registerAdapter } from 'ai-office-core';
registerAdapter('grok', createGrokAdapter, undefined, false);

// knip-ignore\nexport default GrokAdapter;