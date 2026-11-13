# AUDITORÍA QA / TEST AUTOMATION — AI-OFFICE v3.1.3

**Fecha:** 2026-11-03  
**Commit auditado:** `e0c7d48` (HEAD actual, mismo que remediación v3.0.5)  
**Rama:** `main`  
**Entorno:** Windows 11 / Node.js 24.x / pnpm workspace (oficina-plugin)  
**Auditor:** Test Automation Engineer (subagente)

---

## RESUMEN EJECUTIVO

| Dimensión | Estado | Evidencia |
|---|---|---|
| **Tests totales** | 438 passing (README dice 456) | `npm test` → 27 files, 438 tests, 31.75s |
| **Typecheck** | ✅ PASS | `tsc --noEmit` exit 0 |
| **Build** | ✅ PASS | `tsc -p tsconfig.build.json` exit 0 |
| **docs:check** | ✅ PASS | Sincronizado (tools=18, hooks=7, catalog=258/18) |
| **Benchmark selección** | ✅ PASS (71% hit@1) | Fingerprint inmutable `07211c1` |
| **Coverage** | 70.08% stmt / 64.15% branch / 75.42% func / 72.61% lines | Thresholds: 60/50/60/60 → **CUMPLE** |
| **npm audit (prod)** | ✅ 0 vulnerabilities | `--omit=dev` |
| **npm audit (completo)** | 2 high, 24 moderate | Residuales en `@opencode-ai/plugin` (dev-only, peer optional) |
| **CI matrix** | ✅ Ubuntu/Windows × Node 22/24 | `.github/workflows/ci.yml` verificado |

**Hallazgo crítico:** El README/badge dice **456 tests** pero la suite real ejecuta **438 tests** (−18). La remediación previa (v3.0.5) reportó 456 tras agregar 11 tests de regresión, pero la cuenta actual no coincide. Esto indica que `docs:check` **no valida el conteo de tests** contra la realidad de Vitest.

---

## 1. VERIFICACIÓN DE COMANDOS DE CALIDAD

| Comando | Código salida | Duración | Resultado | Notas |
|---|---|---|---|---|
| `npm ci` | 0 | 35s | ✅ | 346 packages, 26 vulns totales |
| `npm run typecheck` | 0 | ~3s | ✅ | 0 errores TypeScript |
| `npm test` | 0 | 31.75s | ✅ | 27 suites, 438 tests |
| `npm run build` | 0 | ~3s | ✅ | `dist/` generado limpio |
| `npm run docs:check` | 0 | ~1s | ✅ | README.md + docs/QUE-ES.md al día |
| `npm run bench:selection` | 0 | ~5s | ✅ | 71% hit@1, fingerprint `07211c1` |
| `npm pack --dry-run` | 0 | ~2s | ✅ | Paquete empaquetable |
| `npm audit --omit=dev` | 0 | ~2s | ✅ | **0 vulnerabilidades en producción** |
| `npm audit` | 1 | ~2s | ⚠️ | 26 vulns (2 high, 24 moderate) |

**Conclusión:** Todos los gates técnicos pasan. El único gap documental es el conteo de tests.

---

## 2. GAPS DE COBERTURA — INVARIANTES SIN TEST, EDGE CASES, FLAKINESS

### 2.1 Invariantes duros sin test de regresión explícito

| Invariante | Código | Test actual | Gap |
|---|---|---|---|
| `gate_required_before_done` | `office.ts:closeCard` | `office.test.ts` ciclo completo | No hay test unitario que verifique **fallo explícito** cuando `gates.md` falta o tiene FAIL |
| `evidence_required_before_done` | `office.ts:closeCard` | `evidence.test.ts` grafo requisito-evidencia | No prueba que `DONE` se rechace si evidencia obligatoria está en `MISSING` |
| `reviewer_neq_owner` | `office.ts:reviewCard` | `router.test.ts` rotación | No prueba intento de auto-revisión → debe lanzar |
| `max_spawn_depth ≤ 2` | `dispatch.ts` | `dispatch.test.ts` | No prueba depth 3 → debe rechazar spawn |
| `max_help_chain_hops ≤ 2` | `bus.ts:handleHelpRequest` | `bus.test.ts` | No prueba cadena de 3 saltos → debe escalar a Integrador |
| `lease_ttl_sec + heartbeat` | `leases.ts:acquire/renew` | `leases.test.ts` expiración | No prueba **heartbeat perdido** → lease debe expirar y card volver a pool |
| `msg_ttl_sec = 900` | `bus.ts` TTL purge | `bus.test.ts` TTL | No prueba mensaje vencido → invisible para lectores nuevos |

