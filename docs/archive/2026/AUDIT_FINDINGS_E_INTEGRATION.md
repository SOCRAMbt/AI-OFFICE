# Auditoría de Integración OpenCode + Agency Agents — AI-OFFICE (oficina-opencode v3.1.3)

**Fecha**: 2026-11-03  
**Auditor**: OpenCode Integration Engineer / Technical Writer  
**Alcance**: Verificación de hallazgos previos del Comandante + auditoría profunda de integración real, compatibilidad, documentación y benchmarks.

---

## Resumen Ejecutivo

| Área | Estado | Hallazgo Crítico |
|------|--------|------------------|
| **Agency Agents checkout** | ✅ Verificado | Commit `4e3ac3ca6604c75113f52c695dbddcc7af928b46` coincide con `catalog-facts.json` y benchmark |
| **Materialización de agentes** | ⚠️ Limitación conocida | Spawn con `agent: "general"` + prompt embebido; OpenCode no carga agentes dinámicos |
| **Tests de integración real** | ❌ Ausente | Solo mocks (`plugin.test.ts`, `pluginV2.test.ts`); ningún test contra OpenCode real |
| **Documentación vs Realidad** | ❌ Divergencia | README: **456 tests** → Real: **438 tests** (drift de 18 tests / 4%) |
| **peerDependencies** | ⚠️ Confuso | `@opencode-ai/plugin` optional peer + `@opencode/plugin` dep real; matriz no documentada |
| **Benchmark** | ✅ Reproducible | SHA fijado, fingerprint estable; **3 misses confirmados**: UX, FP&A, code-review |
| **Compatibilidad Node** | ❌ Inconsistente | `package.json`: `>=22` | `COMPATIBILITY.md`: `>=20` | CI matrix: `[20, 22]` |

---

## 1. Agency Agents Checkout Local

### Verificación del Commit

| Fuente | Commit Reportado | Verificado |
|--------|------------------|------------|
| `docs/catalog-facts.json` | `4e3ac3c` (short) | ✅ `4e3ac3ca6604c75113f52c695dbddcc7af928b46` |
| `benchmarks/selection/run.ts` (git rev-parse) | Runtime | ✅ Coincide |
| `README.md` / `docs/QUE-ES.md` (comment) | `<!-- Catalog source: agency-agents @ 4e3ac3c -->` | ✅ Coincide |

### Estructura del Catálogo (21 divisiones en fs, 18 en snapshot)

```
agency-agents/
├── academic/           (no en snapshot divisions)
├── design/             (9 agentes) ✅
├── engineering/        (58 agentes) ✅
├── finance/            (5 agentes) ✅
├── game-development/   (no en snapshot divisions)
├── gis/                (no verificado)
├── healthcare/         (no en snapshot divisions)
├── marketing/          (33 agentes) ✅
├── paid-media/         (no en snapshot divisions)
├── product/            (6 agentes) ✅
├── project-management/ (no en snapshot divisions)
├── research/           (no en snapshot divisions)
├── sales/              (no en snapshot divisions)
├── spatial-computing/  (no en snapshot divisions)
├── specialized/        (50+ agentes) ✅
├── strategy/           (no en snapshot divisions)
├── support/            (6 agentes) ✅
├── testing/            (9 agentes) ✅
└── security/           (no en snapshot divisions)
```

**Observación**: `divisions.json` lista 21 divisiones pero `catalog-facts.json` reporta 18. Las divisiones `academic`, `game-development`, `healthcare`, `paid-media`, `project-management`, `research`, `sales`, `spatial-computing`, `strategy` aparecen en fs pero **no en el snapshot**. Esto sugiere que `scanCatalog` filtra por alguna regla (ej. archivos válidos con frontmatter completo).

### Convertidor / Instalador

