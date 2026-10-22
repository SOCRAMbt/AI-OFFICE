# Capa 2-3 — El mesh (v2)

Detalle de la malla: bus, fichas, roster, leases, spawn policy, idle pool.

---

## La ficha: schema único

Venga el rol de agency-agents o de la factory, se materializa en la **misma** `Ficha`. Esa unificación es lo que permite que el bus, el matching de ayuda, la rotación y los coordinadores no necesiten saber el origen de nada.

```yaml
id: e-frontend          # id de despliegue, único por corrida
role: frontend-developer
display_name: Frontend Developer
source:
  kind: agency-agents   # agency-agents | factory
  division: engineering
  path: engineering/frontend-developer.md
  source_prompt: <el system prompt original, verbatim>
  vibe: <la personality hook de una línea del frontmatter>
  missions: [<subtítulos de "Core Mission">]
  deliverables: [<subtítulos de "Technical Deliverables">]
  rules: [<items de "Critical Rules">]
capabilities:
  - react-component-design
  - css-architecture
  - accessibility
tools: [read, glob, grep, edit, write, bash]
scope:
  may_touch: ["src/components/**", "src/hooks/**"]
  forbidden: ["src/server/**", "**/*.env*"]
can_delegate: true      # este rol puede tirar subagentes nuevos
delegate_budget: 2
peers:                  # con quién tiene relación de pares (para pedir ayuda)
  - e-architect
  - e-qa
  - e-security
must_not:               # límites duros, leídos por los coordinadores
  - "no editar archivos fuera de may_touch"
  - "no tocar archivos de forbidden"
  - "no aprobar tu propio trabajo"
on_finish: "idle-join"  # al terminar su objetivo entra al pool de ayuda
escalate_to: coordinator-flow
```

### Resolución: catálogo primero, factory después

El catálogo de agency-agents tiene **258 agentes resolubles en 18 divisiones** (la cifra vive en `docs/catalog-facts.json`, con su commit de origen, y el CI verifica que no se desactualice). La especialidad real de cada uno está en el **cuerpo** y en la `description` y el `vibe` del frontmatter:

- **Core Mission** → los subtítulos son la especialidad declarada
- **Technical Deliverables** → lo que sabe producir
- **Advanced Capabilities** → lo que maneja mejor
- **description + vibe** → líneas curadas a mano: la señal más limpia

El matcher pondera por señal: **identidad** (slug + nombre + `description` + `vibe`) 35% · **misión literal** 28% · **misión conceptual** 18% · **división** 10% · **cuerpo** 5%.

Además aplica tres correcciones que la bolsa de tokens no hace:

- **Sinónimos por capability** — `"e2e"` es `"end-to-end"`, pero `"e2e"` **no** es `"playwright"`. La taxonomía agrupa por concepto; los sinónimos no.
- **Lematización** — `"testing"` ~ `"test"`, `"validation"` ~ `"validate"`. El Commander pide capabilities en sus palabras y los agentes usan las suyas.
- **Focus de misión** — qué fracción de las misiones declaradas del agente es del dominio. Es lo que distingue a un especialista de un generalista que menciona la tool de pasada.

**Medido**: el matcher completo acierta el primer rol en el **71%** de 21 tareas de referencia, contra el **48%** de la versión anterior (`npm run bench:selection`). Se probó además una ponderación por IDF y **no se quedó**: bajaba el hit@1 a 67%.

```
1. CATALOG MATCH (preferido)
   Buscar en agency-agents/<division>/*.md el agente cuya especialidad
   declarada en el cuerpo matchea las capacidades pedidas.
   → source.kind = agency-agents, source_prompt = el prompt original

2. FACTORY (si no hay match, o la cobertura es < 60%)
   Se genera desde template: system prompt = rol + ficha + working
   discipline + capabilities + objetivo de la corrida, con la MISMA
   estructura de 10 secciones que agency-agents.
   → source.kind = factory
   Se registra como AGENT-CANDIDATE para promoverlo a skill después
```