### 2.2 Edge cases sin cubrir en tests existentes

| Área | Edge case | Riesgo | Test propuesto |
|---|---|---|---|
| **Scope guard** | `v2.ts` `scopeOf` retorna `undefined` en error → bypass (SEC-003 histórico) | **P1** | Test: error transitorio en `loadState` → hook debe bloquear (DENY_ALL) |
| **Fallback paths** | Colisión `~/.oficina/{basename}` entre proyectos homónimos (SEC-001 histórico) | **P1** | Test: dos proyectos `C:\a\app` y `C:\b\app` → rutas alternativas distintas (SHA256) |
| **Tripwire** | `arm()` falla silenciosamente → `check()` reporta limpio (COR-001 histórico) | **P2** | Test: forzar error en `snapshotTree` → `check()` debe marcar `incomplete: true` |
| **State corruption** | `readJson` renombra a `.corrupt-*` pero `loadState` crea corrida vacía (STATE-001 histórico) | **P1** | Test: `state.json` corrupto → debe lanzar `StateCorruptionError`, NO crear estado nuevo |
| **AgentId collision** | `dispatch.ts` `e-${role}` colisiona si 2 cards piden mismo rol (DISP-001 histórico) | **P1** | Test: 3 cards con mismo rol → 3 agentIds únicos con sufijo cardId |
| **Benchmark fingerprint** | SHA fijado en CI pero `tasks.json` no versionado en repo | **P2** | Test: modificar `tasks.json` → fingerprint debe cambiar y CI fallar |
| **CLI audit** | `readJson` sobre `gates.md` (Markdown) → siempre null (CLI-001 histórico) | **P2** | Test: `oficina audit` debe leer gates como texto, no JSON |
| **Windows 8.3** | `sandbox-83.test.ts` salta aserción si no hay alias `~1` real | **P3** | Test: mockear `canonicalizePhysical` para verificar expansión determinista |

### 2.3 Análisis de flakiness potencial

| Síntoma | Probable causa raíz | Verificación hecha |
|---|---|---|
| Tests pasan 100% en 3 corridas locales | No observado flakiness en ejecución actual | `npm test` repetido 3x → 438/438 consistente |
| `concurrency.test.ts` 40 rondas concurrentes | Diseñado para detectar races | Pasa determinísticamente (withLock + O_EXCL) |
| `sandbox-83.test.ts` rama condicional | Solo aserciona si `RUNNER~1` presente | **Riesgo**: test pasa sin ejercer código real en CI sin 8.3 |
| Benchmark `catalogRevision` depende de `git rev-parse` externo | Repo `agency-agents` clonado en CI por SHA | ✅ CI fija commit `4e3ac3ca6604c75113f52c695dbddcc7af928b46` |

**Recomendación:** Ejecutar suite con `--repeat-each=10` en CI nocturno para certificar ausencia de flakiness estadístico.

---

## 3. NPM AUDIT — SEPARACIÓN PROD vs DEV Y RIESGO REAL

### 3.1 Producción (`npm audit --omit=dev`) — **0 vulnerabilidades**

```json
{
  "metadata": {
    "vulnerabilities": { "total": 0 },
    "dependencies": { "prod": 2, "dev": 395, "optional": 57, "peer": 42 }
  }
}
```

**Dependencias de producción:** `@opencode/plugin@^2.1.2`, `zod@^4.6.7` — ambas limpias.

### 3.2 Desarrollo (completo) — 26 vulnerabilidades

