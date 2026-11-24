# AGENTS.md - AI-OFFICE Monorepo

## Project Overview

AI-OFFICE: Multi-platform agent orchestration with Host Adapter Pattern.

**Monorepo**: 8 packages managed with Turborepo
- `ai-office-core` - Platform-agnostic core engine
- `ai-office-host-opencode` - OpenCode adapter
- `ai-office-host-cursor` - Cursor adapter
- `ai-office-host-codex` - Codex adapter
- `ai-office-host-claudecode` - Claude Code adapter
- `ai-office-host-grok` - Grok adapter
- `ai-office-host-gemini` - Gemini adapter
- `ai-office-cli` - Unified CLI

## Architecture

### Host Adapter Pattern

The core engine (`ai-office-core`) has **ZERO platform dependencies**. All platform integration goes through the `HostAdapter` interface (12 methods).

```
┌─────────────────────────────────────────────────────────────┐
│                    ai-office-core                          │
│  Office, OfficeFactory, State, Cards, Gates, Bus, Roster   │
│  ZERO platform SDKs                                         │
└──────────────────────────┬──────────────────────────────────┘
                           │ HostAdapter Interface (12 methods)
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│ OpenCode      │  │ Cursor        │  │ Codex         │
│ Adapter       │  │ Adapter       │  │ Adapter       │
│ (ctx API)     │  │ (VS Code API) │  │ (JSON-RPC)    │
└───────────────┘  └───────────────┘  └───────────────┘
        ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│ Claude Code   │  │ Grok          │  │ Gemini        │
│ Adapter       │  │ Adapter       │  │ Adapter       │
│ (Anthropic)   │  │ (OpenAI)      │  │ (Google)      │
└───────────────┘  └───────────────┘  └───────────────┘
```

## Commands

```bash
# Build all packages
npm run build

# Type check all packages
npm run typecheck

# Run tests
npm run test

# Run tests with coverage
npm run coverage

# Lint
npm run lint

# Dev mode (watch)
npm run dev

# Smoke test
npm run smoke
```

## Package Structure

### ai-office-core
- **Entry**: `src/index.ts`
- **Host Layer**: `src/host/` (HostAdapter, AdapterFactory, PlatformType)
- **Core Modules**: Office, OfficeFactory, State, Cards, Gates, Bus, Roster, Leases, Tools
- **No platform SDKs** - only peerDependencies in adapters

### ai-office-host-opencode
- **Entry**: `src/OpenCodeAdapter.ts`
- **Dependencies**: `ai-office-core`, `zod`
- **Peer**: `@opencode-ai/plugin`
- **Contains**: All v2.ts logic (spawner, dashboard, hooks, tripwire, auto-continuation)

### ai-office-host-cursor
- **Entry**: `src/CursorAdapter.ts`
- **Dependencies**: `ai-office-core`, `zod`
- **Peer**: `vscode`

### ai-office-host-codex
- **Entry**: `src/CodexAdapter.ts`
- **Dependencies**: `ai-office-core`, `zod`
- **Protocol**: JSON-RPC over stdio

### ai-office-host-claudecode
- **Entry**: `src/ClaudeCodeAdapter.ts`
- **Dependencies**: `ai-office-core`, `@anthropic-ai/sdk`, `zod`

### ai-office-host-grok
- **Entry**: `src/GrokAdapter.ts`
- **Dependencies**: `ai-office-core`, `openai`, `zod`

### ai-office-host-gemini
- **Entry**: `src/GeminiAdapter.ts`
- **Dependencies**: `ai-office-core`, `@google/generative-ai`, `zod`

### ai-office-cli
- **Entry**: `src/index.ts`
- **Dependencies**: `ai-office-core`, `commander`, `chalk`, `ora`, `inquirer`
- **Bin**: `ai-office`

## Development Workflow

### 1. Make Changes
```bash
# Edit source files in packages/*/src/
```

### 2. Build
```bash
npm run build
```

### 3. Type Check
```bash
npm run typecheck
```

### 3. Test
```bash
npm run test
npm run test:watch  # Watch mode
```

### 4. Coverage
```bash
npm run coverage
```

### 5. Lint
```bash
npm run lint
```

## Testing

### Unit Tests
```bash
npm run test
```

### Integration Tests
```bash
# Test specific adapter
cd packages/ai-office-host-opencode
npm run test
```

### E2E Tests
```bash
npm run test:e2e
```

## TypeScript Config

### Base Config (`packages/ai-office-core/tsconfig.base.json`)
- Target: ES2023
- Module: ESNext
- ModuleResolution: Bundler
- Strict: true
- exactOptionalPropertyTypes: false

### Package Configs
Each package extends base config with:
- `outDir: "./dist"`
- `rootDir: "./src"`
- `declaration: true`
- `moduleResolution: NodeNext`

## Turborepo Pipeline

```json
{
  "pipeline": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "typecheck": { "dependsOn": ["^typecheck"] },
    "lint": { "dependsOn": ["^lint"] },
    "test": { "dependsOn": ["^build"], "outputs": ["coverage/**"] }
  }
}
```

## CI/CD

### GitHub Actions Matrix
- **Node**: 20, 22
- **OS**: ubuntu-latest, windows-latest, macos-latest
- **Platforms**: opencode, cursor, codex, claude-code, grok, gemini

### Gates (All Must Pass)
1. TypeCheck (Node 20, 22)
2. Lint (Node 20, 22)
3. Test (Node 20, 22 × OS × Platform)
4. Build (Node 20, 22)
5. Coverage (≥90% core, ≥80% adapters)
6. Security (Semgrep)
7. Knip (dead code)
8. Docs Check

## Versioning

### Changesets
```bash
# Create changeset
npx changeset

# Version bump
npx changeset version

# Publish
npm publish --access public
```

### Version Policy
- **Core**: Minor for new features, patch for fixes
- **Adapters**: Minor for new features, patch for fixes
- **CLI**: Minor for new commands, patch for fixes
- **All packages versioned independently**

## Code Standards

### TypeScript
- Strict mode enabled
- No `any` without justification
- Proper error handling with typed errors
- Use `type` over `interface` for unions

### File Organization
```
src/
├── index.ts              # Barrel export
├── host/                 # Host adapter layer
│   ├── index.ts
│   ├── PlatformType.ts
│   ├── HostAdapter.ts
│   └── AdapterFactory.ts
├── core/                 # Core modules
│   ├── office.ts
│   ├── officeFactory.ts
│   ├── state.ts
│   ├── cards.ts
│   └── ...
├── hooks/                # Plugin hooks
└── tools/                # Tool definitions
```

## Adding a New Adapter

1. Create package: `packages/ai-office-host-<name>/`
2. Implement `HostAdapter` interface (12 methods)
3. Add `registerAdapter('<name>', createAdapter)`
4. Add package.json with peerDependencies
5. Add to turbo.json pipeline
6. Add to CI matrix
7. Write README and tests

## Common Issues

### Build Fails
```bash
# Clear cache
rm -rf node_modules package-lock.json dist
npm install
npm run build
```

### Type Errors
```bash
# Check specific package
cd packages/ai-office-core
npm run typecheck
```

### Test Failures
```bash
# Run specific test file
npx vitest run tests/specific.test.ts
```

### Dependency Conflicts
```bash
# Use legacy peer deps
npm install --legacy-peer-deps
```

## Useful Commands

```bash
# Build all
npm run build

# Type check all
npm run typecheck

# Test all
npm run test

# Coverage report
npm run coverage

# Lint all
npm run lint

# Dev mode (watch)
npm run dev

# Smoke test
npm run smoke

# Clean
npm run clean  # if defined
```