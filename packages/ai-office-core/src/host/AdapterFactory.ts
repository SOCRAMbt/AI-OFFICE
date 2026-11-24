/**
 * AdapterFactory - Creates and manages HostAdapter instances
 *
 * Central registry for platform adapters. Handles auto-detection,
 * explicit creation, and custom adapter registration.
 */

import type {
  HostAdapter,
  InitConfig,
  PlatformCapabilities,
} from './HostAdapter.js';
import type { PlatformType } from './PlatformType.js';
import { detectPlatform, PLATFORM_DETECTION, getPlatformCapabilities } from './PlatformType.js';

// ============================================================================
// Adapter Registry
// ============================================================================

/** Internal adapter registration */
interface AdapterRegistration {
  /** Factory function to create the adapter */
  create: (config: InitConfig) => Promise<HostAdapter>;
  /** Platform capabilities */
  capabilities: PlatformCapabilities;
  /** Whether this is a built-in adapter */
  builtin: boolean;
}

/** Registry of known adapters */
const adapterRegistry = new Map<PlatformType, AdapterRegistration>();

/** Tracks the currently active adapter */
let activeAdapter: HostAdapter | null = null;
let activePlatform: PlatformType | null = null;

/**
 * Registers a platform adapter.
 * Called by each adapter package during initialization.
 *
 * @param platform - Platform type
 * @param create - Factory function to create adapter instance
 * @param capabilities - Platform capabilities (optional, defaults to standard)
 * @param builtin - Whether this is a built-in adapter
 */
export function registerAdapter(
  platform: PlatformType,
  create: (config: InitConfig) => Promise<HostAdapter>,
  capabilities?: Partial<PlatformCapabilities>,
  builtin = false
): void {
  const fullCapabilities = getPlatformCapabilities(platform);
  if (capabilities) {
    Object.assign(fullCapabilities, capabilities);
  }

  adapterRegistry.set(platform, { create, capabilities: fullCapabilities, builtin });
}

/**
 * Creates an adapter for the specified platform.
 *
 * @param platform - Platform type to create adapter for
 * @param config - Initialization configuration
 * @returns Initialized HostAdapter instance
 * @throws If platform is not registered
 */
export async function createAdapter(
  platform: PlatformType,
  config: InitConfig
): Promise<HostAdapter> {
  const registration = adapterRegistry.get(platform);
  if (!registration) {
    const available = Array.from(adapterRegistry.keys()).join(', ');
    throw new Error(
      `No adapter registered for platform: ${platform}. Available: ${available}`
    );
  }

  const adapter = await registration.create(config);
  await adapter.initialize(config);
  return adapter;
}

/**
 * Auto-detects the platform and creates the appropriate adapter.
 *
 * @param config - Initialization configuration (projectRoot required)
 * @returns Initialized HostAdapter for detected platform
 * @throws If no platform can be detected or adapter not registered
 */
export async function createAutoAdapter(config: InitConfig): Promise<HostAdapter> {
  const detected = detectPlatform();
  if (!detected) {
    throw new Error(
      'Could not auto-detect platform. Set one of these env vars: ' +
      Object.entries(PLATFORM_DETECTION)
        .flatMap(([_, vars]) => vars)
        .join(', ')
    );
  }

  const registration = adapterRegistry.get(detected);
  if (!registration) {
    throw new Error(
      `Detected platform ${detected} but no adapter is registered. ` +
      `Install @ai-office/host-${detected} package.`
    );
  }

  const adapter = await registration.create(config);
  await adapter.initialize(config);
  return adapter;
}

/**
 * Gets the currently active adapter (if any).
 * @returns Active HostAdapter or null
 */
export function getActiveAdapter(): HostAdapter | null {
  return activeAdapter;
}

/**
 * Gets the currently active platform type.
 * @returns Active PlatformType or null
 */
export function getActivePlatform(): PlatformType | null {
  return activePlatform;
}

/**
 * Sets the active adapter for the current context.
 * Used by the CLI and entry points to provide a singleton adapter.
 *
 * @param adapter - Adapter instance
 * @param platform - Platform type
 */
export function setActiveAdapter(adapter: HostAdapter, platform: PlatformType): void {
  activeAdapter = adapter;
  activePlatform = platform;
}

/**
 * Clears the active adapter.
 */
export function clearActiveAdapter(): void {
  activeAdapter = null;
  activePlatform = null;
}

/**
 * Lists all registered platforms.
 * @returns Array of registered platform types
 */
export function listRegisteredPlatforms(): PlatformType[] {
  return Array.from(adapterRegistry.keys());
}

/**
 * Checks if a platform adapter is registered.
 * @param platform - Platform to check
 * @returns True if registered
 */
export function isPlatformRegistered(platform: PlatformType): boolean {
  return adapterRegistry.has(platform);
}

/**
 * Gets capabilities for a registered platform.
 * @param platform - Platform type
 * @returns Platform capabilities or undefined if not registered
 */
export function getRegisteredCapabilities(platform: PlatformType): PlatformCapabilities | undefined {
  return adapterRegistry.get(platform)?.capabilities;
}

/**
 * Unregisters a platform adapter (mainly for testing).
 * @param platform - Platform to unregister
 */
export function unregisterAdapter(platform: PlatformType): void {
  adapterRegistry.delete(platform);
}

/**
 * AdapterFactory class - static interface for common operations
 */
export class AdapterFactory {
  /**
   * Creates an adapter for the specified platform.
   * @param platform - Platform type
   * @param config - Initialization config
   * @returns HostAdapter instance
   */
  static async create(platform: PlatformType, config: InitConfig): Promise<HostAdapter> {
    return createAdapter(platform, config);
  }

  /**
   * Auto-detects platform and creates adapter.
   * @param config - Initialization config
   * @returns HostAdapter instance
   */
  static async detectAndCreate(config: InitConfig): Promise<HostAdapter> {
    return createAutoAdapter(config);
  }

  /**
   * Detects the current platform from environment.
   * @returns PlatformType or null
   */
  static detectPlatform(): PlatformType | null {
    return detectPlatform();
  }

  /**
   * Registers a custom adapter.
   * @param platform - Platform type
   * @param adapter - Adapter instance (or factory function)
   */
  static registerAdapter(
    platform: PlatformType,
    create: (config: InitConfig) => Promise<HostAdapter>,
    capabilities?: Partial<PlatformCapabilities>
  ): void {
    registerAdapter(platform, create, capabilities, false);
  }

  /**
   * Gets the active adapter.
   * @returns Active HostAdapter or null
   */
  static getActive(): HostAdapter | null {
    return getActiveAdapter();
  }

  /**
   * Gets the active platform.
   * @returns Active PlatformType or null
   */
  static getActivePlatform(): PlatformType | null {
    return getActivePlatform();
  }

  /**
   * Lists all registered platforms.
   * @returns Array of platform types
   */
  static listPlatforms(): PlatformType[] {
    return listRegisteredPlatforms();
  }
}

// adapterRegistry is internal, not exported