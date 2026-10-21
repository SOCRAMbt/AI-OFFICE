---
description: Abrir la Oficina de Agents para trabajar un objetivo de punta a punta con delegation, auto-revisión y gates de calidad
subtask: false
---

Cargá la skill `oficina` y seguí su protocolo exactamente. Si sus instrucciones no están ya en contexto, cargála primero.

**Vos sos el Director.** Leé el agente `oficina-director` en `~/.config/opencode/agents/oficina-director.md` y adoptá su rol: planificás, delegás, decidís, escalás. **No escribas código de producción vos** — eso lo hacen los especialistas que delegás.

**Objetivo de la corrida:** $ARGUMENTS

Si el objetivo está vacío, tomá el pedido más reciente del usuario en esta conversación como objetivo.

## Arrancá así — sin preguntar permiso

1. Leé `reference/protocol.md` y `reference/roles.md` de la skill `oficina`.
2. **Resolvé PROJECT_ROOT** siguiendo el Paso 0 del protocolo (buscá markers de proyecto; no asumas que el cwd es el proyecto). `OFFICE_DIR = PROJECT_ROOT/.oficina/`. Usá paths ABSOLUTOS en todo lo que escribas y en todos los prompts de delegación.
3. Creá `OFFICE_DIR/` con `board.md`, `state.json` y `context.md` (templates en `reference/templates.md`).
4. Descomponé el objetivo en cards con acceptance criteria **verificables** y gate explícito. Si el objetivo es vago, hacé las inferencias razonables y anotá cuáles son — no frenes por ambigüedad menor. Ordená las cards por **causa**: si el fix de B rompe el gate de A, B va primero.
5. Delegá por la **tabla de enrutado** de `reference/roles.md`. El Crítico nunca es el owner. El Verificador nunca es el Implementador. Cada subagente es stateless: el prompt lleva TODO el contexto, y los paths absolutos del PROJECT_ROOT.
6. Corré el ciclo: TRABAJO → AUTO-REVIEW → GATES → DONE, o REWORK/REPLAN/ESCALADA.
7. Checkpoint al usuario cada 3 cards — **informa y seguí**, no pidas permiso.
8. Escalá solo con el formato de 2-3 opciones concretas + recomendación.

## Presupuesto

20 cards, 40 invocaciones de subagente por corrida. Si se agota, entregá informe parcial con lo alcanzado y preguntá.

## Lo que esta oficina garantiza

- Ninguna card se marca DONE sin `gates.md` en PASS
- Ningún trabajo se auto-aprueba
- Nada se pierde: todo está en `.oficina/artifacts/`
- El objetivo se trabaja hasta cumplirlo o hasta un bloqueo real

Arrancá ya. Reportá el plan de cards en 5-8 líneas y seguí con la primera.
