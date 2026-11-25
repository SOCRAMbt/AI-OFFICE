# LANZAMIENTO — Kit de publicación de AI-OFFICE

> Esto es un **guión de ejecución**, no contenido para automatizar. Cada canal se publica **a mano**, desde tus cuentas, cuando decidas. No hay un solo claim acá que no se pueda verificar en el repo.

## Objetivo honesto (lo que puede pasar)

No "^volverse viral". Objetivo medible después del lanzamiento:

1. **≥ 25 estrellas en GitHub** → desbloquea `awesome-opencode` (criterios verificados) y la conversación entre developers serios.
2. **1–2 issues humanas reales** (bug, recomendación) → primera señal de usuarios reales.
3. **Discusiones/Discord con 10+ mensajes** → la comunidad empieza a hablar sola.
4. **Google indexando `/oficina`** → tráfico web recurrente.

Si no pasa nada de eso, la conclusión no es "el producto no sirve": es que el contenido o el canal estaban mal. Iterar, no insistir.

---

## DÍA 0 — Preparación (antes de publicar nada)

10–15 minutos en la UI de GitHub (nada puede hacerse desde el CLI sin tu cuenta):

- [ ] **Releases publicadas** manualmente para `v3.3.0` y `v3.2.6` usando `docs/release-notes/*.md` (texto ya listo; tags ya existen en el repo remoto).
- [ ] **Pages activadas**: Settings → Pages → Source: `Deploy from a branch` → Branch: `main` / folder: `/docs` → Save. El demo ya vive en `docs/index.html` y el link `socrambt.github.io/AI-OFFICE/` ya está en el README y en el social preview.
- [ ] **Discussions activadas**: Settings → General → Features → Discussion ✅. Canal natural para "preguntas / show and tell".
- [ ] **Social preview subida**: Settings → Social preview → subir `docs/assets/social-preview.png` (1280×640, ya en el repo).
- [ ] **Topics verificados**: `opencode`, `opencode-plugin`, `multi-agent`, `agent-mesh`, `orchestration`, `developer-tools`, `slash-command`. (Ya están o alcanzan con agregar 2 desde la rueda de ⚙️ del repo.)
- [ ] **#4324 (awesome-market)**: publicar el único comentario de re-review de `docs/PROMOCION.md` §4.1.
- [ ] **CI verde** en `main` (correr `npm test` y `npm run smoke` una última vez; todo está verde desde v3.3.0).

Regla de oro del DÍA 0: **el sitio se ve, funciona e instala antes de que nadie lo vea.** Un link que cae en errores es peor que un lanzamiento aburrido.

---

## DÍA 1 — Show HN (martes o jueves, 08:30–10:00 ET)

### Título (copiar exacto, sin mejorarlo)

```
Show HN: AI-OFFICE – durable multi-agent orchestration for OpenCode
```

### Cuerpo (pegar tal cual)

```
I built AI-OFFICE (oficina-opencode on npm, GitHub repo) after hitting, over and over, the same problem every multi-agent CLI user faces: the agent stops when the model says "I'm done" — not when the work is actually done.

It's an OpenCode plugin that runs durable multi-agent "corridas": a coordinator/peer-mesh dispatches subagents from a 250+ role catalog, messages travel over a disk-based bus with leases, and task cards can't close without quality gates plus per-criterion evidence saved in .oficina/.

- MIT, zero hosted services; state lives on your machine
- Quality gates you can't bypass: build, typecheck, lint, test, secrets scan
- Agents help each other over the disk bus (HELP_REQUEST / HELP_ACCEPT) instead of flooding your context
- v3.3.0, 574 tests passing, ~4.3k downloads on npm in the last 30 days
- Honest status: solo mantenedor, solo founder, y este plugin se construyó usándose a sí mismo. Es temprano. Prefiero escuchar qué se rompe antes que aplausos.

Repo: https://github.com/SOCRAMbt/AI-OFFICE · npm: https://www.npmjs.com/package/oficina-opencode
```

