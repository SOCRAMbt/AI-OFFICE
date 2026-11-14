---
name: oficina
description: Oficina de Agents que trabaja un objetivo de principio a fin sin instrucciones repetidas. Con el plugin instalado, la oficina es una m�quina de estados con hooks de enforcement: el Director descompone, el dispatch crea los subagentes busc�ndolos en el cat�logo real de agency-agents, coordina por un bus de mensajes en disco, permite pedir ayuda y delegar entre pares, y un hook de auto-continuaci�n sigue trabajando cuando el modelo dice "termin�". Una card no se cierra sin gates en verde Y sin evidencia para cada criterio de aceptaci�n. �sala cuando el usuario da un objetivo, feature, bug o refactor y quiere que un equipo de agentes lo ejecute completo, se auto-verifique y entregue evidencia, en vez de que el assistant lo haga todo lineal. Incluye protocolo de identidad, resoluci�n de problemas operativos y verificaci�n de instalaci�n (v3.2.2).
---

# OFICINA � Manual Operativo (v3.2.2)

Un objetivo entra por la puerta. La oficina lo ejecuta, se auto-verifica, y entrega evidencia.

Este documento es el manual completo para cualquier IA que use el plugin `oficina-opencode`. Cubre: verificaci�n de instalaci�n, el protocolo por rol, las 18 tools, el modelo de identidad, y la resoluci�n de problemas conocidos.

---

## 0. Verificaci�n de instalaci�n (hac� esto primero)

Antes de usar la oficina, verific� que el plugin carg� la versi�n correcta:

| Verificaci�n | C�mo | Esperado |
|---|---|---|
| Tools registradas | �Ves las 18 tools `oficina_*` disponibles? | 18 tools |
| Versi�n del paquete | `npm view oficina-opencode version` o leer `node_modules/oficina-opencode/package.json` | 3.2.2 o mayor |
| Root correcto | La primera vez que una tool corra, el output muestra `officeDir` | `<proyecto>/.oficina` |

**S�ntomas de instalaci�n vieja o rota:**

- Hay 16 tools en vez de 18 (falta `oficina_next`, `oficina_status`, `oficina_bus_cleanup`) ? instalaci�n < 3.1.x.
- La oficina escribe en otro proyecto (ver troubleshooting �R1).
- Los reviewers quedan `(sin asignar)` en todas las cards (ver �R2).

**C�mo instalar/actualizar:**

```bash
npm install oficina-opencode@latest -g        # o en el proyecto
# En el config de OpenCode (~/.config/opencode/opencode.json):
#   "plugins": ["oficina-opencode"]
# Si ya existe un loader local (~/.config/opencode/plugins/oficina.js),
# el paquete actualizado se resuelve desde <config>/node_modules/.
```

---

## 1. Las tres garant.as de v3.2.0 (l�elo antes de operar)

**1a. Identidad autenticada.** Toda tool sensible compara `args.agentId` con la identidad real de la sesi�n (`ctx.agent`, que da el host). Si no coinciden, la tool rechaza con *"no coincide con la sesi�n"*. **Consecuencia pr�ctica: us� SIEMPRE tu id de ficha tal como te lo dieron, y oper� desde tu propia sesi�n.** No pases el id de otro agente ni desde otra sesi�n.

**1b. Reviewer asignado por el motor.** El routing del plan corre con el roster vac�o; **es `oficina_dispatch` el que asigna los reviewers** una vez que el roster existe (su output lo muestra: `**Reviewers asignados:** T-00 ? e-x, ...`). `oficina_review` exige: card en estado `review`, vos sos EL reviewer asignado, y no sos el owner. **Consecuencia pr�ctica: no despach�s plan sin dispatch; si una card aparece sin reviewer, re-corr� `oficina_dispatch`.**

---

## 1.5 Dashboard: ábrelo y avisá al usuario (OBLIGATORIO)

Cuando la IA empiece a trabajar una corrida — sea invocada con `/oficina`, con `/oficina lite`, o que su trabajo active las tools `oficina_*` — tiene que:

