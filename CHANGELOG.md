
## [3.2.1] — 2026-11-19

Merge verificado del fork `bochaah/AI-OFFICE` → rama `fix/engine-remediation` (commit `7d29ef8`, base `4539f87`) con las 6 fases de remediación de motor. Suite: 557/557 verde (incl. 28 tests nuevos en `phase1.test.ts`/`phase2.test.ts`/`phase4.test.ts`/`phase5.test.ts`).

### Seguridad / Sandbox

- `.opencode/agents/**` agregado a sensitive patterns (protegido de scopes amplios).
- Protección `.oficina/state.json`, roster, leases y memory.md de escrituras fuera de scope (solo artifacts/fichas/board.md/context.md).
- VT-FAT NTFS ADS (`:` después de drive letter) detectado y rechazado.
- Glob matching es case-insensitive en Windows + segmentos de ruta normalizados (trailing dots/spaces eliminados).
- Symlink resolution anclado a physical root (junction path), no solo léxico.
- `safeId` refactor: rechaza IDs reservados Windows (con/prn/aux/nul/com1-9/lpt1-9), colons y trailing dots/spaces; `safeJoin` usa `path.join` en vez de concat con `/`.
- `pathsFromPatch` corregido para `/dev/null` con prefijos `a/`/`b/` constituyendo file-change hunks.
- Tripwire: sigue a symlinks externos, incluye dotfiles-e (`.opencode`).
- Shell parser: detecta PowerShell cmdlets, .NET I/O, `curl -OutFile`, `irm`, `tee`, interpreters extra (`bun`,`deno`, `tsx`, `pwsh`), heredoc, `--eval`, `-File`, `/c`.
- Tests sandbox normalizados a `junction` en Windows (trySymlink helper).
- `spawn` browser abre solo `^https?://localhost:\d+`; error handler registrado.
- Path traversal + stored XSS cerrados en servidor dashboard y kanban export.
- `.cmd` package scripts se abren con `shell: true`; catalog scanner normaliza CRLF (Windows).
- `defaultRunner` usa `npm.cmd` en Windows para evitar ENOENT.

### Concurrencia / Estado

- `withLock` (directorio `mkdir`) usa `meta.json` con pid; staleness real verificada por `process.kill(pid, 0)` (no solo mtime). Lease heartbeat y release ahora dentro de `.locks/<taskId>.lock` (en vez de write-then-check).
- `LeaseStore.forceRelease` agregado para recovery (borrado forzado bajo el lock, sin importar propietario).
- `EvidenceStore.add` bajo `withLock` (evidencia no pierde actualizaciones).
- `EvidenceStore.file` usa `safeId` (path traversal bloqueado).
- `Office.savePlan`, `deploy`, `halt`, `resume`, `closeCard`, `claimCard`, `claimNext`, `submitWork`, `submitReview`, `assignReviewers`, `routeHelpRequest`, `spawnAgent` cableados a `withRunLock` con mutaciones atómicas, en vs runLock universal.
- `selectNextCard` respeta owner único: cards en progreso/rework solo van al agente que las posee; cards `todo` se enrutan por preferencia de owner (propiedad→id) para evitar starvation.
- `decideRetry` invoca al límite de rechazos → card pasa a `escalated` (sin auto-aprobación).
- Cáda card en `review` pasa a `rework` si falla el gate o faltan evidencias al cerrar.
- `isRunComplete` → transición a `delivered` al cerrar la última card.
- `Object.assign(state, freshState)` sobre la llamada exterior (el llamador mantiene coherencia sin re-cargar).
- `spawnAgent` devuelve `{ id }` → `v2.spawner` retorna `child.id` → v2.ts registra `bindSession(childSessionId, agentId, cardId)`; subagentes heredan scope de verdad.
- `validateAgentIdentity` permite `general`/`build`/`plan`-`oficina-`*: los hosts OpenCode v2 sólo exponen este tipo de identidad; identidad real se verifica por binding de sesión (child → agentId).

### Protocolo / Dispatch