| Severidad | Count | Principales vectores | Afecta a |
|---|---|---|---|
| **High** | 2 | `zod <4.6.6` (GHSA-mrhx-c7xc-m3w5) → memory exhaustion en validación collections | `@opencode-ai/plugin/node_modules/zod` (devDependency, peer optional) |
| **Moderate** | 24 | `glob` (GHSA-3g3m-2fjr-6pw4), `minimatch` (GHSA-g3hv-75wg-m249), `tinypool` (vía vitest 3.x), `cacache`, `pacote`, `@npmcli/*`, `sigstore`, `tuf-js` | Tooling de desarrollo/test (no en bundle publicado) |

### 3.3 Evaluación de riesgo real

| Vulnerabilidad | CVE/GHSA | Vector | Explotable en prod? | Justificación |
|---|---|---|---|---|
| `zod` memory exhaustion | GHSA-mrhx-c7xc-m3w5 | Validar input gigante en constrained collections | **NO** | Solo en `@opencode-ai/plugin` (devDependency, peer optional para entry v1). Nuestro `zod` directo es `^4.6.7` (fix incluido). |
| `tinypool` RCE | GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr | Prototype pollution → RCE en workers | **NO** | `vitest@5.0.5` ya actualizado (trae `tinypool@2.1.2+`). Vulnerabilidad residual en `@opencode-ai/plugin` que usa vitest 3.x internamente. |
| `glob` AbortSignal bypass | GHSA-3g3m-2fjr-6pw4 | Post-timeout filesystem traversal | **NO** | Solo en tooling de build/test. No hay path user-controlled que llegue a `glob` en runtime. |
| `minimatch` DoS | GHSA-g3hv-75wg-m249 | Globparts amplification | **NO** | Mismo caso: dev-only. |

**Veredicto:** **Riesgo residual ACEPTADO y DOCUMENTADO** en `REMEDIATION_CLOSURE_REPORT.md`. No hay vulnerabilidades en el paquete publicado (`npm pack` → solo `oficina-opencode` + deps prod). Las 2 HIGH son en dependencia peer opcional de desarrollo (`@opencode-ai/plugin`) que no se instala en consumidores finales.

---

## 4. DOCS:CHECK — VALIDACIÓN DE CONTEOS/VERSIONES EN DOCS CRÍTICOS

### 4.1 Estado actual

`scripts/sync-docs.ts` valida y sincroniza:
- `README.md` → bloque `<!-- BEGIN GENERATED: facts -->`
- `docs/QUE-ES.md` → mismo bloque

**Hechos validados automáticamente:**
- Tools count (18) ✅
- Hooks count (7) ✅
- Plugin API version (`@opencode/plugin@2.1.2`) ✅
- Node engine (>=22) ✅
- Catalog agents/divisions (258/18) ✅

**NO validados (gap crítico):**
- **Conteo de tests** (README badge dice 456, realidad 438)
- **Versión del paquete** en badge npm vs `package.json` (coincide v3.1.3)
- **Coverage %** en badge (dice 75%, real 70.08% stmt)
- **Benchmark hit@1** en tabla README (dice 71%, real 71% — coincide hoy pero no validado)

### 4.2 Arreglo recomendado

Extender `computeFacts()` en `src/core/docsync.ts` para incluir:

```typescript
interface Facts {
  // ... existentes
  testCount: number        // desde vitest run --reporter=json
  coverage: {              // desde vitest run --coverage --reporter=json
    lines: number
    functions: number
    branches: number
    statements: number
  }
  benchmark: {
    hit1: number
    catalogRevision: string
    fingerprint: string
  }
}
```

Y agregar validación en `sync-docs.ts --check` que compare `facts.testCount` contra el badge del README (regex `/tests-(\d+)%20passing/`).

---

## 5. CI MATRIX — UBUNTU/WINDOWS × NODE 22/24 + DOCS + SMOKE + INSTALL

### 5.1 Matrix actual (`.github/workflows/ci.yml`)

