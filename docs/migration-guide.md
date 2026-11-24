# Migration Guide: OpenCode-only → Multi-platform AI-OFFICE

## Overview

This guide helps you migrate from the legacy OpenCode-only AI-OFFICE plugin to the new multi-platform architecture with Host Adapter Pattern.

## What Changed

### Before (v3.x - OpenCode only)
```
src/
├── v2.ts              # OpenCode v2 plugin entry (all logic here)
├── core/              # Core engine (85% platform-agnostic)
├── hooks/             # Scope guard, tripwire, etc.
└── tools/             # Tool definitions
```

### After (v4.x - Multi-platform)
```
packages/
├── ai-office-core/              # Core engine (100% platform-agnostic)
│   └── src/host/                # HostAdapter interface + AdapterFactory
├── ai-office-host-opencode/     # OpenCode adapter (v2.ts logic moved here)
├── ai-office-host-cursor/       # Cursor adapter (VS Code Extension API)
├── ai-office-host-codex/        # Codex adapter (JSON-RPC over stdio)
├── ai-office-host-claudecode/   # Claude Code adapter (Anthropic SDK)
├── ai-office-host-grok/         # Grok adapter (OpenAI-compatible)
├── ai-office-host-gemini/       # Gemini adapter (Google GenAI)
└── ai-office-cli/               # Unified CLI (Commander.js)
```

## Breaking Changes

**NONE** - The migration is fully backward compatible.

- `v2.ts` still works identically as a thin wrapper
- All existing OpenCode workflows continue to work
- No API changes for existing users

## Migration Steps

### 1. Update Package Dependencies

**Before:**
```json
{
  "dependencies": {
    "oficina-opencode": "^3.x"
  }
}
```

**After:**
```json
{
  "dependencies": {
    "ai-office-core": "^4.x",
    "ai-office-host-opencode": "^4.x"
  }
}
```

### 2. Update Plugin Entry (if custom)

**Before (custom v2.ts):**
```typescript
import { Plugin } from "@opencode/plugin";
import { OfficeFactory } from "./core/officeFactory";
// ... all logic inline
```

**After (thin wrapper):**
```typescript
import { Plugin } from "@opencode/plugin";
import { OfficeFactory } from "ai-office-core";
import { OpenCodeAdapter } from "ai-office-host-opencode";

export default Plugin.define({
  id: "oficina",
  async setup(ctx) {
    const cwd = ctx.location?.directory ?? process.cwd();
    const adapter = new OpenCodeAdapter();
    await adapter.initialize({ projectRoot: cwd });
    adapter.setContext(ctx);

    const factory = new OfficeFactory({ host: adapter });
    adapter.setOfficeFactory(factory);

    const office = factory.getPrimary(cwd);
    await office.init();

    await adapter.registerTools(office);
    await adapter.registerScopeGuardHooks();
    await adapter.registerContextHooks();

    return () => adapter.shutdown();
  }
});
```

### 3. Use Unified CLI (optional)

```bash
# Install globally
npm install -g ai-office-cli

# Install for current platform
ai-office install

# Run prompts
ai-office run "Implement feature X"
```

## New Features

### Multi-Platform Support

Run AI-OFFICE on any platform:

```bash
# Auto-detect
ai-office run "Implement feature X"

# Explicit platform
ai-office run --platform cursor "Implement feature X"
ai-office run --platform codex "Implement feature X"
ai-office run --platform claude-code "Implement feature X"
ai-office run --platform grok "Implement feature X"
ai-office run --platform gemini "Implement feature X"
```

### Platform Detection

```typescript
import { AdapterFactory } from 'ai-office-core/host';

// Auto-detect
const adapter = await AdapterFactory.detectAndCreate({ projectRoot: cwd });

// Explicit
const adapter = await AdapterFactory.create('cursor', { projectRoot: cwd });
```

### Custom Adapters

```typescript
import { AdapterFactory, HostAdapter } from 'ai-office-core/host';

class MyAdapter implements HostAdapter {
  // ... implement 12 methods
}

AdapterFactory.registerAdapter('my-platform', createMyAdapter);
```

