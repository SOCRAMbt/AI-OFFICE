<div align="center">

# AI-OFFICE

### Una oficina de agentes para OpenCode donde el trabajo no se detiene cuando el modelo dice «terminé».

[![npm](https://img.shields.io/npm/v/oficina-opencode?label=npm&color=cb3837)](https://www.npmjs.com/package/oficina-opencode)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933.svg)](https://nodejs.org)
[![tests](https://img.shields.io/badge/tests-157%20passing-22a06b.svg)](tests)
[![coverage](https://img.shields.io/badge/coverage-87.8%25-7c3aed.svg)](https://vitest.dev)
[![types](https://img.shields.io/badge/typescript-strict-3178c6.svg)](tsconfig.json)

**4 hooks · 10 tools · 7 agentes · 6 gates · 6 invariantes duros**

> **¿Preferís la versión en humano?** → [`docs/QUE-ES.md`](docs/QUE-ES.md) — qué es, qué hace y por qué, sin jerga.
> **¿Preferís el porqué técnico?** → [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

[Documentación](#arquitectura) · [Instalación](#instalación) · [Uso](#uso) · [CLI](#cli-operación)

</div>

---

## El problema

Working con agents tiene cinco fallas concretas. No son falta de inteligencia: son falta de **estructura**.

| Falla | Qué pasa en la práctica |
|---|---|
| **El modelo decide cuándo terminar** | Dice «listo, terminado» con la mitad del trabajo sin hacer, y la sesión para ahí. |
| **El trabajo se hace lineal** | Todo en un solo contexto: un agente, una tarea, un hilo. Los subagentes existen pero se desaprovechan. |
| **Nadie orquesta** | No hay un plan, no hay prioridad, no hay un dueño por tarea. |
| **El contexto se pierde** | Hay que repetir lo que ya se dijo, lo ya se decidió y lo ya se encontró. |
| **Los subagentes son islands** | No se piden ayuda, no se coordinan, no se benefician del trabajo del otro. |

Una skill de markdown no arregla ninguna de las cinco. Un prompt puede pedirle al modelo que sea cuidadoso; no puede **impedirle** que termine antes de tiempo.

---

## Qué es

**AI-OFFICE** es un plugin de OpenCode que convierte la orquestación en **código ejecutable**, no en instrucciones.

La diferencia:

```
Skill     →  "Hacé lo que corresponda"          →  depende de que el modelo quiera
Plugin    →  máquina de estados + hooks         →  no depende de la buena voluntad
```

Cuatro piezas lo hacen posible:

**1. Un hook que no deja que la sesión muera.** Cuando la sesión queda `idle` y quedan cards sin terminar, el motor manda un prompt sintético y la corrida sigue. El modelo **no puede declarar que terminó**: el estado lo dice.

**2. Un guard que no deja editar fuera de scope.** `tool.execute.before` intercepta cada `edit`/`write` y lo rechaza si el archivo está fuera del scope de la card. "No toques eso" deja de ser una sugerencia.

**3. Gates que se ejecutan, no se opinan.** Build, type check, lint, tests, escaneo de secretos y diff review. El motor corre los comandos, lee los exit codes y decide. La salida real queda pegada en el artefacto.

**4. Invariantes que el código garantiza.** `gate_required_before_done` y `reviewer_neq_owner` no son recomendaciones: `assertInvariants` lanza y la transición no ocurre.

---

## Arquitectura

Cuatro capas. De abajo hacia arriba.

```
┌──────────────────────────────────────────────────────────────────────┐
│ CAPA 3 — COORDINACIÓN                                                │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────┐  │
│  │ COMANDANTE   │  │ ARQUITECTO   │  │ INTEGRADOR                │  │
│  │ scope        │  │ cross-cutting│  │ DAG · leases · gates      │  │
│  │ objetivo     │  │ patrones     │  │ presupuesto · anti-deadlock│ │
│  │ prioridad    │  │ contratos    │  │                            │  │
│  └───────┬──────┘  └──────┬───────┘  └────────────┬──────────────┘  │
│          │                │                       │                 │
│  ════════╪════════════════╪═══════════════════════╪═════════════    │
│          ▼                ▼                       ▼                 │
│ CAPA 2 — BUS DE MENSAJES  (append-only sobre disco)                 │
│  bus/<canal>/<seq>-<msgid>.json                                      │
│  inbox/<agentId>/  ·  roster.json  ·  leases/<taskId>.json           │
│  canales: coord-command │ coord-arch │ coord-flow │ peer            │
│          │                                                              │
│          ▼                                                              │
│ CAPA 1 — ESPECIALISTAS  (ficha normalizada)                         │
│  E1  E2  E3  E4  E5  E6  E7  E8  E9  E10                            │
│  fichas: id · role · capabilities · scope · peers · must_not         │
│          │                                                              │
│          ▼                                                              │
│ CAPA 0 — ROSTER / FICHAS  (resolución de roles)                      │
│  agency-agents/<division>/*.md  →  ficha  │  catálogo < 60% → factory│
└──────────────────────────────────────────────────────────────────────┘
```

### La ficha: un solo schema

Venga el rol de `agency-agents` o de la factory, se materializa en la **misma** ficha. Esa unificación es lo que permite que el bus, el matching de ayuda, la rotación y los coordinadores no necesiten saber el origen de nada.

```yaml
id: e-frontend
role: frontend-developer
source: { kind: agency-agents, division: engineering, path: engineering/frontend-developer.md }
capabilities: [react-component-design, css-architecture, accessibility]
scope:
  may_touch: ["src/components/**", "src/hooks/**"]
  forbidden: ["src/server/**", "**/*.env*"]
can_delegate: true
delegate_budget: 2
peers: [e-architect, e-qa, e-security]
must_not:
  - "no editar archivos fuera de may_touch"
  - "no aprobar tu propio trabajo"
on_finish: idle-join
escalate_to: coordinator-flow
```

### Resolución de roles: catálogo primero, factory después

1. **Catálogo match** — se escanea el repo real de `agency-agents`, se infieren capabilities del nombre y la descripción, y se elige el de mayor overlap.
2. **Factory** — si la cobertura queda **< 60%**, el rol se genera desde un template, con las capabilities y el objetivo de la corrida dentro del prompt. Un rol fabricado queda marcado como candidato a skill.

**Nunca se fuerza un mal match.** Si la card pide capabilities que nadie cubre, el router devuelve `null` y las faltantes — para fabricar el rol o pedir ayuda. Un rol medio-tonto en el equipo arruina más de lo que aporta.

---

## El bus

Los subagentes de OpenCode son **procesos aislados sin memoria compartida**. No pueden hablarse de facto. La solución coherente es un bus append-only sobre disco.

```json
{
  "id": "m-0042",
  "seq": 42,
  "from": "e-frontend",
  "to": ["e-architect"],
  "kind": "HELP_REQUEST",
  "subject": "T-03",
  "body": {
    "need": "convertir este componente a streaming SSR",
    "why_me": "tengo el contexto del componente pero no el del server"
  },
  "reply_to": null,
  "in_reply_to": null,
  "ttl_sec": 900,
  "created_at": "2026-10-21T15:04:00Z",
  "priority": "normal",
  "idempotency_key": "help:T-03:e-frontend:a1b2c3",
  "hops": 0
}
```

| Garantía | Implementación | Por qué importa |
|---|---|---|
| **Append-only** | Los mensajes nunca se borran; `seq` es monótono por canal | El log es la auditoría |
| **Escritura atómica** | `.tmp` + `rename` | Nunca hay un JSON partido en el read |
| **Ack** | `inbox/<agentId>/<msgid>.ack` | El emisor sabe quién leyó |
| **TTL** | Vencido = invisible para lectores nuevos, sigue en el log | Un pedido viejo no bloquea nada |
| **Idempotency key** | Mismo key = mismo mensaje | Evita el storm de «¿me ayudás?» |
| **Broadcast** | `to: ["*"]` al pool | El primero que acepta toma el lease |
| **Anti-deadlock** | `hops` máximo 2 | Una cadena de ayuda no se enquista |

### El que recibe hace su propio triage

No acepta por cortesía. Seis preguntas, en orden:

1. ¿Entiendo la tarea? → si no, `HELP_DECLINE` + explicar
2. ¿Está en mi scope? → si no, `HELP_DECLINE` + sugerir a quién
3. ¿Puedo hacerlo **ya** sin romper mi card? → si no, `HELP_DECLINE` + «cuando termine»
4. ¿Tengo el contexto? → si no, `HELP_QUESTION` por el bus
5. ¿Vale la pena? → si no, `HELP_DECLINE` + alternativa
6. ¿Tengo presupuesto? → si no, `HELP_DECLINE` + «sin presupuesto»

---

## Los 4 hooks

Acá es donde el protocolo deja de ser una intención.

| Hook | Qué hace | Por qué importa |
|---|---|---|
| `event` → `session.idle` | Si queda trabajo, manda un prompt sintético y la corrida sigue | La oficina trabaja sola. El modelo no declara el fin: el estado. |
| `tool.execute.before` | Bloquea escrituras fuera del scope de la card | «No toques eso» pasa de instrucción a restricción |
| `experimental.chat.system.transform` | Inyecta el estado de la oficina en cada llamada | El agente no repregunta lo que ya sabe ni repite trabajo |
| `experimental.session.compacting` | Reinyecta el estado **leído del disco** al compactar | Sin esto, la oficina se olvida a mitad de camino |

El hook de auto-continuación tiene guardas duras: solo reanuda si queda trabajo real, tope de 25 auto-reanudaciones por sesión, cooldown de 1,5 s entre reanudaciones, y nunca reanuda una corrida `paused`, `blocked` o `delivered`.

---

## Los 6 gates

De la skill `verification-loop`. Se ejecutan de verdad; el motor interpreta los exit codes.

| # | Fase | Node | Python | Go | Rust |
|---|---|---|---|---|---|
| 1 | Build | `npm run build` | `python -m build` | `go build ./...` | `cargo build` |
| 2 | Type check | `npm run typecheck` | `mypy` | `go vet ./...` | `cargo check` |
| 3 | Lint | `npm run lint` | `ruff` | `golangci-lint` | `cargo clippy` |
| 4 | Tests | `npm run test` | `pytest` | `go test` | `cargo test` |
| 5 | Secretos | escaneo en código | ← | ← | ← |
| 6 | Diff review | `git diff --stat` | ← | ← | ← |

**Reglas de honestidad** — no negociables:

- Nunca `PASS` en una fase que no se corrió → `NOT RUN` y eso hace fallar el gate
- Nunca output inventado
- `N/A` siempre con motivo explícito
- Una fase aplicable en `FAIL` = gate `FAIL`. No se promedia
- El escaneo de secretos corre **en TypeScript**, no shelling out a `grep` (que no existe en Windows), y **redacta** el valor: un log de gate que imprime la credencial completa la acaba de filtrar

---

## Invariantes duros

Los implementa el código. Un prompt puede pedirle al modelo que sea cuidadoso; el motor no puede romperlos.

| Invariante | Valor |
|---|---|
| `gate_required_before_done` | `true` — sin gates en `PASS` no hay `DONE` |
| `reviewer_neq_owner` | `true` — no hay auto-aprobación |
| `max_concurrent_agents` | 10 base · 14 hard cap |
| `max_spawn_depth` | 2 niveles bajo el coordinador |
| `max_spawns_total` | 20 por corrida |
| `max_help_chain_hops` | 2 — anti-deadlock |
| `max_messages_per_agent` | 150 — anti-spam |
| `msg_ttl_sec` | 900 |
| `lease_ttl_sec` | 1800 — con heartbeat; si el agente muere, expira |
| `heartbeat_sec` | 60 |
| `max_review_rejections` | 3 → escalación |
| `max_cards` · `max_agent_calls` | 20 · 40 por corrida |

---

## Los 3 coordinadores

Un solo coordinador es cuello de botella y punto único de falla.

| | COMANDANTE | ARQUITECTO | INTEGRADOR |
|---|---|---|---|
| **Dominio** | Scope, objetivo, prioridades | Decisiones técnicas cross-cutting | DAG, leases, gates, calidad |
| **Responde** | ¿esto está en el objetivo? | ¿qué patrón usamos? | ¿quién tiene T-07? ¿pasó el gate? |
| **Detecta** | Scope creep, requisitos no cubiertos | Drift arquitectónico, decisiones inconsistentes | Deadlock, starvation, gates rojos, doble-claim |
| **Nunca** | Diseñar ni revisar código | Escribir código | Escribir código |

**Arbitraje**: scope → Comandante. Patrón/contrato → Arquitecto. Flujo/lease/gate → Integrador. Si cruza dos dominios, el Arquitecto decide lo técnico con visto bueno del Comandante; si el Integrador detecta deadlock, reparte y avisa.

Las preguntas de un especialista al coordinador **van por el bus**, no interrumpen al humano. Al usuario solo llega lo que ningún coordinador puede resolver.

---

## Los 10 tools

Diez, no treinta. Cada tool que se suma es ruido en el contexto de todos los agentes.

| Tool | Qué hace |
|---|---|
| `oficina_plan` | Guarda el plan de cards. El modelo propone; el motor valida y rutea owner/reviewer |
| `oficina_board` | Estado: cards, owners, agentes libres, agentes sin heartbeat, presupuesto |
| `oficina_assign` | Toma trabajo — la próxima card, o claim proactivo de una puntual |
| `oficina_submit` | Entrega handoff + evidencia real → pasa a `REVIEW` |
| `oficina_review` | Registra el veredicto. El motor **rechaza** que el owner se auto-revise |
| `oficina_gate` | Corre los 6 gates. Exit codes reales, no opinión |
| `oficina_bus` | Bus: `send` · `receive` · `ack` · `help` |
| `oficina_spawn` | Pide desplegar un agente. El Integrador aprueba o rechaza |
| `oficina_escalate` | Escala al usuario con 2-3 opciones concretas y recomendación |
| `oficina_ficha` | Resuelve un rol a ficha — del catálogo o de la factory |

---

## Los 7 agentes

| Agente | Rol | Aprueba? |
|---|---|---|
| `oficina-commander` | Scope, objetivo, prioridades | No revisa técnico |
| `oficina-architect` | Decisiones técnicas cross-cutting | No revisa técnico |
| `oficina-integrator` | DAG, leases, gates, presupuesto | No revisa técnico |
| `oficina-critico` | Revisión con confianza calibrada (umbral 80) | Sí |
| `oficina-guardian` | Secretos, inyecciones, deps, auth | Sí |
| `oficina-verificador` | Ejecuta build/typecheck/lint/test | Sí |
| `oficina-director` | Dirección de la oficina v1 (fallback) | No |

---

## Instalación

### Desde npm

```bash
npm install -g oficina-opencode
```

### Local (desarrollo)

```bash
git clone https://github.com/SOCRAMbt/El-ltimoTPP.git
cd El-ltimoTPP
npm install
npm run build

cd ~/.config/opencode
npm install file:/ruta/a/El-ltimoTPP
```

Y el entry point en `~/.config/opencode/plugins/oficina.js`:

```js
export { OficinaPlugin, default } from "oficina-opencode"
```

### Configuración

`~/.config/opencode/opencode.json`:

```json
{
  "experimental": {
    "subagent_depth": 3
  }
}
```

`subagent_depth: 3` es **obligatorio**: con el default (`1`) los subagentes no pueden delegar a otros subagentes, y la malla no arranca.

### Los assets del protocolo

El paquete incluye la skill, los agentes y el comando. Para instalarlos:

```bash
oficina install --target ~/.config/opencode
```

O a mano: `skills/oficina/` → `~/.config/opencode/skills/oficina/`, `agents/*.md` → `~/.config/opencode/agents/`, `commands/oficina.md` → `~/.config/opencode/commands/`.

---

## Uso

Desde la raíz del proyecto:

```text
/oficina Agregar autenticación JWT con refresh rotation
```

El comando carga la skill `oficina`, el plugin registra las tools, y la corrida arranca sola.

El ciclo:

```
OBJETIVO → PLAN (Comandante)
              ↓
         STANDUP — la card con deps satisfechas
              ↓
         TRABAJO (owner) → handoff.md + evidence.md
              ↓
         AUTO-REVIEW (oficina-critico, ≠ owner)
              ↓
         GATES (oficina-verificador + oficina-guardian)
              ↓
        ┌────────┴────────┐
      DONE            REWORK → REPLAN → ESCALADA
```

---

## CLI — operación

```bash
oficina init [objetivo]                    # Crea .oficina/ en el proyecto
oficina status                             # Cards, agentes, presupuesto, escalaciones
oficina board                              # Tablero Kanban
oficina bus                                # Estadísticas del bus
oficina audit T-03                         # Artefactos, gates y review de una card
oficina verify                             # Corre los gates de las cards en review
oficina catalog --agency-root <path>      # Lista el catálogo de roles
oficina install --target <dir>             # Instala skill, agentes y comando
oficina reset --force                      # Abandona la corrida
```

---

## Estructura de la corrida

```
<proyecto>/.oficina/
├── board.md          # Kanban legible por humanos
├── state.json        # estado legible por máquinas — retoma tras reinicio
├── context.md        # ledger de conocimiento acumulado
├── roster.json       # quién existe, qué puede, qué está haciendo
├── config.json
├── bus/
│   ├── coord-command/0001-m-xxxxxxxx.json
│   ├── coord-arch/
│   ├── coord-flow/
│   └── peer/
├── inbox/<agentId>/  # acks
├── leases/<taskId>.json
├── fichas/<agentId>.md
└── artifacts/<cardId>/
    ├── handoff.md    # qué hizo el owner
    ├── evidence.md   # salida real de los comandos
    ├── review.md     # veredicto del crítico
    ├── gates.md      # PASS/FAIL técnico y seguridad
    └── decision.md   # decisión del director
```

El formato de artefactos es compatible con OFICINA v1 (la skill). El plugin **migra el estado v1 automáticamente**: objetivo, cards y resultados se conservan.

---

## Código

21 archivos TypeScript · 4.722 líneas de `src/` · 1.883 líneas de test · 14 módulos en `core/`.

```
src/
├── index.ts              # entry del plugin: tools + hooks
├── cli.ts                # CLI de operación
├── core/
│   ├── types.ts          # el schema único del sistema
│   ├── state.ts          # máquina de estados + invariantes + migración v1
│   ├── bus.ts            # bus append-only con TTL/ack/idempotencia
│   ├── roster.ts         # quién existe + pool idle
│   ├── leases.ts         # leases con TTL y heartbeat
│   ├── catalog.ts        # escaneo de agency-agents + matching de capabilities
│   ├── factory.ts        # generación de roles + registro de candidatos
│   ├── router.ts         # enrutado + rotación anti-monotonía
│   ├── gates.ts          # runner de los 6 gates + escaneo de secretos
│   ├── retry.ts          # política de 3 golpes
│   ├── office.ts         # la fachada que amarra todo
│   ├── paths.ts          # resolución de project root
│   ├── fsx.ts            # IO atómico
│   └── log.ts            # logging estructurado
├── tools/index.ts        # las 10 tools
└── hooks/
    ├── sessionIdle.ts    # auto-continuación
    ├── scopeGuard.ts     # enforcement de scope
    ├── systemTransform.ts
    └── compacting.ts
```

### Dependencias

Una sola, y es peer del host: `@opencode-ai/plugin`. Zod entra por `tool.schema` — la instancia del propio plugin — para que los tipos nunca divergan de la versión que el host está corriendo.

---

## Testing

```bash
npm test           # 157 tests, 11 archivos
npm run coverage   # 87.8% stmts · 81.0% branches
npm run typecheck  # tsc --noEmit, strict
npm run build      # tsc → dist/
```

| Suite | Cubre |
|---|---|
| `bus.test.ts` | Append-only, ack, TTL, idempotencia, broadcast, prioridad, atomicidad |
| `state.test.ts` | Transiciones, invariantes duros, selección de card, ciclo de corrida |
| `gates.test.ts` | Detección de tooling, las 6 fases, N/A con motivo, consolidación, redacción |
| `router.test.ts` | Enrutado, rotación, reviewer ≠ owner, política de 3 golpes, presupuesto |
| `leases.test.ts` | Adquisición, heartbeat, expiración, double-claim, reasignación |
| `catalog.test.ts` | Escaneo del catálogo, matching, cobertura, factory, template |
| `office.test.ts` | Ciclo completo end-to-end, invariantes, artefactos en disco |
| `scopeGuard.test.ts` | Globs, extracción de path, enforcement de scope |
| `plugin.test.ts` | El plugin contra un host mockeado: tools, hooks, auto-resume |
| `migration.test.ts` | Migración v1 → v2 sin pérdida de datos |
| `cli.test.ts` | init, status, board, install, audit, reset, idempotencia |

---

## Licencia

MIT — ver [LICENSE](LICENSE).

El diseño se apoya en los patrones de `durable-execution` y `workflow-engine-design`: estado durable antes de los efectos, leases con TTL, transiciones nombradas explícitamente y at-least-once con reconciliación por idempotency key.
