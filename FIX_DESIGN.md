# AI-OFFICE Plan de Corrección - Diseño y Orden de Cambios

**Fecha:** 2026-11-03
**Baseline:** 438 tests passing, HEAD ad113798
**Objetivo:** Convertir garantías centrales en propiedades comprobables del código

---

## Principios de Diseño

1. **Fail-closed por defecto** - Cualquier error de identidad/scope/verificación deniega la operación
2. **Identidad real, no del modelo** - `ctx.agent` (host) es la verdad; `args.agentId` debe coincidir
3. **Binding sesión↔agente↔card obligatorio** - Toda operación sensible requiere binding válido
4. **Transaccionalidad por corrida** - Single run lock para todas las mutaciones de estado/roster
5. **Fencing tokens en leases** - Generación monotónica previene stale heartbeat/release
6. **Tests primero (TDD)** - Cada fix va precedido por test de regresión que falla sin el fix
7. **Cambios mínimos y auditables** - No refactors amplios sin justificación

---

## Estrategia de Locks (Deadlock-Free)

```
┌─────────────────────────────────────────────────────────────┐
│  RUN LOCK (`.run-{runId}.lock`) — ORDEN 1                   │
│  → Protege: OfficeState, Roster, cross-card invariants      │
│  → Tomado por: claimNext, claimCard, submitWork,            │
│     submitReview, closeCard, routeHelpRequest,              │
│     setAgentState, spawnAgent, cleanupBus                   │
├─────────────────────────────────────────────────────────────┤
│  CARD LEASE LOCK (`.locks/{cardId}.lock`) — ORDEN 2         │
│  → Protege: single Lease file (acquire/heartbeat/release)   │
│  → Tomado SOLO dentro de LeaseStore methods                 │
├─────────────────────────────────────────────────────────────┤
│  EVIDENCE LOCK (`.evidence-locks/{cardId}.lock`) — ORDEN 3  │
│  → Protege: EvidenceStore.add/graph para una card           │
│  → Tomado SOLO dentro de EvidenceStore.add                  │
├─────────────────────────────────────────────────────────────┤
│  BUS SEQ LOCK (`.seq.lock` en channel dir) — ORDEN 4        │
│  → Protege: sequence allocation + message write             │
│  → Ya implementado en allocateSeq                           │
└─────────────────────────────────────────────────────────────┘
```

**Regla de oro:** Siempre adquirir RUN LOCK primero, luego cualquier lock inferior. Nunca al revés.

---

## Modelo de Identidad

```
┌─────────────────────────────────────────────────────────────┐
│  OPENCODE HOST (fuente de verdad)                           │
│  └── ctx.agent  →  Identidad real de la sesión (no falsificable) │
├─────────────────────────────────────────────────────────────┤
│  TOOL CONTEXT                                                │
│  └── args.agentId  →  Debe === ctx.agent (validado en entry) │
├─────────────────────────────────────────────────────────────┤
│  SESSION BINDING (state.sessions[sessionId])                │
│  ├── agentId     →  Debe === ctx.agent                      │
│  ├── cardId      →  Card en curso (o null)                  │
│  └── autoResumes →  Persistido en state.json                │
├─────────────────────────────────────────────────────────────┤
│  ROSTER ENTRY (roster.agents[agentId])                      │
│  ├── id, role, state, capabilities, peers                   │
│  ├── currentCard, lease, helpedPeers (persistido)           │
│  └── lastHeartbeat                                          │
└─────────────────────────────────────────────────────────────┘
```

**Validación en cascada (cada operación sensible):**
1. `args.agentId === ctx.agent` → Identidad real
2. `state.sessions[ctx.sessionId].agentId === args.agentId` → Binding sesión
3. `state.sessions[ctx.sessionId].cardId === args.cardId` → Binding card
4. `roster.agents[args.agentId]` existe → Agente desplegado
5. `card.owner === args.agentId` / `card.reviewer === args.agentId` → Ownership

---

## Plan de Corrección por Prioridad