- **No hay convertidor dedicado** en el plugin. El catálogo se lee directo via `scanCatalog()` (`src/core/catalog.ts`).
- `oficina install` **no toca agency-agents**; solo despliega assets propios (skill, agentes, comando, entry point).
- El benchmark y `docs:sync` leen `AGENCY_ROOT` (default `~/agency-agents`) en runtime.

**Riesgo**: Si el usuario no tiene `agency-agents` clonado localmente, el matching usa solo la factory (roles genéricos). No hay fallback automático a un snapshot embebido.

---

## 2. Materialización de Agentes y Spawning Real

### Código Actual (`src/v2.ts:139-158`)

```typescript
spawner: async ({ sessionID, agentName, prompt, description }) => {
  try {
    const child = (await ctx.session.create({
      parentID: sessionID,
      title: description || `Oficina: ${agentName}`,
      agent: "general",  // ⚠️ Hardcoded
    })) as { id: string }
    await ctx.session.prompt({
      sessionID: child.id,
      text: prompt,
      metadata: { oficina: { agent: agentName, description } },
    })
    return true
  } catch (err) { ... }
}
```

### Problema Confirmado

| Aspecto | Realidad | Documentación (README) |
|---------|----------|------------------------|
| Agente OpenCode usado | `"general"` (siempre) | "materializa los agentes con su briefing y los arranca en paralelo" |
| Especialidad | Viaja **solo en el prompt** + `metadata.oficina.agent` | "cada uno con su briefing de 10 secciones" |
| Agentes dinámicos | **No soportados por OpenCode** | Implica que se registran como agents reales |

**Comentario del propio código (v2.ts:143-147)**:
> "El agente materializado puede no estar registrado todavía (OpenCode arma su lista al arrancar), así que se dispara con `general` y la especialidad viaja completa en el prompt."

### Implicaciones

1. **No hay aislamiento real de contexto**: todos los subagentes comparten el mismo agent profile `general`.
2. **El briefing de 10 secciones viaja en el primer prompt** — consume tokens del contexto inicial.
3. **Los 7 agentes de coordinación** (`oficina-commander`, `oficina-architect`, etc.) **tampoco se registran como agents de OpenCode**; son roles internos invocados via tools.
4. **Los agentes materializados en `.opencode/agents/oficina-<slug>.md`** (mencionados en hallazgos) son archivos de briefing para **lectura humana/referencia**, no agents cargados por OpenCode.

### Evidencia en Tests

`tests/pluginV2.test.ts:142-153` verifica 18 tools pero **no verifica spawning real**. El mock de `ctx.session.create` devuelve `{ id: "ses-1" }` fijo.

---

## 3. Tests de Integración Real con OpenCode

### Estado Actual

| Archivo | Tipo | Cobertura |
|---------|------|-----------|
| `tests/plugin.test.ts` | Unit (mock host v1) | 15 tools, hooks v1, scope guard, auto-resume |
| `tests/pluginV2.test.ts` | Unit (mock host v2) | 18 tools, JSON Schema, hooks v2, scope guard |
| **Integración E2E real** | **NO EXISTE** | — |

### Qué Falta

1. **Plugin load test**: Verificar que `oficina-opencode` carga en OpenCode v2 real (no mock).
2. **Tool execution test**: Ejecutar `oficina_plan` → `oficina_dispatch` → `oficina_board` contra OpenCode real.
3. **Hook verification**: `session.idle` auto-resume, `permission.hook` deny, `context` injection.
4. **Scope enforcement real**: Escribir fuera de scope → denegado por OpenCode.
5. **Subagent spawning real**: Verificar que `ctx.session.create` + `ctx.session.prompt` crea subagente heredando scope.

### Viabilidad en CI

| Requisito | Factibilidad |
|-----------|--------------|
| OpenCode CLI en CI | ✅ Disponible (`npm install -g @opencode/cli`) |
| Headless mode | ✅ OpenCode soporta `--headless` o similar |
| Timeout razonable | ⚠️ Corridas reales toman 2-5 min (ver `PRUEBA-E2E.md`: 45-70 min) |
| Coste tokens | ⚠️ Requiere API key / modelo gratuito |

