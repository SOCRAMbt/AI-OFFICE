# Arquitectura de AI-OFFICE

Este documento es el **porqu├®**. El README es el qu├®. Ac├í est├í la raz├│n de cada decisi├│n de dise├▒o, y qu├® alternativas se descartaron.

---

## 1. Por qu├® un plugin y no una skill

La diferencia no es cosm├®tica. Es de categor├¡a.

| Capacidad | Skill (markdown) | Plugin (TypeScript) |
|---|---|---|
| Protocolo | El modelo ┬½recuerda┬╗ seguirlo | M├íquina de estados con transiciones v├ílidas |
| Loop | El modelo decide si sigue | Hook `session.idle` ÔåÆ auto-resume |
| Estado | Markdown que el modelo edita | C├│digo due├▒o del estado, escrituras at├│micas |
| Gates | El modelo corre comandos e interpreta | El motor corre comandos, parsea exit codes |
| Escalamiento | Juicio del modelo | Contadores, 3-strikes determin├¡stico |
| Rotaci├│n | Regla en markdown | Algoritmo de rotaci├│n en c├│digo |
| Recovery | El modelo lee `state.json` | Checkpoint/resume built-in |
| Costo | Autorreporte | Accounting real de invocaciones |
| Scope | Confianza | Enforcement en `tool.execute.before` |

**El dolor concreto del usuario**: ┬½trabajen incansablemente hasta lograrlo┬╗. Con una skill, eso depende de que el modelo *quiera* seguir. Con un modelo r├ípido que dice ┬½listo, terminado┬╗, para. Eso es exactamente ┬½la IA no cumple┬╗.

El plugin invierte la dependencia: **el estado decide, no la confianza**.

---

## 2. La API de plugins de OpenCode ÔÇö verificaci├│n

Antes de comprometerse al enfoque, se verific├│ la superficie real contra la versi├│n instalada (`@opencode-ai/plugin@1.15.11`):

| Hook | Estado | Uso |
|---|---|---|
| `tool` | Ô£à estable | 10 tools `oficina_*` |
| `event` (incluye `session.idle`) | Ô£à estable | auto-continuaci├│n |
| `tool.execute.before` | Ô£à estable | guard de scope |
| `experimental.chat.system.transform` | Ô£à estable | inyecci├│n de estado |
| `experimental.session.compacting` | Ô£à estable | estado post-compactaci├│n |
| `client.session.promptAsync` | Ô£à estable | prompt sint├®tico de auto-resume |
| `client.app.log` | Ô£à estable | logging estructurado |

**Conclusi├│n**: la API v1 de plugins est├í documentada y tipada. No es la superficie beta-inestable que el riesgo original supon├¡a. El enfoque proceeded.

### Lo que la API NO da (y se resolvi├│ por otro lado)

| Limitaci├│n | Resoluci├│n |
|---|---|
| Los subagentes no tienen memoria compartida | Bus append-only sobre disco |
| Los subagentes no se hablan | El bus es el ├║nico canal; los coordinadores son canales m├ís |
| Los paths relativos resuelven contra el cwd de sesi├│n | `paths.ts` resuelve `PROJECT_ROOT` por marcadores y usa paths absolutos |
| `grep` no existe en Windows | El escaneo de secretos se implement├│ en TypeScript |

---

## 3. El bus: por qu├® disco y no memoria

Los subagentes de OpenCode son **procesos aislados**. No comparten heap. Un bus en memoria ser├¡a un bus de una sola sesi├│n: el Director publicar├¡a un mensaje que nadie leer├¡a.

Disco resuelve las cuatro cosas que importan:

1. **Supervivencia** ÔÇö el bus sobrevive al reinicio de la sesi├│n.
2. **Compartibilidad** ÔÇö el mismo bus sirve para otro harness (Claude Code, AgentTeams).
3. **Auditabilidad** ÔÇö el log es el historial. Un message log append-only es gratis.
4. **Atomicidad** ÔÇö `tmp + rename` garantiza que un lector nunca ve un JSON partido.

### Sem├íntica elegida

- **Append-only**: los mensajes nunca se borran. Un `seq` mon├│tono por canal da orden total sin locks.
- **`seq` derivado de los archivos existentes**, no de un contador en memoria: dos emisores concurrentes no pueden colisionar.
- **Ack en archivo separado**: el receptor escribe `inbox/<agentId>/<msgid>.ack`. El emisor puede preguntar ┬½┬┐qui├®n ley├│?┬╗.
- **TTL**: vencido = invisible para lectores nuevos, pero sigue en el log. No se borra la evidencia.
- **Idempotency key**: derivada de `card + agente + motivo` con hash. Dos intentos del mismo pedido no generan storm.

