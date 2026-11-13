---
name: oficina
description: Oficina de Agents que trabaja un objetivo de principio a fin sin instrucciones repetidas. Con el plugin instalado, la oficina es una máquina de estados con hooks de enforcement: el Director descompone, el dispatch crea los subagentes buscándolos en el catálogo real de agency-agents, coordina por un bus de mensajes en disco, permite pedir ayuda y delegar entre pares, y un hook de auto-continuación sigue trabajando cuando el modelo dice "terminé". Una card no se cierra sin gates en verde Y sin evidencia para cada criterio de aceptación. Úsala cuando el usuario da un objetivo, feature, bug o refactor y quiere que un equipo de agentes lo ejecute completo, se auto-verifique y entregue evidencia, en vez de que el assistant lo haga todo lineal. Incluye protocolo de identidad, resolución de problemas operativos y verificación de instalación (v3.2.0).
---

# OFICINA — Manual Operativo (v3.2.0)

Un objetivo entra por la puerta. La oficina lo ejecuta, se auto-verifica, y entrega evidencia.

Este documento es el manual completo para cualquier IA que use el plugin `oficina-opencode`. Cubre: verificación de instalación, el protocolo por rol, las 18 tools, el modelo de identidad, y la resolución de problemas conocidos.

---

## 0. Verificación de instalación (hacé esto primero)

Antes de usar la oficina, verificá que el plugin cargó la versión correcta:

| Verificación | Cómo | Esperado |
|---|---|---|
| Tools registradas | ¿Ves las 18 tools `oficina_*` disponibles? | 18 tools |
| Versión del paquete | `npm view oficina-opencode version` o leer `node_modules/oficina-opencode/package.json` | 3.2.0 o mayor |
| Root correcto | La primera vez que una tool corra, el output muestra `officeDir` | `<proyecto>/.oficina` |

**Síntomas de instalación vieja o rota:**

- Hay 16 tools en vez de 18 (falta `oficina_next`, `oficina_status`, `oficina_bus_cleanup`) ? instalación < 3.1.x.
- La oficina escribe en otro proyecto (ver troubleshooting §R1).
- Los reviewers quedan `(sin asignar)` en todas las cards (ver §R2).

**Cómo instalar/actualizar:**

```bash
npm install oficina-opencode@latest -g        # o en el proyecto
# En el config de OpenCode (~/.config/opencode/opencode.json):
#   "plugins": ["oficina-opencode"]
# Si ya existe un loader local (~/.config/opencode/plugins/oficina.js),
# el paquete actualizado se resuelve desde <config>/node_modules/.
```

---

## 1. Las tres garant.as de v3.2.0 (léelo antes de operar)

**1a. Identidad autenticada.** Toda tool sensible compara `args.agentId` con la identidad real de la sesión (`ctx.agent`, que da el host). Si no coinciden, la tool rechaza con *"no coincide con la sesión"*. **Consecuencia práctica: usá SIEMPRE tu id de ficha tal como te lo dieron, y operá desde tu propia sesión.** No pases el id de otro agente ni desde otra sesión.

**1b. Reviewer asignado por el motor.** El routing del plan corre con el roster vacío; **es `oficina_dispatch` el que asigna los reviewers** una vez que el roster existe (su output lo muestra: `**Reviewers asignados:** T-00 ? e-x, ...`). `oficina_review` exige: card en estado `review`, vos sos EL reviewer asignado, y no sos el owner. **Consecuencia práctica: no despachés plan sin dispatch; si una card aparece sin reviewer, re-corré `oficina_dispatch`.**

---

## 2. El flujo completo: de un objetivo a un equipo

```
   EL USUARIO DA UN OBJETIVO
            |
            v
  +--------------------------------+
  | 1. PLAN      (Comandante)     |  ? cards con scope, acceptance, gate, deps
  |    oficina_plan               |
  +--------------------------------+
            |
            v
  +--------------------------------+
  | 2. DISPATCH  (Integrador)     |  ? RESUELVE ROLES, MATERIALIZA, ARRANCA
  |    oficina_dispatch           |    asigna reviewers, spawnea owners Y pares
  +--------------------------------+
            |
            v
  +--------------------------------+
  | 3. TRABAJO   (Owner)          |  ? oficina_assign + handoff.md + evidence.md
  +--------------------------------+
            |
            v
  +--------------------------------+
  | 4. REVIEW    (Reviewer)       |  ? oficina_review (asignado por el motor,
  |                               |    nunca el owner)
  +--------------------------------+
            | APROBADO
            v
  +--------------------------------+
  | 5. GATES + EVIDENCIA          |  ? oficina_gate + oficina_evidence
  +--------------------------------+
            | PASA
            v
  | 6. NEXT      (todos)          |  ? oficina_next: CLAIM / HELP_RESPOND /
  +--------------------------------+    ASK_COORDINATOR / STAY_IDLE
```