| Job | OS | Node | Steps clave |
|---|---|---|---|
| `verify` | ubuntu-latest, windows-latest | 22, 24 | `npm ci` → typecheck → test → build → coverage (ubuntu/24) → pack dry-run (ubuntu/24) |
| `docs` | ubuntu-latest | 24 | `npm ci` → build → `docs:check` → `bench:selection` (clona agency-agents @ SHA fijo) |
| `smoke` | ubuntu-latest | 24 | `npm ci` → build → CLI init/status/board → install en target limpio |
| `install-verify` | ubuntu-latest, windows-latest | 24 | `npm pack` → instalar `.tgz` en proyecto temporal → verificar exports v1/v2 + CLI |

### 5.2 Gaps y riesgos

| Gap | Severidad | Impacto |
|---|---|---|
| **No hay job de coverage en Windows** | P2 | Diferencias de path/fs pueden afectar instrumentación v8 |
| **Benchmark clona `agency-agents` externo en CI** | P1 | Dependencia de red externa; si GitHub cae o repo se mueve, CI falla. SHA fijo mitiga pero no elimina. |
| **`install-verify` no corre coverage** | P3 | No valida que el paquete instalado pase tests |
| **No hay job de `npm audit --omit=dev` en CI** | P2 | Validación de 0 vulns en prod no automatizada |
| **No hay test de flakiness (`--repeat-each`)** | P3 | Flakiness latente no detectada hasta producción |

### 5.3 Arreglos recomendados

1. Agregar step `npm audit --omit=dev` en job `verify` (fail si >0)
2. Cachear `agency-agents` como artifact o usar `actions/cache` con key `agency-agents-${{ hashFiles('benchmarks/selection/tasks.json') }}`
3. Agregar `npm run coverage` en matriz Windows (Node 24)
4. Job nocturno programado: `vitest run --repeat-each=10` para certificar estabilidad

---

## 6. TESTS DE REGRESIÓN PROPUESTOS — UNO POR HALLAZGO CRÍTICO DE AUDITORÍAS ANTERIORES

Basado en `AUDIT_REPORT_AI_OFFICE.md` (forense) y `REMEDIATION_CLOSURE_REPORT.md` (cierre), cada hallazgo P1/P2 debe tener test de regresión explícito que **fallaba antes de la fix y pasa después**.

| ID Histórico | Hallazgo | Test de regresión propuesto | Archivo | Estado actual |
|---|---|---|---|---|
| **COR-002** | TOCTOU en `claimNext` | `claimNext` concurrente: 2 agentes reclaman misma card → solo uno obtiene lease, otro recibe `null` | `tests/concurrency.test.ts` | ✅ EXISTE: "Claim de card concurrente a través de la oficina" |
| **STATE-001** | `loadState` sobreescribe estado corrupto | `state.json` corrupto → `loadState` lanza `StateCorruptionError` (no crea estado nuevo) | `tests/recovery.test.ts` | ✅ EXISTE: "un JSON corrupto se pone en cuarentena y lanza StateCorruptionError" |
| **DISP-001** | Colisión `agentId` por `e-${role}` | 3 cards mismo rol → 3 agentIds únicos con sufijo cardId corto | `tests/dispatch.test.ts` | ✅ EXISTE: 4 tests DISP-001 |
| **COR-001** | `Tripwire.prune(maxAge)` no usa `maxAge` | `prune(maxAge)` elimina entradas > maxAge, conserva ≤ maxAge, maneja NaN/negativo | `tests/tripwire.test.ts` | ✅ EXISTE: 7 tests prune |
| **SEC-001** | Fallback `~/.oficina/{basename}` colisiona | 2 proyectos `C:\a\app` y `C:\b\app` → rutas alternativas distintas (SHA256) | `tests/sandbox.test.ts` / `tests/paths.test.ts` | ⚠️ **FALTA** — no hay test explícito de aislamiento fallback |
| **SEC-003** | `v2.ts` `scopeOf` retorna `undefined` en error → bypass | Error transitorio en `loadState` → hook debe bloquear (política DENY_ALL) | `tests/pluginV2.scope.test.ts` | ⚠️ **FALTA** — test actual verifica bloqueo normal, no error transitorio |
| **CLI-001** | `oficina audit` lee `gates.md` con `readJson` | `audit` debe leer gates como texto plano, no JSON | `tests/cli.test.ts` | ⚠️ **FALTA** — no hay test de comando `audit` |
| **CI-001** | Benchmark usa HEAD móvil (sin SHA pin) | CI debe fallar si `benchmarks/selection/run.ts` clona sin SHA fijo | `.github/workflows/ci.yml` | ✅ FIXEADO en CI (checkout commit `4e3ac3c`) |
| **H6** | Tests 8.3 triviales (`expect(true)`) | `sandbox-83.test.ts`: 13 tests con aserciones semánticas de `canonicalizePhysical` | `tests/sandbox-83.test.ts` | ✅ EXISTE (remediado) |
| **DOC-002** | Badge tests desincronizado (438 vs 456) | `docs:check` valida conteo real vs badge README | `scripts/sync-docs.ts` | ⚠️ **FALTA** — `docs:check` no valida conteo |

