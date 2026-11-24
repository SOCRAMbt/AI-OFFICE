---
"@ai-office/core": minor
"@ai-office/host-opencode": minor
"@ai-office/host-cursor": minor
"@ai-office/host-codex": minor
"@ai-office/host-claudecode": minor
"@ai-office/host-grok": minor
"@ai-office/host-gemini": minor
"@ai-office/cli": minor
---

Initial release of AI-OFFICE multi-platform architecture with Host Adapter Pattern.

## Features

- **Core Engine**: Platform-agnostic agent orchestration (Office, OfficeFactory, State, Cards, Gates, Bus, Roster, Leases)
- **Host Adapter Pattern**: Universal interface for platform integration (12 methods)
- **6 Platform Adapters**: OpenCode, Cursor, Codex, Claude Code, Grok, Gemini
- **Unified CLI**: `ai-office install|run|detect|config` with auto-detection
- **AdapterFactory**: Auto-detection via env vars + dynamic registration
- **Zero platform deps in core**: Only peerDependencies in adapters
- **Backward compatible**: v2.ts thin wrapper maintains OpenCode compatibility

## Architecture

```
packages/
├── ai-office-core/              # Core engine (zero platform deps)
│   └── src/host/                # HostAdapter, AdapterFactory, PlatformType
├── ai-office-host-opencode/     # OpenCode adapter (v2.ts logic moved here)
├── ai-office-host-cursor/       # Cursor adapter (VS Code Extension API)
├── ai-office-host-codex/        # Codex adapter (JSON-RPC over stdio)
├── ai-office-host-claudecode/   # Claude Code adapter (Anthropic SDK)
├── ai-office-host-grok/         # Grok adapter (OpenAI-compatible)
├── ai-office-host-gemini/       # Gemini adapter (Google GenAI)
├── ai-office-cli/               # Unified CLI (Commander.js)
```

## Breaking Changes

None - fully backward compatible with existing OpenCode plugin.

## Migration

See `docs/migration-guide.md` for migration from OpenCode-only setup.