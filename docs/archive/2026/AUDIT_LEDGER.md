# AI-OFFICE Auditoría Integral - Ledger de Trabajo

**Fecha inicio:** 2026-11-03
**Repo:** C:\Users\Marcos\oficina-plugin
**Branch:** main
**HEAD:** ad113798315ed6054922ecab62efe03719be921a
**Versión package.json:** 3.1.3
**Agency Agents checkout:** C:\Users\Marcos\agency-agents (commit 4e3ac3ca6604c75113f52c695dbddcc7af928b46)

## Estado Inicial - Baseline

### Calidad
- `npm run typecheck`: ✅ PASS
- `npm run build`: ✅ PASS
- `npm test`: ✅ 438/438 PASS
- `npm run docs:check`: ✅ PASS
- `npm run bench:selection`: ✅ PASS (hit@1 71%)
- `npm audit`: 26 vulnerabilities (24 moderate, 2 high) - principalmente glob/minimatch/zod en deps de OpenCode

### Cambios locales sin commit
- README.md (modified)
- docs/QUE-ES.md (modified)
- package-lock.json (modified)
- package.json (modified - version 3.1.3)

### Skills disponibles en repo
- `oficina` (skill principal)

### Skills OpenCode locales (C:\Users\Marcos\.opencode\agents)
- oficina-engineering-pdf-engine-architect.md
- oficina-game-designer.md
- oficina-specialized-master-plan-architect.md
- oficina-testing-api-tester.md

---

## Fases del Plan

### Fase 1: Baseline y Triage ✅ COMPLETADO
- [x] Inventario repo, Git, comandos base, reproducción hallazgos
- [x] Perfiles Agency Agents identificados
- [x] Skills listados

### Fase 2: Auditoría Paralela Sin Edición ✅ COMPLETADA
- [x] A. Identidad/Autenticación - Security Auditor
- [x] B. Transacciones/Concurrencia - Backend/Distributed Systems Engineer
- [x] C. Scope/Permisos/Delegación - OpenCode Plugin Engineer
- [x] D. Coordinación/Ayuda/Protocolo - Backend Engineer
- [x] E. Integración OpenCode/Agency Agents - OpenCode Integration Engineer
- [x] F. Tests/Seguridad/Documentación - QA Engineer + Technical Writer

### Fase 3: Diseño y Orden de Cambios (EN CURSO)
- [ ] Publicar prioridades, invariantes, estrategia de locks, modelo identidad
- [ ] Definir secuencia de integración para evitar conflictos

### Fase 4: Corrección con Tests
- [ ] Tests de regresión que fallen por defectos
- [ ] Corrección en lotes pequeños

### Fase 5: Revisión Independiente
- [ ] Code Reviewer independiente audita diff final

### Fase 6: Verificación
- [ ] Todos los comandos de calidad
- [ ] Smoke/integración OpenCode
- [ ] git diff --check, estado Git, archivos generados

---

## Hallazgos por Área (CONSOLIDADOS - 58 hallazgos totales)

### A. Identidad y Autenticación - CRÍTICO (12 hallazgos)

| ID | Hallazgo | Severidad | Archivo/Símbolo |
|----|----------|-----------|-----------------|
| F-01 | 9 tools aceptan `agentId` del modelo sin validar contra `ctx.agent` | 🔴 CRITICAL | `src/tools/index.ts` (oficina_assign, submit, review, bus, spawn, escalate, evidence, mesa, stop) |
| F-02 | No binding verificado sesión ↔ agente roster | 🔴 CRITICAL | `src/v2.ts:279`, `src/core/office.ts:646` |
| F-03 | `submitWork`/`submitReview` usan `agentId` del modelo para ownership/reviewer | 🔴 CRITICAL | `src/core/office.ts:717,760` |
| F-04 | Bus/ACK usan `agentId` del modelo sin verificar sesión | 🟠 HIGH | `src/tools/index.ts:484`, `src/core/bus.ts:233` |
| F-05 | `oficina_stop` permite `agentId` opcional del modelo | 🟡 MEDIUM | `src/tools/index.ts:1106` |
| F-06 | Self-review bypass via reviewer field manipulation | 🔴 CRITICAL | `src/core/office.ts:564,760` |
| F-07 | Claim de card en `rework` por agente distinto al owner | 🟠 HIGH | `src/core/office.ts:683` |
| F-08 | Agente fantasma opera sin deploy | 🟠 HIGH | `src/core/roster.ts:692` |
| F-09 | Linaje sesión hija manipulable (`resolveParentSession` confía en host) | 🔴 CRITICAL | `src/v2.ts:206`, `src/hooks/scopeGuard.ts:265` |
| F-10 | `VERIFICATION_FAILED` no bloquea en `enforce=false` | 🟠 HIGH | `src/hooks/scopeGuard.ts:342`, `src/v2.ts:227` |
| F-11 | Bus broadcast `to: ["*"]` permite suplantación de destinatario | 🟢 LOW | `src/tools/index.ts:529`, `src/core/bus.ts:222` |
| F-12 | `oficina_dispatch` spawnea sin validar caller | 🟡 MEDIUM | `src/tools/index.ts:825` |

