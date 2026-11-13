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
