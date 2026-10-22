---
name: oficina
description: Oficina de Agents que trabaja un objetivo de principio a fin sin instrucciones repetidas. Con el plugin instalado, la oficina es una máquina de estados con hooks de enforcement: el Director descompone, el dispatch crea los subagentes buscándolos en el catálogo real de agency-agents, coordina por un bus de mensajes en disco, permite pedir ayuda y delegar entre pares, y un hook de auto-continuación sigue trabajando cuando el modelo dice "terminé". Una card no se cierra sin gates en verde Y sin evidencia para cada criterio de aceptación. Sin el plugin, el mismo protocolo funciona con el flujo de artefactos en markdown. Úsala cuando el usuario da un objetivo, feature, bug o refactor y quiere que un equipo de agentes lo ejecute completo, se auto-verifique y entregue evidencia, en vez de que el assistant lo haga todo lineal.
---

# OFICINA — Oficina de Agents

Un objetivo entra por la puerta. La oficina lo ejecuta, se auto-verifica, y entrega evidencia.

## Dos motores, un solo protocolo

| | **Con plugin** (motor duro) | **Sin plugin** (fallback) |
|---|---|---|
| Estado | Máquina de estados en TypeScript | `state.json` markdown + JSON |
| Equipo | `oficina_dispatch` crea los subagentes | El modelo los crea a mano |
| Gates | 7 comandos reales, exit codes interpretados por código | El modelo corre los comandos y pega la salida |
| Enforcement | 3 capas: guard, `permission.ask`, tripwire | Disciplina del prompt |
| Cierre | Gates **+ evidencia** de cada requisito | Solo gates |
| Loop | Hook `session.idle` → la oficina sigue sola | El modelo decide si sigue |
| Invariantes | `assertInvariants` en código | Regla dura en el prompt |
| Costo | Ledger de tokens y USD en tiempo real | No se mide |
| Comunicación | Bus de mensajes con TTL/ack/idempotencia | Artefactos en disco, unidireccional |

**Preferí el plugin.** Si las tools `oficina_*` están disponibles, usá el motor duro: los invariantes dejan de ser sugerencias.

El protocolo de este documento sirve para los dos. Las secciones marcadas **[plugin]** solo aplican con el plugin instalado.

---

## Por qué existe

| Falla | Cómo la resuelve OFICINA |
|---|---|
| El usuario tiene que dar todas las instrucciones | El **Comandante** descompone solo. El usuario da un objetivo y basta. |
| El agent "no cumple" lo que se dice | Cada card tiene **acceptance criteria** explícitos y un **gate** que se ejecuta, no se opina. |
| Los subagentes se desaprovechan | **Dispatch** que resuelve el rol desde el catálogo real de agency-agents y panel con complementos. |
| Hay que repetir el contexto | **Ledger de contexto** en disco (`.oficina/context.md`) + handoff por artefactos. |
| Los agents no se coordinan ni se ayudan | **Bus de mensajes** + **mesa** compartida: cada uno sabe quién trabaja en qué. |
| Son monotonos | **Revisor distinto del autor** + rotación de owner y de dimensión. |
| Nadie los orquesta | **3 coordinadores** con dominios particionados y arbitraje explícito. |
| La IA dice "terminé" sin terminar | **[plugin]** Hook de auto-continuación: el estado decide, no la confianza. |
| Compila pero no cumple | **Grafo de evidencia**: cada criterio de aceptación necesita respaldo o la card no se cierra. |
| Se gasta una fortuna sin avisar | **Ledger de costo** con presupuestos y **freno de emergencia**. |

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

## El flujo completo: de un objetivo a un equipo

Este es el flujo. Seguílo en orden.