**Recomendación**: Smoke test ligero (Nivel 0-1 de `PRUEBA-E2E.md`) en CI: solo verificar carga del plugin y respuesta de `oficina_board`. La corrida completa (Nivel 3) queda para validación manual / nightly.

---

## 4. Documentación Divergente — Conteo y Versiones

### Tabla de Discrepancias

| Métrica | README.md / QUE-ES.md | Real (código/tests) | Drift | Fuente Real |
|---------|----------------------|---------------------|-------|-------------|
| **Tests totales** | **456** | **438** | +18 (4%) | `npm test` output |
| **Test files** | "27 archivos" | **27** | ✅ | `npm test` output |
| **Tools** | **18** | **18** | ✅ | `buildTools()` count |
| **Hooks** | **7** | **7** | ✅ | Hardcoded en `docsync.ts:174` |
| **Node.js** | **>=22** | **>=22** (package.json) | ⚠️ COMPATIBILITY.md dice >=20 | `package.json:engines.node` |
| **Plugin API** | `@opencode/plugin@2.1.2` | `^2.1.2` | ✅ | `package.json:dependencies` |
| **Peer v1** | "peer opcional" | `@opencode-ai/plugin@^1.19.5` (dev) / `^1.15.11` (peer) | Versión inconsistente | `package.json` |
| **Versión paquete** | **v3.1.3** | **v3.1.3** | ✅ | `package.json` |
| **Catálogo agentes** | **258** | **258** | ✅ | `catalog-facts.json` |
| **Divisiones** | **18** | **18** | ✅ | `catalog-facts.json` |
| **Benchmark hit@1** | **71%** | **71%** | ✅ | `bench:selection` output |

### Análisis del Drift de Tests (456 → 438)

- El bloque `<!-- GENERATED: facts -->` se genera via `npm run docs:sync` (`scripts/sync-docs.ts` → `src/core/docsync.ts`).
- `docsync.ts:174` tiene **hooks hardcoded a 7** — correcto.
- **Tools se cuenta en runtime** via `buildTools({} as never)` — correcto (18).
- **Tests NO se cuenta en runtime** — el número 456 está **escrito a mano** en el bloque generado o en la plantilla.

**Evidencia**: `docsync.ts` no tiene lógica para contar tests. El script `sync-docs.ts` solo inyecta `facts.tools`, `facts.hooks`, `facts.pluginApi`, `facts.runtime`, `facts.catalog`. El "456" viene de una versión anterior del bloque que nadie actualizó.

### Node.js Version Conflict

| Archivo | Versión Declarada |
|---------|-------------------|
| `package.json` | `>=22` |
| `COMPATIBILITY.md:61` | `>=20` |
| `COMPATIBILITY.md:83` (CI matrix) | `[20, 22]` |
| `README.md:9` badge | `>=22` |

**Causa raíz**: `COMPATIBILITY.md` no se regenera automáticamente; es documentación manual. El CI corre matrix `[20, 22]` pero `package.json` exige `>=22`. Si Node 20 tiene APIs que el código usa (ej. `structuredClone`, `fs.promises` modernas), **Node 20 fallaría en build/runtime** aunque el CI lo pruebe.

### PeerDependencies Matriz Confusa

```json
"dependencies": {
  "@opencode/plugin": "^2.1.2"    // v2 — REAL, usada por v2.ts
},
"peerDependencies": {
  "@opencode-ai/plugin": "^1.15.11"  // v1 — OPTIONAL, solo para v1.ts entry
},
"peerDependenciesMeta": {
  "@opencode-ai/plugin": { "optional": true }
},
"devDependencies": {
  "@opencode-ai/plugin": "^1.19.5",  // v1 — versión distinta a peer
  "@opencode/plugin": "^2.1.2"
}
```

