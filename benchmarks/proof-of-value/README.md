# Proof-of-Value Benchmark

Compares "AI agent alone" vs "AI agent + AI-OFFICE" on real coding tasks.

## What it measures

- **Did the agent say "done"?** — whether the agent reported task completion
- **Do tests actually pass?** — whether the test suite exits 0
- **Time taken** — wall clock time per task
- **Token cost** — estimated token usage

## Key metric: "Lies caught"

The number of tasks where the agent said "done" but tests failed. This is the core value proposition of AI-OFFICE.

## Usage

```bash
# Run with sample tasks
npx tsx benchmarks/proof-of-value/run.ts

# Run with custom tasks
npx tsx benchmarks/proof-of-value/run.ts --tasks ./my-tasks --output ./my-results.json
```

## Task format

Each task is a JSON file in the tasks directory:

```json
{
  "id": "task-001",
  "description": "Add input validation to signup form",
  "repo": "path/to/repo",
  "testCommand": "npm test",
  "expectedFiles": ["src/validate.ts"]
}
```

## Results

Results are published as JSON + markdown. The benchmark is reproducible by anyone.

## Status

Framework created. Needs real task curation (20-30 tasks from real repos with existing tests).