### Secuencia exacta por rol

**COMANDANTE (la sesión principal):**
1. `oficina_plan` — descomponé el objetivo en cards. **Capabilities: copiá palabras literales de las descripciones del catálogo** (ver §R6).
2. `oficina_dispatch` con tu `agentId` — el integrador materializa el equipo, asigna reviewers y arranca owners **y pares**.
3. Verificá el output: si dice `?? Spawn falló para: ...`, arrancá a esos agentes manual con su prompt antes de seguir. Si dice `?? spawn=false: ningún agente tiene sesión viva`, no avances: materializar no es arrancar.
4. Monitoreá con `oficina_status` / `oficina_mesa`. Intervení solo en escalaciones.

**OWNER (agente con card):**
1. `oficina_assign` — reclamás la card. Esto bindea tu sesión a la card.
2. Trabajá **dentro del scope** (`mayTouch`). Fuera del scope la escritura se rechaza de verdad.
3. `oficina_submit` con `handoff` (qué hiciste, archivos tocados, decisiones) y `evidence` (salida literal de comandos). Sin evidencia no hay cierre.
4. Al terminar: `oficina_next` — te obliga a decidir el próximo movimiento.

**REVIEWER:**
1. La card llega a estado `review` cuando el owner entrega. Vos fuiste asignado por el dispatch.
2. `oficina_review` con veredicto `approved`/`rejected`. Si rechazás, el motivo tiene que ser accionable (path:línea, escenario, fix, test de regresión).
3. **Nunca revises tu propio trabajo** — el motor lo rechaza, no lo intentes.

**PAR LIBRE (sin card propia):**
1. **Tu primer acto es `oficina_next`**: te muestra tu inbox (los `HELP_REQUEST` dirigidos a vos) y la mesa.
2. Si tenés un pedido, respondé YA con `oficina_next action=HELP_RESPOND`: `HELP_ACCEPT` (respuesta completa), `HELP_PARTIAL` (decí qué falta), `HELP_QUESTION` (pedí contexto), `HELP_DECLINE` (motivo concreto). **La respuesta lleva sustancia real, no un "te aviso".**
3. Si no tenés pedidos: `STAY_IDLE` con justificación, o reclamá una card sin owner con `oficina_assign`.

---

## 3. Las 18 tools

| Tool | Qué hace | Quién la usa |
|---|---|---|
| `oficina_plan` | Guarda el plan de cards. El modelo propone; el motor valida y rutea owner/reviewer | Comandante |
| **`oficina_dispatch`** | **Arma el equipo**: resuelve roles, materializa agentes, asigna reviewers, arranca owners y pares. Solo agentes con `canDelegate` | Integrador/Comandante |
| **`oficina_mesa`** | La mesa: quién trabaja en qué, quién está libre, qué ayuda espera respuesta | Todos |
| `oficina_board` | Estado: cards, owners, agentes libres, agentes sin heartbeat | Todos |
| **`oficina_status`** | Resumen de corrida: estado, cards por estado, agentes vivos/muertos, spawns pendientes | Todos |
| `oficina_assign` | Toma trabajo — la próxima card o claim proactivo de una puntual. **Bindea tu sesión a la card** | Owner |
| `oficina_submit` | Entrega handoff + evidencia real ? pasa a `REVIEW` | Owner |
| `oficina_review` | Veredicto del reviewer asignado. El motor rechaza self-review y reviewers no asignados | Reviewer |
| `oficina_gate` | Corre los 7 gates. Exit codes reales, no opinión | Owner/Reviewer |
| **`oficina_evidence`** | Grafo de requisitos: qué evidencia falta para cerrar cada criterio | Todos |
| `oficina_bus` | Bus: `send` · `receive` · `ack` · `help`. Valida identidad por mensaje | Todos |
| **`oficina_next`** | **Protocolo obligatorio de siguiente acción.** Lee mesa + inbox, ejecuta CLAIM/HELP_RESPOND/ASK_COORDINATOR/STAY_IDLE. NO declare "terminé" sin pasar por acá | Todos |
| `oficina_spawn` | Pide desplegar un agente con gating de capabilities | Agente con card |
| **`oficina_bus_cleanup`** | Limpia mensajes expirados del bus (TTL vencido) | Integrador |
| `oficina_escalate` | Escala al usuario con 2-3 opciones concretas y recomendación | Cualquiera |
| `oficina_ficha` | Resuelve un rol a ficha y despliega el agente con su briefing | Comandante |
| `oficina_brief` | Muestra el briefing y el panel de roles sin desplegar | Comandante |
| `oficina_stop` | Freno de emergencia: `halt` / `resume`. Requiere `agentId` (auditoría) | Usuario/Comandante |