```
   EL USUARIO DA UN OBJETIVO
            |
            v
  +--------------------------------+
  | 1. PLAN      (Comandante)     |  → cards con scope, acceptance, gate, deps
  |    oficina_plan               |
  +--------------------------------+
            |
            v
  +--------------------------------+
  | 2. DISPATCH  (Integrador)     |  → RESUELVE LOS ROLES y ARRANCA LOS AGENTES
  |    oficina_dispatch            |    busca en agency-agents, materializa
  |                               |    .opencode/agents/, spawna en paralelo
  +--------------------------------+
            |
            v
  +--------------------------------+
  | 3. MESA      (todos)          |  → quién trabaja en qué, quién está libre,
  |    oficina_mesa (view)         |    qué ayuda espera respuesta
  +--------------------------------+
            |
            v
  +--------------------------------+
  | 4. TRABAJO   (Owner)          |  → oficina_assign + handoff.md + evidence.md
  +--------------------------------+
            |
            v
  +--------------------------------+
  | 5. AUTO-REVIEW  (Crítico)     |  → revisor ≠ owner
  |    oficina_review              |
  +--------------------------------+
            | APROBADO
            v
  +--------------------------------+
  | 6. GATES + EVIDENCIA          |  → oficina_gate corre los 7 gates
  |    oficina_gate                |    + verifica el grafo de requisitos
  +--------------------------------+
            | PASA
            v
  +--------------------------------+
  | 7. DONE                       |  → la card queda done, el agente se libera
  +--------------------------------+
            |
            v
      el agente queda LIBRE y ofrece ayuda
      → puede reclamar la siguiente card
```

**[plugin] El paso 2 es el que hace que esto sea una oficina y no un chatbot.** `oficina_dispatch` es lo único que arma el equipo: resuelve el rol de cada card, materializa el agente con su briefing de 10 secciones, y lo arranca con `session.prompt`.

---

## Las 16 tools

| Tool | Qué hace |
|---|---|
| `oficina_plan` | Guarda el plan de cards. El modelo propone; el motor valida y rutea owner/reviewer |
| **`oficina_dispatch`** | **Arma el equipo**: resuelve los roles, materializa los agentes y los arranca en paralelo |
| **`oficina_mesa`** | **La mesa**: quién trabaja en qué, quién está libre, qué ayuda espera respuesta, qué cards no tienen owner |
| `oficina_board` | Estado: cards, owners, agentes libres, agentes sin heartbeat, presupuesto |
| `oficina_assign` | Toma trabajo — la próxima card, o claim proactivo de una puntual |
| `oficina_submit` | Entrega handoff + evidencia real → pasa a `REVIEW` |
| `oficina_review` | Registra el veredicto. El motor **rechaza** que el owner se auto-revise |
| `oficina_gate` | Corre los 7 gates. Exit codes reales, no opinión |
| **`oficina_evidence`** | **El grafo de requisitos**: qué evidencia falta para poder cerrar |
| **`oficina_cost`** | **Tokens y USD** por card, agente y fase, con los presupuestos |
| **`oficina_stop`** | **Freno de emergencia**: detiene o reanuda la corrida |
| `oficina_bus` | Bus: `send` · `receive` · `ack` · `help` |
| `oficina_spawn` | Pide desplegar un agente. El Integrador aprueba o rechaza |
| `oficina_escalate` | Escala al usuario con 2-3 opciones concretas y recomendación |
| `oficina_ficha` | Resuelve un rol a ficha y **despliega** el agente con su briefing |
| `oficina_brief` | Muestra el briefing y el **panel de roles** sin desplegar: decisión del Comandante |

---

## El dispatch: cómo se arma el equipo

**[plugin]** `oficina_dispatch` hace, por cada card sin owner:

1. **Busca el rol** en el catálogo de agency-agents con el matcher.
2. **Calcula el panel**: primario + complementos (los que cubren lo que el primario NO cubre).
3. **Materializa el agente** en `.opencode/agents/oficina-<slug>.md` con su briefing de 10 secciones y su prompt de especialidad. Queda versionado con el repo.
4. **Lo arranca** en paralelo con `session.prompt` (parte `subtask`).

El resultado es que **los subagentes heredan el scope de su card** y trabajan con el contexto completo desde el primer token.

**Si algo no matchea bien**, no fuerces: `oficina_brief` muestra las alternativas sin desplegar, y `oficina_ficha` despliega un rol puntual.