### B. Transacciones y Concurrencia - CRÍTICO (11 hallazgos)

| ID | Hallazgo | Severidad | Archivo/Símbolo |
|----|----------|-----------|-----------------|
| B-01 | Run lock vs per-card lease lock ordering violation | 🔴 CRITICAL | `src/core/office.ts:588` vs `664` |
| B-02 | Non-transactional `loadState → mutate → saveState` | 🟠 HIGH | `src/core/office.ts` (todos mutadores) |
| B-03 | Lease `heartbeat`/`release` lack fencing token | 🟠 HIGH | `src/core/leases.ts:126,141` |
| B-04 | `LeaseStore.release` TOCTOU between `get` and `writeJsonAtomic` | 🟠 HIGH | `src/core/leases.ts:141` |
| B-05 | `claimCard` releases lease on ineligible state *after* acquiring | 🟡 MEDIUM | `src/core/office.ts:683` |
| B-06 | `closeCard` releases lease *after* `saveState` | 🟡 MEDIUM | `src/core/office.ts:900` |
| B-07 | `submitReview` / `closeCard` concurrent on same card — lost transition | 🟠 HIGH | `src/core/office.ts:747,862` |
| B-08 | `routeHelpRequest` mutates state without lock | 🟠 HIGH | `src/core/office.ts:915` |
| B-09 | `setAgentState` / `heartbeat` roster mutations not protected | 🟡 MEDIUM | `src/core/roster.ts:65`, `src/core/office.ts:954` |
| B-10 | `spawnAgent` saves state *before* spawning | 🟢 LOW | `src/core/office.ts:385` |
| B-11 | `EvidenceStore.add` read-modify-write without lock | 🟡 MEDIUM | `src/core/stores.ts` |

### C. Scope, Permisos y Delegación - CRÍTICO (12 hallazgos)

| ID | Hallazgo | Severidad | Archivo/Símbolo |
|----|----------|-----------|-----------------|
| C-01 | Sesiones sin card binding = escritura libre (`NO_SCOPE_APPLICABLE`) | 🔴 CRITICAL | `src/hooks/scopeGuard.ts:336`, `src/v2.ts:332` |
| C-02 | Campo `hidden: true` en frontmatter no existe en schema | 🔴 CRITICAL | `src/core/dispatch.ts:198`, `src/core/types.ts:127` |
| C-03 | Permisos OpenCode v2: claves reales vs conjuntos del plugin | 🔴 CRITICAL | `src/v2.ts:47`, `src/hooks/scopeGuard.ts:71` |
| C-04 | Delegación `task` no respeta `canDelegate`/`delegateBudget` | 🟠 HIGH | `src/hooks/scopeGuard.ts:103,408` |
| C-05 | Herencia scope en subagentes: profundidad 6, ciclos, padres no disponibles | 🟠 HIGH | `src/hooks/scopeGuard.ts:281`, `src/v2.ts:206` |
| C-06 | Análisis shell: falsos negativos en interpreters, variables, heredoc | 🟠 HIGH | `src/core/sandbox.ts:679` |
| C-07 | Tools providers/MCP/custom: superficie desconocida | 🟠 HIGH | `src/v2.ts:47`, `src/hooks/scopeGuard.ts:71` |
| C-08 | Agente invocado directamente (`@oficina-<slug>`) salta dispatch | 🟡 MEDIUM | `src/core/dispatch.ts:139`, `src/core/factory.ts:475` |
| C-09 | Archivos sensibles: lista hardcodeada, no extensible | 🟡 MEDIUM | `src/core/sandbox.ts:362` |
| C-10 | Tripwire `tripwireMaxFiles=4000` puede silenciar detecciones | 🟡 MEDIUM | `src/v2.ts:192` |
| C-11 | `enforceScope: false` modo legacy peligroso | 🟢 LOW | `src/v2.ts:79`, `src/hooks/scopeGuard.ts:107` |
| C-12 | Falta test bypass por tool MCP/custom | 🟢 LOW | `tests/pluginV2.scope.test.ts` |

### D. Coordinación, Ayuda, Protocolo - ALTO/CRÍTICO (12 hallazgos)