---

## 4. Resolución de problemas (R1–R10)

Estos son los fallos reales observados en producción. Cada uno con síntoma exacto, causa y acción.

### R1 — "The office is rooted in the wrong project"
- **Síntoma:** los artefactos aparecen en otro proyecto (ej. `cedears-tracker-pro` en vez del proyecto actual); la mesa muestra estado que no coincide con lo que veís.
- **Causa (v3.1.3 y anteriores):** el plugin tomaba el `process.cwd()` del server de OpenCode, que puede ser cualquier proyecto.
- **Fix (v3.2.0):** el root es `ctx.location.directory` (el directorio de la **sesión**). Actualizá el paquete a =3.1.4.
- **Si te pasa igual:** verificá que la oficina viva en `<proyecto>/.oficina`; si hay un `.oficina` en otro proyecto con estado fresco, ese fue el root viejo — mové/eliminá ese estado y re-corré.

### R2 — Reviewer `(sin asignar)` en todas las cards
- **Síntoma:** `submitReview` rechaza con *"la card T-xx está asignada a null"*; nadie puede revisar.
- **Causa:** el routing del plan corrió con el roster vacío. En v3.1.3 y anteriores el dispatch no re-ruteaba ? reviewers null para siempre.
- **Fix (v3.2.0):** `oficina_dispatch` asigna reviewers después de materializar el equipo. **Re-corré `oficina_dispatch`** (es idempotente: no duplica agentes ni reasigna los que ya tienen reviewer).
- **Verificación:** el output del dispatch muestra `**Reviewers asignados:** T-00 ? e-x, ...`.

### R3 — HELP_REQUEST sin respuesta ("se mueren en el canal")
- **Síntoma:** el bus tiene pedidos de ayuda, el pool está lleno, pero nadie contesta.
- **Causa:** los pares estaban **materializados** (`.opencode/agents/`) pero **sin sesión viva**. Un agente sin sesión no puede recibir del bus. Materializar ? arrancar.
- **Fix (v3.2.0):** el dispatch spawnea también a los pares, y su prompt incluye el protocolo de triage (`oficina_next` ? `HELP_RESPOND` con sustancia).
- **Si te pasa igual:** spawnéá a los pares manual con su prompt y la instrucción explícita: *"tu primer acto es oficina_next; respondé los HELP_REQUEST dirigidos a vos"*.

### R4 — Spawn silenciosamente fallido (cards sin nadie trabajándolas)
- **Síntoma:** el dispatch reporta "equipo despachado" pero las cards no avanzan; no hay sesiones.
- **Causa:** en v3.1.3 el resultado del spawn no se reportaba: un `false` se tragaba en silencio.
- **Fix (v3.2.0):** el output distingue `**Arrancados (con sesión viva):**` de `**?? Spawn falló para:** X`. **Si aparece el warning, arrancá a X manual con su prompt y recién ahí sigas.**

### R5 — "agentId del argumento (X) no coincide con la sesión (Y)"
- **No es un bug: es la garantía de identidad trabajando.** Pasaste un `agentId` que no es el de tu sesión, o operás desde la sesión de otro.
- **Acción:** usá tu id de ficha real. Si sos el Comandante sin ficha, primero desplegá tu ficha de integrador con `oficina_ficha` y operá con ese id.

