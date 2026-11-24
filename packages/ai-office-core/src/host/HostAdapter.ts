/**
 * HostAdapter - Universal interface for AI coding platform integration
 *
 * Every platform adapter MUST implement this exact interface.
 * The core engine depends ONLY on this interface - zero platform SDKs in core.
 */

import type { PlatformType, PlatformCapabilities } from './PlatformType.js';
import { getPlatformCapabilities } from './PlatformType.js';

// ============================================================================
// Configuration Types
// ============================================================================

/** Session creation configuration */
export interface SessionConfig {
  /** Parent session ID for subagent inheritance */
  parentID?: string;
  /** Session title/description */
  title?: string;
  /** Working directory for the session */
  cwd?: string;
  /** Initial prompt to send */
  initialPrompt?: string;
  /** Model configuration override */
  model?: ModelConfig;
  /** Metadata for tracking */
  metadata?: Record<string, unknown>;
}

/** Session representation */
export interface Session {
  /** Unique session identifier */
  id: string;
  /** Parent session ID if this is a subagent */
  parentID?: string;
  /** Session title */
  title: string;
  /** Current working directory */
  cwd: string;
  /** Session status */
  status: 'active' | 'idle' | 'completed' | 'failed';
  /** Creation timestamp */
  createdAt: string;
  /** Last activity timestamp */
  updatedAt: string;
}

/** Prompt execution options */
export interface PromptOptions {
  /** System prompt override */
  systemPrompt?: string;
  /** Temperature for generation */
  temperature?: number;
  /** Max tokens for response */
  maxTokens?: number;
  /** Whether to stream the response */
  stream?: boolean;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/** Result of a prompt execution */
export interface SessionResult {
  /** Response text */
  text: string;
  /** Tool calls made during execution */
  toolCalls?: ToolCall[];
  /** Token usage */
  usage?: TokenUsage;
  /** Session status after execution */
  status: 'active' | 'idle' | 'completed' | 'failed';
  /** Error if execution failed */
  error?: string;
}

/** Tool call representation */
export interface ToolCall {
  /** Tool name */
  name: string;
  /** Tool input arguments */
  input: Record<string, unknown>;
  /** Tool output/result */
  output?: unknown;
  /** Whether the call succeeded */
  success: boolean;
  /** Error if failed */
  error?: string;
}

/** Token usage tracking */
export interface TokenUsage {
  /** Input tokens */
  input: number;
  /** Output tokens */
  output: number;
  /** Total tokens */
  total: number;
  /** Cache read tokens (if supported) */
  cacheRead?: number;
  /** Cache write tokens (if supported) */
  cacheWrite?: number;
}

/** Tool definition for platform capabilities */
export interface Tool {
  /** Tool name */
  name: string;
  /** Tool description */
  description: string;
  /** JSON Schema for input validation */
  inputSchema: Record<string, unknown>;
  /** Whether tool is available in current context */
  available: boolean;
}

/** Scope check result */
export interface ScopeResult {
  /** Whether the operation is allowed */
  allowed: boolean;
  /** Reason if not allowed */
  reason?: string;
  /** Violation kind */
  kind?: 'forbidden' | 'outside_scope' | 'sensitive_file';
}

/** Subagent configuration */
export interface SubagentConfig {
  /** Agent name/role */
  name: string;
  /** Agent description */
  description: string;
  /** System prompt for the subagent */
  systemPrompt: string;
  /** Initial user prompt */
  prompt: string;
  /** Working directory */
  cwd?: string;
  /** Model configuration */
  model?: ModelConfig;
  /** Parent session ID */
  parentSessionId: string;
  /** Associated card ID (for scope inheritance) */
  cardId?: string;
  /** Metadata */
  metadata?: Record<string, unknown>;
}

/** Subagent representation */
export interface Subagent {
  /** Subagent session ID */
  sessionId: string;
  /** Agent name */
  name: string;
  /** Current status */
  status: 'starting' | 'running' | 'completed' | 'failed';
  /** Creation timestamp */
  createdAt: string;
}

/** Subagent execution result */
export interface SubagentResult {
  /** Subagent session ID */
  sessionId: string;
  /** Final result text */
  result: string;
  /** Whether execution succeeded */
  success: boolean;
  /** Error if failed */
  error?: string;
  /** Token usage */
  usage?: TokenUsage;
  /** Completion timestamp */
  completedAt: string;
}

/** Model configuration */
export interface ModelConfig {
  /** Model identifier */
  id: string;
  /** Provider identifier */
  provider: string;
  /** Model variant (if applicable) */
  variant?: string;
  /** Model parameters */
  parameters?: Record<string, unknown>;
}

/** Initialization configuration */
export interface InitConfig {
  /** Project root directory */
  projectRoot: string;
  /** Platform-specific configuration */
  platformConfig?: Record<string, unknown>;
  /** Whether to enable debug logging */
  debug?: boolean;
}

/** Command execution result */
export interface ExecResult {
  /** Exit code */
  exitCode: number;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Whether command timed out */
  timedOut: boolean;
}

// ============================================================================
// HostAdapter Interface
// ============================================================================

/**
 * HostAdapter - The universal interface every platform must implement.
 *
 * This is the ONLY dependency the core engine has on platform-specific code.
 * All platform SDKs, APIs, and quirks are encapsulated behind these 12 methods.
 */
export interface HostAdapter {
  // ---------------------------------------------------------------------------
  // Session Management
  // ---------------------------------------------------------------------------