### Primer comentario (tu voz, 3–5 líneas, publicar 2 min después)

```
Happy to answer anything. The bit that took longest wasn't the bus or the gates — it was getting agents to recover from their own bad outputs: rejections, missing evidence, circuit breakers. If you try it and it does something dumb, please open an issue with the .oficina/ output and I'll fix it. That's the whole point of the project.
```

### Reglas

- Responder **todo** comentario en HN (inglés), corto y técnico. Nada de defensas; agradecer y escuchar.
- No pedir upvotes, ni aquí ni en ningún lado. Si HN decide que molesta, morís ahí.
- No editar el post. Si te equivocaste, corregí en comentarios.

---

## DÍA 2 — Comunidad y directorios (30 min, gratis)

### Email a Console.dev (David, revisa cada envío con sus propios criterios)

```
Subject: Tool suggestion: AI-OFFICE — durable multi-agent orchestration for OpenCode

Hi David — suggesting AI-OFFICE (oficina-opencode), my open-source plugin for OpenCode. It gives the CLI durable multi-agent runs: coordinator + peer mesh, disk message bus with leases, quality gates and per-criterion evidence before a task closes. 250+ role catalog, local state, MIT, zero hosted services. npm install -g oficina-opencode, v3.3.0, ~4.3k dl/mo. Docs in Spanish+English, active changelog with provenance-linked npm releases. Repo: github.com/SOCRAMbt/AI-OFFICE. Happy to answer questions or prep a hands-on test.
```

### Changelog News — https://changelog.com/news/submit

```
AI-OFFICE: durable multi-agent orchestration plugin for OpenCode (v3.3.0)
Nueva versión con --maxagents flag para controlar cuántos agentes puede desplegar una corrida, y templates oficiales de reporte y recomendación para la comunidad. MIT, provenance SLSA.
```

### Discord de OpenCode — canal showcase (preguntar por el canal si no existe)

```
Hey — I built an OpenCode plugin: AI-OFFICE. Corridas multi-agente durables con gates que no se omite y evidencia por criterio. Solo quiero feedback honesto de la gente que lo usa — qué se rompe cuando lo probás. MIT, gratis: npm install -g oficina-opencode. Repo: github.com/SOCRAMbt/AI-OFFICE
```

---

## DÍA 3 — dev.to (artículos técnicos — el único formato que funciona en frío sin audiencia)

### Título y tags

```
How I made AI agents finish their work (disk bus, leases, evidence gates)
#opencode #ai #agents #showdev
```

### Estructura que siempre funciona

1. El problema (agentes que "terminan" sin hacer nada verificable).
2. Solución en 4 piezas: card + scope → gates que corren → evidencia por criterio → bus en disco.
3. Código REAL: un excerpt de `gates.ts` con el escaneo de secretos y de `office.ts` con la persistencia atómica; el fingerprint del circuit breaker que salvó una corrida mía.
4. **Fallas honestas que cometiste**: el run donde T-04 se atascó, el fallback silencioso de las sesiones mías, los claims que tuve que bajar.
5. Cómo probarlo en 5 minutos (npm install, /oficina <objetivo>, mirar `.oficina/`).

Extensión: 800–1.200 palabras. Nada de "conclusiones" vacías; terminar con "¿qué se rompe para vos?"

---

## DÍA 4 — X (Twitter) e LinkedIn (build in public)

### Hilo X (6 posts, inglés, las cuentas de herramientas de IA adoran esto)

1/ Most multi-agent CLIs ship agents that "finish" when the model says done. Not when the work is done. I built something else.

2/ AI-OFFICE (oficina-opencode) runs durable corridas in OpenCode: coordinator + peer mesh dispatch subagents from a 250+ role catalog. Messages go over a disk bus with leases.

3/ And the detail that changes everything: task cards can't close without quality gates plus per-criterion evidence. The model can't talk its way out of DONE.

