# Oficina · Dashboard v3.3.0

Interfaz en tiempo real para **ver** AI-OFFICE: la mesa redonda con los agentes, el bus de mensajes, el tablero Kanban, los gates y el circuit breaker — layout estilo AI-OFFICE Dashboard v3.3.0 (oscuro profundo, Inter/ui-monospace, cero CDN, funciona offline).

## Cómo abrirlo

```bash
# 1. Con datos reales (recomendado) — desde la raíz del repo:
node dashboard/server.mjs            # → http://localhost:7333

# 2. Demo rica (corrida sintética RUN-2025-05-18-0017: 5 agentes,
#    17 cards en 5 columnas, bus, gates, circuit breaker):
npm run dashboard:demo               # regenera .oficina-demo/ y sirve en 7333

# 3. Contra otro proyecto:
node dashboard/server.mjs --oficina /ruta/al/proyecto/.oficina --port 8080
```

## Qué muestra cada panel

| Panel | Qué muestra | Fuente |
|---|---|---|
| **AGENTS** | Roster activo: avatar por rol con punto de estado (working/mint, reviewing/amber, idle/gray), tarea actual, waveform animado | `roster.json` + `state.json` |
| **The Round Table** | Mesa elíptica cenital con los agentes alrededor, logos hex y burbujas de coordinación (último mensaje relevante del bus por agente) | `roster.json` + `bus/` |
| **Message Bus** | Feed determinista (más reciente abajo), rutas `Commander → Implementer`, timestamps mono, prioridad alta con borde ámbar; input para mensajes del operador (`POST /api/dashboard-message` → canal `bus/dashboard/`) | `bus/*/*.json` |
| **GATES** | Último resultado por fase (Build/Typecheck/Lint/Test) agregado de todas las cards, badge Passed/Failed, hace cuánto | `artifacts/<card>/gates.md` (+ `mtime`) |
| **CIRCUIT BREAKER** | Estado real derivado de `failureHistory` / cards `blocked_escalated`: **Closed** si no hay nada bloqueado, **Tripped** con las cards afectadas y el umbral (3 fallos idénticos o 5 rechazos) | `state.json` |
| **RECENT ACTIVITY** | Últimas decisiones de la corrida (aprobadas, gate-fails, escaladas, asignaciones) con hora exacta; "View all events" expande el historial | `state.decisions[]` |
| **TASK BOARD** | Columnas Backlog / In Progress / Review / Done / Blocked con ids `#NN`, chips de rama, paperclip de artefactos, check en Done, chip `Typecheck` en Blocked, agrupar por owner, filtro "solo activas", `+ New Card` (copia JSON listo para pegar) | `state.json` |
| **Metrics** | Progreso %, cards done, duración (tick cada 1s), throughput tasks/h; Tokens: `—` honesto (el host OpenCode no expone conteo) | `state.json` |

## Interacciones

- Escalate → modal con payload `oficina_escalate` copiable al portapapeles
- Stop Run → modal con instrucciones (el dashboard no mata procesos; frená la sesión de OpenCode) + instrucción copiable
- Copiar Run ID (chip superior y footer)
- `View all events →` expande el feed de actividad
- `Esc` cierra modales · colapsar paneles con las ✕ de cada cabecera
- Live badge conectada vía SSE (`api/events`) con fallback a polling de 4s; banner ámbar "SIN CONEXIÓN" si `.oficina/` no responde

## Arquitectura

- `dashboard.html` — estructura + estilos + cliente (una sola página, sin build step, sin CDN)
- `server.mjs` — Node puro, cero dependencias: sirve estáticos, agrega `.oficina/` (`/api/state`, `/api/gates`, `/api/artifacts`, `/api/events` SSE con cursor, `/api/dashboard-message` POST), loopback-only
- `scripts/seed-demo.mjs` — genera la corrida sintética `.oficina-demo/` (idempotente)
- `dashboard.css`, `dashboard.js` — **legacy v3.2.0**, sin referencias en `dashboard.html` (pendiente de eliminar en un refactor futuro)

## Accesibilidad

- `role="log"` en el feed del bus, `aria-live="polite"`, modales con `role="dialog"` + `aria-modal` + cierre por Escape/backdrop
- Foco visible con `:focus-visible`, targets ≥ 24px, `prefers-reduced-motion` desactiva animaciones
- Contraste alto en toda la paleta (AAA sobre fondos `#0b0f17`)

## Notas

- Si `.oficina/` no responde, la interfaz conserva el último snapshot y muestra el banner — nunca inventa datos.
- `.oficina-demo/` es un fixture sintético (git-ignored) — regenerar con `npm run dashboard:demo`.
- Atajos previos (tema/replay WebGL) se retiraron con el rediseño v3.3.0; el replay scrub del bus queda como trabajo futuro.
