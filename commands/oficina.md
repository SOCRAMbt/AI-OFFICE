---
description: Abrir la Oficina de Agents para trabajar un objetivo de punta a punta con dispatch, auto-revisión, gates de calidad y evidencia por requisito. Flags: `/oficina lite` (Modo Célula), `--maxagents N` (tope de N agentes simultáneos; sin el flag, la corrida queda en un tope conservador fijo).
subtask: false
---

Cargá la skill `oficina` y seguí su protocolo exactamente. Si sus instrucciones no están ya en contexto, cargala primero.

**Objetivo de la corrida:** $ARGUMENTS

Si el objetivo está vacío, tomá el pedido más reciente del usuario en esta conversación como objetivo.

## Flags que acepta esta invocación

| Flag | Efecto |
|---|---|
| `--lite` | Modo Célula (1 Ejecutor + 1 Revisor cruzado). Equivale a `/oficina lite`. |
| `--full` | Modo Completo forzado (salta la auto-degradación). |
| `--maxagents N` | Tope de N agentes simultáneos para la corrida (1-14). También vale `--maxagentes N`. |

### `--maxagents N` — el flag del usuario manda en el presupuesto

**Parsealo primero**: quitalo del texto del objetivo antes de planificar. Después:

- **Si el usuario pasó el flag:** llamá `oficina_plan` con `maxAgents: N`. El tope queda persistido en la corrida (`state.maxAgents`) y `oficina_dispatch` clampa contra él — nadie despacha más de N aunque pida más. Respetalo incluso si pensás que hacen falta más: si creés que es poco, decilo en tu informe con evidencia (no lo cambies vos).
- **Si el usuario NO lo pasó:** el motor arranca con un tope conservador fijo de **3**. Analizá si la tarea cabe en menos (2 o incluso 1 casi siempre alcanzan) y pasá ese número — nunca más de 3. Esto existe para que una corrida no se coma los créditos del usuario sin un pedido explícito.
- En el informe inicial cantá la decisión: `Agentes simultáneos: N` (fuente: flag `--maxagents` | `default conservador 3` | `elección tuya por debajo del tope`).

## Modo imperativo — /oficina lite vs /oficina

| Invocación | Modo | Cuándo |
|---|---|---|
| `/oficina lite <objetivo>` | **Modo Célula** | Tarea chica y aislada: 1 Ejecutor (especialista o fabricado) + 1 Revisor cruzado. Briefings compactos, gates directos, invariante owner ≠ reviewer. |
| `/oficina <objetivo>` | **Modo Full** | Arquitectura de 4 capas (Comandante, Arquitecto, Integrador, Peer Mesh): trabajo multi-módulo, con búsqueda de dependencias y paneles. |
| `/oficina --full <objetivo>` | **Modo Full forzado** | Saltá la auto-degradación (ver abajo). |
| `/oficina --maxagents 5 <objetivo>` | **Modo Full con tope** | Igual que Full, pero la corrida no despacha más de 5 agentes simultáneos, pase lo que pase. |

### Auto-triage inteligente

Si se invoca `/oficina` sin `lite`, el Comandante debe evaluar el alcance ANTES de planificar y **degradar automáticamente a Modo Célula** cuando el objetivo:
- toca ≤ 2 archivos,
- o es un cambio aislado de baja complejidad (sin cambios transversales, sin replan de arquitectura),
- y cabe en 1 card con ≤ 3 acceptance criteria.

Al degradar: registrar la decisión en el bus (`oficina_bus action=send kind=STATUS subject=modo-lite` con el motivo), decirlo explícitamente al usuario, y proceder en Modo Célula (roles `Ejecutor` + `Revisor Cruzado`). Si el usuario quiere el modo completo: lo vuelve a invocar con `/oficina --full`.

Si ninguna de estas tres aplica, usar Modo Full (4 capas) normalmente.

## Paso 0 — ¿Plugin o fallback?