---

## La mesa: cómo se coordinan

**[plugin]** `oficina_mesa` es la vista compartida. Sin ella, el peer mesh es un bus al que nadie mira.

- **view** — quién trabaja en qué, quién está libre, qué cards no tienen owner, qué ayuda espera respuesta, qué preguntas están abiertas.
- **read** — tus mensajes.
- **respond** — contestar un pedido de ayuda.
- **offer** — ofrecer ayuda.
- **claim** — reclamar una card libre.

**Consultá la mesa antes de**: reclamar trabajo, pedir ayuda (para saber a quién), y cuando te asignen una card.

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

## Resolver roles: catálogo → factory → panel

**[plugin]** `oficina_brief` muestra el panel sin desplegar; `oficina_ficha` además despliega el agente con su briefing.

**1. Catálogo primero.** El repo de agency-agents tiene **258 agentes resolubles en 18 divisiones** (la cifra vive en `docs/catalog-facts.json`, con su commit de origen, y el CI verifica que no se desactualice). La especialidad real de cada uno está en el **cuerpo** (Core Mission, Technical Deliverables, Advanced Capabilities) y en la `description` y el `vibe` del frontmatter, no solo en el nombre.

El matcher pondera por señal: **identidad** (slug + nombre + `description` + `vibe`) 35%, **misión literal** 28%, **misión conceptual** 18%, **división** 10%, **cuerpo** 5%. Además usa **sinónimos por capability** (`"e2e"` es `"end-to-end"`, pero `"e2e"` NO es `"playwright"`), **lematización** (`"testing"` ~ `"test"`) y **focus de misión** (qué fracción de las misiones del agente es del dominio: distingue a un especialista de un generalista que menciona la tool de pasada).

**Medido, no supuesto:** el matcher completo acierta el primer rol en el **71%** de 21 tareas de referencia, contra el **48%** de la versión anterior. El benchmark es `npm run bench:selection`.

**2. Factory si la cobertura es < 60%.** El rol fabricado emite la **misma estructura de 10 secciones** que el catálogo, con las capabilities, el scope, el objetivo de la corrida y los modos de fallo del rol. Un rol fabricado con contexto es usable; uno genérico no.

**3. Panel, no un solo agente.** Un objetivo casi nunca es de un solo dominio. El panel devuelve:

- **primario** — el mejor match. Se lleva la card.
- **complementos** — los que cubren lo que el primario NO cubre. Son sus pares en el bus.
- **sin cubrir** — lo que nadie cubre. Señal de que la card debería partirse en dos.

**Nunca fuerces un mal match.** Si nadie cubre una capacidad, se fabrica el rol o se pide ayuda. Un rol medio-tonto en el equipo arruina más de lo que aporta.

**Sin plugin**: la tabla de `reference/roles.md`.

---

## El briefing: qué recibe cada agente

**[plugin]** Todo agente desplegado recibe un briefing de **10 secciones en orden fijo** —de lo más estable a lo más cambiante— y **4 artefactos** en `.oficina/fichas/<agentId>/`:

| Artefacto | Contenido |
|---|---|
| `ficha.md` | Quién sos: rol, especialidad, origen, vibe |
| `misiones.md` | Tu misión · lo que ya sabés · lo que NO sabés |
| `protocolo.md` | Cómo trabajás · tu territorio · qué se espera · límites · éxito |
| `bus.md` | Tu canal: dónde, formato, TTLs, cómo acusar recibo |

**El agente no arranca sin `misiones.md`. Nunca.**

**Mínimo**: las 10 secciones son requeridas. Si alguna queda vacía, el briefing se marca `INCOMPLETO` y el agente no se despliega. Un briefing a medio llenar produce un agente a medio informado, que es peor que no tener agente.

La sección *"lo que ya sabés"* se alimenta del **ledger** (`.oficina/context.md`): decisiones, restricciones, piezas construidas y trampas. Es lo que evita repetir lo ya decidido.