### LOTE 1 - P0 CRITICAL: Identidad y Autorización (Bloque 1-2 días)

| # | Fix | Archivos | Tests Nuevos | Descripción |
|---|-----|----------|--------------|-------------|
| 1.1 | Validar `args.agentId === ctx.agent` en 9 tools | `src/tools/index.ts` | `tests/identity-security.test.ts` | Helper `validateAgentIdentity` al inicio de cada `execute` |
| 1.2 | Binding sesión↔agente↔card en office.ts | `src/core/office.ts` | `tests/identity-security.test.ts` | `assertSessionBinding` en claimCard, submitWork, submitReview, claimNext |
| 1.3 | Validar existencia en roster | `src/core/office.ts` | `tests/identity-security.test.ts` | Check `roster.agents[agentId]` antes de operaciones |
| 1.4 | Validar reviewer asignado (no cualquiera) | `src/core/office.ts` | `tests/identity-security.test.ts` | `card.reviewer === reviewerId` en submitReview |
| 1.5 | ClaimCard solo para owner actual | `src/core/office.ts` | `tests/identity-security.test.ts` | Rechazar claim si `card.owner && card.owner !== agentId` |
| 1.6 | Linaje sesión hija: validar metadata `oficina` | `src/v2.ts` | `tests/identity-security.test.ts` | `resolveParentSession` verifica `session.metadata.oficina` |
| 1.7 | `VERIFICATION_FAILED` siempre bloquea escrituras | `src/hooks/scopeGuard.ts`, `src/v2.ts` | `tests/pluginV2.scope.test.ts` | Fail-closed independiente de `enforce` |
| 1.8 | `oficina_stop` requiere agentId y valida | `src/tools/index.ts` | `tests/identity-security.test.ts` | `agentId` obligatorio + validación identidad |
| 1.9 | `oficina_dispatch` solo integrator/commander | `src/tools/index.ts` | `tests/identity-security.test.ts` | Validar `caller.ficha.canDelegate` |
| 1.10 | Fallback paths con SHA256 (SEC-001) | `src/core/paths.ts` | `tests/paths.test.ts` | `resolveAlternateOficinaDir` usa hash del projectRoot |

### LOTE 2 - P0 CRITICAL: Transaccionalidad y Leases (Bloque 1-2 días)

| # | Fix | Archivos | Tests Nuevos | Descripción |
|---|-----|----------|--------------|-------------|
| 2.1 | Run lock para TODAS las mutaciones | `src/core/office.ts` | `tests/concurrency.test.ts` | `withRunLock` wrapper; claimCard, submitWork, submitReview, closeCard, routeHelpRequest, setAgentState, spawnAgent |
| 2.2 | Lease fencing token (generation) | `src/core/leases.ts`, `types.ts` | `tests/concurrency.test.ts` | `generation` monotónico en Lease; acquire incrementa; heartbeat/release requieren expectedGeneration |
| 2.3 | `release` toma lock del lease | `src/core/leases.ts` | `tests/concurrency.test.ts` | `withLock(lockPath(taskId), ...)` en release |
| 2.4 | `claimCard` valida elegibilidad ANTES de acquire | `src/core/office.ts` | `tests/concurrency.test.ts` | Check estado + owner antes de lease |
| 2.5 | `closeCard` libera lease ANTES de saveState | `src/core/office.ts` | `tests/concurrency.test.ts` | Orden: release lease → transitionCard → saveState |
| 2.6 | EvidenceStore.add con lock por card | `src/core/stores.ts` | `tests/concurrency.test.ts` | Lock `.evidence-locks/{cardId}.lock` |

### LOTE 3 - P0 CRITICAL: Coordinación y Ayuda (Bloque 1 día)

