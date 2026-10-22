---
description: Abrir la Oficina de Agents para trabajar un objetivo de punta a punta con dispatch, auto-revisión, gates de calidad y evidencia por requisito
subtask: false
---

Cargá la skill `oficina` y seguí su protocolo exactamente. Si sus instrucciones no están ya en contexto, cargala primero.

**Objetivo de la corrida:** $ARGUMENTS

Si el objetivo está vacío, tomá el pedido más reciente del usuario en esta conversación como objetivo.

## Paso 0 — ¿Plugin o fallback?

**[plugin]** Si tenés las tools `oficina_*` disponibles, usá el **motor duro**. Es lo que hace que los invariantes dejen de ser sugerencias: el guard de scope rechaza escrituras fuera del scope, el gate corre comandos de verdad, y una card no se cierra sin evidencia.

Comprobá si existe `oficina_plan`. Si existe:

1. `oficina_plan` con el objetivo descompuesto en cards (ver abajo).
2. `oficina_dispatch` → **arma el equipo**: resuelve los roles en el catálogo de agency-agents, materializa los agentes y los arranca en paralelo.
3. `oficina_mesa` (view) → mirá quién trabaja en qué.
4. Corré el ciclo con las tools: `oficina_assign` → trabajo → `oficina_submit` → `oficina_review` → `oficina_evidence` → `oficina_gate`.
5. `oficina_cost` para el costo; `oficina_stop` si la corrida se descontrola.

**Si NO hay plugin**, seguí el flujo de artefactos en markdown de `reference/protocol.md`. Mismo protocolo, sin enforcement.

## Arrancá así — sin preguntar permiso

1. Leé `reference/protocol.md` y `reference/roles.md` de la skill `oficina`.
2. **Resolvé PROJECT_ROOT** siguiendo el Paso 0 del protocolo (buscá markers de proyecto; no asumas que el cwd es el proyecto). `OFFICE_DIR = PROJECT_ROOT/.oficina/`. Usá paths ABSOLUTOS en todo lo que escribas y en todos los prompts de delegación.
3. Descomponé el objetivo en cards con acceptance criteria **verificables** y gate explícito. Si el objetivo es vago, hacé las inferencias razonables y anotá cuáles son — no frenes por ambigüedad menor. Ordená las cards por **causa**: si el fix de B rompe el gate de A, B va primero.
4. Cada card necesita: `scope` (qué archivos puede tocar), `acceptance` (criterios verificables) y `gate` (el comando que lo demuestra).
5. Delegá por la **tabla de enrutado** de `reference/roles.md`. El Crítico nunca es el owner. El Verificador nunca es el Implementador. Cada subagente es stateless: el prompt lleva TODO el contexto, y los paths absolutos del PROJECT_ROOT.
6. Corré el ciclo: TRABAJO → AUTO-REVIEW → GATES + EVIDENCIA → DONE, o REWORK/REPLAN/ESCALADA.
7. Checkpoint al usuario cada 3 cards — **informá y seguí**, no pidás permiso.
8. Escalá solo con el formato de 2-3 opciones concretas + recomendación.

## Presupuesto

20 cards, 40 invocaciones de subagente, 20 spawns por corrida. **[plugin]** El costo real (tokens y USD) se ve con `oficina_cost`; si se dispara, `oficina_stop` frena la corrida.

## Lo que esta oficina garantiza

- Ninguna card se marca DONE sin `gates.md` en PASS
- **[plugin]** Ninguna card se marca DONE sin evidencia para cada criterio de aceptación obligatorio
- Ningún trabajo se auto-aprueba
- Nada se pierde: todo está en `.oficina/artifacts/`
- El objetivo se trabaja hasta cumplirlo o hasta un bloqueo real

Arrancá ya. Reportá el plan de cards en 5-8 líneas y seguí con la primera.