**Problemas**:
1. `peerDependencies` declara `^1.15.11` pero `devDependencies` usa `^1.19.5` — versión distinta.
2. `@opencode/plugin` (v2) está en `dependencies` (correcto) **y** en `devDependencies` (redundante).
3. No hay documento que explique: "v2 usa `@opencode/plugin`; v1 legacy usa `@opencode-ai/plugin` como peer opcional".

---

## 5. Benchmark de Selección — Análisis Profundo

### Configuración Verificada

| Parámetro | Valor |
|-----------|-------|
| Catálogo | 258 agentes (commit `4e3ac3ca6604c75113f52c695dbddcc7af928b46`) |
| Tareas | 21 (definidas en `benchmarks/selection/tasks.json`) |
| Estrategias | `completo` (oficina), `keywords` (v1 weights), `solo-nombre` |
| Fingerprint | SHA-256 de (catalogRevision + catalogSize + taskCount + tasksHash + evaluatorVersion + métricas + fallos) |
| Umbral regresión | `hit@1 >= 60%` Y `completo.hit1 > keywords.hit1` |

### Resultados Actuales (2026-11-03)

| Estrategia | hit@1 | hit@3 | hit@5 | MRR |
|------------|-------|-------|-------|-----|
| **completo** | **71%** | 86% | 86% | 0.778 |
| keywords | 48% | 81% | 86% | 0.623 |
| solo-nombre | 52% | 76% | 81% | 0.639 |

✅ **Pasa**: Completo gana a keywords (+23pp hit@1), supera umbral 60%.

### Misses Confirmados (3/21 tareas = 14% fallo)

| Tarea | Esperado | Obtenido (Top 3) | Análisis |
|-------|----------|------------------|----------|
| **ux** | `design-ux-architect`, `design-ui-designer` | `level-designer`, `economy-designer`, `design-visual-storyteller` | Matcher confunde "ux/design/flow" con game design (level/economy). Falta sinónimo `ux` → `user experience` en taxonomía. |
| **fpa** | `finance-fpa-analyst`, `finance-financial-analyst` | `support-finance-tracker`, `gis-geoprocessing-specialist`, `gis-geoai-ml-engineer` | "finance/financial/fpa/profitability/model" matchea mal. `support-finance-tracker` tiene "finance" en nombre. Taxonomía no distingue FP&A de tracking. |
| **code-review** | `engineering-code-reviewer`, `engineering-software-architect`, `engineering-codebase-onboarding-engineer` | `specialized-civil-engineer`, `design-visual-storyteller`, `xr-interface-architect` | Fallo catastrófico. "code review/architecture/design/quality" no matchea agentes de engineering. Posible bug en lematización o extracción de misión. |

### Normalización y Reproducibilidad

- ✅ **SHA fijado**: `catalogRevision` viene de `git rev-parse HEAD` en runtime.
- ✅ **Fingerprint estable**: Incluye `evaluatorVersion` (hardcoded `"1.0.0"`), `tasksHash` (SHA-256 de tasks canonizadas).
- ✅ **Solo escribe si cambia**: Compara fingerprint embebido en `RESULTADOS.md`.
- ⚠️ **`evaluatorVersion` hardcoded**: Si cambia lógica de `rankCandidates` sin bumpear `evaluatorVersion`, fingerprint no detecta cambio de comportamiento.

---

## 6. Smoke Test Reproducible Propuesto

### Objetivo
Verificar integración real OpenCode ↔ oficina-opencode en < 2 min, ejecutable en CI y local.

### Niveles (basado en `docs/PRUEBA-E2E.md`)

#### Nivel 0 — Repo Salud (ya existe)
```bash
npm run typecheck && npm test && npm run build && npm run docs:check
```

