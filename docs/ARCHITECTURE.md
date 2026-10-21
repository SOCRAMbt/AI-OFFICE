# Arquitectura de AI-OFFICE

Este documento es el **porqué**. El README es el qué. Acá está la razón de cada decisión de diseño, y qué alternativas se descartaron.

---

## 1. Por qué un plugin y no una skill

La diferencia no es cosmética. Es de categoría.

| Capacidad | Skill (markdown) | Plugin (TypeScript) |
|---|---|---|
| Protocolo | El modelo «recuerda» seguirlo | Máquina de estados con transiciones válidas |
| Loop | El modelo decide si sigue | Hook `session.idle` → auto-resume |
| Estado | Markdown que el modelo edita | Código dueño del estado, escrituras atómicas |
| Gates | El modelo corre comandos e interpreta | El motor corre comandos, parsea exit codes |
| Escalamiento | Juicio del modelo | Contadores, 3-strikes determinístico |
| Rotación | Regla en markdown | Algoritmo de rotación en código |
| Recovery | El modelo lee `state.json` | Checkpoint/resume built-in |
| Costo | Autorreporte | Accounting real de invocaciones |
| Scope | Confianza | Enforcement en `tool.execute.before` |

**El dolor concreto del usuario**: «trabajen incansablemente hasta lograrlo». Con una skill, eso depende de que el modelo *quiera* seguir. Con un modelo rápido que dice «listo, terminado», para. Eso es exactamente «la IA no cumple».

El plugin invierte la dependencia: **el estado decide, no la confianza**.

---

## 2. La API de plugins de OpenCode — verificación

Antes de comprometerse al enfoque, se verificó la superficie real contra la versión instalada (`@opencode-ai/plugin@1.15.11`):

| Hook | Estado | Uso |
|---|---|---|
| `tool` | ✅ estable | 10 tools `oficina_*` |
| `event` (incluye `session.idle`) | ✅ estable | auto-continuación |
| `tool.execute.before` | ✅ estable | guard de scope |
| `experimental.chat.system.transform` | ✅ estable | inyección de estado |
| `experimental.session.compacting` | ✅ estable | estado post-compactación |
| `client.session.promptAsync` | ✅ estable | prompt sintético de auto-resume |
| `client.app.log` | ✅ estable | logging estructurado |

**Conclusión**: la API v1 de plugins está documentada y tipada. No es la superficie beta-inestable que el riesgo original suponía. El enfoque proceeded.

### Lo que la API NO da (y se resolvió por otro lado)

| Limitación | Resolución |
|---|---|
| Los subagentes no tienen memoria compartida | Bus append-only sobre disco |
| Los subagentes no se hablan | El bus es el único canal; los coordinadores son canales más |
| Los paths relativos resuelven contra el cwd de sesión | `paths.ts` resuelve `PROJECT_ROOT` por marcadores y usa paths absolutos |
| `grep` no existe en Windows | El escaneo de secretos se implementó en TypeScript |

---

## 3. El bus: por qué disco y no memoria

Los subagentes de OpenCode son **procesos aislados**. No comparten heap. Un bus en memoria sería un bus de una sola sesión: el Director publicaría un mensaje que nadie leería.

Disco resuelve las cuatro cosas que importan:

1. **Supervivencia** — el bus sobrevive al reinicio de la sesión.
2. **Compartibilidad** — el mismo bus sirve para otro harness (Claude Code, AgentTeams).
3. **Auditabilidad** — el log es el historial. Un message log append-only es gratis.
4. **Atomicidad** — `tmp + rename` garantiza que un lector nunca ve un JSON partido.

### Semántica elegida

- **Append-only**: los mensajes nunca se borran. Un `seq` monótono por canal da orden total sin locks.
- **`seq` derivado de los archivos existentes**, no de un contador en memoria: dos emisores concurrentes no pueden colisionar.
- **Ack en archivo separado**: el receptor escribe `inbox/<agentId>/<msgid>.ack`. El emisor puede preguntar «¿quién leyó?».
- **TTL**: vencido = invisible para lectores nuevos, pero sigue en el log. No se borra la evidencia.
- **Idempotency key**: derivada de `card + agente + motivo` con hash. Dos intentos del mismo pedido no generan storm.

### Alternativa descartada

**Broker en memoria (Redis, SQLite)**: agrega una dependencia, un proceso que mantener, y un modo de fallo nuevo. El bus sobre disco no necesita ninguno de esos, y el filesystem ya es transaccional-ish con `rename`.

---

## 4. La ficha: un solo schema

