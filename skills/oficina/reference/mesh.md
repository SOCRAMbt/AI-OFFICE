# Capa 2-3 — El mesh (v2)

Detalle de la malla: bus, fichas, roster, leases, política de spawn y pool idle.

---

## La ficha: schema único

Venga el rol de agency-agents o de la factory, se materializa en la misma `Ficha`. Esa unificación es lo que permite que el bus, el matching de ayuda, la rotación y los coordinadores no necesiten saber el origen de nada.

```yaml
id: e-frontend          # id de despliegue, único por corrida
role: frontend-developer
display_name: Frontend Developer
source:
  kind: agency-agents   # agency-agents | factory
  division: engineering
  path: engineering/frontend-developer.md
  source_prompt: <el system prompt original, verbatim>
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
peers:                  # con quién tiene relación de pares
  - e-architect
  - e-qa
  - e-security
must_not:               # límites duros, leídos por los coordinadores
  - "no editar archivos fuera de may_touch"
  - "no aprobar tu propio trabajo"
on_finish: "idle-join"  # al terminar su objetivo entra al pool de ayuda
escalate_to: coordinator-flow
```

### Los 4 artefactos de un agente desplegado

Un agente **no arranca sin `misiones.md`**. Nunca.

| Artefacto | Contenido |
|---|---|
| `ficha.md` | La ficha renderizada |
| `misiones.md` | Sus cards asignadas, con acceptance criteria y gate |
| `protocolo.md` | Cómo pedir ayuda, delegar, reportar, qué NO hacer |
| `bus.md` | Su canal, polling, formato de mensajes, TTLs |

---

## Resolución de roles

```
1. CATALOG MATCH (preferido)
   Buscar en agency-agents/<division>/*.md el agente cuya descripción
   matchea las capabilities pedidas. Se elige el de mayor overlap.
   → source.kind = agency-agents, source_prompt = el prompt original

2. FACTORY (si no hay match, o la cobertura es < 60%)
   Se genera desde template: system prompt = rol + ficha + working
   discipline + capabilities inferidas + objetivo de la corrida.
   → source.kind = factory
   Se registra como AGENT-CANDIDATE para promoverlo a skill después
```

**Regla de cobertura**: antes de desplegar, se calcula el overlap de capabilities objetivo vs. roster. Si es < 60%, se crea un rol nuevo con factory en vez de forzar un mal match.

Esto evita el "subagente monotono", que es el síntoma exacto del problema original.

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
└── leases/<taskId>.json                   # lock con TTL
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
- **Canal `peer` broadcast**: `to: ["*"]`. El primero que puede toma el lease.

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

## Política de spawn

Un especialista puede desplegar un subagente nuevo **solo si**:

1. El rol buscado **no está en el roster activo**.
2. El rol sale de agency-agents por catálogo, o de factory con cobertura ≥ 60%.
3. El presupuesto global lo permite (`max_concurrent`, `max_spawns_total`).
4. **El deployment es visible en el roster y en el board** — no es invisible.

Y **debe reportarlo** al Integrador:

```json
{
  "kind": "SPAWN_REQUEST",
  "requested_role": "motion-designer",
  "source": { "kind": "agency-agents", "path": "design/motion-designer.md" },
  "reason": "T-03 necesita transiciones que exceden mi scope de CSS",
  "budget": { "spawns_used": 1, "spawns_remaining": 1 }
}
```

El Integrador **aprueba o rechaza**: si la capacidad ya la cubre un peer desplegado, rechaza e indica a quién preguntar.

**Coherencia clave**: el subagente-account de un subagente es el **mismo `id` de ficha** (no un clon). Hereda la ficha, el bus, el lease, y aparece en el roster.

---

## El pool idle

### Ciclo de vida de un agente

```
DEPLOYED ──► WORKING ──► (sus cards en DONE) ──► IDLE_AVAILABLE ──► (ayuda) ──► WORKING
                 │                                                              │
                 └──► BLOCKED ──► IDLE_AVAILABLE                                 │
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

1. **Atender un `HELP_REQUEST` dirigido** → triage → accept/decline
2. **Atender un broadcast** `to: ["*"]` → el primero que acepta **toma el lease** → los demás lo ven ocupado y se retiran
3. **Claim proactivo**: si hay work packages sin owner en el board y tu capability matchea el mejor → **reclamás**, avisás al Integrador, y lo hacés

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

**Double-claim**: el lease lo previene. Si dos agentes discuten por la misma card, el lease decide — no la discusión.

---

## Deadlock, starvation y agentes muertos

| Problema | Señal | Respuesta |
|---|---|---|
| **Deadlock** | dos cards se esperan mutuamente | Romper el ciclo: una cede, o partir una. Lo detecta el Integrador. |
| **Starvation** | una card espera demasiado | Priorizarla o avisar al Comandante. |
| **Doble claim** | dos agentes en la misma card | El lease lo bloquea. |
| **Agente muerto** | sin heartbeat en 3× `heartbeat_sec` | Su card se reasigna, su lease expira. |

---

## Arbitration de los coordinadores

```
Pregunta de un especialista
      │
      ├─ ¿es de scope/objetivo/prioridad?   → COMANDANTE
      ├─ ¿es de diseño/patrón/contrato?       → ARQUITECTO
      ├─ ¿es de flujo/lease/gate/calidad?     → INTEGRADOR
      │
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