1. **Abrir el dashboard** apenas la corrida esté en marcha. El plugin lo intenta solo: `oficina_plan` arranca el server en background y abre el navegador. Si inspeccionás `<PROJECT_ROOT>/.oficina/dashboard.json`, ahí queda la URL y el puerto reales (7333, o el siguiente libre si estaba ocupado). Si no está arriba, levantalo vos: `oficina dashboard` (o `node dashboard/server.mjs --oficina <PROJECT_ROOT>/.oficina` desde el repo). Si el navegador no abrió solo, abrí `<url>` vos o avisá el comando.
2. **Avisar al usuario en el primer mensaje de la corrida**, con la ubicación y la confirmación de que lo abriste. Formato:
   ```
   Dashboard en vivo: <url> (lo abrí en tu navegador — mesa, bus, kanban,
   gates y circuit breaker con datos reales de <PROJECT_ROOT>/.oficina/)
   ```
   Tomá la URL de `dashboard.json`, no asumas el puerto.
3. **No cerrés el dashboard** ni le pidas al usuario que lo abra a mano. Si no arranca, decilo y seguí — es best-effort: nunca bloquea la corrida.
4. **Sin agentes de relleno**: la mesa y el panel AGENTS muestran EXACTAMENTE los agentes que la corrida despachó (0 es 0, 3 es 3, 10 es 10 — los tamaños se adaptan solos). No agregues, no filtres, no inventes.

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

**COMANDANTE (la sesi�n principal):**
1. `oficina_plan` � descompon� el objetivo en cards. **Capabilities: copi� palabras literales de las descripciones del cat�logo** (ver �R6).
2. `oficina_dispatch` con tu `agentId` � el integrador materializa el equipo, asigna reviewers y arranca owners **y pares**.
3. Verific� el output: si dice `?? Spawn fall� para: ...`, arranc� a esos agentes manual con su prompt antes de seguir. Si dice `?? spawn=false: ning�n agente tiene sesi�n viva`, no avances: materializar no es arrancar.
4. Monitore� con `oficina_status` / `oficina_mesa`. Interven� solo en escalaciones.

**OWNER (agente con card):**
1. `oficina_assign` � reclam�s la card. Esto bindea tu sesi�n a la card.
2. Trabaj� **dentro del scope** (`mayTouch`). Fuera del scope la escritura se rechaza de verdad.
3. `oficina_submit` con `handoff` (qu� hiciste, archivos tocados, decisiones) y `evidence` (salida literal de comandos). Sin evidencia no hay cierre.
4. Al terminar: `oficina_next` � te obliga a decidir el pr�ximo movimiento.

**REVIEWER:**
1. La card llega a estado `review` cuando el owner entrega. Vos fuiste asignado por el dispatch.
2. `oficina_review` con veredicto `approved`/`rejected`. Si rechaz�s, el motivo tiene que ser accionable (path:l�nea, escenario, fix, test de regresi�n).
3. **Nunca revises tu propio trabajo** � el motor lo rechaza, no lo intentes.

**PAR LIBRE (sin card propia):**
1. **Tu primer acto es `oficina_next`**: te muestra tu inbox (los `HELP_REQUEST` dirigidos a vos) y la mesa.
2. Si ten�s un pedido, respond� YA con `oficina_next action=HELP_RESPOND`: `HELP_ACCEPT` (respuesta completa), `HELP_PARTIAL` (dec� qu� falta), `HELP_QUESTION` (ped� contexto), `HELP_DECLINE` (motivo concreto). **La respuesta lleva sustancia real, no un "te aviso".**
3. Si no ten�s pedidos: `STAY_IDLE` con justificaci�n, o reclam� una card sin owner con `oficina_assign`.

---

## 3. Las 18 tools

| Tool | Qu� hace | Qui�n la usa |
|---|---|---|
| `oficina_plan` | Guarda el plan de cards. El modelo propone; el motor valida y rutea owner/reviewer | Comandante |
| **`oficina_dispatch`** | **Arma el equipo**: resuelve roles, materializa agentes, asigna reviewers, arranca owners y pares. Solo agentes con `canDelegate` | Integrador/Comandante |
| **`oficina_mesa`** | La mesa: qui�n trabaja en qu�, qui�n est� libre, qu� ayuda espera respuesta | Todos |
| `oficina_board` | Estado: cards, owners, agentes libres, agentes sin heartbeat | Todos |
| **`oficina_status`** | Resumen de corrida: estado, cards por estado, agentes vivos/muertos, spawns pendientes | Todos |
| `oficina_assign` | Toma trabajo � la pr�xima card o claim proactivo de una puntual. **Bindea tu sesi�n a la card** | Owner |
| `oficina_submit` | Entrega handoff + evidencia real ? pasa a `REVIEW` | Owner |
| `oficina_review` | Veredicto del reviewer asignado. El motor rechaza self-review y reviewers no asignados | Reviewer |
| `oficina_gate` | Corre los 7 gates. Exit codes reales, no opini�n | Owner/Reviewer |
| **`oficina_evidence`** | Grafo de requisitos: qu� evidencia falta para cerrar cada criterio | Todos |
| `oficina_bus` | Bus: `send` � `receive` � `ack` � `help`. Valida identidad por mensaje | Todos |
| **`oficina_next`** | **Protocolo obligatorio de siguiente acci�n.** Lee mesa + inbox, ejecuta CLAIM/HELP_RESPOND/ASK_COORDINATOR/STAY_IDLE. NO declare "termin�" sin pasar por ac� | Todos |
| `oficina_spawn` | Pide desplegar un agente con gating de capabilities | Agente con card |
| **`oficina_bus_cleanup`** | Limpia mensajes expirados del bus (TTL vencido) | Integrador |
| `oficina_escalate` | Escala al usuario con 2-3 opciones concretas y recomendaci�n | Cualquiera |
| `oficina_ficha` | Resuelve un rol a ficha y despliega el agente con su briefing | Comandante |
| `oficina_brief` | Muestra el briefing y el panel de roles sin desplegar | Comandante |
| `oficina_stop` | Freno de emergencia: `halt` / `resume`. Requiere `agentId` (auditor�a) | Usuario/Comandante |