### Alternativa descartada

**Broker en memoria (Redis, SQLite)**: agrega una dependencia, un proceso que mantener, y un modo de fallo nuevo. El bus sobre disco no necesita ninguno de esos, y el filesystem ya es transaccional-ish con `rename`.

---

## 4. La ficha: un solo schema

El riesgo de un sistema multi-agente es la **heterogeneidad**: 80 agentes de agency-agents, cada uno con un formato distinto, m├ís roles fabricados. Si el bus, el matching de ayuda y la rotaci├│n tienen que conocer cada formato, el sistema se vuelve inmantenible.

La normalizaci├│n a `Ficha` resuelve eso de ra├¡z:

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

A partir de ah├¡, el bus, el matching de capacidades, la rotaci├│n de owner y los tres coordinadores **no saben ni necesitan saber** de d├│nde sali├│ el rol.

### Resoluci├│n: cat├ílogo ÔåÆ factory

El cat├ílogo de agency-agents se escanea en runtime: se parsea el frontmatter, se infieren capabilities de un mapa de dominio, y se matchea por overlap.

**Regla de cobertura 60%**: si el mejor match no cubre el 60% de las capabilities pedidas, se fabrica el rol. Porqu├® el umbral:

- Con umbral bajo (30%), un rol medio-tono entra al equipo. Un solo rol que hace su trabajo a medias arruina m├ís de lo que aporta ÔÇö y encima consume presupuesto.
- Con umbral alto (90%), casi todo se fabrica, y se pierde el valor de tener 80 agentes escritos con criterio.

60% es el punto donde un rol es genuinamente ├║til y donde la cobertura ya no es accidental.

**El router nunca fuerza un match.** Si una card pide `kubernetes` y nadie lo tiene, devuelve `null` + las capabilities faltantes. Fabricar un rol o pedir ayuda es la respuesta; asignar un developer a una card de infra es la respuesta mala.

---

## 5. Los invariantes duros

La diferencia entre ┬½la skill dice que no hagas X┬╗ y ┬½el motor no te deja hacer X┬╗.

```ts
export function assertInvariants(ctx: InvariantContext): void {
  // reviewer_neq_owner
  if (limits.reviewerNeqOwner && card.owner === card.reviewer) throw ...
  // gate_required_before_done
  if (limits.gateRequiredBeforeDone && card.state === "done" && gatesPassed !== true) throw ...
  // max_review_rejections, max_help_chain_hops, max_cards, max_agent_calls, max_spawns_total
}
```

`transitionCard` llama a `assertInvariants` antes de aplicar. La transici├│n **no ocurre** si el invariante se viola. No es un warning: es una excepci├│n.

### Por qu├® 3 rechazos y no 1

- **1 rechazo** ÔåÆ REWORK. Casi siempre es un detalle. Iterar es correcto.
- **2 rechazos** ÔåÆ REPLAN. Dos intentos fallidos con el mismo owner y el mismo approach sugieren que el approach est├í mal. El Director rehace la card y **rota el owner**: el problema puede ser el agente, no el c├│digo.
- **3 rechazos** ÔåÆ ESCALACI├ôN. El costo de seguir iterando supera el valor. Se le presenta al usuario el objetivo, los 3 intentos, la causa ra├¡z y 2-3 opciones con recomendaci├│n.

---

## 6. El hook de auto-continuaci├│n

El hook m├ís importante y el que m├ís riesgo de loop trae. Por eso tiene cuatro guardas:

| Guarda | Por qu├® |
|---|---|
| Solo si `status === "running"` | Una corrida pausada, bloqueada o entregada no se reanuda: eso es decisi├│n del usuario |
| Solo si quedan cards sin `DONE` | Si no hay trabajo, reanudar es ruido |
| Tope de 25 auto-reanudaciones por sesi├│n | Un loop infinito quema presupuesto y tokens |
| Cooldown de 1,5 s | Evita reanudar en loop cerrado por latencia |

### Por qu├® `promptAsync` y no `prompt`

`client.session.prompt()` es bloqueante: el hook esperar├¡a a que el modelo termine, y como el modelo termin├│ (por eso estamos en `idle`), se genera un deadlock. `promptAsync` es fire-and-forget: el hook manda el prompt y devuelve.

---

## 7. El guard de scope

