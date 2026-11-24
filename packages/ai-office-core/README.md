# @ai-office/core

AI-OFFICE Core Engine - Platform-agnostic agent orchestration.

## Overview

The core engine contains all business logic for:
- Agent orchestration and lifecycle
- Card/task management with DAG dependencies
- Quality gates (technical, security, requirements)
- Scope enforcement and tripwire detection
- State persistence and recovery
- Inter-agent communication (bus)
- Roster and lease management

The core has **ZERO dependencies on platform SDKs**. Platform integration is done via the HostAdapter interface.

## Installation

```bash
npm install @ai-office/core
```

## Quick Start

```typescript
import { OfficeFactory, createAutoAdapter } from '@ai-office/core';

// Auto-detect platform and create adapter
const adapter = await createAutoAdapter({ projectRoot: process.cwd() });

// Create office factory with adapter
const factory = new OfficeFactory({ host: adapter });
const office = factory.getPrimary(process.cwd());

await office.init();

// Save a plan
const state = await office.loadState();
await office.savePlan(state, [
  {
    title: "Implement feature X",
    type: "implementation",
    acceptance: ["Tests pass", "Code compiles"],
    gate: "npm test && npm run build"
  }
]);

// Dispatch agents
await office.dispatch(state);
```

## Architecture

### Host Adapter Pattern

The core engine depends ONLY on the `HostAdapter` interface:

```typescript
interface HostAdapter {
  // Session Management
  createSession(config: SessionConfig): Promise<Session>;
  promptSession(sessionId: string, prompt: string, options?: PromptOptions): Promise<SessionResult>;

  // Tools & Scope
  getAvailableTools(): Tool[];
  checkScope(path: string, operation: 'read' | 'write' | 'exec'): Promise<ScopeResult>;

  // Subagent Management
  spawnSubagent(config: SubagentConfig): Promise<Subagent>;
  getSubagentResult(subagentId: string): Promise<SubagentResult>;

  // Model Management
  getModel(): ModelConfig;
  setModel(model: ModelConfig): void;

  // Lifecycle
  initialize(config: InitConfig): Promise<void>;
  shutdown(): Promise<void>;

  // Utilities
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  execCommand(cmd: string, args: string[]): Promise<ExecResult>;
}
```

### AdapterFactory

Central registry for platform adapters:

```typescript
import { AdapterFactory } from '@ai-office/core/host';

// Auto-detect and create adapter
const adapter = await AdapterFactory.detectAndCreate({ projectRoot: process.cwd() });

// Or explicitly create
const adapter = await AdapterFactory.create('opencode', { projectRoot: process.cwd() });

// Register custom adapter
AdapterFactory.registerAdapter('my-platform', createMyAdapter);
```

### Platform Auto-Detection

The factory auto-detects the platform from environment variables:

| Platform | Env Var Detected |
|----------|------------------|
| OpenCode | OPENCODE_CONFIG_DIR, OPENCODE_SESSION_ID |
| Cursor | CURSOR_TRACE_ID, VSCODE_PID |
| Codex | CODEX_SESSION_ID |
| Claude Code | CLAUDE_CODE_ENTRYPOINT |
| Grok | GROK_API_KEY, XAI_API_KEY |
| Gemini | GOOGLE_API_KEY, GEMINI_API_KEY |

## Core Classes

### Office

Main facade that ties all modules together:

```typescript
const office = factory.getPrimary(cwd);
await office.init();

const state = await office.loadState();
await office.savePlan(state, cards);
await office.dispatch(state);
```

### OfficeFactory

Creates one Office per working directory:

```typescript
const factory = new OfficeFactory({ host: adapter });
const office = factory.getPrimary(cwd);
```

### State Management

Cards with DAG dependencies:

```typescript
interface Card {
  id: string;
  title: string;
  type: CardType;
  state: CardState;
  owner: string | null;
  reviewer: string | null;
  acceptance: string[];
  gate: string;
  dependsOn: string[];
}
```

### Quality Gates

Three dimensions:
1. **Technical** - build, typecheck, lint, test, diff
2. **Security** - secrets, dependencies
3. **Requirements** - acceptance criteria with evidence

## Testing

```bash
npm run test        # Run tests
npm run coverage    # Run with coverage
npm run typecheck   # TypeScript check
```

## License

MIT