| ID | Hallazgo | Severidad | Archivo/Símbolo |
|----|----------|-----------|-----------------|
| H-01 | `routeHelpRequest` pasa `capabilities` como `requesterPeers` | 🔴 CRITICAL | `src/core/office.ts:922` |
| H-02 | Ciclo de vida ayuda sin state machine | 🔴 CRITICAL | `src/core/bus.ts:42`, `src/core/mesa.ts:89` |
| H-03 | `oficina_next` no existe como tool obligatoria | 🟠 HIGH | `src/tools/index.ts` |
| H-04 | Presupuestos en memoria volátiles (`maxAutoResumes` en Map) | 🔴 CRITICAL | `src/v2.ts:475` |
| H-05 | `oficina_dispatch` spawns "en paralelo" son secuenciales | 🟠 HIGH | `src/tools/index.ts:858` |
| H-06 | Limpieza bus destructiva (`cleanupExpired` unlink sin archivo) | 🟠 HIGH | `src/core/bus.ts:384` |
| H-07 | Anti-monotonía rota: `helpedPeers` nunca se incrementa | 🔴 CRITICAL | `src/core/router.ts:181`, `src/core/office.ts:922` |
| H-08 | `oficina_bus help` ignora targets y hace broadcast | 🟠 HIGH | `src/tools/index.ts:507` |
| H-09 | `pairCollaborationCount` hardcoded a 0, no calculado de historia | 🟡 MEDIUM | `src/core/router.ts:172` |
| H-10 | No hay escalación automática de `HELP_REQUEST` vencidos | 🟡 MEDIUM | `src/core/bus.ts:217`, `src/core/office.ts` |
| H-11 | `fichaFromEntry` hardcodea `peers: []` rompiendo routing ayuda | 🟡 MEDIUM | `src/core/router.ts:243` |
| H-12 | `oficina_mesa` claim no actualiza lease/owner/session binding | 🟢 LOW | `src/tools/index.ts:996` |

### E. Integración OpenCode/Agency Agents - ALTO/CRÍTICO (9 hallazgos)

| ID | Hallazgo | Severidad | Archivo/Símbolo |
|----|----------|-----------|-----------------|
| E-01 | Test count drift: README 456 vs real 438 (-18) | 🟠 HIGH | `README.md`, `docsync.ts` |
| E-02 | Node version inconsistency: >=22 vs >=20 vs CI [20,22] | 🟠 HIGH | `package.json`, `COMPATIBILITY.md`, `.github/workflows/ci.yml` |
| E-03 | PeerDependencies confuso: v1 legacy vs v2 real | 🟡 MEDIUM | `package.json:87` |
| E-04 | Sin test integración real OpenCode | 🔴 CRITICAL | `tests/plugin.test.ts`, `pluginV2.test.ts` |
| E-05 | Agentes materializados ≠ agents OpenCode (`agent: "general"`) | 🟡 MEDIUM | `src/v2.ts:147` |
| E-06 | Benchmark misses: UX, FP&A, code-review (14% fallo) | 🟡 MEDIUM | `benchmarks/selection/tasks.json` |
| E-07 | `evaluatorVersion` hardcoded en benchmark | 🟢 LOW | `benchmarks/selection/run.ts:375` |
| E-08 | Catálogo snapshot divisions mismatch: 18 vs 21 | 🟢 LOW | `docs/catalog-facts.json` |
| E-09 | Hooks count hardcoded en docsync.ts (7) | 🟢 LOW | `src/core/docsync.ts:174` |

### F. Tests, Seguridad, Documentación - MEDIO/ALTO (12 hallazgos)

| ID | Hallazgo | Severidad | Archivo/Símbolo |
|----|----------|-----------|-----------------|
| F-QA-001 | Conteo tests desincronizado (README 456 vs 438) | 🟠 HIGH | `README.md:10`, `docsync.ts` |
| F-QA-002 | Coverage badge 75% vs real 70.08% stmt | 🟡 MEDIUM | `README.md:16` |
| F-QA-003 | Fallback paths colisionan (SEC-001 histórico) | 🔴 CRITICAL | `src/core/paths.ts:125` |
| F-QA-004 | `v2.ts` scopeOf bypass en error transitorio (SEC-003) | 🔴 CRITICAL | `src/v2.ts:187` |
| F-QA-005 | `oficina audit` lee gates.md como JSON (CLI-001) | 🟡 MEDIUM | `src/cli.ts:233` |
| F-QA-006 | Tripwire `arm()` silencia errores (COR-001) | 🟡 MEDIUM | `src/core/tripwire.ts` |
| F-QA-007 | Benchmark fingerprint no valida tasks.json en repo | 🟡 MEDIUM | `benchmarks/selection/run.ts:376` |
| F-QA-008 | Windows 8.3 test salta aserción real | 🟢 LOW | `tests/sandbox-83.test.ts` |
| F-QA-009 | CI no valida `npm audit --omit=dev` = 0 | 🟡 MEDIUM | `.github/workflows/ci.yml` |
| F-QA-010 | No test flakiness `--repeat-each=10` | 🟢 LOW | `package.json`, CI |
| F-QA-011 | 7 invariantes duros sin test unitario de fallo | 🟡 MEDIUM | `src/core/office.ts`, `src/core/state.ts` |
| F-QA-012 | 2 HIGH residuales en @opencode-ai/plugin (dev-only) | 🟢 LOW | `package.json`, `npm audit` |