`tool.execute.before` intercepta `edit`, `write`, `patch`. Para cada uno:

1. Extrae el path del argumento (soportando `filePath`, `path` y el formato de `patch`).
2. Lo relativiza contra el `PROJECT_ROOT`.
3. Si est├í bajo `.oficina/` ÔåÆ permitido (es el canal de la oficina).
4. Si matchea `forbidden` ÔåÆ **rechazado**, sin excepci├│n.
5. Si no matchea `may_touch` ÔåÆ **rechazado**.

El mensaje de error le dice al modelo qu├® hacer, no solo qu├® no hacer. Un guard que dice ┬½no┬╗ sin decir ┬½qu├® s├¡┬╗ produce intentos a ciegas.

### El bug del orden de reemplazos

El globÔåÆregex tiene un orden no trivial. El patr├│n `**/*.env` se convierte en `(?:.*/)?[^/]*\.env`, y ese `?` insertado **tiene que convertirse en `.` antes**, no despu├®s ÔÇö si no, `(?:.*/)?` se transforma en `(.:.*/).` y el glob deja de matchear. Los tests lo cazaron; el comentario en el c├│digo lo documenta.

---

## 8. Los gates

De la skill `verification-loop`. Se ejecutan de verdad.

### Honestidad del gate

Un gate que dice ┬½deber├¡a compilar┬╗ no es un gate. Las reglas:

- Nunca `PASS` en una fase no ejecutada ÔåÆ `NOT RUN`, y `NOT RUN` hace fallar el gate.
- Nunca output inventado. Si un comando no da salida, se pega `(sin salida)`.
- `N/A` con motivo expl├¡cito. `N/A` silencioso es una fase skipeada disfrazada.
- Una fase aplicable en `FAIL` = gate `FAIL`. No se promedia ni se pondera.

### La fase de secretos

Dos decisiones no obvias:

**No usa `grep`.** Shelling out a `grep` hace que el gate falle en Windows por razones equivocadas ÔÇö y un gate que falla siempre es un gate que nadie lee. El escaneo se implement├│ en TypeScript: portable, sin dependency opcional, y con control del ruido.

**Redacta el valor.** El output dice `src/auth.js:12  credenciales asignadas  API_K***...EY`. Un log de gate que imprime la credencial completa la acaba de filtrar ÔÇö y los logs de gate van a archivos, a CI, y a transcripts de sesi├│n.

### Detectar tests que no corrieron

Un gate que pasa con cero tests es un gate verde vac├¡o. `testsActuallyRan` parsea el output en ambos ├│rdenes (`5 tests` y `tests 5`) y devuelve `false` si no encuentra un conteo.

---

## 9. Los 3 coordinadores

Un solo coordinador es cuello de botella y punto ├║nico de falla: si el Director est├í ocupada con una decisi├│n t├®cnica, nadie prioriza.

Partici├│n por dominio:

| | Dominio | Por qu├® es un corte natural |
|---|---|---|
| Comandante | scope, objetivo, prioridad | Es el ├║nico que puede decir ┬½esto est├í fuera del objetivo┬╗ |
| Arquitecto | cross-cutting | Es el ├║nico que puede decir ┬½esto contradice lo que hizo otra card┬╗ |
| Integrador | flujo, leases, gates | Es el ├║nico que puede decir ┬½esta task ya la tiene otro┬╗ |

**Arbitraje**: cada pregunta tiene un due├▒o por tipo. Las preguntas al coordinador van **por el bus**, no interrumpen al humano. Al usuario solo llega lo que ning├║n coordinador puede resolver: criterio de producto, conflicto entre dominios sin resoluci├│n, o presupuesto agotado.

---

## 10. El pool idle

El request original: ┬½ayudar al resto cuando terminaron su objetivo para lograr todo m├ís r├ípido┬╗.

Tres modos, en orden de preferencia:

1. **Ayuda dirigida** ÔÇö un `HELP_REQUEST` con `to: ["e-x"]`. El receptor hace triage.
2. **Broadcast** ÔÇö `to: ["*"]`. El primero que acepta toma el lease; los dem├ís ven el lease ocupado y se retiran. El lease, no el chat, resuelve la carrera.
3. **Claim proactivo** ÔÇö si hay cards sin owner y tu capability matchea, la reclam├ís.

El modo 3 es el que convierte la oficina de ┬½N tareas en paralelo┬╗ a ┬½N agentes que se acomodan solos seg├║n la carga┬╗.

---

## 11. Migraci├│n v1 ÔåÆ v2