El riesgo de un sistema multi-agente es la **heterogeneidad**: 80 agentes de agency-agents, cada uno con un formato distinto, más roles fabricados. Si el bus, el matching de ayuda y la rotación tienen que conocer cada formato, el sistema se vuelve inmantenible.

La normalización a `Ficha` resuelve eso de raíz:

```ts
interface Ficha {
  id: string
  role: string
  displayName: string
  source: FichaSource          // agency-agents | factory
  capabilities: string[]
  tools: string[]
  scope: { mayTouch: string[]; forbidden: string[] }
  canDelegate: boolean
  delegateBudget: number
  peers: string[]
  mustNot: string[]
  onFinish: "idle-join" | "retire"
  escalateTo: CoordinatorId
}
```

A partir de ahí, el bus, el matching de capacidades, la rotación de owner y los tres coordinadores **no saben ni necesitan saber** de dónde salió el rol.

### Resolución: catálogo → factory

El catálogo de agency-agents se escanea en runtime: se parsea el frontmatter, se infieren capabilities de un mapa de dominio, y se matchea por overlap.

**Regla de cobertura 60%**: si el mejor match no cubre el 60% de las capabilities pedidas, se fabrica el rol. Porqué el umbral:

- Con umbral bajo (30%), un rol medio-tono entra al equipo. Un solo rol que hace su trabajo a medias arruina más de lo que aporta — y encima consume presupuesto.
- Con umbral alto (90%), casi todo se fabrica, y se pierde el valor de tener 80 agentes escritos con criterio.

60% es el punto donde un rol es genuinamente útil y donde la cobertura ya no es accidental.

**El router nunca fuerza un match.** Si una card pide `kubernetes` y nadie lo tiene, devuelve `null` + las capabilities faltantes. Fabricar un rol o pedir ayuda es la respuesta; asignar un developer a una card de infra es la respuesta mala.

---

## 5. Los invariantes duros

La diferencia entre «la skill dice que no hagas X» y «el motor no te deja hacer X».

```ts
export function assertInvariants(ctx: InvariantContext): void {
  // reviewer_neq_owner
  if (limits.reviewerNeqOwner && card.owner === card.reviewer) throw ...
  // gate_required_before_done
  if (limits.gateRequiredBeforeDone && card.state === "done" && gatesPassed !== true) throw ...
  // max_review_rejections, max_help_chain_hops, max_cards, max_agent_calls, max_spawns_total
}
```

`transitionCard` llama a `assertInvariants` antes de aplicar. La transición **no ocurre** si el invariante se viola. No es un warning: es una excepción.

### Por qué 3 rechazos y no 1

- **1 rechazo** → REWORK. Casi siempre es un detalle. Iterar es correcto.
- **2 rechazos** → REPLAN. Dos intentos fallidos con el mismo owner y el mismo approach sugieren que el approach está mal. El Director rehace la card y **rota el owner**: el problema puede ser el agente, no el código.
- **3 rechazos** → ESCALACIÓN. El costo de seguir iterando supera el valor. Se le presenta al usuario el objetivo, los 3 intentos, la causa raíz y 2-3 opciones con recomendación.

---

## 6. El hook de auto-continuación

El hook más importante y el que más riesgo de loop trae. Por eso tiene cuatro guardas:

| Guarda | Por qué |
|---|---|
| Solo si `status === "running"` | Una corrida pausada, bloqueada o entregada no se reanuda: eso es decisión del usuario |
| Solo si quedan cards sin `DONE` | Si no hay trabajo, reanudar es ruido |
| Tope de 25 auto-reanudaciones por sesión | Un loop infinito quema presupuesto y tokens |
| Cooldown de 1,5 s | Evita reanudar en loop cerrado por latencia |

### Por qué `promptAsync` y no `prompt`

`client.session.prompt()` es bloqueante: el hook esperaría a que el modelo termine, y como el modelo terminó (por eso estamos en `idle`), se genera un deadlock. `promptAsync` es fire-and-forget: el hook manda el prompt y devuelve.

---

## 7. El guard de scope

`tool.execute.before` intercepta `edit`, `write`, `patch`. Para cada uno:

1. Extrae el path del argumento (soportando `filePath`, `path` y el formato de `patch`).
2. Lo relativiza contra el `PROJECT_ROOT`.
3. Si está bajo `.oficina/` → permitido (es el canal de la oficina).
4. Si matchea `forbidden` → **rechazado**, sin excepción.
5. Si no matchea `may_touch` → **rechazado**.

El mensaje de error le dice al modelo qué hacer, no solo qué no hacer. Un guard que dice «no» sin decir «qué sí» produce intentos a ciegas.

### El bug del orden de reemplazos

