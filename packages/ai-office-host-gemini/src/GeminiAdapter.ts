/**
 * GeminiAdapter - HostAdapter implementation for Google Gemini
 *
 * Implements the universal HostAdapter interface using
 * Google Generative AI SDK (getGenerativeModel, startChat).
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
import type { GenerativeModel, ChatSession } from '@google/generative-ai';
import { GoogleGenerativeAI } from '@google/generative-ai';

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
interface GeminiSessionState {
  model: GenerativeModel;
  chat: ChatSession | null;
  sessionId: string;
  cwd: string;
  modelConfig?: ModelConfig;
}

// ============================================================================
// GeminiAdapter Implementation
// ============================================================================

export class GeminiAdapter implements HostAdapter {
  private genAI: GoogleGenerativeAI | null = null;
  private modelConfig: ModelConfig = {
    id: 'gemini-1.5-pro',
    provider: 'google',
  };
  private initialized = false;
  private session: GeminiSessionState | null = null;
  private cwd: string = process.cwd();

  /** Initialize with Google API key */
  async initialize(config: InitConfig): Promise<void> {
    this.cwd = config.projectRoot;
    const apiKey = config.platformConfig?.['GOOGLE_API_KEY'] || config.platformConfig?.['GEMINI_API_KEY'] || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;

    if (!apiKey) {
      console.warn('[GeminiAdapter] No GOOGLE_API_KEY or GEMINI_API_KEY provided. Adapter will not function without it.');
    } else {
      this.genAI = new GoogleGenerativeAI(String(apiKey));
    }

    this.initialized = true;
  }

  /** Set GoogleGenerativeAI client (for testing) */
  setClient(genAI: GoogleGenerativeAI): void {
    this.genAI = genAI;
  }

  // ---------------------------------------------------------------------------
  // Session Management
  // ---------------------------------------------------------------------------

  async createSession(config: SessionConfig): Promise<Session> {
    if (!this.genAI) throw new Error('GeminiAdapter not initialized with Google API key');

    const sessionId = `gemini-session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const model = config.model || this.modelConfig;

    const generativeModel = this.genAI.getGenerativeModel({
      model: model.id,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4096,
      },
    });

    this.session = {
      model: generativeModel,
      chat: null,
      sessionId,
      cwd: config.cwd || this.cwd,
      modelConfig: model,
    };

    return {
      id: sessionId,
      parentID: config.parentID,
      title: config.title || 'AI-OFFICE Gemini Session',
      cwd: config.cwd || this.cwd,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async promptSession(sessionId: string, prompt: string, options?: PromptOptions): Promise<SessionResult> {
    if (!this.genAI) throw new Error('GeminiAdapter not initialized with Google API key');
    if (!this.session || this.session.sessionId !== sessionId) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      // Start chat if not already started
      if (!this.session.chat) {
        this.session.chat = this.session.model.startChat({
          history: [],
          generationConfig: {
            temperature: options?.temperature ?? 0.7,
            maxOutputTokens: options?.maxTokens || 4096,
          },
        });
      }

      const result = await this.session.chat.sendMessage(prompt);
      const responseText = result.response.text();

      return {
        text: responseText,
        status: 'active',
        usage: {
          input: result.response.usageMetadata?.promptTokenCount || 0,
          output: result.response.usageMetadata?.candidatesTokenCount || 0,
          total: result.response.usageMetadata?.totalTokenCount || 0,
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
    if (!this.genAI) throw new Error('GeminiAdapter not initialized');

    const subagentId = `gemini-subagent-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    // Create a new model/chat for the subagent
    const model = config.model || this.modelConfig;
    const generativeModel = this.genAI!.getGenerativeModel({
      model: model.id,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4096,
      },
    });

    const chat = generativeModel.startChat({ history: [] });

    if (config.prompt) {
      await chat.sendMessage(config.prompt);
    }

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
    this.genAI = null;
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

/** Creates a GeminiAdapter instance */
export async function createGeminiAdapter(config: InitConfig): Promise<GeminiAdapter> {
  const adapter = new GeminiAdapter();
  await adapter.initialize(config);
  return adapter;
}

// Auto-register when this module is loaded
import { registerAdapter } from 'ai-office-core';
registerAdapter('gemini', createGeminiAdapter, undefined, false);

// knip-ignore\nexport default GeminiAdapter;