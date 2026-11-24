/**
 * ClaudeCodeAdapter - HostAdapter implementation for Claude Code
 *
 * Implements the universal HostAdapter interface using Anthropic SDK
 * with beta.messages.create and tool definitions.
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
import { Anthropic } from '@anthropic-ai/sdk';

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

/** Anthropic message param */
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Array<{ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: any }>;
}

/** Tool definition for Anthropic */
interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** Session state */
interface ClaudeCodeSessionState {
  messages: AnthropicMessage[];
  sessionId: string;
  cwd: string;
  model?: ModelConfig;
  tools: Map<string, AnthropicTool>;
}

// ============================================================================
// ClaudeCodeAdapter Implementation
// ============================================================================

export class ClaudeCodeAdapter implements HostAdapter {
  private client: Anthropic | null = null;
  private modelConfig: ModelConfig = {
    id: 'claude-3-5-sonnet-20241022',
    provider: 'anthropic',
  };
  private initialized = false;
  private session: ClaudeCodeSessionState | null = null;
  private cwd: string = process.cwd();

  /** Initialize with Anthropic API key */
  async initialize(config: InitConfig): Promise<void> {
    this.cwd = config.projectRoot;
    const apiKey = config.platformConfig?.['ANTHROPIC_API_KEY'] || process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      console.warn('[ClaudeCodeAdapter] No ANTHROPIC_API_KEY provided. Adapter will not function without it.');
    } else {
      this.client = new Anthropic(apiKey);
    }

    this.initialized = true;
  }

  /** Set Anthropic client (for testing) */
  setClient(client: Anthropic): void {
    this.client = client;
  }

  // ---------------------------------------------------------------------------
  // Session Management
  // ---------------------------------------------------------------------------

  async createSession(config: SessionConfig): Promise<Session> {
    const sessionId = `claude-code-session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const model = config.model || this.modelConfig;

    this.session = {
      messages: [],
      sessionId,
      cwd: config.cwd || this.cwd,
      model,
      tools: new Map(),
    };

    return {
      id: sessionId,
      parentID: config.parentID,
      title: config.title || 'AI-OFFICE Claude Code Session',
      cwd: config.cwd || this.cwd,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async promptSession(sessionId: string, prompt: string, options?: PromptOptions): Promise<SessionResult> {
    if (!this.client) throw new Error('ClaudeCodeAdapter not initialized with Anthropic client');
    if (!this.session || this.session.sessionId !== sessionId) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      this.session.messages.push({ role: 'user', content: prompt });

      const tools = this.getAvailableTools().map(t => ({
        name: t.name,
        description: t.description,
        input_schema: {
          type: 'object' as const,
          properties: t.inputSchema as Record<string, unknown>,
        },
      }));

      const response = await this.client.messages.create({
        model: options?.systemPrompt ? this.modelConfig.id : this.modelConfig.id,
        max_tokens: options?.maxTokens || 4096,
        temperature: options?.temperature ?? 0.7,
        system: options?.systemPrompt,
        messages: this.session.messages,
        tools: tools.length > 0 ? tools : undefined,
      });

      let responseText = '';
      const toolCalls: ToolCall[] = [];

      for (const content of response.content) {
        if (content.type === 'text') {
          responseText += content.text;
        } else if (content.type === 'tool_use') {
          toolCalls.push({
            name: content.name,
            input: content.input as Record<string, unknown>,
            success: true,
          });
        }
      }

      this.session.messages.push({ role: 'assistant', content: responseText });

      return {
        text: responseText,
        toolCalls,
        status: 'active',
        usage: {
          input: response.usage?.input_tokens || 0,
          output: response.usage?.output_tokens || 0,
          total: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
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
    if (!this.client) throw new Error('ClaudeCodeAdapter not initialized');

    const subagentId = `claude-code-subagent-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    // Create a new session state for the subagent
    const subagentSession: ClaudeCodeSessionState = {
      messages: [],
      sessionId: subagentId,
      cwd: config.cwd || this.cwd,
      model: config.model || this.modelConfig,
      tools: new Map(),
    };

    if (config.prompt) {
      subagentSession.messages.push({ role: 'user', content: config.prompt });
    }

    // Store subagent session (in a real implementation, this would be persisted)
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

/** Creates a ClaudeCodeAdapter instance */
export async function createClaudeCodeAdapter(config: InitConfig): Promise<ClaudeCodeAdapter> {
  const adapter = new ClaudeCodeAdapter();
  await adapter.initialize(config);
  return adapter;
}

// Auto-register when this module is loaded
import { registerAdapter } from 'ai-office-core';
registerAdapter('claude-code', createClaudeCodeAdapter, undefined, false);

export default ClaudeCodeAdapter;