### R6 — El matcher asigna roles equivocados o cobertura 0
- **Síntoma:** `oficina_brief` devuelve un primario que no tiene nada que ver, o `sin cubrir` con capabilities que claramente existen en el catálogo.
- **Causa más común:** capabilities escritas con **sinónimos inventados**. El matcher compara contra las descripciones literales del catálogo: `'conversion'` no es `'CRO'`, `'planeamiento financiero'` no es `'FP&A'`.
- **Acción:** en `oficina_plan`, escribí capabilities con **palabras que aparecen en las descripciones del catálogo** (consultalas con `oficina_brief` o el skill). Sustantivos técnicos concretos: `react`, `fp&a`, `penetration testing`, `vo2max`. Medido: el matcher acierta el primer rol en el 71% de las tareas de referencia — pero solo con el vocabulario correcto.

### R7 — Web search falla (402 / payment required)
- **Causa:** el provider del modelo no tiene crédito para `websearch`. No es problema del plugin.
- **Acción:** usá `webfetch` + buscadores sin API (ej. DuckDuckGo HTML) como fallback. La hoja de entorno que recibe cada agente documenta el runtime disponible.

### R8 — "la card T-xx ya está tomada por otro agente" / "pertenece a X"
- **No es un bug: el lease/doble-claim working.** La card tiene owner.
- **Acción:** reclamá otra card (`oficina_assign` sin `cardId`) u ofrecé ayuda. Si el owner está muerto (sin heartbeat), el lease expira solo (~15 min) y la card vuelve al pool.

### R9 — "la corrida está detenida: ..."
- **Causa:** alguien corrió `oficina_stop action=halt` (freno de emergencia).
- **Acción:** si sos el usuario/Comandante y querés seguir: `oficina_stop action=resume` con tu `agentId`. Si no sabés por qué se frenó, `oficina_status` muestra el motivo en el estado.

### R10 — La corrida se retoma tras reiniciar y repite acciones
- **Causa (v3.1.3 y anteriores):** los contadores de auto-resume vivían en memoria.
- **Fix (v3.2.0):** `autoResumes` se persiste en `state.sessions[].autoResumes`. Verificá versión =3.1.4.

---

## 5. Los coordinadores y la escalación

| | COMANDANTE | ARQUITECTO | INTEGRADOR |
|---|---|---|---|
| **Dominio** | Scope, objetivo, prioridades | Decisiones técnicas cross-cutting | DAG, leases, gates, calidad |
| **Responde** | ¿esto está en el objetivo? | ¿qué patrón usamos? | ¿quién tiene T-07? ¿pasó el gate? |
| **Detecta** | Scope creep | Drift arquitectónico | Deadlock, starvation, doble-claim |

**Arbitraje:** scope ? Comandante. Patrón/contrato ? Arquitecto. Flujo/lease/gate ? Integrador.

**Al usuario solo se escala** si el coordinador no puede decidir (criterio de producto), si el conflicto cruza dominios sin resolución, o si se agotó el presupuesto. La escalación (`oficina_escalate`) lleva SIEMPRE 2-3 opciones concretas con tradeoff y una recomendación con motivo.

---

## 6. Ayuda entre pares: el protocolo completo

Pedir: `oficina_bus action=help` con **need** (qué necesitás) y **whyMe** (por qué no lo resolvés vos). Un pedido sin `whyMe` es ruido.

El que recibe hace su propio triage — no acepta por cortesía:

1. ¿Entiendo la tarea? ? si no, `HELP_DECLINE` + explicar
2. ¿Está en mi scope? ? si no, `HELP_DECLINE` + sugerir a quién
3. ¿Puedo hacerlo ya sin romper mi card? ? si no, `HELP_DECLINE` + "cuando termine"
4. ¿Tengo el contexto? ? si no, `HELP_QUESTION` por el bus
5. ¿Vale la pena? ? si no, `HELP_DECLINE` + alternativa

**Anti-deadlock**: máximo 2 saltos en una cadena de ayuda; después escala al Integrador. Un pedido puede declarar explícitamente que no bloquea: *"si el #1 cambia, re-ancalo los números"* — el pedido informa, no frena.
**Anti-monotonía**: si el par A?B ya colaboró 2 veces, el tercer pedido va a un tercero.
**TTL**: los HELP_REQUEST vencen. `oficina_bus_cleanup` limpia los expirados.

