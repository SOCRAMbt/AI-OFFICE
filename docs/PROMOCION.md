# Promoción de AI-OFFICE — dossier operativo (2026-11-15)

> Notas del maintainer para crecer el proyecto. Nada acá es automático: cada acción pasa por humanos y por las reglas de cada plataforma. Nada de spam: el proyecto crece por confianza, no por volumen.

**Estado verificado (2026-11-15):** npm `oficina-opencode` v3.3.0, ~4.300 descargas/30d · GitHub `SOCRAMbt/AI-OFFICE` — 0★ (0estrellas visibles), 1 fork · MIT · OpenCode plugin.
**Consecuencia dura:** las awesome lists que exigen 25-100★ quedan bloqueadas hasta tracción; el canal activo hoy es el awesome-market (issue #4324) y el contenido propio.

## 1) Cerrar el loop abierto: awesome-opencode-market #4324 (URGENTE)

`https://github.com/awesome-market/awesome-opencode-market/issues/4324` — estado hoy: `open`, label `submission:needs-work`.
El bot marcó 4 red flags `.npmrc` en `dist/core/sandbox.js`, `dist/hooks/scopeGuard.js` (+ `.d.ts`). **Verificados en `src/`: son falsos positivos** — `.npmrc` sólo aparece en `SENSITIVE_PATTERNS` (paths que el agente puede **jamás escribir**, aunque su scope diga `"**"`) y en comentarios. El `curl` es una *detección* para bloquear `curl -o`/`wget -O`, nunca se ejecuta. El `fetch()` del dashboard va contra `http://localhost:7333` con allowlist `localhost|127.0.0.1`.

**Qué hacer (en orden):**

1. **Un único comentario** pidiendo re-review manual (texto en §4). 30 días sin actualizar = autocierre como "abandoned".
2. Si el maintainer pide fix real (p. ej., quitar el literal `.npmrc` del docstring), hacerlo y UN comentario más — nunca dos rondas de "decime si…".
3. Si pasa a `review:decided` pass, **no celebrar ni linkear el issue** — el listing viaja por su daily digest con ventana de objeciones.
4. Si a los 7 días no hay respuesta: un `ping` cordial. Nunca más de eso.

## 2) Tabla priorizada (impacto × esfuerzo, verificado 2026-11-15)

| # | Canal | Mecanismo | Autopromo | Esfuerzo | Estado |
|---|-------|-----------|-----------|---------|--------|
| 1 | #4324 re-review | Comentario único en el issue | n/a (pedido de review) | 15 min | ✅ abierto, needs-work |
| 2 | Console.dev (28k+ subs dev) | Email a hello@console.dev con detalles | sugerencias libres, no docs pagas | 10 min | ✅ verificado |
| 3 | TerminalDock | Formulario `/submit` (cuenta) | listing gratis | 20 min | ✅ verificado |
| 4 | GitHub: topics + badges + social preview | Settings + asset | n/a | 20 min | ✅ topics OK; falta imagen social |
| 5 | Web Tools Weekly | DM a `@LouisLazaris` (X/Bluesky) | links, no tutoriales | 15 min | ✅ 200 |
| 6 | Fazier (AI tools daily) | Formulario gratis | libre | 20 min | ✅ 200 |
| 7 | Changelog News | changelog.com/news/submit (login) | propio estilo, alentado | 20 min | ✅ verificado |
| 8 | Show HN (mar–jue) | "Show HN: …" en news.ycombinator.com/submit | OK si es tryable; sin pedir upvotes | 45 min | ✅ guías verificadas |
| 9 | awesome-ai-devtools (~4k★) | PR a README, sección *Multi-Agent Orchestration* | gratis — se espera que mandes tu tool | 30 min | ✅ PR template verificado |
| 10 | awesome-ai-sdks (e2b-dev, 1.2k★) | PR a README | libre | 30 min | ✅ verificado |
| 11 | awesome-opencode (11k★) | PR con YAML en `data/plugins/` | **bloqueado: exige ≥25★** | 45 min | ⛔ hasta ≥25★ |
| 12 | OpenCode Discord | canal showcase | feedback, no anuncio | 15 min | ✅ invite OK; canales no verificables sin cuenta |
| 13 | OpenCode X (233k) | reply/quote técnico a posts propios | orgánico | 20 min | ✅ verificado |
| 14 | dev.to / Hashnode | artículo técnico (EN y/o ES) | contenido no promocional-primario | 3–4 h | ✅ ambos 200 |
| 15 | DevHunt | launch semanal medido lunes UTC (gratis; listing básico gratis) | es su modelo | 30 min + opcional $49 | ✅ verificado |
| 16 | Uneed | formulario (fila ~5 meses; fast-track pago) | libre | 15 min | ✅ 200 |
| 17 | Microlaunch | launch mensual gratis | libre | 20 min | ✅ 200 |
| 18 | OpenAlternative | cuenta + formulario (alternativa OSS) | listings gratuitos | 30 min | ✅ redirect login |
| 19 | LibHunt / SaaSHub | formulario | ~360k devs/mes (vendor-reported) | 30 min | ⚠️ 403 a bots |
| 20 | freeCodeCamp ES (contenido) | propuesta editorial al equipo | contenido gratuito, no publicidad | 6–10 h | ⚠️ flujo editorial sin verificar |

### Blacklist (no abrir: queman el proyecto)

- **awesome-opencode / awesome-nodejs / awesome-cli-apps** — exigen 25–100★ hoy; 0★ ⇒ cierre automático.
- **awesome-claude-code** — fit Claude Code + exigió ≥100★; recurso OpenCode-first off-target.
- **awesome-ai-agents (e2b, 31k★)** — "only AI assistants and agents", no herramientas → rechazo.
- **awesome-mcp-servers** — AI-OFFICE no es MCP. **free-for-dev / awesome-selfhosted-data** — no es SaaS ni infra.
- **r/programming / Lobste.rs** — autopromo baneada/invite-only + enfriamiento 70 días.
- **TLDR / Ben's Bites / Bytes / Pragmatic Engineer / Latent Space** — todo sponsoring de pago.
- **Xataka / Genbeta** — sin contacto editorial verificable; **no** pitch a ciegas.
- **Product Hunt** — sólo réplica de bajo coste; no canal principal para tool de nicho.
- **Reviews falsos en Product Hunt/G2, botnets de upvotes, posts "Try my plugin 🚀" repetidos** — shadowban inmediato.

## 3) Secuencia sugerida (qué hacer en qué orden)

**Semana 1 — cerrar loops de cero fricción:** comentario #4324 (§4) · email Console.dev · TerminalDock/Fazier/Uneed/Microlaunch · Changelog News (real news: v3.3.0). **No** lanzar DevHunt el mismo día que Show HN.
**Semana 2 — contenido técnico como motor:** artículo EN (dev.to/Hashnode) + ES (dev.to/es o freeCodeCamp propuesta): "De un agente que chatea a un equipo que termina tarea con evidencia", con `npm i -g oficina-opencode`; **Show HN martes–jueves**, texto modesto con feedback real y anti-claims; reseñar #4324 sólo como eco, no como pedido de voto.
**Semana 3–4 — convertir atención en assets:** DevHunt (si hay apoyos reales, nunca pedidos) · post técnico en Discord OpenCode + reply en X · PRs a `awesome-ai-devtools` y `awesome-ai-sdks` si los de la semana 2 aún no se cerraron · revisitar `awesome-opencode` cuando ≥25★.

**Reglas de hierro:** no pedir upvotes · no cross-post idéntico en N canales el mismo día · un único comentario de re-review en #4324 · cadencia visible de commits/releases (los listings premian actividad) · ningún claim sin número verificable (el review bot ya marca credibilidad).

## 4) Textos listos para copiar

### 4.1 Comentario final en `#4324` (EN, un único comentario)

> Hi — thanks for the automated pass. I believe the 4 red flags are false positives and wanted to give you the receipts so it's 2 minutes to verify: `.npmrc` (and `.env`, keys) appear only in `SENSITIVE_PATTERNS` in `src/core/sandbox.ts` — a hard-coded list of paths agents may **never write**, regardless of task scope. `src/hooks/scopeGuard.ts` documents the same rule. The `curl` finding is a pattern that **blocks** `curl -o` / `wget -O` from agents (never executes them). Dashboard `fetch()` calls target `http://localhost:7333` guarded by an allowlist regex — local-only. Child processes are the documented design of this runtime: it orchestrates agents that run user commands under leases/gates; it doesn't harvest credentials. Could a maintainer re-review manually (or `/approve`)? Happy to split a minimal `docs/SECURITY-MODEL.md` if useful. Thanks!

### 4.2 Show HN (título: `Show HN: AI-OFFICE – durable multi-agent orchestration for OpenCode`)

> AI-OFFICE (oficina-opencode) is an open-source plugin for OpenCode that runs durable multi-agent "corridas": a coordinator/peer-mesh dispatches subagents from a 250+ role catalog, messages travel over a disk-based bus with leases, and task cards can't close without quality gates plus per-criterion evidence. Runs survive restarts (state in `.oficina/`), with atomic writes and FIFO episodic memory. Built by a solo founder in Argentina. MIT — `npm install -g oficina-opencode && oficina install`. v3.3.0, ~4.3k downloads/30d. Feedback welcome — especially on the gate/evidence model and what breaks under long unattended runs.

### 4.3 Email a Console.dev

> Subject: Tool suggestion: AI-OFFICE — durable multi-agent orchestration for OpenCode
>
> Hi — suggesting AI-OFFICE (oficina-opencode), my open-source plugin for OpenCode. It gives the CLI durable multi-agent runs: coordinator + peer mesh, disk message bus with leases, quality gates and per-criterion evidence before a task closes. 250+ role catalog, local state, MIT, zero hosted services. `npm install -g oficina-opencode`, v3.3.0, ~4.3k dl/mo. Docs in Spanish+English, active changelog with provenance-linked npm releases. Repo: github.com/SOCRAMbt/AI-OFFICE. Happy to answer questions or prep a hands-on test.

### 4.4 PR awesome-ai-devtools (línea, sección Multi-Agent Orchestration) + cuerpo

```
- [AI-OFFICE](https://github.com/SOCRAMbt/AI-OFFICE) - Open-source multi-agent orchestration plugin for OpenCode: durable coordinator/peer-mesh runs, disk message bus with leases, quality gates with per-criterion evidence. MIT.
```

> Adds AI-OFFICE to Multi-Agent Orchestration. It's a developer tool (not a general-purpose AI framework): an OpenCode plugin that dispatches subagents from a 250+ role catalog with durable state, leases and evidence gates. `npm install -g oficina-opencode`. MIT, actively maintained, EN/ES docs.

### 4.5 DevHunt (listing; launch semanal medido lunes UTC)

> AI-OFFICE — the open-source "office of agents" for OpenCode. One command sets up everything: dispatch from a 250+ role catalog, coordinator + peer mesh over a disk message bus with leases, quality gates you can't bypass, per-criterion evidence, durable runs that resume after crashes. For devs who want agents to actually finish — not just chat. `npm i -g oficina-opencode` · free · MIT · github.com/SOCRAMbt/AI-OFFICE

### 4.6 dev.to (ES) — artículo de entrada

> **Orquestación multi-agente durable para OpenCode: cómo hice que 6 agentes terminen de verdad** — tags `es` `opencode` `ai` `agents`
> Tesis: un agente que "termina" no es uno que dijo "listo" — es uno cuyos gates corrieron, cuya evidencia está en disco y cuyo reviewer no era él mismo. Sesenta líneas: bus en disco, leases con TTL, cards con acceptance verificable. Sin claims: dónde falla (tokens, leases que vencen, revisión forzada). Código real de `.oficina/artifacts/`, nunca teoría. `npm i -g oficina-opencode`, MIT.

## 5) Repos/listas verificadas que faltan por 0★ (revisitar en mes 2)

- **awesome-opencode** (PR `data/plugins/`) — exige ≥25★. Protocolo: 25★ ⇒ PR con YAML; nunca antes.
- **awesome-nodejs / awesome-cli-apps** — exigen 100★/20★. Idem.
- **awesome-opencode-skills / awesome-opencode-subagents** — mal fit (colecciones de definiciones), no mandar.
- **free-for-dev** — SaaS con free tier; AI-OFFICE no aplica.

## 6) Checklist mínima de GitHub (Settings del repo, 10 min)

1. **Social preview**: subir imagen 1280×640 (reutilizar banner de `docs/assets/banner.svg`).
2. **Topics**: ya están (`opencode`, `opencode-plugin`, `multi-agent`, `agent-mesh`…). Agregar sólo si falta: `orchestration`.
3. **Discussions**: activar (Settings → Features → Discussions) para preguntas/recomendaciones de colaboradores en un canal único menos ruidoso que los issues; los templates nuevos ya cubren bug/recomendación.
4. **Comunicado**: habilitar "Sponsor" no hace falta hoy; **sí** habilitar Issues (ya), y pin de releases
5. **README EN**: agregar resumen de 5 líneas en inglés arriba (npm es inglés por defecto y los bots de listings parsean mejor).

## 7) Qué quedó fuera (honesto)

- No se publicó ni comentó nada en ningún canal: los textos son material de decisión.
- No se hicieron reviews ni listings pagados.
- La verificación en vivo quedó al 2026-11-15; re-verificar la semana de publicación de cada acción (las reglas cambian).
