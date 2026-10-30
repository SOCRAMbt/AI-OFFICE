# Oficina · Dashboard visual

Interfaz en tiempo real para **ver** cómo trabaja la Oficina de Agents: la mesa, el bus de mensajes, las decisiones del jefe, el kanban de cards, los gates y la factory.

## Cómo abrirlo

```bash
# 1. Con datos reales (recomendado) — desde la raíz del repo:
node dashboard/server.mjs          # → http://localhost:7333

# 2. Sin server — abrí dashboard/dashboard.html en el browser:
#    entra en Modo Demo (datos simulados, claramente etiquetados).
```

## Qué muestra cada panel

| Panel | Qué muestra | Fuente |
|---|---|---|
| **Mesa** | La mesa redonda con cada agente: anillo de color por estado (ámbar = trabajando, verde = libre, rojo = sin heartbeat), card actual, y cards sin owner (recuadro punteado) | `roster.json` + `state.json` |
| **Bus de mensajes** | Flujo entre agentes: HELP_REQUEST, CLAIM, STATUS, SPAWN… con flechas `→`, color por prioridad, threading visual (respuestas indentadas) | `bus/peer/*.json` |
| **Decisiones del jefe** | Feed de Director / Integrator / Architect / Commander | mensajes de `oficina-*` |
| **Cards** | Kanban de 7 columnas: todo → in_progress → review → done / rework / blocked / escalated, con owner, reviewer, count de rechazos y checklist de acceptance criteria | `state.json` |
| **Gates** | Al hacer click en una card: spinners de gates (build, typecheck, lint, test, security, diff) y PASS/FAIL + links a evidence.md / handoff.md | `artifacts/<card>/gates.md` |
| **Factory** | Toast animado cuando aparece un agente nuevo en el roster | diff de `roster.json` |
| **Replay** | Grabación de la sesión paso a paso (scrub del bus) | buffer en memoria |

## Atajos de teclado

- **T** — tema oscuro/claro
- **R** — modo replay
- **Esc** — salir del replay

## Arquitectura

- `dashboard.html` — estructura (una sola página, sin build step)
- `dashboard.css` — tokens en `:root`, tema dark/light, solo se anima `transform`/`opacity`
- `dashboard.js` — conexión (SSE + polling), render de los 6 paneles, modo demo, replay, fondo WebGL con bloom (three.js vía esm.sh, fallback silencioso)
- `server.mjs` — Node puro, cero dependencias: sirve los archivos, agrega `.oficina/`, watch + SSE

## Accesibilidad

- ARIA live regions en bus y toasts (`role="log"`, `role="status"`)
- Navegación por teclado: los mensajes y cards son focusables, se expanden con Enter/Espacio
- Contraste AA en ambos temas
- `prefers-reduced-motion` desactiva animaciones y el fondo WebGL

## Notas

- El modo demo existe para ver la interfaz sin corrida activa; el banner lo indica.
## Arranque

**Automático (recomendado):** arrancá una corrida con el comando `/oficina` o con el plugin instalado: el dashboard se levanta solo en background y el navegador se abre cuando la corrida arranca. Se negocia un puerto libre si el 7333 está ocupado.

**Manual:**

```bash
node dashboard/server.mjs            # abre el navegador en 7333
oficina dashboard                    # CLI: igual, desde el paquete instalado
node dashboard/server.mjs --no-open  # solo servidor, sin navegador
node dashboard/server.mjs --oficina /ruta/al/proyecto/.oficina --port 8080
```

Sin datos reales la interfaz entra en modo demo (etiquetado, honesto): ves cómo se lee la mesa y el bus aunque no haya corrida activa; el banner lo indica.
- El fondo WebGL se degrada a nada si WebGL o la CDN no están disponibles — la mesa nunca depende de él.
