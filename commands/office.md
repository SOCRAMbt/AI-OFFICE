---
description: Open the AI-OFFICE to work an objective end-to-end with dispatch, auto-review, quality gates and evidence per requirement. Flags: `/office lite` (Cell Mode), `--maxagents N` (cap of N simultaneous agents; without the flag, the run stays at a conservative fixed cap).
subtask: false
---

Load the `oficina` skill and follow its protocol exactly. If its instructions are not already in context, load it first.

**Run objective:** $ARGUMENTS

If the objective is empty, take the user's most recent request in this conversation as the objective.

## Flags accepted by this invocation

| Flag | Effect |
|---|---|
| `--lite` | Cell Mode (1 Executor + 1 cross-reviewer). Equivalent to `/office lite`. |
| `--full` | Forced Full Mode (skips auto-degradation). |
| `--maxagents N` | Cap of N simultaneous agents for the run (1-14). Also accepts `--maxagentes N`. |

### `--maxagents N` — the user's flag governs the budget
Same behavior as `/oficina --maxagents N`. The budget is persisted in state.maxAgents and dispatch clamps against it.

### `/office lite` — Cell Mode
Equivalent to `/oficina lite`. One executor + one cross-reviewer, no peer mesh.

## What this command does

1. Loads the `oficina` skill (protocol, roles, gates).
2. Creates `.oficina/` in the project if it doesn't exist.
3. Decomposes the objective into cards with acceptance criteria.
4. Dispatches agents from the 258-role catalog.
5. Runs quality gates (build, tests, secret scan) before closing any card.
6. Delivers final report with evidence.

## Aliases

- `/oficina` — Spanish alias (deprecated, use `/office`)
- `/office` — English (primary)

---
*AI-OFFICE: your AI agent says "done". AI-OFFICE makes it prove it.*