4/ Numbers, no hype: 574 tests, ~4.3k npm downloads in 30 days, MIT, solo maintainer, v3.3.0 released today.

5/ Things that broke (fix the loop, not the claim): cold starts with no canDelegate agents, silent fallbacks, circuit breakers that learned from their own rejections.

6/ MIT + free: npm install -g oficina-opencode. Repo: github.com/SOCRAMbt/AI-OFFICE. Star if it helps you — and break it, honestly.

### LinkedIn (1 párrafo, español)

```
Llevo semanas construyendo AI-OFFICE (oficina-opencode): un plugin de código abierto para OpenCode que ejecuta corridas multi-agente durables — gates que no se omiten, evidencia por criterio, y un bus de mensajes en disco para que los agentes se coordinen de verdad. v3.3.0 publicado hoy con --maxagents, 574 tests, ~4.300 descargas en 30 días, MIT. Si usás agentes para trabajo real, probalo: github.com/SOCRAMbt/AI-OFFICE — y decime qué rompe.
```

---

## DÍA 5 — Product Hunt (lanzamiento lento, solo si DÍA 1–4 dieron señal)

**Product Hunt primero verificar**: la explicación tiene que ser tryable y autoexplicativa. Una audiencia de developers en Product Hunt premia herramientas que funcionan. No es un canal para "viralidad", es un canal para hecho real.

- **Tagline:** `Durable multi-agent orchestration for OpenCode — gates you can't skip`
- **Descripción:** `One command installs the office. /oficina <objective> — and watch agents finish with evidence, not promises. MIT · agents coordinated over a disk message bus · npm i -g oficina-opencode`
- **Maker comment:** `solo mantenedor. Empecé esto porque veía a mis agentes "terminando" sin nada en disco. Lo que más aprendí: la evidencia por criterio cambia todo; nada puede cerrar sin ella. 0 → 4.3k descargas en el primer mes, 2 errores públicos graves, 2 fixes del mismo día. Hoy lanzo v3.3.0. Preguntas reales acá: las contesto yo, no un bot.`

**No Product Hunt el mismo día que Show HN.** Show HN es para developers que prueban cosas; Product Hunt para herramientas terminadas que la gente experimenta.

---

## Cómo responder a issues y comentarios (regla de 24h)

- **"No funciona en Windows"** → pedir SO exacto + logs literales + .oficina/ (artifacts), no teorías.
- **"Idea: X"** → agradecer, no comprometer, abrir en GOOD-FIRST-ISSUES si es viable.
- **"¿Auto-genera el código o lo hace otro?"** → explicar el catálogo (258 roles de agency-agents), la factory para gaps, y que el scope guard impide writes fuera de alcance.
- **Críticas duras** → si es correcto, "tenés razón" y fix. Si es incorrecto, defender con código (link a archivo:línea), no con volumen.

---

## Qué mide este lanzamiento (meterlo en Untitled — 14 días después)

- Traffic views/uniques (GitHub Insights → Traffic)
- npm downloads por semana (`npm view oficina-opencode`)
- Estrellas (objetivo: ≥25 antes de aplicar awesome-opencode)
- Issues humanas abiertas (objetivo: ≥2)
- Discusiones / HN / Discord: conversaciones reales que puedas citar

```
Métricas (plantilla):
- Seguidor estrella  pre: 0    post: ___
- Views clave         pre: 15   post: ___
- Clones únicos       pre: 123  post: ___
- Issue humanas       pre: 0    post: ___
- npm dl/semana       pre: 1.6k post: ___
```

---

## Checklist final para publicar

- [ ] DÍA 0 completo
- [ ] Demo en vivo funciona: `https://socrambt.github.io/AI-OFFICE/`
- [ ] Show HN (título + cuerpo + primer comentario copiado/pegado exacto)
- [ ] HN Respondé TODO en 24h
- [ ] DÍA 2-5 en el orden de arriba, y nada más hasta que la semana pase
