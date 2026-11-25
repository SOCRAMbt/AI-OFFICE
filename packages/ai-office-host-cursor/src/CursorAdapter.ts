/**
 * CursorAdapter - HostAdapter implementation for Cursor
 *
 * Wraps VS Code Extension API to implement the universal
 * HostAdapter interface for Cursor IDE.
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
import { registerAdapter } from 'ai-office-core';
import { z } from 'zod';
import { resolve } from 'node:path';

// ============================================================================
// Type Definitions for VS Code / Cursor Context
// ============================================================================

/** Minimal VS Code Extension API interface */
interface VSCodeAPI {
  window: {
    createTerminal: (options: { name: string }) => VSCodeTerminal;
    showInformationMessage: (message: string) => Promise<string | undefined>;
    showErrorMessage: (message: string) => Promise<string | undefined>;
    showWarningMessage: (message: string) => Promise<string | undefined>;
    withProgress: <T>(options: { location: number; title: string; cancellable?: boolean }, task: (progress: { report: (value: { increment?: number; message?: string }) => void }) => Promise<T>) => Promise<T>;
  };
  workspace: {
    workspaceFolders: readonly { uri: { fsPath: string }; name: string; index: number }[] | undefined;
    fs: {
      readFile: (uri: { fsPath: string }) => Promise<Uint8Array>;
      writeFile: (uri: { fsPath: string }, content: Uint8Array) => Promise<void>;
      stat: (uri: { fsPath: string }) => Promise<{ type: number; size: number; ctime: number; mtime: number }>;
      createDirectory: (uri: { fsPath: string }) => Promise<void>;
    };
    openTextDocument: (uri: { fsPath: string }) => Promise<{ uri: { fsPath: string }; getText: () => string }>;
    saveTextDocument: (document: { uri: { fsPath: string }; getText: () => string }) => Promise<boolean>;
  };
  commands: {
    executeCommand: (command: string, ...args: any[]) => Promise<any>;
    registerCommand: (command: string, callback: (...args: any[]) => any) => { dispose: () => void };
  };
  extensions: {
    getExtension: (extensionId: string) => { exports: any } | undefined;
  };
  env: {
    machineId: string;
    sessionId: string;
  };
}

/** VS Code Terminal interface */
interface VSCodeTerminal {
  name: string;
  sendText: (text: string, addNewLine?: boolean) => void;
  show: (preserveFocus?: boolean) => void;
  dispose: () => void;
}

/** Cursor-specific API extensions */
interface CursorAPI extends VSCodeAPI {
  chat?: {
    startSession: (config: { title: string; model?: string }) => Promise<{ id: string }>;
    sendMessage: (sessionId: string, message: string) => Promise<{ text: string }>;
    getSession: (sessionId: string) => Promise<{ model?: { id: string; provider: string } } | undefined>;
  };
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

const WRITE_ACTIONS = new Set(['edit', 'write', 'patch', 'multiedit', 'apply_patch']);

// ============================================================================
// CursorAdapter Implementation
// ============================================================================

export class CursorAdapter implements HostAdapter {
  private vscode: CursorAPI | null = null;
  private modelConfig: ModelConfig = {
    id: 'default',
    provider: 'cursor',
  };
  private initialized = false;
  private sessionCache = new Map<string, { id: string; title: string; parentId?: string }>();
  private terminalCache = new Map<string, VSCodeTerminal>();

  /** Initialize with VS Code extension context */
  async initialize(config: InitConfig): Promise<void> {
    this.initialized = true;
  }

  /** Set the VS Code API (called from extension activation) */
  setVSCodeAPI(vscode: CursorAPI): void {
    this.vscode = vscode;
    if (vscode?.chat) {
      console.log('[CursorAdapter] Cursor chat API detected');
    }
  }

  /** Get the underlying VS Code API */
  getVSCodeAPI(): CursorAPI | null {
    return this.vscode;
  }

  // ---------------------------------------------------------------------------
  // Session Management
  // ---------------------------------------------------------------------------