  /**
   * Creates a new session on the host platform.
   * @param config - Session configuration
   * @returns The created session
   */
  createSession(config: SessionConfig): Promise<Session>;

  /**
   * Sends a prompt to a session and gets the result.
   * @param sessionId - Target session ID
   * @param prompt - User prompt text
   * @param options - Execution options
   * @returns Execution result with response, tool calls, and usage
   */
  promptSession(sessionId: string, prompt: string, options?: PromptOptions): Promise<SessionResult>;

  // ---------------------------------------------------------------------------
  // Tools & Scope
  // ---------------------------------------------------------------------------

  /**
   * Returns all tools available on this platform.
   * Used by the core to understand platform capabilities.
   * @returns Array of tool definitions
   */
  getAvailableTools(): Tool[];

  /**
   * Checks if a path/operation is within the allowed scope.
   * @param path - File or directory path to check
   * @param operation - Type of operation
   * @returns Scope check result
   */
  checkScope(path: string, operation: 'read' | 'write' | 'exec'): Promise<ScopeResult>;

  // ---------------------------------------------------------------------------
  // Subagent Management
  // ---------------------------------------------------------------------------

  /**
   * Spawns a subagent (child session) on the host platform.
   * @param config - Subagent configuration
   * @returns The spawned subagent
   */
  spawnSubagent(config: SubagentConfig): Promise<Subagent>;

  /**
   * Gets the result of a completed subagent.
   * @param subagentId - Subagent session ID
   * @returns Subagent execution result
   */
  getSubagentResult(subagentId: string): Promise<SubagentResult>;

  // ---------------------------------------------------------------------------
  // Model Management
  // ---------------------------------------------------------------------------

  /**
   * Gets the current model configuration.
   * @returns Current model config
   */
  getModel(): ModelConfig;

  /**
   * Sets the model configuration for future sessions.
   * @param model - New model configuration
   */
  setModel(model: ModelConfig): void;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Initializes the adapter with platform-specific configuration.
   * @param config - Initialization configuration
   */
  initialize(config: InitConfig): Promise<void>;

  /**
   * Shuts down the adapter and cleans up resources.
   */
  shutdown(): Promise<void>;

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  /**
   * Reads a file from the filesystem.
   * @param path - File path (relative to project root)
   * @returns File contents
   */
  readFile(path: string): Promise<string>;

  /**
   * Writes a file to the filesystem.
   * @param path - File path (relative to project root)
   * @param content - File content
   */
  writeFile(path: string, content: string): Promise<void>;

  /**
   * Executes a shell command.
   * @param cmd - Command to execute
   * @param args - Command arguments
   * @returns Execution result
   */
  execCommand(cmd: string, args: string[]): Promise<ExecResult>;
}

// Re-export PlatformCapabilities and getPlatformCapabilities from PlatformType
export type { PlatformCapabilities } from './PlatformType.js';
export { getPlatformCapabilities } from './PlatformType.js';