**Regla de cobertura**: antes de desplegar, se calcula qué fracción del objetivo cubre el **panel** (primario + complementos). Si es < 60%, se crea un rol nuevo con factory en vez de forzar un mal match.

Esto evita el "subagente monotono", que es el síntoma exacto del problema original.

### El panel de roles

Un objetivo casi nunca es de un solo dominio. El panel devuelve:

- **primario** — el mejor match global. Se lleva la card.
- **complementos** — los agentes que cubren lo que el primario NO cubre. Son sus pares en el bus.
- **sin cubrir** — lo que nadie del panel cubre. Señal de que la card debería partirse en dos.

Ejemplo real:

```
PIDE: react, form, validation, accessibility, frontend

  PRIMARIO    28%  engineering-section-508-specialist
              cubre:   form, accessibility
  + COMPLEM. 23%  engineering-frontend-developer
              aporta:  react, frontend
```

### Los 4 artefactos de un agente desplegado

Un agente **no arranca sin `misiones.md`**. Nunca.

| Artefacto | Contenido |
|---|---|
| `ficha.md` | Quién sos: rol, especialidad, origen, vibe |
| `misiones.md` | Tu misión · lo que ya sabés · lo que NO sabés |
| `protocolo.md` | Cómo trabajás · tu territorio · qué se espera · límites · éxito |
| `bus.md` | Tu canal: dónde, formato, TTLs, cómo acusar recibo |

Y `briefing.md` con el documento completo, para lectura humana.

### El briefing: orden y mínimo

Cada agente recibe un briefing de **10 secciones en orden fijo**. El orden va de lo más estable a lo más cambiante: un agente lee de arriba hacia abajo y siempre tiene lo que necesita para el paso siguiente.

| # | Sección | Qué le dice |
|---|---|---|
| 1 | Quién sos | Rol, especialidad de origen, vibe |
| 2 | Tu misión | Card, criterios de aceptación numerados, gate |
| 3 | Lo que ya sabés | Decisiones, restricciones, piezas, trampas |
| 4 | Lo que NO sabés | Huecos explícitos y a quién preguntarle |
| 5 | Tu territorio | may_touch / forbidden / prohibiciones de la ficha |
| 6 | Cómo trabajás | Ciclo, cuándo pedir ayuda, delegar, escalar |
| 7 | Tu canal | Bus: dónde, formato, TTL, ack |
| 8 | Qué se espera de vos | handoff.md y evidence.md |
| 9 | Lo que no podés hacer | Prohibiciones (están en código) |
| 10 | Cómo se mide que terminaste | Las tres condiciones de terminado |

**Mínimo**: las 10 secciones son requeridas. Si alguna queda vacía, el briefing se marca `INCOMPLETO` y el agente no arranca. Un briefing a medio llenar produce un agente a medio informado, que es peor que no tener agente.

**La sección 3 se alimenta del ledger** (`.oficina/context.md`). Es lo que evita repetir lo ya decidido.

---

## El bus

### Layout

```
.oficina/
├── bus/
│   ├── coord-command/0001-<msgid>.json    # canal del Comandante
│   ├── coord-arch/0001-<msgid>.json       # canal del Arquitecto
│   ├── coord-flow/0001-<msgid>.json       # canal del Integrador
│   └── peer/0001-<msgid>.json             # canal general entre pares
├── inbox/<agentId>/                       # índice de lo que le llegó
├── roster.json                            # quién existe, qué puede, qué hace
├── leases/<taskId>.json                   # lock con TTL
```

