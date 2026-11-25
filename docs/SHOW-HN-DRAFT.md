# Show HN Draft (DO NOT COMMIT - keep private)

## Title
Show HN: AI-OFFICE – AI agents can't say "done" until the tests pass

## URL
https://github.com/SOCRAMbt/AI-OFFICE

## First comment (post within 10 minutes of submission)

Hi HN! I'm Marcos, solo dev from Argentina.

**The problem:** I kept watching AI coding agents (Claude Code, Codex, OpenCode) say "done" on tasks where tests were broken, code didn't compile, or the change didn't match what I asked. The agent moves on. I discover it hours later.

**How AI-OFFICE works:** You type `/office <task>` in OpenCode. A Commander agent assembles a team of specialist subagents from a catalog of 258 roles across 18 divisions. They coordinate via a message bus on disk. No task closes until real gates pass: build, tests, security scan. Evidence is saved per acceptance criterion in `.oficina/`.

**The key moment:** The agent says "done" → gate fails (red) → team fixes → gate passes (green). That red→green moment is what I wanted to capture.

**Benchmark:** I ran 30 real tasks (small repo issues with existing tests). Agent alone said "done" in 14/30 with broken tests. AI-OFFICE caught all 14. [link to benchmark]

**Token cost:** ~3x more tokens than a single agent. Honest about that. The tradeoff is correctness vs. cost.

**What's missing:** Claude Code / Codex support is partial (skill version only). Dashboard needs polish. The benchmark needs more tasks.

**Feedback I'm looking for:** Would you use this? What's the biggest blocker? Is the "proof of done" concept compelling or just overhead?

Happy to answer anything. I'll be here all day.