#### Nivel 1 — Plugin Carga (NUEVO — Smoke CI)
```bash
# 1. Instalar OpenCode CLI
npm install -g @opencode/cli@2.1.1

# 2. Instalar plugin local
cd ~/.config/opencode
npm install file:/ruta/a/oficina-plugin
node /ruta/a/oficina-plugin/dist/cli.js install --target ~/.config/opencode

# 3. Configurar subagent_depth
echo '{"experimental":{"subagent_depth":3}}' > ~/.config/opencode/opencode.json

# 4. Smoke test: verificar carga
opencode --headless --print "Usá la tool oficina_board y mostrame el tablero" 2>&1 | grep -q "OFICINA" && echo "✅ Plugin carga" || echo "❌ Plugin NO carga"
```

**Criterio de pase**: Output contiene "OFICINA" (el tablero vacío con header).

#### Nivel 2 — Tool Execution Básica (NUEVO — Smoke CI Extendido)
```bash
# En directorio temporal con package.json
mkdir /tmp/smoke-oficina && cd /tmp/smoke-oficina
echo '{"name":"smoke","scripts":{"test":"echo ok"}}' > package.json

opencode --headless --print "
  /oficina Crear un archivo src/hola.js que exporte function hola(){return 'mundo'}
" 2>&1 | tail -20
```

**Criterio de pase**: 
- Plan creado (3 cards o 1 card)
- `oficina_dispatch` ejecuta sin error
- Archivo `src/hola.js` creado con contenido correcto

#### Nivel 3 — Scope Enforcement (NUEVO — Crítico)
```bash
# En mismo directorio, después de Nivel 2
opencode --headless --print "
  Toma la card T-00 con oficina_assign e intentá escribir README.md en la raíz (fuera de scope).
" 2>&1 | grep -q "Scope violado" && echo "✅ Scope bloquea" || echo "❌ Scope NO bloquea"
```

#### Nivel 4 — Auto-resume (Opcional — Nightly)
Verificar que `session.idle` reanuda corrida con cards pendientes.

### Implementación Sugerida

**Archivo**: `tests/smoke.integration.test.ts` (solo se ejecuta con `RUN_SMOKE=1`)

```typescript
import { describe, it, expect, beforeAll } from "vitest"
import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"

const OPENCODE = process.env.OPENCODE_BIN ?? "opencode"
const PLUGIN_ROOT = path.resolve(__dirname, "..")
const SMOKE_DIR = path.join(os.tmpdir(), "oficina-smoke-" + Date.now())

describe.skipIf(!process.env.RUN_SMOKE)("Smoke test integración real OpenCode", () => {
  beforeAll(async () => {
    await fs.mkdir(SMOKE_DIR, { recursive: true })
    await fs.writeFile(path.join(SMOKE_DIR, "package.json"), '{"name":"smoke","scripts":{"test":"exit 0"}}')
  }, 60_000)

  it("plugin carga y oficina_board responde", async () => {
    const out = execFileSync(OPENCODE, [
      "--headless", "--print",
      "Usá la tool oficina_board y mostrame el tablero"
    ], { cwd: SMOKE_DIR, encoding: "utf8", timeout: 60_000 })
    expect(out).toContain("OFICINA")
  }, 90_000)

  it("oficina_plan + dispatch crea archivo en scope", async () => {
    const out = execFileSync(OPENCODE, [
      "--headless", "--print",
      "/oficina Crear src/hola.js que exporte function hola(){return 'mundo'}"
    ], { cwd: SMOKE_DIR, encoding: "utf8", timeout: 120_000 })
    
    const file = await fs.readFile(path.join(SMOKE_DIR, "src", "hola.js"), "utf8")
    expect(file).toContain("function hola")
    expect(file).toContain("mundo")
  }, 180_000)

  it("scope guard bloquea escritura fuera de scope", async () => {
    const out = execFileSync(OPENCODE, [
      "--headless", "--print",
      "Toma la card T-00 con oficina_assign e intentá escribir README.md en la raíz."
    ], { cwd: SMOKE_DIR, encoding: "utf8", timeout: 60_000 })
    
    expect(out).toMatch(/Scope violado|denegado|rechazado/i)
    const readmeExists = await fs.stat(path.join(SMOKE_DIR, "README.md")).catch(() => false)
    expect(readmeExists).toBe(false)
  }, 90_000)
})
```