### 6.1 Tests de regresión NUEVOS requeridos (no existentes)

```typescript
// tests/paths.test.ts — SEC-001 fallback isolation
it("fallback paths for homonymous projects are isolated via SHA256", async () => {
  const projA = "/tmp/a/app"
  const projB = "/tmp/b/app"
  const altA = resolveAlternateOficinaDir(projA)
  const altB = resolveAlternateOficinaDir(projB)
  expect(altA).not.toBe(altB)
  expect(altA).toMatch(/-app-[a-f0-9]{8}$/)
  expect(altB).toMatch(/-app-[a-f0-9]{8}$/)
})

// tests/pluginV2.scope.test.ts — SEC-003 fail-closed on error
it("scopeOf returns DENY_ALL when loadState throws transient error", async () => {
  const office = createMockOffice({ loadState: () => { throw new Error("transient") } })
  const hook = createV2Hooks(office)
  const verdict = await hook.scopeOf("session-xyz")
  expect(verdict).toEqual(DENY_ALL_POLICY)
})

// tests/cli.test.ts — CLI-001 audit reads gates as text
it("oficina audit reads gates.md as text, not JSON", async () => {
  const { stdout } = await runCLI(["audit", "T-01", "--directory", tempDir])
  expect(stdout).toContain("## Gates") // markdown header present
  expect(stdout).not.toContain("null")
})

// tests/docsync.test.ts — DOC-002 test count validation
it("docs:check validates test count badge against vitest reality", async () => {
  const facts = await computeFacts({ projectRoot, catalogSnapshot })
  expect(facts.testCount).toBe(438) // real count
  // sync-docs.ts --check should fail if README badge says 456
})
```

---

## 7. HALLÁZGOS CONSOLIDADOS — TABLA FINAL