---

## 7. Verificar el resultado, no solo el proceso

Siete gates. Los seis técnicos dicen que **el código está sano**; el séptimo dice que **el objetivo está cumplido**:

| # | Fase | Qué comprueba |
|---|---|---|
| 1 | Build | Compila |
| 2 | Type check | Tipos |
| 3 | Lint | Estilo |
| 4 | Tests | Comportamiento |
| 5 | Secretos | No hay credenciales en el árbol (escaneo en código, valor redactado) |
| 6 | Diff | Qué cambió |
| 7 | **Requisitos** | **Cada criterio de aceptación tiene evidencia** |

**Reglas de honestidad — no negociables:**

- Nunca `PASS` en una fase que no se corrió ? `NOT RUN` y eso hace fallar el gate
- Nunca output inventado
- `N/A` siempre con motivo explícito
- Una fase aplicable en `FAIL` = gate `FAIL`. No se promedia

### El grafo de evidencia

`oficina_evidence view <cardId>` muestra, por card, qué criterio tiene evidencia y cuál no. Niveles:

| Nivel | Qué es |
|---|---|
| 1 | Estático (un gate) |
| 2 | Comportamiento (un artefacto, un test) |
| 3 | Validación de requisitos (inspección) |
| 4 | Auditoría independiente (revisor ? owner) |

**Una card NO se cierra sin evidencia suficiente de cada requisito obligatorio.** Los gates en verde no alcanzan: un proyecto puede compilar, pasar todos sus tests y tener la autenticación mal porque ningún test contemplaba ese escenario. Al entregar, registrá evidencia: `oficina_evidence action=add`, diciendo QUÉ evidencia respalda QUÉ criterio.

---

## 8. El scope: una restricción, no una instrucción

Cuando un agente intenta escribir fuera del scope de su card, la operación **se rechaza**. No es una sugerencia.

- La ruta se **resuelve** (absoluta ? normalizada ? symlinks resueltos) y recién ahí se decide.
- `..`, paths absolutos y symlinks que apuntan afuera están cerrados.
- Los archivos sensibles (`.env`, `.npmrc`, `.git/**`, claves) **nunca** son escribibles.
- Los **subagentes heredan el scope** de la cadena de sesiones: delegar no es un escalón para salirse.
- Una sesión de oficina **sin card** no tiene acceso de escritura libre (fail-closed).

Si el archivo es necesario: pedí por el bus que se amplíe el scope. No lo toques por tu cuenta.

---

## 9. Reglas de ejecución

1. **Nunca marques DONE sin los gates en verde.** Una card sin `gates.md` en PASS no está DONE, está mintiendo.
2. **Nunca marques DONE sin evidencia** de cada requisito obligatorio.
3. **Nunca revises tu propio trabajo.** El motor lo rechaza.
4. **Un subagente, una card, un artefacto.** Los subagentes son stateless: la delegación lleva todo el contexto.
5. **Los artefactos son la memoria.** Si no está en `.oficina/`, no existe.
6. **No toques fuera del scope.** Si hace falta, pedí la ampliación por el bus.
7. **Terminar = pasar por `oficina_next`.** No declares "terminé" en la conversación: la decisión verificable es la de la tool.
8. **Escalá cuando el caso lo pida**, no antes. 3 rechazos de la misma card = escalación automática con opciones concretas.
9. **Pedí ayuda con need + whyMe.** Contestá con sustancia real y en el `messageId` del pedido.

---

## 10. Cuándo NO usar OFICINA

- Tarea de una sola acción.
- El usuario pidió explícitamente hacerlo vos directo.
- Exploración sin objetivo claro — primero brainstorming, después OFICINA.

En esos casos, hacelo vos. OFICINA es para trabajo multi-paso con objetivo verificable.

---

## Referencias

- `reference/mesh.md` — bus, fichas, roster, leases, spawn policy, idle pool
- `reference/roles.md` — fichas de rol, criterios de enrutado, rotación
- `reference/protocol.md` — handoff, gates, escalamiento, checkpoints, reintentos
- `reference/templates.md` — templates de board, state.json, handoff, review, gates, informe
- Repo: `github.com/SOCRAMbt/AI-OFFICE` · npm: `oficina-opencode`
