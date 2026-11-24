# @ai-office/host-opencode

OpenCode adapter for AI-OFFICE (Host Adapter Pattern).

## Install
```bash
npx @ai-office/cli install --platform=opencode
```

## Configuration
- Env: `OPENCODE_API_KEY` (optional)
- Workspace: project root

## Usage
```bash
ai-office run "prompt"
```

## API
Implements all 14 `HostAdapter` methods: createSession, promptSession, getAvailableTools, checkScope, spawnSubagent, getSubagentResult, getModel, setModel, initialize, shutdown, readFile, writeFile, execCommand.

## Troubleshooting
- OpenCode ctx not available in tests → use mock factory (see tests/OpenCodeAdapter.test.ts).

## Links
- [Migration guide](../../docs/migration-guide.md)
- [Issues](https://github.com/SOCRAMbt/oficina-opencode/issues)