---

## 4. Resoluci�n de problemas (R1�R10)

Estos son los fallos reales observados en producci�n. Cada uno con s�ntoma exacto, causa y acci�n.

### R1 � "The office is rooted in the wrong project"
- **S�ntoma:** los artefactos aparecen en otro proyecto (ej. `cedears-tracker-pro` en vez del proyecto actual); la mesa muestra estado que no coincide con lo que ve�s.
- **Causa (v3.1.3 y anteriores):** el plugin tomaba el `process.cwd()` del server de OpenCode, que puede ser cualquier proyecto.
- **Fix (v3.2.0):** el root es `ctx.location.directory` (el directorio de la **sesi�n**). Actualiz� el paquete a =3.1.4.
- **Si te pasa igual:** verific� que la oficina viva en `<proyecto>/.oficina`; si hay un `.oficina` en otro proyecto con estado fresco, ese fue el root viejo � mov�/elimin� ese estado y re-corr�.

### R2 � Reviewer `(sin asignar)` en todas las cards
- **S�ntoma:** `submitReview` rechaza con *"la card T-xx est� asignada a null"*; nadie puede revisar.
- **Causa:** el routing del plan corri� con el roster vac�o. En v3.1.3 y anteriores el dispatch no re-ruteaba ? reviewers null para siempre.
- **Fix (v3.2.0):** `oficina_dispatch` asigna reviewers despu�s de materializar el equipo. **Re-corr� `oficina_dispatch`** (es idempotente: no duplica agentes ni reasigna los que ya tienen reviewer).
- **Verificaci�n:** el output del dispatch muestra `**Reviewers asignados:** T-00 ? e-x, ...`.

### R3 � HELP_REQUEST sin respuesta ("se mueren en el canal")
- **S�ntoma:** el bus tiene pedidos de ayuda, el pool est� lleno, pero nadie contesta.
- **Causa:** los pares estaban **materializados** (`.opencode/agents/`) pero **sin sesi�n viva**. Un agente sin sesi�n no puede recibir del bus. Materializar ? arrancar.
- **Fix (v3.2.0):** el dispatch spawnea tambi�n a los pares, y su prompt incluye el protocolo de triage (`oficina_next` ? `HELP_RESPOND` con sustancia).
- **Si te pasa igual:** spawn�� a los pares manual con su prompt y la instrucci�n expl�cita: *"tu primer acto es oficina_next; respond� los HELP_REQUEST dirigidos a vos"*.

### R4 � Spawn silenciosamente fallido (cards sin nadie trabaj�ndolas)
- **S�ntoma:** el dispatch reporta "equipo despachado" pero las cards no avanzan; no hay sesiones.
- **Causa:** en v3.1.3 el resultado del spawn no se reportaba: un `false` se tragaba en silencio.
- **Fix (v3.2.0):** el output distingue `**Arrancados (con sesi�n viva):**` de `**?? Spawn fall� para:** X`. **Si aparece el warning, arranc� a X manual con su prompt y reci�n ah� sigas.**

### R5 � "agentId del argumento (X) no coincide con la sesi�n (Y)"
- **No es un bug: es la garant�a de identidad trabajando.** Pasaste un `agentId` que no es el de tu sesi�n, o oper�s desde la sesi�n de otro.
- **Acci�n:** us� tu id de ficha real. Si sos el Comandante sin ficha, primero despleg� tu ficha de integrador con `oficina_ficha` y oper� con ese id.

