# ai-office-host-cursor

Cursor adapter for AI-OFFICE (VS Code Extension API).

## Install
```bash
npx ai-office-cli install --platform=cursor
```

## Configuration
- Requires VS Code / Cursor extension host.
- Set VS Code API via `setVSCodeAPI()`.

## Usage
```bash
ai-office run "prompt"
```

## API
Implements all 14 `HostAdapter` methods.

## Troubleshooting
- `CursorAdapter not initialized with VS Code API` â†’ call setVSCodeAPI before use.

## Links
- [Migration guide](../../docs/migration-guide.md)