### Envelope

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
  "idempotency_key": "T-03-help-request-1",
  "hops": 0
}
```

### Semántica

- **Append-only**: los mensajes nunca se borran, se archivan. `seq` es monótono por canal.
- **Escritura atómica**: write a `.tmp` + `rename` → nunca hay un JSON partido en el read.
- **Polling, no push**: cada agente hace `glob` de su inbox cada N turnos.
- **Ack**: el receptor escribe `inbox/<agentId>/<msgid>.ack`. El emisor ve quién leyó.
- **TTL**: mensaje expirado = invisible para nuevos lectores, sigue en el log para auditoría.
- **Idempotency key**: un `HELP_REQUEST` con la misma key no se duplica.
- **Canal `peer` broadcast**: un `HELP_REQUEST` puede ir a `to: ["*"]` para broadcast de "necesito X" al pool, y el primero que puede toma el lease.

### Tipos de mensaje

| Kind | Quién lo emite | Para qué |
|---|---|---|
| `HELP_REQUEST` | cualquier agente | pedir ayuda a un peer o al pool |
| `HELP_ACCEPT` / `HELP_DECLINE` / `HELP_PARTIAL` / `HELP_QUESTION` | el que recibe | triage del pedido |
| `QUESTION` / `ANSWER` | agente ↔ coordinador | consultas de dominio |
| `SPAWN_REQUEST` / `SPAWN_APPROVED` / `SPAWN_REJECTED` | agente ↔ Integrador | gestión de spawns |
| `CLAIM` / `RELEASE` | agente ↔ Integrador | estado de trabajo |
| `STATUS` / `NOTICE` | cualquiera | información general |

---

## El protocolo de ayuda

### Cuándo se pide ayuda

Un especialista pide ayuda cuando, **en este orden**:

1. La tarea es de otro dominio → pide al peer de ese dominio
2. La tarea es de otro dominio y **ese peer no está desplegado** → **despliega uno**
3. La tarea está en su scope pero ve que otro lo haría mejor → pide
4. Está bloqueado por una dependencia → pide al dueño del lease

### El que recibe evalúa (no acepta por cortesía)

Al recibir un `HELP_REQUEST`, el receptor **hace su propio triage**:

```
1. ¿Entiendo la tarea?              → si no: HELP_DECLINE + explicar
2. ¿Está en mi scope/ficha?          → si no: HELP_DECLINE + sugerir a quién
3. ¿Puedo hacerlo YA sin romper mi
   propia card en curso?              → si no: HELP_DECLINE + "cuando termine"
4. ¿Tengo el contexto necesario?     → si no: HELP_QUESTION (pregunta de vuelta)
5. ¿Vale la pena? (costo vs. valor)  → si no: HELP_DECLINE + alternativa
6. ¿Puedo con mi presupuesto?         → si no: HELP_DECLINE + "sin presupuesto"
```

| Respuesta | Cuándo | Payload |
|---|---|---|
| `HELP_ACCEPT` | Puede y corresponde | `scope`, `deadline`, `needs_from_me` |
| `HELP_DECLINE` | No puede o no le corresponde | `reason`, `alternative`, `available_at` |
| `HELP_PARTIAL` | Puede una parte | `can_do`, `cannot_do`, `split_suggestion` |
| `HELP_QUESTION` | No entiende o falta info | `question` — ida y vuelta máximo 2 turnos |

**Anti-deadlock**: una cadena de ayuda (A pide a B, B pide a C) tiene **máximo 2 saltos**. Si se excede, el pedido escala al coordinador de flujo.

**Anti-monotonía en la ayuda**: la rotación de revisor se extiende a la ayuda. Si el mismo par (A↔B) ya se ayudaron 2 veces, el tercer pedido se enruta a un tercero.

---

## Política de spawn

Un especialista puede desplegar un subagente nuevo **solo si**:

1. El rol buscado **no está en el roster activo** (no duplicar)
2. El rol sale de `agency-agents` por catálogo, o de factory con cobertura ≥ 60%
3. El presupuesto global lo permite (`max_concurrent`, `max_spawns_total`)
4. **El deployment es visible en el roster y en el board** — no es invisible

Y **debe reportarlo** al Integrador:

```json
{
  "kind": "SPAWN_REQUEST",
  "requested_role": "motion-designer",
  "source": {"kind": "agency-agents", "path": "design/motion-designer.md"},
  "reason": "T-03 necesita transiciones que exceden mi scope de CSS",
  "budget": {"spawns_used": 1, "spawns_remaining": 1}
}
```

El Integrador **aprueba o rechaza**: si la capacidad ya la cubre un peer desplegado, rechaza y le indica a quién preguntar. Esto mata el "cada agente se clona su propio equipo".

**Coherencia clave**: el subagente-account de un subagente es el **mismo `id` de ficha** (no un clon). Hereda la ficha, el bus, el lease, y aparece en el roster. Cuando termina, vuelve al pool de idle.

---

## El pool idle

### Ciclo de vida de un agente

```
DEPLOYED ──► WORKING ──► (sus cards en DONE) ──► IDLE_AVAILABLE ──► (ayuda) ──► WORKING
                 │                                                              │
                 └──► BLOCKED (espera input) ──► IDLE_AVAILABLE                  │
                                                                                ▼
                                                                     RETIRED (fin de corrida)