| # | Hallazgo | Archivo/Símbolo | Severidad | Escenario | Evidencia | Arreglo recomendado | Test de regresión propuesto |
|---|---|---|---|---|---|---|---|
| **F-QA-001** | **Conteo tests desincronizado: README 456 vs real 438** | `README.md:10`, `scripts/sync-docs.ts`, `vitest.config.ts` | **P1 (Doc)** | Badge `tests-456%20passing` engaña a usuarios; `docs:check` no lo valida | `npm test` → 438 tests; remediación previa reportó 456 tras +11 tests | Extender `computeFacts()` con `testCount` y validar en `sync-docs.ts --check` vs regex badge | `tests/docsync.test.ts`: "valida test count badge contra realidad vitest" |
| **F-QA-002** | **Coverage badge 75% vs real 70.08% stmt** | `README.md:16` | **P2 (Doc)** | Badge `cobertura-75%25%20lines` inflado | `npm run coverage` → 70.08% stmt, 72.61% lines | Incluir `coverage` en `Facts` y validar badge | `tests/docsync.test.ts`: "valida coverage badge contra realidad" |
| **F-QA-003** | **Fallback paths colisionan entre proyectos homónimos (SEC-001)** | `src/core/paths.ts:125-136` `resolveAlternateOficinaDir` | **P1 (Seguridad)** | `C:\a\app` y `C:\b\app` → ambos usan `~/.oficina/app` → estado cruzado | Código usa `path.basename(projectRoot)` sin hash | Incorporar `crypto.createHash("sha256").update(projectRoot).digest("hex").slice(0,8)` | `tests/paths.test.ts`: "fallback paths isolated via SHA256" |
| **F-QA-004** | **`v2.ts` scopeOf bypass en error transitorio (SEC-003)** | `src/v2.ts:187-208` `scopeOf` catch → `undefined` | **P1 (Seguridad)** | Error I/O transitorio → hook no bloquea → herramienta ejecuta sin scope | Retornar `DENY_ALL_POLICY` en catch (fail-closed) | `tests/pluginV2.scope.test.ts`: "scopeOf retorna DENY_ALL en error transitorio" |
| **F-QA-005** | **`oficina audit` lee gates.md como JSON (CLI-001)** | `src/cli.ts:233` `readJson(gates.md)` | **P2 (CLI)** | `gates.md` es Markdown → `JSON.parse` falla → `gates: null` siempre | Usar `fs.readFile(..., "utf8")` o persistir `gates.json` complementario | `tests/cli.test.ts`: "audit lee gates como texto" |
| **F-QA-006** | **Tripwire arm() silencia errores → check() reporta limpio (COR-001)** | `src/core/tripwire.ts` `arm()` catch silencioso | **P2 (Observabilidad)** | Falla captura snapshot → `arm()` retorna sin error → `check()` no marca `incomplete` | Guardar estado de fallo en `before` map; `check()` debe reportar `incomplete: true` con detalle | `tests/tripwire.test.ts`: "arm falla → check marca incomplete con error" |
| **F-QA-007** | **Benchmark fingerprint no valida tasks.json en repo** | `benchmarks/selection/run.ts:376-381`, `benchmarks/selection/tasks.json` | **P2 (Reproducibilidad)** | `tasks.json` modificado localmente no cambia fingerprint si no se corre benchmark | Incluir `tasksHash` en fingerprint (ya hecho) PERO validar en CI que `tasks.json` no tiene cambios sin commit | CI step: `git diff --exit-code benchmarks/selection/tasks.json` |
| **F-QA-008** | **Windows 8.3 test salta aserción real si no hay alias ~1** | `tests/sandbox-83.test.ts` condicional `if (deepAbsolute.includes("RUNNER~1"))` | **P3 (Testing)** | En CI sin 8.3 habilitado, test pasa sin ejercer `canonicalizePhysical` | Mockear `canonicalizePhysical` para test determinista, o requerir 8.3 en CI Windows | `tests/sandbox-83.test.ts`: test con mock que verifica expansión semántica |
| **F-QA-009** | **CI no valida `npm audit --omit=dev` = 0** | `.github/workflows/ci.yml` job `verify` | **P2 (Supply chain)** | Vulnerabilidad en prod no detectada hasta release | Agregar step `npm audit --omit=dev` en `verify` (fail si >0) | CI: step falla si audit prod > 0 |
| **F-QA-010** | **No test de flakiness estadístico (--repeat-each)** | `package.json` scripts, CI | **P3 (Calidad)** | Flakiness latente no detectada; suite pasa 1x pero puede fallar 1/20 | Job nocturno programado: `vitest run --repeat-each=10` | CI nocturno: `--repeat-each=10` exit 0 requerido |
| **F-QA-011** | **Invariantes duros sin test unitario de fallo explícito** | `src/core/office.ts` `closeCard`, `reviewCard`, `dispatch.ts` | **P2 (Testing)** | `gate_required_before_done`, `evidence_required_before_done`, `reviewer_neq_owner`, `max_spawn_depth`, `max_help_chain_hops` solo probados en integración | Tests unitarios que verifiquen rechazo explícito (throw) cuando invariante violado | Ver tabla 2.1: 7 tests unitarios propuestos |
| **F-QA-012** | **Dependencias dev con 2 HIGH residuales (zod en @opencode-ai/plugin)** | `package.json` devDependencies, `npm audit` | **P3 (Supply chain)** | 2 HIGH en `@opencode-ai/plugin/node_modules/zod` (dev-only, peer optional) | Documentado en `REMEDIATION_CLOSURE_REPORT.md`; risk accepted. Monitorear upstream para fix. | Ninguno (risk accepted, documented) |