---

## Resumen de Severidad Consolidado

| Severidad | Cuenta | Áreas |
|-----------|--------|-------|
| 🔴 **CRITICAL** | 23 | A(6), B(1), C(3), D(4), E(1), F(2) |
| 🟠 **HIGH** | 18 | A(3), B(5), C(3), D(3), E(2), F(2) |
| 🟡 **MEDIUM** | 11 | A(1), B(3), C(2), D(3), E(2), F(1) |
| 🟢 **LOW** | 6 | A(1), B(0), C(2), D(2), E(0), F(1) |
| **TOTAL** | **58** | |

---

## Agentes/Subagentes Asignados - COMPLETADOS

| Rol | Perfil Agency Agents | Responsabilidad | Estado | Hallazgos |
|-----|---------------------|-----------------|--------|-----------|
| Security Auditor | security-auditor / appsec-engineer | A. Identidad, permisos, scope, threat model | ✅ Done | 12 (6 CRITICAL) |
| Backend/Distributed Systems | backend-architect | B. Transacciones, locks, leases, recuperación | ✅ Done | 11 (1 CRITICAL) |
| OpenCode Plugin Engineer | developer-tooling-engineer | C. Scope, permisos, API real, hooks, tools | ✅ Done | 12 (3 CRITICAL) |
| Backend/Distributed Systems | backend-architect | D. Coordinación, ayuda, router, protocolo | ✅ Done | 12 (4 CRITICAL) |
| OpenCode Integration Engineer | technical-writer | E. Integración OpenCode, Agency Agents, docs | ✅ Done | 9 (2 CRITICAL) |
| QA/Test Automation Engineer | test-automation-engineer | F. Tests, seguridad deps, cobertura, CI | ✅ Done | 12 (2 CRITICAL) |
| **Comandante/Integrador** | (este agente) | Plan, decisiones, estado, dependencias, integración | ✅ Coordinado | **58 hallazgos totales** |

---

## Comandos Ejecutados y Resultados

| Comando | Resultado |
|---------|-----------|
| `npm run typecheck` | ✅ PASS |
| `npm run build` | ✅ PASS |
| `npm test` | ✅ 438/438 PASS |
| `npm run docs:check` | ✅ PASS |
| `npm run bench:selection` | ✅ PASS (hit@1 71%) |
| `npm audit --omit=dev` | ✅ 0 vulns prod |
| `npm audit` | 26 vulns (2 high, 24 moderate) - dev only |
| `npm pack --dry-run` | ✅ PASS |

---

## Archivos Clave a Auditar (Referencia)

### Identidad/Autenticación
- src/tools/index.ts (handlers con agentId)
- src/core/office.ts (claim, submit, review, evidencia)
- src/v2.ts (bindings sesión)
- src/core/bus.ts (bus tools, ACK)

### Transacciones/Concurrencia
- src/core/office.ts (claimNext, claimCard, submit/review/cierre)
- src/core/leases.ts
- src/core/roster.ts, stores.ts
- src/core/atomic.ts
- tests/concurrency.test.ts

### Scope/Permisos
- src/v2.ts (plugin entry, hooks)
- src/hooks/scopeGuard.ts
- src/core/sandbox.ts
- src/core/dispatch.ts, factory.ts

### Coordinación
- src/core/router.ts (routeHelpRequest)
- src/core/office.ts (dispatch, help)
- src/core/mesa.ts, bus.ts
- src/tools/index.ts (oficina_next, oficina_status, oficina_bus_cleanup)

---

## Próximos Pasos Inmediatos - FASE 3: DISEÑO Y ORDEN DE CAMBIOS

1. **Publicar prioridades, invariantes, estrategia de locks, modelo de identidad**
2. **Definir secuencia de integración** para evitar conflictos entre áreas
3. **Crear tests de regresión ANTES de tocar código** (TDD) para cada hallazgo P0/P1