```

### Registro en el roster

```json
{
  "id": "e-frontend",
  "state": "idle_available",
  "capabilities": ["react-component-design", "css-architecture"],
  "idle_since": "2026-10-21T15:22:00Z",
  "can_accept": true,
  "lease": null
}
```

### Los tres modos de ayudar

1. **Atender un `HELP_REQUEST` dirigido** (to: ["e-frontend"]) → triage → accept/decline
2. **Atender un broadcast** `to: ["*"]` → el primero que acepta **toma el lease** → los demás lo ven ocupado y se retiran
3. **Claim proactivo**: si hay work packages sin owner en el board y tu capability matchea el mejor → **reclamás**, avisás al Integrador, y lo hacés. No esperás que te lo asignen.

El modo 3 es lo que convierte la oficina de "N agentes en paralelo" a "N agentes que se acomodan solos según la carga".

---

## Leases

Un agente que trabaja una card **toma un lease** con TTL. El heartbeat lo extiende. Si el agente muere, el lease expira y la card se reasigna.

Sin esto, una card queda trabada por un subagente que murió en silencio.

```
leases/<taskId>.json
{
  "taskId": "T-03",
  "agentId": "e-frontend",
  "acquiredAt": "...",
  "expiresAt": "...",
  "heartbeatAt": "...",
  "renewals": 12
}
```

**Double-claim**: el lease lo bloquea. Si dos agentes discuten por la misma card, el lease decide — no la discusión.

---

## Deadlock, starvation y agentes muertos

| Problema | Señal | Respuesta |
|---|---|---|
| **Deadlock** | dos cards se esperan mutuamente | Romper el ciclo: una cede, o partir una. Lo detecta el Integrador. |
| **Starvation** | una card espera demasiado | Priorizarla o avisar al Comandante. |
| **Doble claim** | dos agentes en la misma card | El lease lo bloquea. |
| **Agente muerto** | sin heartbeat en 3× `heartbeat_sec` | Su card se reasigna, su lease expira. |

---

## Arbitraje de los coordinadores

```
Pregunta de un especialista
      |
      ├─ ¿es de scope/objetivo/prioridad?   → COMANDANTE
      ├─ ¿es de diseño/patrón/contrato?       → ARQUITECTO
      ├─ ¿es de flujo/lease/gate/calidad?     → INTEGRADOR
      |
      └─ ¿cruza dos dominios?
           → ARQUITECTO (decisión técnica) con visto bueno del COMANDANTE
             si tiene impacto de scope; si el Integrador detecta deadlock
             → INTEGRADOR reparte y avisa.
```

**Las preguntas al coordinador van por el bus**, no por chat. Un especialista nunca interrumpe al humano para preguntar algo que un coordinador puede resolver.

Solo llega al humano si:
- El coordinador no puede decidir (requiere criterio de producto/negocio)
- Hay conflicto entre dominios que ningún coordinador resuelve
- Se agotó el presupuesto o hay un bloqueo externo
