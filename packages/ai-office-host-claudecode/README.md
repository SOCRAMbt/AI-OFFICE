# ai-office-host-claudecode

Claude Code adapter for AI-OFFICE (Anthropic SDK).

## Install
```bash
npx ai-office-cli install --platform=claude-code
```

## Configuration
- Env: `ANTHROPIC_API_KEY`

## Usage
```bash
ai-office run "prompt"
```

## API
Implements all 14 `HostAdapter` methods.

## Troubleshooting
- No API key â†’ adapter initializes but client null; set via platformConfig.

## Links
- [Migration guide](../../docs/migration-guide.md)