  async createSession(config: SessionConfig): Promise<Session> {
    if (!this.vscode) throw new Error('CursorAdapter not initialized with VS Code API');

    const sessionId = `cursor-session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const workspaceFolder = this.vscode.workspace.workspaceFolders?.[0];
    const cwd = config.cwd || workspaceFolder?.uri.fsPath || process.cwd();

    const session = {
      id: sessionId,
      parentID: config.parentID,
      title: config.title || 'AI-OFFICE Cursor Session',
      cwd,
      status: 'active' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.sessionCache.set(sessionId, { id: sessionId, title: session.title, parentId: config.parentID });
    return session;
  }

  async promptSession(sessionId: string, prompt: string, options?: PromptOptions): Promise<SessionResult> {
    if (!this.vscode) throw new Error('CursorAdapter not initialized with VS Code API');

    try {
      if (this.vscode.chat) {
        const session = await this.vscode.chat.startSession({
          title: `AI-OFFICE: ${this.sessionCache.get(sessionId)?.title || 'Session'}`,
          model: this.modelConfig.id,
        });

        const result = await this.vscode.chat.sendMessage(session.id, prompt);

        return {
          text: result.text,
          status: 'active',
          usage: { input: 0, output: 0, total: 0 },
        };
      }

      const terminal = this.getOrCreateTerminal(sessionId);
      terminal.sendText(`cursor chat "${prompt.replace(/"/g, '\\"')}"`);
      terminal.show();

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
      { name: 'list', description: 'List directory', inputSchema: { type: 'object' }, available: true },
    ];
  }

  async checkScope(filePath: string, operation: 'read' | 'write' | 'exec'): Promise<ScopeResult> {
    if (!this.vscode) return { allowed: false, reason: 'VS Code API not initialized' };

    try {
      const workspaceFolder = this.vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) return { allowed: false, reason: 'No workspace folder open' };

      const workspacePath = workspaceFolder.uri.fsPath;
      const fullPath = resolve(workspacePath, filePath);

      if (!fullPath.startsWith(workspacePath)) {
        return { allowed: false, reason: 'Path outside workspace', kind: 'outside_scope' };
      }

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

      if (sensitivePatterns.some(p => p.test(filePath))) {
        return { allowed: false, reason: 'Sensitive file', kind: 'sensitive_file' };
      }

      return { allowed: true };
    } catch {
      return { allowed: false, reason: 'Scope check failed' };
    }
  }

  // ---------------------------------------------------------------------------
  // Subagent Management
  // ---------------------------------------------------------------------------

  async spawnSubagent(config: SubagentConfig): Promise<Subagent> {
    if (!this.vscode) throw new Error('CursorAdapter not initialized with VS Code API');

    const subagentId = `cursor-subagent-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    if (this.vscode.chat) {
      const session = await this.vscode.chat.startSession({
        title: `AI-OFFICE Subagent: ${config.name}`,
        model: config.model?.id || this.modelConfig.id,
      });

      if (config.prompt) {
        await this.vscode.chat.sendMessage(session.id, config.prompt);
      }

      return {
        sessionId: session.id,
        name: config.name,
        status: 'starting',
        createdAt: new Date().toISOString(),
      };
    }

    const terminal = this.vscode.window.createTerminal({
      name: `AI-OFFICE Subagent: ${config.name}`,
    });

    if (config.prompt) {
      terminal.sendText(`cursor chat "${config.prompt.replace(/"/g, '\\"')}"`);
    }

    this.terminalCache.set(subagentId, terminal);

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
    this.vscode = null;
    this.initialized = false;
    this.sessionCache.clear();
    for (const terminal of this.terminalCache.values()) {
      terminal.dispose();
    }
    this.terminalCache.clear();
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  async readFile(filePath: string): Promise<string> {
    if (!this.vscode) throw new Error('CursorAdapter not initialized');

    const workspaceFolder = this.vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) throw new Error('No workspace folder');

    const fullPath = filePath.startsWith('/') ? filePath : `${workspaceFolder.uri.fsPath}/${filePath}`;
    const data = await this.vscode.workspace.fs.readFile({ fsPath: fullPath });
    return new TextDecoder().decode(data);
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    if (!this.vscode) throw new Error('CursorAdapter not initialized');

    const workspaceFolder = this.vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) throw new Error('No workspace folder');

    const fullPath = filePath.startsWith('/') ? filePath : `${workspaceFolder.uri.fsPath}/${filePath}`;
    const data = new TextEncoder().encode(content);
    await this.vscode.workspace.fs.writeFile({ fsPath: fullPath }, data);
  }

  async execCommand(cmd: string, args: string[]): Promise<ExecResult> {
    if (!this.vscode) throw new Error('CursorAdapter not initialized');

    const terminal = this.vscode.window.createTerminal({ name: `Exec: ${cmd}` });
    const fullCmd = [cmd, ...args].join(' ');

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';

      terminal.sendText(fullCmd);
      terminal.show();

      setTimeout(() => {
        terminal.dispose();
        resolve({
          exitCode: 0,
          stdout: `Executed: ${fullCmd}`,
          stderr: '',
          timedOut: false,
        });
      }, 1000);
    });
  }

  // ---------------------------------------------------------------------------
  // Internal Helpers
  // ---------------------------------------------------------------------------

  private getOrCreateTerminal(sessionId: string): VSCodeTerminal {
    if (!this.terminalCache.has(sessionId)) {
      const terminal = this.vscode!.window.createTerminal({
        name: `AI-OFFICE: ${sessionId}`,
      });
      this.terminalCache.set(sessionId, terminal);
    }
    return this.terminalCache.get(sessionId)!;
  }
}

// ============================================================================
// Factory Function for Registration
// ============================================================================

/** Creates a CursorAdapter instance */
export async function createCursorAdapter(config: InitConfig): Promise<CursorAdapter> {
  const adapter = new CursorAdapter();
  await adapter.initialize(config);
  return adapter;
}

// Auto-register when this module is loaded
registerAdapter('cursor', createCursorAdapter, undefined, false);

// knip-ignore\nexport default CursorAdapter;