- `routeHelpRequest` rutea a peers declarados (`peers` en ficha) en vez de broadcast; `helpedPeers`/`peers` propagados desde ficha → roster; `fichaFromEntry` restaura `peers`.
- `oficina_bus` `action=help` usa `requestHelp` con targets calculados en vez de broadcast silencioso.
- `claimCard` acepta card existente por `sessionID` para trazabilidad; peer binding respetado.
- `parser`.

### Tests / Packaging

- 28 tests nuevos en `phase1.test.ts`/`phase2.test.ts`/`phase4.test.ts`/`phase5.test.ts` (~1.200 líneas) sobre: Zod default en v2, scope binding estricto, concurrent lease acquire, escalate-on-3-rejects, roster reset ante runId distinto, dashboard server hardening.
- `migration.test.ts` continúa pasando; `sandbox-83.test.ts` Windows rueda sobre junctions ahora.
- Fase de verificación completa pasa en Windows: typecheck, build, `npm test` 557/557, `bench:selection` PASS.
- Empaqueta 240 archivos / ~2,2 MB; `packaging.test.ts` en verde.
# Changelog

## [3.2.0] — 2026-11-13

Blueprint Maestro y Directiva de Operación. Evolución arquitectónica del motor, cerrada y publicada.

### Nuevo

- **Modo Célula (`/oficina lite`)**: 1 Ejecutor + 1 Revisor Cruzado, invariante `owner ≠ reviewer`; auto-triage determinístico que degrada desde `/oficina` para objetivos chicos y aislados (1 card, ≤140 chars, ≤3 criterios, sin palabras transversales). `state.mode: "full" | "lite"`.
- **Circuit Breaker** (`BLOCKED_ESCALATED`): fingerprint del error normalizado; 3 fallos idénticos consecutivos ó 5 intentos totales bloquean la card (lease liberado atómicamente, `blocked.md` con la causa raíz); el resto del DAG sigue sin bloquearse.
- **Matching ≥ 0.70** (`DEFAULT_LIMITS.minCatalogCoverage`). Los agentes fabricados persisten con `generated_by: factory`, `created_for_task`, `stack_tags` en `.opencode/agents/` y en el catálogo vivo.
- **Traits de dominio**: directorio `traits/` (typescript-strict, vitest-testing, windows-powershell, postgres-migrations, markdown-docs, react-hooks). El dispatch detecta el stack del repo (deps/tsconfig/OS) e inyecta solo los traits relevantes bajo `## Active Environment & Stack Traits`.
- **Memoria episódica**: `.oficina/memory.md` (rotación FIFO, tope 150 líneas) que registra fallos de gate, fingerprints de circuitos disparados y cierres de card; se inyecta en el dispatch y se sirve en `/api/memory`.
- **Escrituras atómicas NTFS/POSIX**: `writeAtomic` con tmp único `<target>.<pid>.<rand>.tmp` + rename con reintentos ante EPERM/EBUSY; `allocateSeq` y leases usan locks wx con TTL (breaker de locks vencidos).
- **Dashboard v3.2.0**: estética Linear/Grafana oscura (sin CDNs), Kanban Queued/In Progress/In Review/Done/Blocked con estado del Circuit Breaker, Live Gates detalados por card, bus inspector filtrable, roster con heartbeat stale, visor de memory.md, SSE con cursor + `Last-Event-ID`, loopback únicamente (independiente de 3.1.5).
- Pruebas HTTP de integración del servidor del dashboard (state/memory/artifacts/gates/events) + tests de Circuit Breaker, lite mode, traits, memory, wx-lock. 513 tests pasan.

### Cambios rotos / guía de migración

- `CardState` gana `blocked_escalated`; transiciones válidas actualizadas; estados de v3.1.x cargan sin pérdida (schema aditivo, `version: 2`).
- `minCatalogCoverage` 0.6 → 0.7: corridas que dependían de un match borderline ahora caerán al factory (documentado; el umbral es deliberado).
- `LeaseStore` gana `remove()` — adquisición/liberación usan locks `wx` (en vez de mkdir) en seq y leases.
- `commands/oficina.md` documenta `/oficina lite` y `--full`.
