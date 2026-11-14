
## [3.2.4] — 2026-11-14

**Fix multi-ventana: cada ventana OpenCode corre SU oficina** — no una sola oficina para todas las ventanas.

### Problema

El plugin v2 instanciaba UNA `Office` en el plugin-load time, atada al directorio de quien cargó el plugin. Todas las ventanas compartían ese raíz: ninguna otra ventana podía ser "su oficina". Peor: `tools/index.ts` creaba oficinas "alternative" con `new Office({ cwd, limits })` SIN `spawner`/`client` — oficinas zombied readers: `oficina_dispatch` materializaba fichas pero nada arrancaba → 0 sesiones vivas → "la oficina no funciona en mi otra ventana".

### Fix

- **`OfficeFactory`** (`src/core/officeFactory.ts`, nuevo): una `Office` por `path.resolve(cwd)`. `get(dir)` cacheada; propaga `spawner` (+host hooks) a TODAS las oficinas (antes solo la base la tenía).
- **Tools root-aware** (`buildTools` + `officeOf`): resuelve la oficina por `ctx.directory` y cae a `hooks.getOffice` — el entry v2 inyecta la fábrica en las tools.
- **Scope guard / tripwire** (eje `violencia/tripwireFor/scopeOf`): resolve el proyecto root desde `ctx.session.get({sessionID}).location.directory` (con cache) y aplica el scope al `projectRoot` de ESA oficina, no de la base.
- **Dashboard per-root**: `ensureDashboard(sessionDir)` arranca un dashboard por directorio (puertos negociados incrementalmente). No abre browser por root salvo que lo pida el comando de inicio activo.
- **Auto-continuacion y system-prompt hooks** root-aware por sessionID (cada ventana inyecta el prompt de su oficina, no el de la base).

### Tests

- 5 tests nuevos en `tests/officeFactory.test.ts`: cache per-dir, oficinas distintas, estado aislado, `limits` compartido del host, y la integración `oficina_plan(directory=tmpA)` escribe `.oficina/` sólo en `tmpA` (la base queda intacta).
- Suite: **564/564 verde**.


## [3.2.3] — 2026-11-14

**Fix DISP-002 — dispatch reviva owners pre-asignados (plan-time con roster viejo).**

### Problema

`oficina_plan` enruta owner a las cards usando el roster disponible (que arrastra zombies de corridas anteriores — ids que ya no tienen sesión viva). Después, `oficina_dispatch` iteraba cards "sin owner" y las que tenían owner pre-asignado quedaban con `continue` → **0 agentes despachados, 0 sesiones arrancadas**. La sesión del usuario reemplazaba el equipo por subagentes genéricos "a mano", rompiendo la visibilidad de la oficina (mesa/bus/gates).

### Fix

- **`reviveOwner`** (`src/core/dispatch.ts`): para owner pre-asignado presente en el roster, reconstruye la ficha con el scope de la card, calca el briefing, re-materializa `.opencode/agents/oficina-<rol>.md` (mismo id, no duplica), y devuelve el payload de despacho con `reused: true`. La entrada del roster se refresca a `working` + `currentCard`.
- **Pase de revival en `oficina_dispatch`** (`src/tools/index.ts`): tras el despacho normal y los reviewers, toda card `todo|in_progress|rework` con owner que existe en el roster pero **sin sesión enlazada** se arranca vía spawn (idempotente: si hay binding existente no duplica). El output muestra esos agentes con la etiqueta `(reutilizado)` en "Arrancados (con sesión viva)".
- Si el owner pre-asignado falta en el roster, `reviveOwner` no se llama y la card cae al flujo normal.

### Tests

- 2 tests de regresión (`tests/identity-security.test.ts` > `DISP-002`): revive con spawn simulado (spawnCalls asserted ownerId+cardId) + idempotencia (segundo dispatch no spawnea de nuevo) + owner ghost → revive no-op y la card se reasigna por el flujo normal.
- Suite completa: **559/559 verde**.


## [3.2.2] — 2026-11-14

Dashboard **AI-OFFICE v3.3.0** recreado desde la referencia visual + corrección del crash del server por OOM.

### Dashboard v3.3.0

- Rediseño completo de `dashboard/dashboard.html` al look AI-OFFICE v3.3.0: topbar (Run + copiar, Mode violeta, Status pulsante, Started/Duration ticking, Escalate/Stop Run), AGENTS con waveforms animadas, **mesa redonda cenital** (CSS/SVG, cero assets), Message Bus con Live/SSE, GATES agregando el último resultado por fase, **CIRCUIT BREAKER con estado real** derivado de `failureHistory`/`blocked_escalated`, RECENT ACTIVITY desde `state.decisions`, TASK BOARD 5 columnas con chips de rama/paperclip/done-check/chip Typecheck, barra de métricas (progreso %, duración, throughput tasks/h; Tokens honesto `—` porque el host OpenCode no expone conteo).
- **Agentes exactos, cero relleno**: la mesa y el panel muestran exactamente los agentes que la corrida despachó (0 es 0, 3 es 3, 10 es 10). Los tamaños se adaptan con la densidad (`low|mid|high`) según la cantidad.
- **Estados vacíos honestos**: sin corrida — mesa vacía, «Bus en silencio», gates/actividad/board vacíos, métricas 0/0.
- Layout de 4 columnas como la referencia (AGENTS | Mesa | Message Bus | Gates+Activity).
- `POST /api/dashboard-message`: el operador puede enviar mensajes al bus del dashboard (canal `bus/dashboard/`, wx, 500 chars).
- `/api/state` agrega `decisions`, `server.uptimeSec`, `server.rssMB`; `/api/gates` incluye `mtime` para tiempos relativos (2m/3m…).
- `dashboard/scripts/seed-demo.mjs`: fixture sintético rico (RUN-2025-05-18-0017, 5 agentes, 17 cards) para verlo en acción sin corrida real; git-ignored; `npm run dashboard:demo`.
- Interacciones funcionales verificadas con Playwright (0 errores de consola): modal Escalate con payload `oficina_escalate` copiable, modal Stop Run, `+ New Card` copiando card JSON, agrupar por owner, colapsar paneles, filtro solo-activas, copiar Run ID.

### Fix: server no más OOM

- `fs.watch({ recursive: true })` en Windows acumulaba heap (~2GB en ~16 min → FATAL out-of-memory). Reemplazado por watchers **no recursivos** sobre `OFICINA/` (renames atómicos de state/roster/memory), `bus/` y cada canal, con **debounce de 120ms** y limpieza de clientes SSE muertos en cada write.

### Plugin: el dashboard y el usuario

- `skills/oficina/SKILL.md` nueva sección **«1.5 Dashboard: ábrelo y avisá al usuario (OBLIGATORIO)»**: abrir el dashboard al iniciar una corrida, tomar la URL de `<PROJECT_ROOT>/.oficina/dashboard.json` (no asumir 7333), avisar al usuario en el primer mensaje con ubicación + confirmación (`Dashboard en vivo: <url> …`), y nunca pantalla/agente de relleno.
- `commands/oficina.md` Paso 0 reforzado con el mismo formato obligatorio.
- `docs` sync: SKILL.md versión → 3.2.2. `dashboard/README-DASHBOARD.md` reescrito para v3.3.0.
- `.gitignore`: `.oficina-demo/`.

### Verificación

- `npm test` 557/557 · `docs:check` ok · escenarios Playwright empty/three/twelve (0, 3 y 12 agentes) sin errores de consola.


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