OFICINA v1 (la skill) escrib├¡a `state.json` con snake_case, `scope` como array y `rejections` como array. v2 usa camelCase, `scope` como objeto y `rejections` como n├║mero.

`migrateState()` detecta el formato viejo por la ausencia de `budget.maxCards` y convierte. **No destructivo**: objetivo, cards, resultados, gates y decisiones se conservan. Las cards en formato nuevo se pasan sin tocar.

Detalle no obvio: la migraci├│n se persiste en disco la primera vez, para no migrar en cada lectura.

---

## 12. Decisiones rechazadas

| Decisi├│n | Por qu├® no |
|---|---|
| Broker en memoria (Redis/SQLite) | Dependency + proceso + modo de fallo nuevo para algo que el filesystem resuelve con `rename` |
| Base de datos para el estado | Un `state.json` con escrituras at├│micas es auditable con `cat` y versionable con git |
| Un solo coordinador | Cuello de botella y punto ├║nico de falla |
| Delegar el pool idle a un scheduler externo | Los subagentes son ef├¡meros; un scheduler externo no sabe si el agente sigue vivo |
| Shelling out a `grep` para el gate de secretos | No existe en Windows; el gate fallar├¡a por la raz├│n equivocada |
| `transition: all` en cualquier UI | Anima `box-shadow` en repaint, no en compositor |
| Auto-approve cuando los tests pasan | Los tests no miden correctitud, seguridad ni alcance. El gate t├®cnico es uno de dos: el security gate tambi├®n tiene que pasar |

---

## 10. Evoluci¾n v3.2.0: Circuit Breaker, Traits, Memoria y Modo lite

### 10.1 Circuit Breaker y BLOCKED_ESCALATED

El motor distinguÝa rework/replan/escalate pero no veÝa el patr¾n"tres fallos idÚnticos seguidos". v3.2.0 agrega core/circuitBreaker.ts:

- fingerprint = sha256(mensaje normalizado CASO-INSENSITIVE, paths absolutas stripadas, strings literales, n·meros y hashes normalizados + exit code).
- 3 fingerprints idÚnticos consecutivos ¾ 5 intentos totales ? locked_escalated.
- El lease se libera at¾micamente (LeaseStore.remove, bajo withWxLock) y la card queda terminal: selectNextCard no la elige; el DAG contin·a para las demßs.
- Se escribe rtifacts/<id>/blocked.md con la causa raÝz + historial completo de fingerprints.

### 10.2 Matching = 0.70 y catßlogo vivo

DEFAULT_LIMITS.minCatalogCoverage = 0.7. El catßlogo vivio sigue 258 roles; por debajo del umbral, createPersistentAgent fabrica uno con metadatos de origen obligatorios:

`yaml
generated_by: factory
created_for_task: <tÝtulo de la card>
stack_tags: <capabilities requeridas>
`

### 10.3 Traits: entorno inyectado, no al azar

core/traits.ts audita el repo (deps de package.json, 	sconfig.json strict, lockfiles, process.platform, docs/) y carga solo los traits relevantes desde 	raits/ (packado con el paquete y preferido desde el repo). El dispatch inyecta una secci¾n ## Active Environment & Stack Traits antes del briefing del agente.

### 10.4 Escrituras at¾micas NTFS/POSIX

writeAtomic ahora: tmp ·nico <target>.<pid>.<random>.tmp en el mismo directorio + rename con reintentos exponenciales ante EPERM/EBUSY (5 intentos, 20-320ms). llocateSeq y leases usan locks por archivo s.open(wx) con TTL (breaker de locks vencidos) en vez de solo mkdir.

### 10.5 Memoria epis¾dica

core/memory.ts: .oficina/memory.md, tope 150 lÝneas, FIFO. Registra fallos de gate (fase, exit code, 160 chars de output), fingerprints de circuitos disparados y cierres de card. El dispatch inyecta un resumen de 6-8 lÝneas en cada briefing y /api/memory la muestra en el dashboard.

### 10.6 Modo CÚlula (/oficina lite)

core/triage.ts: degradaci¾n determinÝstica a Modo CÚlula cuando el objetivo cabe en 1 card ? =140 chars ? =3 criterios ? sin palabras de refactor/migraci¾n/arquitectura. En lite, dispatchOffice solo materializa el primario de la primera card ejecutable (sin complementos peer mesh) y expectativa owner ? reviewer sigue siendo invariante. El modo persiste en state.mode; el usuario puede forzar Full con --full.
