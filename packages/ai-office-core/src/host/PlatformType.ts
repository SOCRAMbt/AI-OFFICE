/**
 * PlatformType - Supported AI coding platforms
 *
 * Each platform has a unique identifier used by the AdapterFactory
 * for auto-detection and explicit creation.
 */
export type PlatformType =
  | 'opencode'
  | 'cursor'
  | 'codex'
  | 'claude-code'
  | 'grok'
  | 'gemini';

/**
 * Environment variable mapping for platform auto-detection.
 * The first matching env var determines the platform.
 */
export const PLATFORM_DETECTION: Readonly<Record<PlatformType, readonly string[]>> = {
  'opencode': ['OPENCODE_CONFIG_DIR', 'OPENCODE_SESSION_ID'],
  'cursor': ['CURSOR_TRACE_ID', 'VSCODE_PID'],
  'codex': ['CODEX_SESSION_ID'],
  'claude-code': ['CLAUDE_CODE_ENTRYPOINT'],
  'grok': ['GROK_API_KEY', 'XAI_API_KEY'],
  'gemini': ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
} as const;

/**
 * Detects the current platform from environment variables.
 * Returns the first platform whose env vars are present.
 */
export function detectPlatform(): PlatformType | null {
  for (const [platform, envVars] of Object.entries(PLATFORM_DETECTION)) {
    for (const envVar of envVars) {
      if (process.env[envVar]) {
        return platform as PlatformType;
      }
    }
  }
  return null;
}

/**
 * Gets the capabilities for a platform type.
 * Used for graceful degradation when a feature isn't supported.
 */
export interface PlatformCapabilities {
  /** Supports subagent/spawning */
  subagents: boolean;
  /** Supports streaming responses */
  streaming: boolean;
  /** Supports model switching at runtime */
  modelSwitching: boolean;
  /** Supports scope enforcement */
  scopeEnforcement: boolean;
  /** Supports file system access */
  fileSystem: boolean;
  /** Supports shell command execution */
  shellExecution: boolean;
  /** Supports token usage tracking */
  tokenTracking: boolean;
  /** Maximum context window in tokens */
  maxContextTokens?: number;
  /** Supported model providers */
  supportedProviders: string[];
}

/**
 * Gets the capabilities for a platform type.
 * Used for graceful degradation when a feature isn't supported.
 */
export function getPlatformCapabilities(platform: PlatformType): PlatformCapabilities {
  const baseCapabilities: PlatformCapabilities = {
    subagents: true,
    streaming: true,
    modelSwitching: true,
    scopeEnforcement: true,
    fileSystem: true,
    shellExecution: true,
    tokenTracking: true,
    supportedProviders: [],
  };

  switch (platform) {
    case 'opencode':
      return {
        ...baseCapabilities,
        supportedProviders: ['anthropic', 'openai', 'google', 'xai', 'openrouter'],
        maxContextTokens: 200000,
      };
    case 'cursor':
      return {
        ...baseCapabilities,
        supportedProviders: ['anthropic', 'openai'],
        maxContextTokens: 128000,
      };
    case 'codex':
      return {
        ...baseCapabilities,
        supportedProviders: ['openai'],
        maxContextTokens: 128000,
      };
    case 'claude-code':
      return {
        ...baseCapabilities,
        supportedProviders: ['anthropic'],
        maxContextTokens: 200000,
      };
    case 'grok':
      return {
        ...baseCapabilities,
        supportedProviders: ['xai'],
        maxContextTokens: 128000,
      };
    case 'gemini':
      return {
        ...baseCapabilities,
        supportedProviders: ['google'],
        maxContextTokens: 1000000,
      };
    default:
      return baseCapabilities;
  }
}