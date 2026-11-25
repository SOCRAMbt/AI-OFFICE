---
name: proof-of-done
description: "AI agents can't say 'done' until the tests pass. A lightweight protocol for quality-gated AI agent work: no task closes without real evidence (build, tests, security scan). Works with Claude Code, Codex, Cursor, and OpenCode."
version: 1.0.0
---

# Proof-of-Done Protocol

Your AI agent says "done". This skill makes it prove it.

## The Problem

AI coding agents (Claude Code, Codex, Cursor, Copilot, OpenCode) routinely report "done" on tasks where:
- Tests don't pass
- Code doesn't compile
- Security issues exist
- The change doesn't match the acceptance criteria

The agent moves on. You discover the problem hours later.

## The Protocol

### Rule 1: No "done" without evidence

A task is only "done" when ALL of these pass:

1. **Build succeeds** — `npm run build` / `tsc` / `go build` exits 0
2. **Tests pass** — the test suite exits 0 with tests actually run (not "no test files")
3. **Security scan clean** — no secrets, no known vulnerabilities in changed files
4. **Acceptance criteria met** — each criterion has a file or output as proof

### Rule 2: Reviewer + Verifier

Every task requires two roles:

- **Implementer**: writes the code
- **Reviewer**: checks the work against acceptance criteria (different agent/model)
- **Verifier**: runs the gates and saves evidence

The reviewer must be a different agent than the implementer. Cross-review catches blind spots.

### Rule 3: Evidence per criterion

For each acceptance criterion, save a file:

```
.oficina/artifacts/<task-id>/evidence/
├── build.txt          # build output
├── test.txt           # test output
├── security.txt       # security scan results
└── criteria.md        # per-criterion proof
```

### Rule 4: Gates are real, not opinions

A gate is a command that exits 0 or non-zero. No "should work". No "looks good". Run the command, capture the output, decide by exit code.

### Quick setup

1. Create `.oficina/` in your project
2. Write acceptance criteria before coding
3. Implement → Review → Verify → Evidence
4. No step can be skipped

### Full system

For the complete system (message bus, dashboard, role catalog, dispatch, leases), install the full plugin:

```bash
npm install -g ai-office
```

Then in OpenCode: `/office <your task>`

### Concept

This protocol is based on the "Definition of Done" from agile, applied to AI agents. The key insight: **an agent that can't close a task without proof can't lie about being done.**

---

*AI-OFFICE: your AI agent says "done". AI-OFFICE makes it prove it.*