| # | Fix | Archivos | Tests Nuevos | Descripción |
|---|-----|----------|--------------|-------------|
| 3.1 | `routeHelpRequest` pasa `peers` no `capabilities` | `src/core/office.ts:922` | `tests/router.test.ts` | `requester?.peers ?? []` |
| 3.2 | `helpedPeers` se incrementa en HELP_ACCEPT | `src/tools/index.ts` (oficina_bus), `src/core/office.ts` | `tests/router.test.ts` | `recordHelpGiven(requesterId, helperId)` |
| 3.3 | `oficina_bus help` usa targets de routeHelpRequest | `src/tools/index.ts:516` | `tests/bus.test.ts` | `requestHelp` con `to: route.targets` |
| 3.4 | Auto-resumes persistido en state.json | `src/v2.ts`, `src/core/office.ts` | `tests/pluginV2.test.ts` | `state.sessions[sessionId].autoResumes` |
| 3.5 | Spawns paralelos con Promise.allSettled | `src/tools/index.ts:858` | `tests/dispatch.test.ts` | `Promise.allSettled` en dispatch |
| 3.6 | Bus cleanup archiva en lugar de borrar | `src/core/bus.ts` | `tests/bus.test.ts` | `.oficina/bus/archive/` + log JSONL |

### LOTE 4 - P1 HIGH: Scope, Permisos y Delegación (Bloque 1 día)

| # | Fix | Archivos | Tests Nuevos | Descripción |
|---|-----|----------|--------------|-------------|
| 4.1 | Sesiones sin card binding = DENY_ALL (fail-closed) | `src/hooks/scopeGuard.ts:336`, `src/v2.ts:332` | `tests/pluginV2.scope.test.ts` | `NO_SCOPE_APPLICABLE` → throw en enforce=true |
| 4.2 | Eliminar `hidden: true` del frontmatter | `src/core/dispatch.ts:198` | `tests/dispatch.test.ts` | Quitar campo inútil |
| 4.3 | Alinear claves de permiso con OpenCode v2 | `src/v2.ts:47`, `src/hooks/scopeGuard.ts:71` | `tests/pluginV2.scope.test.ts` | `FILE_WRITE_TOOLS`/`SHELL_TOOLS`/`DELEGATE_TOOLS` usan claves oficiales |
| 4.4 | Validar `canDelegate`/`delegateBudget` en task | `src/hooks/scopeGuard.ts:408` | `tests/pluginV2.scope.test.ts` | Check `ficha.canDelegate` y `delegateBudget > 0` |
| 4.4 | Fail-closed en ciclos/profundidad parentID | `src/hooks/scopeGuard.ts:292` | `tests/pluginV2.herencia.test.ts` | Ciclo → `VERIFICATION_FAILED` |
| 4.5 | Tripwire `tripwireMaxFiles` default más alto (10000) | `src/v2.ts:193` | `tests/tripwire.test.ts` | Configurable, 0 = sin límite |

### LOTE 5 - P1 HIGH: Documentación, Tests, CI (Bloque 0.5 día)

| # | Fix | Archivos | Tests Nuevos | Descripción |
|---|-----|----------|--------------|-------------|
| 5.1 | Test count real en docsync (438 no 456) | `src/core/docsync.ts`, `scripts/sync-docs.ts` | `tests/docsync.test.ts` | `computeFacts()` cuenta tests via vitest |
| 5.2 | Coverage badge real (70.08% no 75%) | `src/core/docsync.ts` | `tests/docsync.test.ts` | Incluir coverage en Facts |
| 5.3 | Node version consistente (>=22 en todos) | `COMPATIBILITY.md`, `.github/workflows/ci.yml` | - | Unificar a >=22 |
| 5.3 | PeerDependencies limpias | `package.json` | - | Quitar @opencode/plugin de devDeps; alinear v1 |
| 5.4 | CI valida `npm audit --omit=dev` = 0 | `.github/workflows/ci.yml` | - | Step en job verify |
| 5.5 | Benchmark misses: sinónimos UX/FP&A/code-review | `benchmarks/selection/tasks.json`, `catalog.ts` | `bench:selection` | Agregar aliases/taxonomía |
| 5.6 | `evaluatorVersion` derivado de hash de matching | `benchmarks/selection/run.ts` | - | Hash de archivos de matching |
| 5.7 | Tests unitarios 7 invariantes duros | `tests/office.test.ts` | 7 tests nuevos | Fallo explícito cuando invariante violado |
| 5.8 | `oficina audit` lee gates como texto | `src/cli.ts` | `tests/cli.test.ts` | `fs.readFile` no `readJson` |

