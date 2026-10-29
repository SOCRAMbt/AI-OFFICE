# Plan: Factory Auto-Crea Skills Persistentes + Eliminación Total del Sistema de Coste/Límites

## Objetivo
1. **Factory → Skill Creator automático**: Cuando el despacho no encuentra match (cobertura < 30%), en vez de fabricar un rol efímero de corrida, **invoca la lógica de `agency-agent-creator` para generar un archivo de agente persistente** en `<projectRoot>/.opencode/agents/<slug>.md` con la plantilla de 10 secciones Agency-Agents, que queda disponible para futuras corridas y para invocación directa (`@oficina-...`).
2. **Catálogo vivo**: El catálogo de matching (`catalog.ts`) debe descubrir dinámicamente los agentes creados en `.opencode/agents/` e incluirlos en futuros despachos.
3. **Eliminar todo el sistema de coste/tokens/límites**: Borrar `cost.ts`, `oficina_cost`, `Budget`, `Limits` (maxCards, maxAgentCalls, maxSpawnsTotal, etc.), enforcement en `state.ts`, `dispatch.ts`, `office.ts`, `retry.ts`, `mesa.ts`, `docsync.ts`, `systemPrompt.ts`, `cli.ts`, `router.ts`, y tests asociados.

---

## Archivos a modificar

### Fase 1: Eliminar sistema de coste/límites (breaking change)

| Archivo | Cambios |
|---|---|
| `src/core/types.ts` | Eliminar `Budget` interface, campos `maxCards`, `maxAgentCalls`, `maxSpawnsTotal` de `Limits`, campos `budget` de `OfficeState`, `Card` |
| `src/core/state.ts` | Eliminar validaciones de presupuesto en `validateState`, simplificar `migrateState` |
| `src/core/dispatch.ts` | Eliminar `maxAgents` de `DispatchOptions`, eliminar tracking de `budget`, eliminar checks de presupuesto |
| `src/core/office.ts` | Eliminar `Limits` import, eliminar checks de `maxCards`, simplificar constructor |
| `src/core/retry.ts` | Eliminar `hasBudget` o simplificar a siempre `ok: true` |
| `src/core/mesa.ts` | Eliminar display de presupuesto |
| `src/core/docsync.ts` | Eliminar `maxCards` de `CatalogFacts`, eliminar display de límites |
| `src/core/systemPrompt.ts` | Eliminar presupuesto del prompt |
| `src/core/router.ts` | Eliminar `delegateBudget` defaults |
| `src/core/factory.ts` | Eliminar `delegateBudget` de `FactoryInput` |
| `src/cli.ts` | Eliminar display de presupuesto en `status`, eliminar flags de presupuesto en comandos |
| `src/tools/index.ts` | Eliminar tool `oficina_cost`, eliminar imports de `cost.ts` |
| `src/core/cost.ts` | **ELIMINAR ARCHIVO COMPLETO** |

### Fase 2: Factory crea agentes persistentes (skill creator automático)

| Archivo | Cambios |
|---|---|
| `src/core/factory.ts` | Nueva función `createPersistentAgentSkill()` que genera el archivo `.md` en `.opencode/agents/` usando la plantilla 10-secciones de agency-agent-creator |
| `src/core/dispatch.ts` | En `instantiateFactory`: en vez de crear `Ficha` runtime, llamar a `createPersistentAgentSkill()`, guardar archivo, y registrar en catálogo dinámico |
| `src/core/catalog.ts` | Nueva función `loadDynamicAgents()` que escanea `.opencode/agents/` y parsea capabilities del frontmatter/cuerpo |
| `src/core/catalog.ts` | `buildPanel` y `resolveRole` deben incluir agentes dinámicos en el catálogo |
| `src/core/office.ts` | Cargar catálogo dinámico al inicializar |

### Fase 3: Tests y limpieza

| Archivo | Cambios |
|---|---|
| `tests/*.test.ts` | Actualizar tests que dependen de budget/cost/factory vieja |
| `tests/dispatch.test.ts` | Tests nuevos para factory persistente + catálogo vivo |
| `tests/catalog.test.ts` | Tests para matching con agentes dinámicos |

---

## Detalle técnico: Factory persistente

### Plantilla del agente (basada en agency-agent-creator)

El archivo generado en `.opencode/agents/<slug>.md`:

```markdown
---
name: {{display_name}}
description: {{one_line_description}}
vibe: {{curated_vibe_mindset}}
mode: subagent
permission:
  edit: allow
  shell: allow
  task: allow
---

# {{display_name}} Agent Personality

You are **{{display_name}}**, a specialist in {{capabilities_list}} focused on {{mission_phrase}}.

## Your Identity & Memory
- **Role**: Specialist in {{primary_domain}} with deep expertise in {{key_technologies}}.
- **Personality**: Direct, pragmatic, and detail-oriented.
- **Memory**: Durable disk artifacts and communication logs; never hidden session memory.
- **Experience**: Edge cases, error recovery, and security boundaries.

## Your Core Mission
### {{Mission_1_Title}}
{{Mission_1_Description}}

## Critical Rules You Must Follow
1. Scope is a hard boundary, not a suggestion. Touch only authorized files.
2. No evidence, no work. Claims without command output (evidence.md) are hypotheses.
3. Never review or approve your own work.
4. Ask before guessing via the office bus (oficina_bus).
5. Acknowledge omissions and gaps explicitly in handoff.md.

## Your Technical Deliverables
- Clean code within assigned scope.
- handoff.md: Technical summary and decisions.
- evidence.md: Verbatim terminal output with exit codes.

## Your Workflow Process
### Step 1: Understand the Terrain
### Step 2: Decide the Approach
### Step 3: Execute Within Scope
### Step 4: Verify and Hand Off

## Your Communication Style
Direct, structured triage of incoming bus requests, zero ambiguity.

## Learning & Memory
Avoid domain-specific failure modes: {{failure_modes_list}}.

## Your Success Metrics
1. All acceptance criteria satisfied with verifiable evidence.
2. Gates (build, typecheck, test, security) exit 0.
3. Zero out-of-scope files touched.

## Advanced Capabilities
{{capability_tokens_space_separated}}
```

### Extracción de capabilities para matching

El catálogo necesita leer `capabilities` del agente. Opciones:
- **Frontmatter**: agregar `capabilities: [token1, token2, ...]` al YAML
- **Parsing del cuerpo**: extraer de "Advanced Capabilities" o "Your Core Mission"
- **Archivo sidecar**: `<slug>.capabilities.json` (más robusto)

**Decisión**: Agregar `capabilities` al frontmatter YAML como array. El parser del catálogo lo lee directamente.

### Catálogo dinámico

```typescript
// En catalog.ts
export interface DynamicAgent {
  slug: string
  displayName: string
  description: string
  capabilities: string[]
  division: string // inferida del slug o "factory"
  path: string // ruta al archivo .md
  source: "dynamic"
}

export async function loadDynamicAgents(projectRoot: string): Promise<DynamicAgent[]> {
  const agentsDir = path.join(projectRoot, ".opencode", "agents")
  // leer todos los .md, parsear frontmatter, extraer capabilities
}
```

`buildPanel` recibe `catalog: CatalogAgent[]` + `dynamicAgents: DynamicAgent[]` y los mezcla para matching.

---

## Orden de ejecución

1. **Eliminar cost.ts** y tool `oficina_cost` (aislado, bajo riesgo)
2. **Eliminar Budget/Limits** de types.ts y state.ts (core, alto riesgo - tests fallen)
3. **Eliminar budget checks** de dispatch.ts, office.ts, retry.ts, mesa.ts, docsync.ts, systemPrompt.ts, router.ts, factory.ts, cli.ts
4. **Tests**: arreglar tests rotos por eliminación de budget
5. **Factory persistente**: nueva función en factory.ts + modificar instantiateFactory en dispatch.ts
6. **Catálogo dinámico**: loadDynamicAgents en catalog.ts + integración en buildPanel/resolveRole
7. **Tests nuevos** para factory persistente + catálogo vivo
8. **Verificación**: `npm run typecheck && npm test` → todo verde

---

## Criterios de aceptación

- [ ] `npm run typecheck` exit 0
- [ ] `npm test` 100% passed (tests existentes adaptados + nuevos)
- [ ] `oficina_cost` ya no existe (tool removida)
- [ ] No hay referencias a `maxCards`, `maxAgentCalls`, `maxSpawnsTotal`, `Budget` en el código (excepto migración v1→v2)
- [ ] Dispatch sin match (<30%) crea archivo en `.opencode/agents/<slug>.md` con plantilla completa
- [ ] El agente creado aparece en futuros `oficina_dispatch` como candidato de matching
- [ ] El agente creado es invocable directamente como `@oficina-<slug>`
- [ ] `.opencode/agents/` está en `.gitignore` (ya está) pero los archivos generados son parte del repo para persistencia

---

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Tests rotos masivamente por eliminación de Budget | Ejecutar tests tras cada archivo modificado; fixes incrementales |
| Catálogo dinámico no detecta cambios en caliente | `loadDynamicAgents` se llama en cada `dispatchOffice` (no cacheado agresivamente) |
| Parsing de frontmatter frágil | Usar regex simple o librería `gray-matter` si ya está en deps; sino regex robusto |
| Agentes dinámicos sin `capabilities` en frontmatter | Validar en `createPersistentAgentSkill` que el frontmatter incluya `capabilities` |
| Migración de state v1→v2 rompe | `migrateState` ya maneja defaults; solo quitar campos de budget |