## Configuration

### Platform-Specific Config

| Platform | Config Location | Format |
|----------|-----------------|--------|
| OpenCode | `~/.config/opencode/plugins/oficina.js` | JS Plugin |
| Cursor | `~/.cursor/extensions/ai-office/` | VS Code Extension |
| Codex | `~/.codex/config.json` | MCP Server |
| Claude Code | `~/.claude-code/config.json` | MCP Server |
| Grok | `~/.grok/config.json` | MCP Server |
| Gemini | `~/.gemini/config.json` | MCP Server |

### Auto-Install

```bash
ai-office install                    # Auto-detect
ai-office install --platform cursor  # Explicit
```

## API Changes

### Office Class

**Before:**
```typescript
const office = new Office({ cwd, spawner, client });
```

**After:**
```typescript
const adapter = await AdapterFactory.create('opencode', { projectRoot: cwd });
const factory = new OfficeFactory({ host: adapter });
const office = factory.getPrimary(cwd);
```

### Spawning Subagents

**Before:**
```typescript
await office.spawnAgent(sessionID, agentName, prompt, description, { agentId, cardId });
```

**After:**
```typescript
// Via adapter (preferred)
await adapter.spawnSubagent({
  name: agentName,
  description,
  systemPrompt: prompt,
  prompt: '',
  parentSessionId: sessionID,
  cardId,
  model: adapter.getModel()
});

// Or via office (backward compatible)
await office.spawnAgent(sessionID, agentName, prompt, description, { agentId, cardId });
```

## Testing

### Mock Adapters

```typescript
import { HostAdapter } from 'ai-office-core/host';

class MockAdapter implements HostAdapter {
  async createSession(config) { return { id: 'test', ... }; }
  async promptSession(sessionId, prompt) { return { text: 'mock', status: 'active' }; }
  // ... implement all 12 methods
}

// Use in tests
const factory = new OfficeFactory({ host: new MockAdapter() });
```

## Troubleshooting

### Platform Not Detected

```bash
# Check environment variables
echo $OPENCODE_CONFIG_DIR
echo $CURSOR_TRACE_ID
echo $CODEX_SESSION_ID
echo $CLAUDE_CODE_ENTRYPOINT
echo $GROK_API_KEY
echo $GOOGLE_API_KEY
```

### Adapter Not Registered

```typescript
import 'ai-office-host-opencode'; // Ensures registration
import { AdapterFactory } from 'ai-office-core/host';

const adapter = await AdapterFactory.create('opencode', config);
```

### Build Errors

```bash
# Clear cache and rebuild
rm -rf node_modules package-lock.json
npm install
npm run build
```

## Rollback Plan

If issues arise, you can rollback to v3.x:

```bash
npm install oficina-opencode@3.x
```

The v3.x plugin still works independently.

## Support

- **Documentation**: See `docs/api/host-adapter.md` for full API
- **Issues**: GitHub Issues for bug reports
- **Discussions**: GitHub Discussions for questions## v2.x (OpenCode plugin) -> v3.x (multi-platform)

### Breaking changes
- Core engine no longer depends on OpenCode SDK; adapters provide platform integration.
- Office constructor now requires a HostAdapter instance.
- v2.ts remains a thin wrapper creating OpenCodeAdapter for backward compatibility.

### Code migration examples
Before:
`	s
const office = new Office(ctx)
`
After:
`	s
const adapter = new OpenCodeAdapter()
await adapter.initialize({ projectRoot })
const office = new Office(adapter)
`

### Per-platform notes
- OpenCode: use OpenCodeAdapter (ctx-based).
- Cursor: use CursorAdapter (VS Code API).
- Codex: uses JSON-RPC over stdio.
- Claude Code: Anthropic SDK.
- Grok: OpenAI-compatible (x.ai).
- Gemini: Google Generative AI.

### Rollback
Revert to v2.x by using the OpenCodeAdapter wrapper; no data migration required.