### R6 � El matcher asigna roles equivocados o cobertura 0
- **S�ntoma:** `oficina_brief` devuelve un primario que no tiene nada que ver, o `sin cubrir` con capabilities que claramente existen en el cat�logo.
- **Causa m�s com�n:** capabilities escritas con **sin�nimos inventados**. El matcher compara contra las descripciones literales del cat�logo: `'conversion'` no es `'CRO'`, `'planeamiento financiero'` no es `'FP&A'`.
- **Acci�n:** en `oficina_plan`, escrib� capabilities con **palabras que aparecen en las descripciones del cat�logo** (consultalas con `oficina_brief` o el skill). Sustantivos t�cnicos concretos: `react`, `fp&a`, `penetration testing`, `vo2max`. Medido: el matcher acierta el primer rol en el 71% de las tareas de referencia � pero solo con el vocabulario correcto.

### R7 � Web search falla (402 / payment required)
- **Causa:** el provider del modelo no tiene cr�dito para `websearch`. No es problema del plugin.
- **Acci�n:** us� `webfetch` + buscadores sin API (ej. DuckDuckGo HTML) como fallback. La hoja de entorno que recibe cada agente documenta el runtime disponible.

### R8 � "la card T-xx ya est� tomada por otro agente" / "pertenece a X"
- **No es un bug: el lease/doble-claim working.** La card tiene owner.
- **Acci�n:** reclam� otra card (`oficina_assign` sin `cardId`) u ofrec� ayuda. Si el owner est� muerto (sin heartbeat), el lease expira solo (~15 min) y la card vuelve al pool.

### R9 � "la corrida est� detenida: ..."
- **Causa:** alguien corri� `oficina_stop action=halt` (freno de emergencia).
- **Acci�n:** si sos el usuario/Comandante y quer�s seguir: `oficina_stop action=resume` con tu `agentId`. Si no sab�s por qu� se fren�, `oficina_status` muestra el motivo en el estado.

### R10 � La corrida se retoma tras reiniciar y repite acciones
- **Causa (v3.1.3 y anteriores):** los contadores de auto-resume viv�an en memoria.
- **Fix (v3.2.0):** `autoResumes` se persiste en `state.sessions[].autoResumes`. Verific� versi�n =3.1.4.

---

## 5. Los coordinadores y la escalaci�n

| | COMANDANTE | ARQUITECTO | INTEGRADOR |
|---|---|---|---|
| **Dominio** | Scope, objetivo, prioridades | Decisiones t�cnicas cross-cutting | DAG, leases, gates, calidad |
| **Responde** | �esto est� en el objetivo? | �qu� patr�n usamos? | �qui�n tiene T-07? �pas� el gate? |
| **Detecta** | Scope creep | Drift arquitect�nico | Deadlock, starvation, doble-claim |

**Arbitraje:** scope ? Comandante. Patr�n/contrato ? Arquitecto. Flujo/lease/gate ? Integrador.

**Al usuario solo se escala** si el coordinador no puede decidir (criterio de producto), si el conflicto cruza dominios sin resoluci�n, o si se agot� el presupuesto. La escalaci�n (`oficina_escalate`) lleva SIEMPRE 2-3 opciones concretas con tradeoff y una recomendaci�n con motivo.

---

## 6. Ayuda entre pares: el protocolo completo

Pedir: `oficina_bus action=help` con **need** (qu� necesit�s) y **whyMe** (por qu� no lo resolv�s vos). Un pedido sin `whyMe` es ruido.

El que recibe hace su propio triage � no acepta por cortes�a:

1. �Entiendo la tarea? ? si no, `HELP_DECLINE` + explicar
2. �Est� en mi scope? ? si no, `HELP_DECLINE` + sugerir a qui�n
3. �Puedo hacerlo ya sin romper mi card? ? si no, `HELP_DECLINE` + "cuando termine"
4. �Tengo el contexto? ? si no, `HELP_QUESTION` por el bus
5. �Vale la pena? ? si no, `HELP_DECLINE` + alternativa

**Anti-deadlock**: m�ximo 2 saltos en una cadena de ayuda; despu�s escala al Integrador. Un pedido puede declarar expl�citamente que no bloquea: *"si el #1 cambia, re-ancalo los n�meros"* � el pedido informa, no frena.
**Anti-monoton�a**: si el par A?B ya colabor� 2 veces, el tercer pedido va a un tercero.
**TTL**: los HELP_REQUEST vencen. `oficina_bus_cleanup` limpia los expirados.

