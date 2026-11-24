# ai-office-host-codex

Codex adapter for AI-OFFICE (JSON-RPC over stdio).

## Install
```bash
npx ai-office-cli install --platform=codex
```

## Configuration
- Env: `OPENAI_API_KEY`
- Requires `codex` binary on PATH.

## Usage
```bash
ai-office run "prompt"
```

## API
Implements all 14 `HostAdapter` methods.

## Troubleshooting
- `Failed to start Codex` â†’ ensure codex CLI installed.

## Links
- [Migration guide](../../docs/migration-guide.md)