Detalle completo en `reference/mesh.md`.

---

## El scope: una restricción, no una instrucción

**[plugin]** Cuando un agente intenta escribir fuera del scope de su card, la operación **se rechaza**. No es una sugerencia.

- La ruta se **resuelve** (absoluta → normalizada → symlinks resueltos) y recién ahí se decide.
- `..`, paths absolutos y symlinks que apuntan afuera están cerrados.
- Los archivos sensibles (`.env`, `.npmrc`, `.git/**`, claves) **nunca** son escribibles.
- Los **subagentes heredan el scope**: delegar no es un escalón para salirse.

Si el archivo es necesario: pedí por el bus que se amplíe el scope. No lo toques por tu cuenta.

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

## Verificar el resultado, no solo el proceso

**[plugin]** Siete gates. Los seis técnicos dicen que **el código está sano**; el séptimo dice que **el objetivo está cumplido**:

| # | Fase | Qué comprueba |
|---|---|---|
| 1 | Build | Compila |
| 2 | Type check | Tipos |
| 3 | Lint | Estilo |
| 4 | Tests | Comportamiento |
| 5 | Secretos | No hay credenciales en el árbol |
| 6 | Diff | Qué cambió |
| 7 | **Requisitos** | **Cada criterio de aceptación tiene evidencia** |

**Reglas de honestidad** — no negociables:

- Nunca `PASS` en una fase que no se corrió → `NOT RUN` y eso hace fallar el gate
- Nunca output inventado
- `N/A` siempre con motivo explícito
- Una fase aplicable en `FAIL` = gate `FAIL`. No se promedia
- El escaneo de secretos corre **en código**, no shelling out a `grep` (que no existe en Windows), y **redacta** el valor: un log de gate que imprime la credencial completa la acaba de filtrar

### El grafo de evidencia

**[plugin]** `oficina_evidence` muestra, por card, qué criterio de aceptación tiene evidencia y cuál no.

Cada criterio de aceptación es un **requisito**. Cada evidencia —un artefacto, un test, un gate, una inspección, una auditoría— se vincula a un requisito con un **nivel**:

| Nivel | Qué es |
|---|---|
| 1 | Estático (un gate) |
| 2 | Comportamiento (un artefacto, un test) |
| 3 | Validación de requisitos (inspección) |
| 4 | Auditoría independiente (revisor ≠ owner) |

**Una card NO se cierra sin evidencia suficiente de cada requisito obligatorio.** Los gates en verde no alcanzan: un proyecto puede compilar, pasar todos sus tests y tener la autenticación mal porque ningún test contemplaba ese escenario.

Cuando entregues, registrá la evidencia: `oficina_evidence` con `action: "add"`, diciendo QUÉ evidencia respalda QUÉ criterio.

---

## El costo y el freno

**[plugin]** `oficina_cost` muestra tokens y USD por card, agente y fase, con los presupuestos y cuánto falta para cada límite. El costo real lo reporta el motor; no se estima.

Si la corrida se está descontrolando: `oficina_stop` con `action: "halt"`. La oficina deja de avanzar — no reanuda, no despacha, no gasta. Se reanuda con `action: "resume"`.

---

## Reglas de ejecución

1. **Nunca marques DONE sin los gates en verde.** Una card sin `gates.md` en PASS no está DONE, está mintiendo.
2. **Nunca marques DONE sin evidencia** de cada requisito obligatorio.
3. **Nunca revises tu propio trabajo.**
4. **Un subagente, una card, un artefacto.** Los subagentes son stateless: la delegación lleva todo el contexto.
5. **Los artefactos son la memoria.** Si no está en `.oficina/`, no existe.
6. **No toques fuera del scope.** Si hace falta, pedí la ampliación por el bus.
7. **Escalá cuando el caso lo pida**, no antes. 3 rechazos de la misma card = escalación con opciones concretas.
8. **Presupuesto**: 20 cards, 40 invocaciones, 20 spawns por corrida. Si se agota, informe parcial honesto y preguntá.

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