---

## 7. Verificar el resultado, no solo el proceso

Siete gates. Los seis t�cnicos dicen que **el c�digo est� sano**; el s�ptimo dice que **el objetivo est� cumplido**:

| # | Fase | Qu� comprueba |
|---|---|---|
| 1 | Build | Compila |
| 2 | Type check | Tipos |
| 3 | Lint | Estilo |
| 4 | Tests | Comportamiento |
| 5 | Secretos | No hay credenciales en el �rbol (escaneo en c�digo, valor redactado) |
| 6 | Diff | Qu� cambi� |
| 7 | **Requisitos** | **Cada criterio de aceptaci�n tiene evidencia** |

**Reglas de honestidad � no negociables:**

- Nunca `PASS` en una fase que no se corri� ? `NOT RUN` y eso hace fallar el gate
- Nunca output inventado
- `N/A` siempre con motivo expl�cito
- Una fase aplicable en `FAIL` = gate `FAIL`. No se promedia

### El grafo de evidencia

`oficina_evidence view <cardId>` muestra, por card, qu� criterio tiene evidencia y cu�l no. Niveles:

| Nivel | Qu� es |
|---|---|
| 1 | Est�tico (un gate) |
| 2 | Comportamiento (un artefacto, un test) |
| 3 | Validaci�n de requisitos (inspecci�n) |
| 4 | Auditor�a independiente (revisor ? owner) |

**Una card NO se cierra sin evidencia suficiente de cada requisito obligatorio.** Los gates en verde no alcanzan: un proyecto puede compilar, pasar todos sus tests y tener la autenticaci�n mal porque ning�n test contemplaba ese escenario. Al entregar, registr� evidencia: `oficina_evidence action=add`, diciendo QU� evidencia respalda QU� criterio.

---

## 8. El scope: una restricci�n, no una instrucci�n

Cuando un agente intenta escribir fuera del scope de su card, la operaci�n **se rechaza**. No es una sugerencia.

- La ruta se **resuelve** (absoluta ? normalizada ? symlinks resueltos) y reci�n ah� se decide.
- `..`, paths absolutos y symlinks que apuntan afuera est�n cerrados.
- Los archivos sensibles (`.env`, `.npmrc`, `.git/**`, claves) **nunca** son escribibles.
- Los **subagentes heredan el scope** de la cadena de sesiones: delegar no es un escal�n para salirse.
- Una sesi�n de oficina **sin card** no tiene acceso de escritura libre (fail-closed).

Si el archivo es necesario: ped� por el bus que se ampl�e el scope. No lo toques por tu cuenta.

---

## 9. Reglas de ejecuci�n

1. **Nunca marques DONE sin los gates en verde.** Una card sin `gates.md` en PASS no est� DONE, est� mintiendo.
2. **Nunca marques DONE sin evidencia** de cada requisito obligatorio.
3. **Nunca revises tu propio trabajo.** El motor lo rechaza.
4. **Un subagente, una card, un artefacto.** Los subagentes son stateless: la delegaci�n lleva todo el contexto.
5. **Los artefactos son la memoria.** Si no est� en `.oficina/`, no existe.
6. **No toques fuera del scope.** Si hace falta, ped� la ampliaci�n por el bus.
7. **Terminar = pasar por `oficina_next`.** No declares "termin�" en la conversaci�n: la decisi�n verificable es la de la tool.
8. **Escal� cuando el caso lo pida**, no antes. 3 rechazos de la misma card = escalaci�n autom�tica con opciones concretas.
9. **Ped� ayuda con need + whyMe.** Contest� con sustancia real y en el `messageId` del pedido.

---

## 10. Cu�ndo NO usar OFICINA

- Tarea de una sola acci�n.
- El usuario pidi� expl�citamente hacerlo vos directo.
- Exploraci�n sin objetivo claro � primero brainstorming, despu�s OFICINA.

En esos casos, hacelo vos. OFICINA es para trabajo multi-paso con objetivo verificable.

---

## Referencias

- `reference/mesh.md` � bus, fichas, roster, leases, spawn policy, idle pool
- `reference/roles.md` � fichas de rol, criterios de enrutado, rotaci�n
- `reference/protocol.md` � handoff, gates, escalamiento, checkpoints, reintentos
- `reference/templates.md` � templates de board, state.json, handoff, review, gates, informe
- Repo: `github.com/SOCRAMbt/AI-OFFICE` � npm: `oficina-opencode`
