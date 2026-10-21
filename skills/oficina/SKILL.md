---
name: oficina
description: Oficina de Agents que trabaja un objetivo de principio a fin sin instrucciones repetidas. Con el plugin instalado, la oficina es una máquina de estados con hooks de enforcement: el Director descompone, delega a especialistas con ficha normalizada, coordina por un bus de mensajes en disco, permite pedir ayuda y delegar entre pares, y un hook de auto-continuación sigue trabajando cuando el modelo dice "terminé". Sin el plugin, el mismo protocolo funciona con el flujo de artefactos en markdown. Úsala cuando el usuario da un objetivo, feature, bug o refactor y quiere que un equipo de agentes lo ejecute completo, se auto-verifique y entregue evidencia, en vez de que el assistant lo haga todo lineal.
---

# OFICINA — Oficina de Agents

Un objetivo entra por la puerta. La oficina lo ejecuta, se auto-verifica, y entrega evidencia.

## Dos motores, un solo protocolo

| | **Con plugin** (motor duro) | **Sin plugin** (fallback) |
|---|---|---|
| Estado | Máquina de estados en TypeScript | `state.json` markdown + JSON |
| Gates | Comandos reales, exit codes interpretados por código | El modelo corre los comandos y pega la salida |
| Enforcement | Guard de scope: no se puede editar fuera del scope | Disciplina del prompt |
| Loop | Hook `session.idle` → la oficina sigue sola | El modelo decide si sigue |
| Invariantes | `assertInvariants` en código | Regla dura en el prompt |
| Comunicación | Bus de mensajes con TTL/ack/idempotencia | Artefactos en disco, unidireccional |

**Preferí el plugin.** Si las tools `oficina_*` están disponibles, usá el motor duro: los invariantes dejan de ser sugerencias.

El protocolo de este documento sirve para los dos. Las secciones marcadas **[plugin]** solo aplican con el plugin instalado.

---

## Por qué existe

| Falla | Cómo la resuelve OFICINA |
|---|---|
| El usuario tiene que dar todas las instrucciones | El **Comandante** descompone solo. El usuario da un objetivo y basta. |
| El agent "no cumple" lo que dice | Cada card tiene **acceptance criteria** explícitos y un **gate** que se ejecuta, no se opina. |
| Los subagentes se desaprovechan | Tabla de **enrutado determinista** + resolución desde el catálogo real de agency-agents. |
| Hay que repetir el contexto | **Ledger de contexto** en disco (`.oficina/context.md`) + handoff por artefactos. |
| Los agents no se coordinan ni se ayudan | **Bus de mensajes**: pueden pedir ayuda, delegar y contestar. |
| Son monotonos | **Revisor distinto del autor** + rotación de owner y de dimensión. |
| Nadie los orquesta | **3 coordinadores** con dominios particionados y arbitraje explícito. |
| La IA dice "terminé" sin terminar | **[plugin]** Hook de auto-continuación: el estado decide, no la confianza. |

---

## Las 4 capas

```
CAPA 3 — COORDINACIÓN    Comandante · Arquitecto · Integrador
CAPA 2 — BUS             bus/<canal>/<seq>-<msgid>.json · inbox/ · leases/
CAPA 1 — ESPECIALISTAS   fichas normalizadas (agency-agents o factory)
CAPA 0 — ROSTER/FICHAS   resolución de roles + matching de capabilities
```

Detalle completo en `reference/mesh.md`.

---

## Los 3 coordinadores

Un solo coordinador es cuello de botella y punto único de falla. Tres, con dominios particionados:

| | COMANDANTE | ARQUITECTO | INTEGRADOR |
|---|---|---|---|
| **Dominio** | Scope, objetivo, prioridades | Decisiones técnicas cross-cutting | DAG, leases, gates, calidad |
| **Responde** | ¿esto está en el objetivo? | ¿qué patrón usamos? | ¿quién tiene T-07? ¿pasó el gate? |
| **Detecta** | Scope creep, requisitos no cubiertos | Drift arquitectónico, decisiones inconsistentes | Deadlock, starvation, gates rojos, doble-claim |
| **NO hace** | Diseñar ni revisar código | Escribir código | Escribir código |

**Arbitraje**: scope → Comandante. Patrón/contrato → Arquitecto. Flujo/lease/gate → Integrador. Si cruza dos dominios: el Arquitecto decide lo técnico con visto bueno del Comandante; si el Integrador detecta deadlock, reparte y avisa.

**Al usuario solo se escala** si el coordinador no puede decidir (criterio de producto), si el conflicto cruza dominios sin resolución, o si se agotó el presupuesto.

---

## El ciclo de la oficina

```
OBJETIVO
   │
   ▼
 ┌──────────────────────┐
 │ 1. PLAN (Comandante) │  Descompone → cards con owner, acceptance, gate, scope
 └──────────────────────┘
   │
   ▼
 ┌──────────────────────┐
 │ 2. STANDUP            │  Elige la card más prioritaria con deps satisfechas
 └──────────────────────┘
   │
   ▼
 ┌──────────────────────┐
 │ 3. TRABAJO (Owner)    │  Ejecuta + escribe handoff.md + evidence.md
 └──────────────────────┘
   │
   ▼
 ┌──────────────────────┐
 │ 4. AUTO-REVIEW        │  Crítico ≠ owner. APROBADO o RECHAZADO con razón
 └──────────────────────┘
   │ RECHAZADO ─────────────┐
   │ APROBADO               │
   ▼                        │
 ┌──────────────────────┐  │
 │ 5. GATES              │  │
 │  Verificador (técn.)  │  │
 │  Guardián (seguridad) │  │
 └──────────────────────┘  │
   │                        │
   │ FALLA ─────────────────┤
   │ PASA                   │
   ▼                        ▼
 ┌─────────────┐         ┌──────────────┐
 │ 6. DONE     │         │ 7. REWORK    │
 └─────────────┘         │  1er: reintenta│
                         │  2do: replan  │
                         │  3ro: ESCALA  │
                         └──────────────┘
```