### LOTE 6 - P2 MEDIUM: Mejoras Operativas (Bloque 0.5 día)

| # | Fix | Archivos | Tests Nuevos | Descripción |
|---|-----|----------|--------------|-------------|
| 6.1 | Help state machine (SENT→ACCEPTED→RESOLVED/EXPIRED) | `src/core/bus.ts`, `types.ts`, `office.ts` | `tests/bus.test.ts` | `helpState` en Card, TTL, auto-escalación |
| 6.2 | PairCollaborationCount calculado de helpedPeers | `src/core/router.ts:182` | `tests/router.test.ts` | `filter(id => id === p.id).length` |
| 6.3 | `fichaFromEntry` usa `entry.peers` | `src/core/router.ts:243`, `types.ts` | `tests/office.test.ts` | Añadir `peers` a RosterEntry |
| 6.4 | `oficina_mesa claim` bindea sesión | `src/tools/index.ts:996`, `office.ts:664` | `tests/office.test.ts` | `bindSession` en claimCard |
| 6.5 | `sensitivePatterns` configurable | `src/core/sandbox.ts`, `v2.ts` | `tests/sandbox.test.ts` | Opción en V2Options |
| 6.6 | `enforceScope` deprecado: strict/warn/off | `src/v2.ts:79`, `scopeGuard.ts:107` | `tests/pluginV2.scope.test.ts` | Explícito, no boolean |

---

## Secuencia de Integración (Para Evitar Conflictos)

```
ORDEN DE EDICIÓN (archivos compartidos → últimos):

1. src/core/types.ts           ← NUEVOS CAMPOS (generation en Lease, peers en RosterEntry, helpState en Card)
2. src/core/atomic.ts          ← Sin cambios (base)
3. src/core/paths.ts           ← Fallback SHA256 (aislado)
4. src/core/leases.ts          ← Fencing token + release lock
5. src/core/stores.ts          ← Evidence lock
6. src/core/office.ts          ← Run lock + binding validations + mutaciones
7. src/core/router.ts          ← Help routing + peers + pair count
8. src/core/bus.ts             ← Help state machine + cleanup archive
9. src/core/sandbox.ts         ← Scope DENY_ALL + sensitivePatterns configurable
10. src/hooks/scopeGuard.ts    ← Fail-closed VERIFICATION_FAILED + delegate validation
11. src/v2.ts                  ← Identity validation + lineage + autoResumes persist + permissions align
12. src/tools/index.ts         ← 9 tools identity validation + oficina_next (alias) + dispatch auth + bus help targets
13. src/core/dispatch.ts       ← Quitar hidden: true
14. src/cli.ts                 ← Audit lee gates como texto
15. src/core/docsync.ts        ← Test count + coverage + benchmark facts
15. tests/*.test.ts            ← TODOS LOS TESTS DE REGRESIÓN (primero!)
```

---

## Tests de Regresión a Crear (Primero - TDD)

| Archivo | Tests | Cobertura |
|---------|-------|-----------|
| `tests/identity-security.test.ts` | 12 | F-01 a F-12, F-QA-004 |
| `tests/concurrency.test.ts` | 11 | B-01 a B-11 (TC-B01 a TC-B11) |
| `tests/router.test.ts` | 4 | H-01, H-07, H-09, H-11 |
| `tests/bus.test.ts` | 4 | H-02, H-06, H-08, H-10 |
| `tests/pluginV2.scope.test.ts` | 4 | C-01, C-03, C-04, C-05, F-QA-004 |
| `tests/pluginV2.test.ts` | 1 | H-04 (autoResumes persist) |
| `tests/dispatch.test.ts` | 2 | H-05, C-02 |
| `tests/paths.test.ts` | 1 | F-QA-003 |
| `tests/docsync.test.ts` | 3 | E-01, F-QA-001, F-QA-002 |
| `tests/cli.test.ts` | 1 | F-QA-005 |
| `tests/tripwire.test.ts` | 1 | F-QA-006 |
| `tests/office.test.ts` | 3 | H-03, H-12, 6.3 |
| `tests/docsync.test.ts` | 3 | E-01, F-QA-001, F-QA-002 |