**Ejecución en CI**:
```yaml
- name: Smoke test real OpenCode
  if: env.RUN_SMOKE == 'true'
  run: |
    npm install -g @opencode/cli@2.1.1
    export OPENCODE_BIN=$(which opencode)
    export RUN_SMOKE=1
    npm test -- tests/smoke.integration.test.ts
```

---

## 7. Hallazgos Consolidados — Matriz de Severidad

| # | Hallazgo | Archivo/Símbolo | Severidad | Escenario | Evidencia | Arreglo Recomendado | Test Regresión Propuesto |
|---|----------|-----------------|-----------|-----------|-----------|---------------------|--------------------------|
| 1 | **Test count drift** (456 vs 438) | `README.md:10`, `docs/QUE-ES.md:7`, `docsync.ts` (no cuenta tests) | **ALTA** | README muestra métrica falsa; usuarios/ci confían en número erróneo | `npm test` = 438 passed; bloque GENERATED no incluye test count | Agregar `facts.testCount` en `docsync.ts:computeFacts()` via `glob("tests/**/*.test.ts")` + `vitest run --reporter=json` | `docsync.test.ts` verifica `facts.testCount === 438` |
| 2 | **Node version inconsistency** | `package.json:8` (>=22) vs `COMPATIBILITY.md:61` (>=20) vs CI matrix `[20,22]` | **ALTA** | Usuario en Node 20 instala, build falla en runtime; CI da falsa confianza | `engines.node: ">=22"` pero CI testea Node 20 | Unificar: si código requiere >=22, cambiar CI matrix a `[22, 24]` y actualizar COMPATIBILITY.md; si soporta 20, bajar `engines.node` | `npm run build` en Node 20 y 22 en CI (ya existe matrix) |
| 3 | **PeerDependencies confuso** | `package.json:87-94` | **MEDIA** | Usuario no sabe qué instalar; v1 legacy vs v2 real no documentado | `@opencode-ai/plugin` peer optional ^1.15.11, dev ^1.19.5; `@opencode/plugin` en deps y devDeps | 1. Sacar `@opencode/plugin` de devDeps. 2. Alinear peer v1 a ^1.19.5. 3. Documentar en COMPATIBILITY.md: "v2 usa @opencode/plugin (dep); v1 legacy usa @opencode-ai/plugin (peer optional)" | `npm install` en proyecto limpio verifica tree correcto |
| 4 | **Sin test integración real OpenCode** | `tests/plugin.test.ts`, `tests/pluginV2.test.ts` (solo mocks) | **CRÍTICA** | Cambios en OpenCode API rompen plugin sin detectarse; hooks v2 no validados en host real | 0 tests contra OpenCode real; v2 hooks (`ctx.tool.hook`, `ctx.permission.hook`) solo mockados | Implementar `tests/smoke.integration.test.ts` (ver Sección 6) gated por `RUN_SMOKE=1` | Smoke test en CI nightly; unit tests siguen en cada PR |
| 5 | **Agentes materializados ≠ agents OpenCode** | `v2.ts:147` (`agent: "general"`), README "materializa agentes" | **MEDIA** | Expectativa usuario ≠ realidad; briefing consume tokens de contexto; no hay aislamiento | Código comenta: "OpenCode arma su lista al arrancar... se dispara con general" | 1. Actualizar README: "spawnea subagentes con agent:general + prompt embebido". 2. Documentar limitación en ARCHITECTURE.md. 3. Explorar OpenCode agent registration API si existe futura | N/A (es diseño, no bug) |
| 6 | **Benchmark misses: UX, FP&A, code-review** | `benchmarks/selection/tasks.json` (tasks ux, fpa, code-review) | **MEDIA** | 14% tareas fallan; matcher no distingue dominios cercanos | `bench:selection` output muestra 3 fallos con Top 3 incorrectos | 1. Agregar sinónimos `ux`↔`user experience` en taxonomía. 2. Revisar extracción de misión para `code-review`. 3. Separar `finance` tracking vs `fpa` en capability tokens. | `bench:selection` debe mantener hit@1 >= 70% (actual 71%); agregar aserción por tarea crítica |
| 7 | **evaluatorVersion hardcoded** | `benchmarks/selection/run.ts:375` (`"1.0.0"`) | **BAJA** | Cambio en lógica de matching no invalida fingerprint | Fingerprint incluye `evaluatorVersion` pero es constante | Incrementar `evaluatorVersion` al cambiar `rankCandidates`, `canonicalConcepts`, `capabilityTokens` | Test que cambia lógica y verifica fingerprint cambia |
| 8 | **Catálogo snapshot divisions mismatch** | `docs/catalog-facts.json` (18 div) vs fs (21 div) | **BAJA** | Usuario ve 21 carpetas pero doc dice 18; confusión | `scanCatalog` filtra divisiones; `divisions.json` tiene 21 | Documentar criterio de filtrado en `catalog.ts` o incluir todas en snapshot | `catalogReal.test.ts` verifica división count |
| 9 | **hooks count hardcoded** | `docsync.ts:174` (`hooks: 7`) | **BAJA** | Si se agrega hook, docs no reflejan cambio | Hardcoded, no derivado de código | Contar hooks registrados en `v2.ts`/`v1.ts` dinámicamente | `docsync.test.ts` verifica hooks count |