**[plugin]** Con el plugin, el paso 3 es un `oficina_assign` y el paso 5 un `oficina_gate` que corre los comandos de verdad.

Cada 3 cards completadas → **checkpoint** al usuario. Al final → **informe de entrega**.

---

## Los roles

| Rol | Agente | Puede aprobar? |
|---|---|---|
| Comandante | `oficina-commander` | No revisa técnico |
| Arquitecto | `oficina-architect` | No revisa técnico |
| Integrador | `oficina-integrator` | No revisa técnico |
| Explorador | `code-explorer` | No |
| Arquitecto (rol) | `code-architect` | No |
| Implementador | `general` | No |
| **Crítico** | `oficina-critico` | Sí (revisión de card) |
| **Guardián** | `oficina-guardian` | Sí (gate seguridad) |
| **Verificador** | `oficina-verificador` | Sí (gate técnico) |

**Regla dura:** el que implementa nunca revisa su propio trabajo.

---

## Resolver roles: catálogo → factory

**[plugin]** `oficina_ficha` hace esto:

1. **Catálogo match**: busca en el repo de agency-agents el agente con mayor overlap de capabilities.
2. **Factory** (si cobertura < 60%): genera el rol desde un template, con el contexto de la corrida en el prompt.

Nunca se fuerza un mal match. Un rol medio-tonto en el equipo arruina más de lo que aporta.

**Sin plugin**: la tabla de `reference/roles.md`.

---

## Pedir ayuda y delegar

**[plugin]** `oficina_bus` con `action: "help"`.

El que recibe **hace su propio triage** — no acepta por cortesía:

1. ¿Entiendo la tarea? → si no, `HELP_DECLINE` + explicar
2. ¿Está en mi scope? → si no, `HELP_DECLINE` + sugerir a quién
3. ¿Puedo hacerlo ya sin romper mi card? → si no, `HELP_DECLINE` + "cuando termine"
4. ¿Tengo el contexto? → si no, `HELP_QUESTION` por el bus
5. ¿Vale la pena? → si no, `HELP_DECLINE` + alternativa
6. ¿Tengo presupuesto? → si no, `HELP_DECLINE` + "sin presupuesto"

**Anti-deadlock**: máximo 2 saltos en una cadena de ayuda; después escala al Integrador.
**Anti-monotonía**: si el par A↔B ya se ayudaron 2 veces, el tercer pedido va a un tercero.

**[plugin]** Delegar un rol nuevo: `oficina_spawn`. El Integrador aprueba o rechaza. Nunca clones agentes por tu cuenta.

**Sin plugin**: `reference/protocol.md`.

---

## El pool idle

Cuando un agente termina su objetivo, entra al pool y puede ayudar de tres modos:

1. Atender un `HELP_REQUEST` dirigido
2. Atender un broadcast (`to: ["*"]`) — el primero que acepta toma el lease
3. **Claim proactivo** — si hay cards sin owner y tu capability matchea, la reclamás

El modo 3 es lo que convierte la oficina de "N tareas en paralelo" a "N agentes que se acomodan solos según la carga".

---

## Reglas de ejecución

1. **Nunca marques DONE sin los gates en verde.** Una card sin `gates.md` en PASS no está DONE, está mintiendo.
2. **Nunca revises tu propio trabajo.**
3. **Un subagente, una card, un artefacto.** Los subagentes son stateless: la delegación lleva todo el contexto.
4. **Los artefactos son la memoria.** Si no está en `.oficina/`, no existe.
5. **Escalá cuando el caso lo pida**, no antes. 3 rechazos de la misma card = escalación con opciones concretas.
6. **Presupuesto**: 20 cards, 40 invocaciones, 20 spawns por corrida. Si se agota, informe parcial honesto y preguntá.

---

## Umbral de calidad

De `verification-loop`: build → type check → lint → tests → security grep → diff review.

Si el proyecto no tiene tooling para alguna fase, se marca `N/A` explícito — nunca se saltea en silencio.

**[plugin]** El escaneo de secretos corre en código y **redacta** el valor: un log de gate que imprime la credencial completa la acaba de filtrar.

---

## Cuándo NO usar OFICINA

- Tarea de una sola acción.
- El usuario pidió explícitamente hacerlo vos directo.
- Exploración sin objetivo claro — primero brainstorming, después OFICINA.

En esos casos, hacelo vos. OFICINA es para trabajo multi-paso con objetivo verificable.

---

## Referencias

- `reference/mesh.md` — bus, fichas, roster, leases, spawn policy, idle pool (v2)
- `reference/roles.md` — fichas de rol, criterios de enrutado, rotación
- `reference/protocol.md` — handoff, gates, escalamiento, checkpoints, reintentos
- `reference/templates.md` — templates de board, state.json, handoff, review, gates, informe