> **Dashboard en vivo (obligatorio):** al arrancar una corrida, el dashboard
> visual se abre automáticamente en el navegador. En tu **primer mensaje** a la
> corrida, avisá al usuario con la ubicación real y que lo abriste, tomando la
> URL de `<PROJECT_ROOT>/.oficina/dashboard.json` (no asumas 7333):
>
> `Dashboard en vivo: <url> (lo abrí en tu navegador — datos de <PROJECT_ROOT>/.oficina/)`
>
> Si no abrió solo: `oficina dashboard`. Si no arranca: avisá y seguí igual —
> es best-effort, nunca bloquea la corrida. La mesa muestra EXACTAMENTE los
> agentes despachados (0 es 0, 3 es 3, 10 es 10); nada de relleno.

**[plugin]** Si tenés las tools `oficina_*` disponibles, usá el **motor duro**. Es lo que hace que los invariantes dejen de ser sugerencias: el guard de scope rechaza escrituras fuera del scope, el gate corre comandos de verdad, y una card no se cierra sin evidencia.

Comprobá si existe `oficina_plan`. Si existe:

1. `oficina_plan` con el objetivo descompuesto en cards. Si degradaste a Modo Célula, pasá `mode: "lite"`; por defecto el motor auto-evalúa y degrada si corresponde. **Pasá siempre `maxAgents`**: `N` si el usuario usó `--maxagents N`; o el número conservador que elijas tras analizar la tarea (≤ 3) si no hay flag. Si lo omitís, el motor aplica 3.
2. `oficina_dispatch` → **arma el equipo**: resuelve los roles en el catálogo de agency-agents, materializa los agentes y los arranca en paralelo. En Modo Célula: solo 1 Ejecutor + 1 Revisor cruzado. Si no hay match, la factory crea un agente persistente en `.opencode/agents/` y queda en el catálogo vivo.
3. `oficina_mesa` (view) → mirá quién trabaja en qué.
4. Corré el ciclo con las tools: `oficina_assign` → trabajo → `oficina_submit` → `oficina_review` → `oficina_evidence` → `oficina_gate`.
5. `oficina_stop` si la corrida se descontrola.

**Si NO hay plugin**, seguí el flujo de artefactos en markdown de `reference/protocol.md`. Mismo protocolo, sin enforcement.

## Arrancá así — sin preguntar permiso

1. Leé `reference/protocol.md` y `reference/roles.md` de la skill `oficina`.
2. **Resolvé PROJECT_ROOT** siguiendo el Paso 0 del protocolo (buscá markers de proyecto; no asumas que el cwd es el proyecto). `OFFICE_DIR = PROJECT_ROOT/.oficina/`. Usá paths ABSOLUTOS en todo lo que escribas y en todos los prompts de delegación.
3. Definí cards con acceptance criteria **verificables** y gate explícito. Si el objetivo es vago, hacé las inferencias razonables y anotá cuáles son — no frenes por ambigüedad menor. Ordená las cards por **causa**: si el fix de B rompe el gate de A, B va primero.
   - En **Modo Célula**: 1 sola card o 2; Executive Briefing compacto (6 líneas); espalda de la card mínima; sin peers.
4. Cada card necesita: `scope` (qué archivos puede tocar), `acceptance` (criterios verificables) y `gate` (el comando que lo demuestra).
5. Delegá por la **tabla de enrutado** de `reference/roles.md`. El Crítico nunca es el owner. El Verificador nunca es el Implementador. Cada subagente es stateless: el prompt lleva TODO el contexto, y los paths absolutos del PROJECT_ROOT.
6. Corré el ciclo: TRABAJO → AUTO-REVIEW → GATES + EVIDENCIA → DONE, o REWORK/REPLAN/ESCALADA.
7. En **Modo Célula**: checkpoint al usuario cada card (alcanza con 1). En **Modo Full**: cada 3 cards. Siempre **informá y seguí**, no pidás permiso.
8. Escalá solo con el formato de 2-3 opciones concretas + recomendación. Incluí el estado del Circuit Breaker si una card se bloqueó.

## Lo que esta oficina garantiza

- Ninguna card se marca DONE sin `gates.md` en PASS
- **[plugin]** Ninguna card se marca DONE sin evidencia para cada criterio de aceptación obligatorio
- Ningún trabajo se auto-aprueba
- Nada se pierde: todo está en `.oficina/artifacts/`
- BLOCKED_ESCALATED frena una card atascada; el resto del DAG sigue
- El objetivo se trabaja hasta cumplirlo o hasta un bloqueo real

Arrancá ya. Reportá el plan de cards en 5-8 líneas y seguí con la primera.