**Total: ~50 tests nuevos** (todos fallan antes del fix, pasan después)

---

## Criterios de Aceptación por Lote

### Lote 1 (Identidad) - ✅ PASS cuando:
- [ ] 9 tools rechazan `agentId !== ctx.agent`
- [ ] `submitWork` rechaza sin binding sesión válido
- [ ] `submitReview` rechaza reviewer no asignado / no en roster / self-review
- [ ] `claimCard` rechaza claim de card con owner distinto
- [ ] Sesión hija sin metadata `oficina` no hereda scope
- [ ] `VERIFICATION_FAILED` bloquea escrituras aunque `enforce=false`
- [ ] `oficina_stop` requiere `agentId` y valida identidad
- [ ] `oficina_dispatch` solo integrator/commander
- [ ] Fallback paths aislados por SHA256

### Lote 2 (Transaccionalidad) - ✅ PASS cuando:
- [ ] `claimNext` + `claimCard` misma card → 1 solo éxito (TC-B01)
- [ ] `claimNext` T-01 + `claimCard` T-02 → ambos success, sin lost updates (TC-B02)
- [ ] `submitWork` T-01 + `submitWork` T-02 concurrentes → ambos persist (TC-B03)
- [ ] `submitReview(approved)` + `closeCard` misma card → final `done`, ambos artifacts (TC-B04)
- [ ] Lease takeover: A expire → B acquire → A heartbeat/release rechazado (TC-B06, TC-B07)
- [ ] `closeCard` crash simulation → lease no dangling (TC-B08)
- [ ] EvidenceStore.add concurrente → ambos nodos persistidos (TC-B11)

### Lote 3 (Coordinación) - ✅ PASS cuando:
- [ ] Help routing usa `peers` de ficha, no `capabilities`
- [ ] `helpedPeers` incrementa tras `HELP_ACCEPT`, rota en 3er pedido
- [ ] `oficina_bus help` usa `targets` calculados, no broadcast
- [ ] Auto-resumes persiste en state.json tras reinicio
- [ ] Dispatch spawns en paralelo (Promise.allSettled)
- [ ] Bus cleanup archiva a `.oficina/bus/archive/` + log JSONL

---

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Run lock se vuelve bottleneck | Baja | Medio | Ops son segundos; monitorear wait times; shard futuro si necesario |
| Fencing token rompe callers existentes | Media | Alto | API versionada: `acquire` devuelve `{ lease, generation }`; `heartbeat`/`release` aceptan `generation` opcional (warn si falta) |
| Deadlock por orden de locks | Nula (jerarquía estricta) | N/A | Code review + análisis estático |
| Evidence lock añade directorio | Baja | Bajo | Reutilizar patrón `.oficina/leases/.locks/` |
| Cambios en `types.ts` rompen serialización | Media | Alto | Migración automática en `loadState` / `migrateState` |

---

## Próximos Pasos Inmediatos

1. **Crear `tests/identity-security.test.ts`** con 12 tests (F-01 a F-12)
2. **Crear `tests/concurrency.test.ts`** extendido con TC-B01 a TC-B11
3. **Ejecutar tests nuevos** → deben FALLAR (red phase)
4. **Implementar Lote 1** (identidad) → tests pasan (green phase)
5. **Commit atómico** por lote
6. **Repetir** para Lotes 2-6

---

**Firma:** Comandante/Integrador  
**Fecha:** 2026-11-03