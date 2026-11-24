/**
 * AI-OFFICE Core - Platform-agnostic agent orchestration engine
 *
 * This is the core engine that contains all business logic for:
 * - Agent orchestration and lifecycle
 * - Card/task management with DAG dependencies
 * - Quality gates (technical, security, requirements)
 * - Scope enforcement and tripwire detection
 * - State persistence and recovery
 * - Inter-agent communication (bus)
 * - Roster and lease management
 *
 * The core has ZERO dependencies on platform SDKs.
 * Platform integration is done via the HostAdapter interface.
 */

export * from './host/index.js';

// Re-export core types and utilities
export type {
  AgentState,
  Card,
  CardState,
  CardType,
  CatalogAgent,
  CatalogMatch,
  Ficha,
  GatePhaseResult,
  GateResult,
  Limits,
  OfficeState,
  Roster,
  RosterEntry,
} from './types.js';

export type { RolePanel } from './catalog.js';
// ScopePolicy is already exported from sandbox.js below

export {
  CONSERVATIVE_MAX_AGENTS,
  DEFAULT_LIMITS,
  StateCorruptionError,
} from './types.js';

export { Office, type OfficeOptions } from './office.js';
export { OfficeFactory } from './officeFactory.js';

// Core utilities
export { ensureDir, exists, nowIso, readJson, readText, shortId, writeJsonAtomic, writeAtomic } from './fsx.js';
export { withLock } from './atomic.js';
export { cardDir, resolvePaths, type ResolvedPaths } from './paths.js';

// Gates
export { detectTooling, runTechnicalGates, runSecurityGate, consolidate, type CommandRunner, type Tooling } from './gates.js';

// Bus
export { Bus, CHANNELS } from './bus.js';

// State management
export { createRun, transitionCard, transitionRun, assertInvariants, selectNextCard, migrateState, isRunComplete } from './state.js';

// Factory
export { createFicha, CandidateRegistry } from './factory.js';

// Catalog
export { scanCatalog, loadDynamicAgents, resolveRole, rankCandidates } from './catalog.js';

// Briefing
export { buildBriefing as buildBriefingContext, renderBriefing, type Briefing } from './briefing.js';

// Router
export { routeCard, routeHelp, ownerStreak, type RouteResult } from './router.js';

// Retry
export { decideRetry, recordRejection, recordApproval } from './retry.js';

// Memory
export { recordGateOutcome, recordFailureFingerprint, recordClose } from './memory.js';

// Triage
export { shouldUseLite, normalizeModeArg } from './triage.js';

// Circuit breaker
export { recordFailure, blockReason } from './circuitBreaker.js';

// Stores
export { createStores, EvidenceStore } from './stores.js';

// Platform integration
export { Tripwire } from './tripwire.js';
export { analyzeShellCommand, checkScope, globToRegex, matchesScope, type ScopePolicy, type ScopeVerdict } from './sandbox.js';
export { extractCommand, extractPaths, resolveScopeCard, pathsFromPatch, extractPath, FILE_WRITE_TOOLS, SHELL_TOOLS, DELEGATE_TOOLS } from './hooks/scopeGuard.js';
export { logger } from './log.js';
export { childModelFrom } from './childModel.js';
export { buildTools, type OficinaTool, type ToolContext, type OficinaToolResult, type ToolHooks } from './tools/index.js';
export { startDashboard, openBrowser } from './dashboard.js';
export { snapshotMesa, renderMesa, renderMesaBrief } from './mesa.js';
export { buildSystemPrompt } from './systemPrompt.js';