El glob→regex tiene un orden no trivial. El patrón `**/*.env` se convierte en `(?:.*/)?[^/]*\.env`, y ese `?` insertado **tiene que convertirse en `.` antes**, no después — si no, `(?:.*/)?` se transforma en `(.:.*/).` y el glob deja de matchear. Los tests lo cazaron; el comentario en el código lo documenta.

---

## 8. Los gates

De la skill `verification-loop`. Se ejecutan de verdad.

### Honestidad del gate

Un gate que dice «debería compilar» no es un gate. Las reglas:

- Nunca `PASS` en una fase no ejecutada → `NOT RUN`, y `NOT RUN` hace fallar el gate.
- Nunca output inventado. Si un comando no da salida, se pega `(sin salida)`.
- `N/A` con motivo explícito. `N/A` silencioso es una fase skipeada disfrazada.
- Una fase aplicable en `FAIL` = gate `FAIL`. No se promedia ni se pondera.

### La fase de secretos

Dos decisiones no obvias:

**No usa `grep`.** Shelling out a `grep` hace que el gate falle en Windows por razones equivocadas — y un gate que falla siempre es un gate que nadie lee. El escaneo se implementó en TypeScript: portable, sin dependency opcional, y con control del ruido.

**Redacta el valor.** El output dice `src/auth.js:12  credenciales asignadas  API_K***...EY`. Un log de gate que imprime la credencial completa la acaba de filtrar — y los logs de gate van a archivos, a CI, y a transcripts de sesión.

### Detectar tests que no corrieron

Un gate que pasa con cero tests es un gate verde vacío. `testsActuallyRan` parsea el output en ambos órdenes (`5 tests` y `tests 5`) y devuelve `false` si no encuentra un conteo.

---

## 9. Los 3 coordinadores

Un solo coordinador es cuello de botella y punto único de falla: si el Director está ocupada con una decisión técnica, nadie prioriza.

Partición por dominio:

| | Dominio | Por qué es un corte natural |
|---|---|---|
| Comandante | scope, objetivo, prioridad | Es el único que puede decir «esto está fuera del objetivo» |
| Arquitecto | cross-cutting | Es el único que puede decir «esto contradice lo que hizo otra card» |
| Integrador | flujo, leases, gates | Es el único que puede decir «esta task ya la tiene otro» |

**Arbitraje**: cada pregunta tiene un dueño por tipo. Las preguntas al coordinador van **por el bus**, no interrumpen al humano. Al usuario solo llega lo que ningún coordinador puede resolver: criterio de producto, conflicto entre dominios sin resolución, o presupuesto agotado.

---

## 10. El pool idle

El request original: «ayudar al resto cuando terminaron su objetivo para lograr todo más rápido».

Tres modos, en orden de preferencia:

1. **Ayuda dirigida** — un `HELP_REQUEST` con `to: ["e-x"]`. El receptor hace triage.
2. **Broadcast** — `to: ["*"]`. El primero que acepta toma el lease; los demás ven el lease ocupado y se retiran. El lease, no el chat, resuelve la carrera.
3. **Claim proactivo** — si hay cards sin owner y tu capability matchea, la reclamás.

El modo 3 es el que convierte la oficina de «N tareas en paralelo» a «N agentes que se acomodan solos según la carga».

---

## 11. Migración v1 → v2

OFICINA v1 (la skill) escribía `state.json` con snake_case, `scope` como array y `rejections` como array. v2 usa camelCase, `scope` como objeto y `rejections` como número.

`migrateState()` detecta el formato viejo por la ausencia de `budget.maxCards` y convierte. **No destructivo**: objetivo, cards, resultados, gates y decisiones se conservan. Las cards en formato nuevo se pasan sin tocar.

Detalle no obvio: la migración se persiste en disco la primera vez, para no migrar en cada lectura.

---

## 12. Decisiones rechazadas

| Decisión | Por qué no |
|---|---|
| Broker en memoria (Redis/SQLite) | Dependency + proceso + modo de fallo nuevo para algo que el filesystem resuelve con `rename` |
| Base de datos para el estado | Un `state.json` con escrituras atómicas es auditable con `cat` y versionable con git |
| Un solo coordinador | Cuello de botella y punto único de falla |
| Delegar el pool idle a un scheduler externo | Los subagentes son efímeros; un scheduler externo no sabe si el agente sigue vivo |
| Shelling out a `grep` para el gate de secretos | No existe en Windows; el gate fallaría por la razón equivocada |
| `transition: all` en cualquier UI | Anima `box-shadow` en repaint, no en compositor |
| Auto-approve cuando los tests pasan | Los tests no miden correctitud, seguridad ni alcance. El gate técnico es uno de dos: el security gate también tiene que pasar |