---

## 8. ARCHIVOS HISTÓRICOS — ETIQUETADO COMO HISTÓRICOS

| Archivo | Estado | Acción |
|---|---|---|
| `AUDIT_REPORT_AI_OFFICE.md` | **HISTÓRICO** | Auditoría forense v3.0.4 (oct-2026). Supersedida por remediación. Renombrar a `docs/archive/AUDIT_REPORT_AI_OFFICE_v3.0.4.md` |
| `REMEDIATION_CLOSURE_REPORT.md` | **HISTÓRICO** | Informe de cierre v3.0.5 (oct-2026). Renombrar a `docs/archive/REMEDIATION_CLOSURE_REPORT_v3.0.5.md` |
| `AUDIT_REMEDIATION_FINAL.md` | **HISTÓRICO** | Detalle técnico remediación. Renombrar a `docs/archive/AUDIT_REMEDIATION_FINAL_v3.0.5.md` |
| `TODO_REMEDIATION.md` | **HISTÓRICO** | Plan de trabajo completado. Renombrar a `docs/archive/TODO_REMEDIATION_v3.0.5.md` |

**Nota:** Este reporte (`AUDIT_FINDINGS_F_QA.md`) es la **auditoría QA actual** (v3.1.3, nov-2026) y debe mantenerse en raíz.

---

## 9. MÉTRICAS DE SALUD DE LA SUITE (BASELINE PARA PRÓXIMA AUDITORÍA)

| Métrica | Valor actual | Objetivo | Tendencia |
|---|---|---|---|
| Tests totales | 438 | ≥ 438 | Estable |
| Pass rate | 100% | 100% | Estable |
| Duración suite | 31.75s | < 60s | ✅ |
| Coverage stmt | 70.08% | ≥ 60% (threshold) | ✅ |
| Coverage branch | 64.15% | ≥ 50% (threshold) | ✅ |
| Coverage func | 75.42% | ≥ 60% (threshold) | ✅ |
| Coverage lines | 72.61% | ≥ 60% (threshold) | ✅ |
| Flakiness (pass-on-retry) | 0% observado | < 0.5% | Desconocido (falta --repeat-each) |
| npm audit prod | 0 | 0 | ✅ |
| Benchmark hit@1 | 71% | > 60% (threshold) | ✅ |
| Benchmark fingerprint | `07211c1` (inmutable) | Inmutable | ✅ |

---

## 10. PRÓXIMOS PASOS RECOMENDADOS (PRIORIZADOS)

| Prioridad | Acción | Esfuerzo | Impacto |
|---|---|---|---|
| **P1** | Fix F-QA-003 (fallback paths SHA256) | 1h | Elimina colisión estado entre proyectos |
| **P1** | Fix F-QA-004 (v2.ts DENY_ALL en error) | 30m | Restaura fail-closed en entry v2 |
| **P1** | Fix F-QA-001 (docs:check valida test count) | 2h | Evita badge engañoso; automatiza verdad documental |
| **P1** | Agregar tests F-QA-003, F-QA-004, F-QA-005, F-QA-006 | 4h | Cobertura regresión para hallazgos P1/P2 históricos |
| **P2** | Fix F-QA-005 (CLI audit lee gates como texto) | 1h | CLI audit funcional |
| **P2** | Fix F-QA-009 (CI audit prod) | 15m | Gate de supply chain automatizado |
| **P2** | Agregar tests unitarios invariantes (Tabla 2.1) | 3h | Defensa en profundidad |
| **P3** | Fix F-QA-002 (coverage badge) | 1h | Honestidad documental |
| **P3** | Fix F-QA-008 (sandbox-83 test determinista) | 1h | Test real en CI |
| **P3** | Job nocturno `--repeat-each=10` | 30m config | Certificación anti-flakiness |

---

**Firmado:** Test Automation Engineer (subagente)  
**Fecha:** 2026-11-03  
**Próxima auditoría recomendada:** 2026-12-03 (mensual) o en próximo release mayor