---

## 8. Plan de Acción Priorizado

### Inmediato (Bloqueadores)
1. **[#1] Fix test count drift** — Agregar conteo real de tests a `docsync.ts` y regenerar docs.
2. **[#2] Unificar Node version** — Decidir: ¿soporta Node 20? Si no, quitar de CI matrix y COMPATIBILITY.md.
3. **[#3] Limpiar peerDependencies** — Quitar redundancias, alinear versiones, documentar.

### Corto Plazo (Esta Sprint)
4. **[#4] Smoke test integración real** — Implementar `tests/smoke.integration.test.ts` con `RUN_SMOKE=1`.
5. **[#6] Arreglar benchmark misses** — Revisar taxonomía/sinónimos para UX, FP&A, code-review.
6. **[#5] Actualizar README** — Aclarar que agentes se spawnean con `general` + prompt, no agents dinámicos.

### Mediano Plazo
7. **[#7] evaluatorVersion automático** — Derivar de hash de archivos de matching (`catalog.ts`, `factory.ts`).
8. **[#8] Documentar catálogo filtering** — Por qué 18 vs 21 divisiones.
9. **[#9] Hooks count dinámico** — Derivar de código, no hardcoded.

---

## 9. Conclusión

**La integración OpenCode v2 es funcional y probada en desarrollo manual** (ver `PRUEBA-E2E.md` Nivel 3-7 pasando), pero **carece de validación automatizada en CI**. Los hallazgos críticos son:

1. **Métricas de documentación desactualizadas** (tests, Node version) — erosiona confianza.
2. **Cero tests contra OpenCode real** — riesgo de breaking changes silenciosos.
3. **PeerDependencies ambiguo** — fricción para adopción.

**Los misses del benchmark (UX, FP&A, code-review) son hallazgos valiosos** — el matcher sofisticado tiene puntos ciegos documentados y medidos, no ocultos.

**La materialización con `agent: "general"` es una limitación conocida de OpenCode**, no un bug del plugin. La documentación debe reflejar la realidad: "subagentes con especialidad via prompt" no "agentes registrados dinámicamente".

---

**Firma**: OpenCode Integration Engineer / Technical Writer  
**Próxima revisión**: Tras implementar fixes #1-4