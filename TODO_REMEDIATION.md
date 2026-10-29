# AI-OFFICE Remediation TODO

## Phase A - Baseline
- [x] Baseline tests: 444 passed
- [x] Typecheck: PASS
- [x] Build: PASS
- [x] Docs:check: PASS
- [x] Benchmark: 71% hit@1
- [x] npm audit --omit=dev: 0 vulnerabilities
- [x] npm audit: 8 vulnerabilities (2 critical, 4 high, 2 moderate) in dev dependencies

## Phase B - Critical Security/Data Loss Fixes
- [x] COR-002: Fix race condition in claimNext (office.ts)
- [x] STATE-001: Fix state corruption recovery (fsx.ts, office.ts)
- [x] DISP-001: Fix agentId collisions in dispatcher (dispatch.ts)
- [x] SEC-003/H1/H2: Fix scope guard v1/v2 consistency (scopeGuard.ts, v1.ts, v2.ts)
- [x] CLI-001: Fix CLI audit reading gates.md as JSON (cli.ts)
- [x] COR-001: Fix tripwire arm/check (tripwire.ts)
- [x] SEC-001: Fix fallback collision in paths.ts

## Phase C - Functional/Observability Fixes
- [x] DEP-001: Fix dependency vulnerabilities (critical fixed, 2 high remain in @opencode-ai/plugin internal zod)
- [ ] CI-001: Fix benchmark source immutability
- [ ] CI-002: Install verify on Windows/Linux
- [ ] H6: Windows 8.3 tests deterministic
- [ ] CLI-002: Fix emit() function
- [ ] COR-001: Tripwire arm/check improvements

## Phase D - Quality/Documentation
- [ ] DOC-002: Documentation sync
- [ ] SEC-002: Security policy
- [ ] Coverage improvements
- [ ] MAINT-001: Historical hygiene

## Phase E - Validation
- [ ] Full test suite
- [ ] Typecheck, build, docs:check
- [ ] Benchmark
- [ ] Coverage
- [ ] Documentation