/* ============================================================
   Oficina · Dashboard visual — lógica
   Fuente de datos: .oficina/ (state.json, roster.json, bus/, artifacts/)
   Vía server.mjs (SSE + /api/state) o modo demo si no hay server.
   ASCII-only: los símbolos se escriben con escapes \uXXXX.
   ============================================================ */

const JEFES = new Set(["oficina-director", "oficina-integrator", "oficina-architect", "oficina-commander", "oficina-guardian"]);
const COLS = ["todo", "in_progress", "review", "done", "rework", "blocked", "escalated"];
const HEARTBEAT_STALE_MS = 5 * 60 * 1000;

const SYM = {
  arrow: "\u2192",       // →
  middot: "\u00B7",      // ·
  check: "\u2713",       // ✓
  cross: "\u2717",       // ✕
  diamond: "\u25C8",     // ◈
  rework: "\u21BB",      // ↻
  chief: "\u2318",       // ⌘
  user: "\u25CB",        // ○
  lens: "\u25CE",        // ◎
  play: '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1l7 4-7 4z" fill="currentColor"/></svg>',
  pause: '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1h2.5v8H2zM6 1h2.5v8H6z" fill="currentColor"/></svg>',
};

/* ---------------- Estado ---------------- */
const state = {
  runId: null,
  cards: {},
  agents: {},
  bus: [],
  replaying: false,
};
const snapshots = [];

const $ = (sel) => document.querySelector(sel);
const el = {
  runId: $("#run-id"), conn: $("#conn"), connLabel: $("#conn-label"),
  demoBanner: $("#demo-banner"),
  mCards: $("#m-cards"), mActive: $("#m-active"), mFree: $("#m-free"),
  mMsgs: $("#m-msgs"), mBlocked: $("#m-blocked"), mDone: $("#m-done"),
  mesaSvg: $("#mesa-svg"), mesaCount: $("#mesa-count"),
  busStream: $("#bus-stream"), busCount: $("#bus-count"),
  chiefFeed: $("#chief-feed"), chiefCount: $("#chief-count"),
  board: $("#board"), toasts: $("#toasts"),
  replay: $("#replay"), replayRange: $("#replay-range"), replayClock: $("#replay-clock"),
  btnPlay: $("#btn-play"), btnReplay: $("#btn-replay"), btnTheme: $("#btn-theme"),
  gates: $("#gates"), linkEvidence: $("#link-evidence"), linkHandoff: $("#link-handoff"),
};

/* ---------------- Utilidades ---------------- */
const fmtTime = (iso) => {
  if (!iso) return "";
  // locale del navegador (guideline i18n): no forzar "es"
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};
const shortName = (id) => {
  if (!id) return "";
  const a = state.agents[id];
  if (a && a.displayName) return a.displayName;
  if (id.startsWith("oficina-")) return SYM.chief + " " + id.replace(/^oficina-/, "");
  return id;
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------------- Toasts ---------------- */
function toast(kind, text, ms = 5000) {
  const t = document.createElement("div");
  t.className = "toast";
  t.dataset.kind = kind;
  t.setAttribute("role", "status");
  const icon = kind === "spawn" ? SYM.diamond : kind === "gate-fail" ? SYM.cross : SYM.check;
  t.innerHTML = `<span class="icon" aria-hidden="true">${icon}</span><span>${esc(text)}</span>`;
  el.toasts.appendChild(t);
  setTimeout(() => { t.classList.add("leaving"); setTimeout(() => t.remove(), 400); }, ms);
}

/* ---------------- Tema ---------------- */
const savedTheme = localStorage.getItem("oficina-theme") || "dark";
document.documentElement.dataset.theme = savedTheme;
el.btnTheme.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("oficina-theme", next);
});

/* ============================================================
   RENDER: mesa (SVG)
   ============================================================ */
function renderMesa() {
  const agents = Object.values(state.agents);
  const cards = Object.values(state.cards);
  const ownerless = cards.filter((c) => !c.owner && c.state !== "done");
  const now = Date.now();
  const NS = "http://www.w3.org/2000/svg";
  const svg = el.mesaSvg;
  svg.innerHTML = "";
  el.mesaCount.textContent = agents.length
    ? `${agents.length} agentes ${SYM.middot} ${ownerless.length} cards sin owner`
    : "sin agentes";

  const mk = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };
  const cx = 180, cy = 168;

  // la mesa
  svg.appendChild(mk("ellipse", { cx, cy, rx: 84, ry: 58, fill: "var(--surface)", stroke: "var(--border-strong)", "stroke-width": "1.5" }));
  const label = mk("text", { x: cx, y: cy - 4, "text-anchor": "middle", fill: "var(--text)", "font-family": "var(--font-display)", "font-weight": "700", "font-size": "13" });
  label.textContent = "LA MESA";
  svg.appendChild(label);
  const sub = mk("text", { x: cx, y: cy + 14, "text-anchor": "middle", fill: "var(--text-3)", "font-size": "8" });
  sub.textContent = state.runId ? "run " + state.runId.slice(0, 10) : "sin corrida";
  svg.appendChild(sub);

  // agentes alrededor de la mesa
  const n = Math.max(agents.length, 1);
  const r = 120;
  agents.forEach((a, i) => {
    const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(ang) * r * 1.35;
    const y = cy + Math.sin(ang) * r * 0.86;
    const stale = a.lastHeartbeat && (now - new Date(a.lastHeartbeat).getTime()) > HEARTBEAT_STALE_MS;
    const st = stale ? "stale" : (a.state === "working" ? "working" : "idle_available");
    const color = st === "working" ? "var(--accent)" : st === "idle_available" ? "var(--ok)" : "var(--err)";

    const g = mk("g", { class: "agent-node", "data-state": st });
    const title = document.createElementNS(NS, "title");
    title.textContent = `${a.displayName || a.id} ${SYM.middot} ${st} ${SYM.middot} ${a.currentCard ? "en " + a.currentCard : "libre"}`;
    g.appendChild(title);

    if (st === "working") {
      g.appendChild(mk("circle", { cx: x, cy: y, r: 19, fill: "none", stroke: color, "stroke-width": "1", opacity: "0.5", class: "pulse" }));
    }
    g.appendChild(mk("circle", { cx: x, cy: y, r: 14, fill: "var(--surface-2)", stroke: color, "stroke-width": "1.5" }));
    const ini = mk("text", { x, y: y + 4, "text-anchor": "middle", fill: "var(--text)", "font-size": "10", "font-weight": "700" });
    ini.textContent = (a.displayName || a.id).slice(0, 2).toUpperCase();
    g.appendChild(ini);
    const nm = mk("text", { x, y: y + 27, "text-anchor": "middle", fill: "var(--text-2)", "font-size": "9" });
    nm.textContent = (a.displayName || a.id).slice(0, 16);
    g.appendChild(nm);
    const cs = mk("text", { x, y: y + 37, "text-anchor": "middle", fill: a.currentCard ? "var(--accent)" : "var(--text-3)", "font-size": "8" });
    cs.textContent = stale ? "sin heartbeat" : (a.currentCard || "libre");
    g.appendChild(cs);
    svg.appendChild(g);
  });

  // cards sin owner: fila inferior
  ownerless.forEach((c, i) => {
    const x = 40 + i * 30, y = 336;
    const g = mk("g", { class: "agent-node", "data-state": "ownerless" });
    const title = document.createElementNS(NS, "title");
    title.textContent = `${c.id} sin owner, lista para reclamar`;
    g.appendChild(title);
    g.appendChild(mk("rect", { x: x - 11, y: y - 8, width: 22, height: 16, rx: 3, fill: "var(--surface-2)", stroke: "var(--card-escalated)", "stroke-width": "1" }));
    const tx = mk("text", { x, y: y + 3, "text-anchor": "middle", fill: "var(--card-escalated)", "font-size": "8", "font-weight": "700" });
    tx.textContent = c.id.replace("T-", "");
    g.appendChild(tx);
    svg.appendChild(g);
  });
}

/* ============================================================
   RENDER: bus
   ============================================================ */
function renderBus() {
  const msgs = state.bus;
  if (Number(el.busStream.dataset.len || 0) === msgs.length) return;
  el.busStream.dataset.len = msgs.length;
  // rendimiento: cap de render (guideline: listas grandes se virtualizan/cortan)
  const MAX = 200;
  const shown = msgs.slice(-MAX);
  el.busCount.textContent = shown.length < msgs.length
    ? `${shown.length} de ${msgs.length} msgs`
    : `${msgs.length} msgs`;
  el.mMsgs.textContent = msgs.length;
  el.busStream.innerHTML = "";

  const frag = document.createDocumentFragment();
  const replies = new Map();
  shown.forEach((m) => { if (m.inReplyTo) { if (!replies.has(m.inReplyTo)) replies.set(m.inReplyTo, []); replies.get(m.inReplyTo).push(m); } });

  const makeMsg = (m, depth) => {
    const div = document.createElement("article");
    div.className = "msg" + (depth > 0 ? " threaded" : "");
    div.dataset.priority = m.priority || "normal";
    div.tabIndex = 0;
    const body = m.body?.text || m.body || "";
    const to = (m.to || []).includes("*") ? "pool" : (m.to || []).map(shortName).join(", ");
    const prio = m.priority && m.priority !== "normal" ? `<span class="prio" data-prio="${esc(m.priority)}">${esc(m.priority)}</span>` : "";
    div.innerHTML = `
      <div class="head">
        <span class="kind" data-kind="${esc(m.kind || "NOTICE")}">${esc(m.kind || "NOTICE")}</span>
        <span class="route">${esc(shortName(m.from))} <span class="arrow" aria-hidden="true">${SYM.arrow}</span> ${esc(to)}</span>
        ${prio}
        <span class="time">${esc(fmtTime(m.createdAt))}</span>
      </div>
      <div class="subject">${esc(m.subject || "")}</div>
      <div class="body">${esc(body)}</div>`;
    div.addEventListener("click", () => div.classList.toggle("expanded"));
    div.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); div.classList.toggle("expanded"); }
    });
    frag.appendChild(div);
    (replies.get(m.id) || []).forEach((r) => makeMsg(r, depth + 1));
  };

  msgs.filter((m) => !m.inReplyTo).forEach((m) => makeMsg(m, 0));
  el.busStream.appendChild(frag);
}

/* ============================================================
   RENDER: feed del jefe
   ============================================================ */
function renderChief() {
  const msgs = state.bus.filter((m) => JEFES.has(m.from));
  if (Number(el.chiefFeed.dataset.len || 0) === msgs.length) return;
  el.chiefFeed.dataset.len = msgs.length;
  el.chiefCount.textContent = String(msgs.length);
  el.chiefFeed.innerHTML = "";
  const frag = document.createDocumentFragment();
  msgs.forEach((m) => {
    const role = m.from.replace(/^oficina-/, "");
    const who = role.charAt(0).toUpperCase() + role.slice(1);
    const body = m.body?.text || m.body || "";
    const div = document.createElement("article");
    div.className = "chief-item";
    div.dataset.who = who;
    div.innerHTML = `
      <div class="who">${esc(who)}</div>
      <div class="what"><b>${esc(m.subject || m.kind)}</b><br>${esc(body.slice(0, 200))}${body.length > 200 ? "..." : ""}</div>`;
    frag.appendChild(div);
  });
  el.chiefFeed.appendChild(frag);
}

/* ============================================================
   RENDER: kanban
   ============================================================ */
function renderBoard() {
  const cards = Object.values(state.cards);
  el.board.innerHTML = "";
  const frag = document.createDocumentFragment();

  for (const col of COLS) {
    const colCards = cards.filter((c) => c.state === col);
    const colEl = document.createElement("div");
    colEl.className = "col";
    colEl.dataset.state = col;
    colEl.setAttribute("role", "list");
    colEl.setAttribute("aria-label", `Columna ${col}, ${colCards.length} cards`);
    const head = document.createElement("header");
    head.innerHTML = `<i aria-hidden="true"></i><span>${esc(col)}</span><span class="n">${colCards.length}</span>`;
    colEl.appendChild(head);

    colCards.forEach((c) => {
      const card = document.createElement("article");
      card.className = "card";
      card.dataset.state = c.state;
      card.setAttribute("role", "listitem");
      card.tabIndex = 0;
      const rej = c.rejections > 0 ? `<span class="rejected">${SYM.rework} ${c.rejections}</span>` : "";
      const ac = (c.acceptance || []).slice(0, 4).map((a) => `<label><input type="checkbox" disabled aria-label="Criterio pendiente de verificaci&oacute;n"><span>${esc(a.slice(0, 60))}</span></label>`).join("");
      card.innerHTML = `
        <div class="cid"><span>${esc(c.id)}</span>${rej}${c.attempts > 1 ? `<span>intento ${c.attempts}</span>` : ""}</div>
        <div class="title">${esc(c.title)}</div>
        <div class="people">
          <span>${SYM.user} ${c.owner ? esc(shortName(c.owner)) : '<span class="none">sin owner</span>'}</span>
          ${c.reviewer ? `<span>${SYM.lens} ${esc(shortName(c.reviewer))}</span>` : ""}
        </div>
        ${ac ? `<div class="ac">${ac}</div>` : ""}`;
      card.addEventListener("click", () => showGates(c));
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showGates(c); }
      });
      colEl.appendChild(card);
    });
    frag.appendChild(colEl);
  }
  el.board.appendChild(frag);

  el.mCards.textContent = String(cards.length);
  el.mDone.textContent = String(cards.filter((c) => c.state === "done").length);
  el.mBlocked.textContent = String(cards.filter((c) => c.state === "blocked" || c.state === "escalated").length);
}

/* ============================================================
   Gates: parse de .oficina/artifacts/<id>/gates.md
   ============================================================ */
function showGates(card) {
  el.gates.querySelectorAll(".gate-row").forEach((g) => g.remove());
  el.linkEvidence.hidden = true;
  el.linkHandoff.hidden = true;
  if (!card?.id) return;
  fetch(`api/artifacts?card=${encodeURIComponent(card.id)}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("sin gates"))))
    .then((data) => {
      (data.gates || []).forEach((g) => {
        const row = document.createElement("div");
        row.className = "gate-row";
        row.dataset.status = g.status;
        const icon = g.status === "pass" ? SYM.check : g.status === "fail" ? SYM.cross : "";
        row.innerHTML = `
          <span class="icon" aria-hidden="true">${icon}</span>
          <span class="name">${esc(g.name)}</span>
          <span class="status">${esc(g.status)}</span>`;
        el.gates.prepend(row);
      });
      if (data.gates?.length) toast(data.gates.every((g) => g.status === "pass") ? "gate" : "gate-fail", `${card.id}: gates ${data.gates.every((g) => g.status === "pass") ? "PASS" : "con FAIL"}`);
      el.linkEvidence.hidden = !data.evidence;
      el.linkHandoff.hidden = !data.handoff;
      el.linkEvidence.href = `api/evidence?card=${encodeURIComponent(card.id)}`;
      el.linkHandoff.href = `api/handoff?card=${encodeURIComponent(card.id)}`;
      el.linkEvidence.target = "_blank";
      el.linkHandoff.target = "_blank";
      el.linkEvidence.rel = "noopener";
      el.linkHandoff.rel = "noopener";
    })
    .catch(() => {});
}

/* ============================================================
   RENDER master + snapshot para replay
   ============================================================ */
let knownAgents = new Set();
let knownCards = new Map();

function detectEvents(prevA, prevC) {
  for (const id of Object.keys(state.agents)) {
    if (!prevA.has(id)) toast("spawn", `Factory materializa agente: ${shortName(id)}`, 6000);
  }
  for (const [id, c] of Object.entries(state.cards)) {
    const prev = prevC.get(id);
    if (prev && prev.state !== "done" && c.state === "done") toast("gate", `${id} ${SYM.arrow} DONE`);
    if (prev && (c.rejections || 0) > (prev.rejections || 0)) toast("gate-fail", `${id} rechazada, vuelve a rework`);
  }
  knownAgents = new Set(Object.keys(state.agents));
  knownCards = new Map(Object.entries(state.cards).map(([k, v]) => [k, { state: v.state, rejections: v.rejections }]));
}

function render() {
  renderMesa();
  renderBus();
  renderChief();
  renderBoard();
  el.runId.textContent = state.runId ? "run " + state.runId.slice(0, 10) : "sin corrida";
  snapshot();
}

function snapshot() {
  if (state.replaying) return;
  const last = state.bus[state.bus.length - 1];
  if (!last) return;
  if (snapshots.length && snapshots[snapshots.length - 1].msg.id === last.id) return;
  snapshots.push({ t: last.createdAt, msg: last });
  el.replayRange.max = String(snapshots.length - 1);
}

/* ============================================================
   REPLAY: scrub del bus
   ============================================================ */
let replayIdx = 0;
let replayTimer = null;

function enterReplay() {
  if (snapshots.length < 2) { toast("gate", "Todavia no hay sesion grabada"); return; }
  state.replaying = true;
  el.replay.hidden = false;
  el.btnReplay.setAttribute("aria-pressed", "true");
  replayIdx = 0;
  scrubReplay();
}
function exitReplay() {
  state.replaying = false;
  el.replay.hidden = true;
  el.btnReplay.setAttribute("aria-pressed", "false");
  if (replayTimer) { clearInterval(replayTimer); replayTimer = null; el.btnPlay.innerHTML = SYM.play; }
  render();
}
function scrubReplay() {
  const snap = snapshots[replayIdx];
  if (!snap) return;
  el.replayRange.value = String(replayIdx);
  el.replayClock.textContent = fmtTime(snap.t) + " " + SYM.middot + " msg " + (replayIdx + 1) + "/" + snapshots.length;
  const full = state.bus;
  state.bus = full.filter((m) => new Date(m.createdAt) <= new Date(snap.t));
  renderBus();
  state.bus = full;
}
el.replayRange.addEventListener("input", () => { replayIdx = Number(el.replayRange.value); scrubReplay(); });
el.btnPlay.addEventListener("click", () => {
  if (replayTimer) { clearInterval(replayTimer); replayTimer = null; el.btnPlay.innerHTML = SYM.play; el.btnPlay.setAttribute("aria-label", "Reproducir replay"); return; }
  el.btnPlay.innerHTML = SYM.pause;
  el.btnPlay.setAttribute("aria-label", "Pausar replay");
  replayTimer = setInterval(() => {
    replayIdx++;
    if (replayIdx >= snapshots.length - 1) { clearInterval(replayTimer); replayTimer = null; el.btnPlay.innerHTML = SYM.play; el.btnPlay.setAttribute("aria-label", "Reproducir replay"); }
    scrubReplay();
  }, 450);
});
el.btnReplay.addEventListener("click", () => (state.replaying ? exitReplay() : enterReplay()));

/* ============================================================
   Conexión: server.mjs (SSE) o demo
   ============================================================ */
async function loadViaServer() {
  const res = await fetch("api/state");
  if (!res.ok) throw new Error("sin server");
  const data = await res.json();
  state.runId = data.runId;
  state.cards = data.cards || {};
  state.agents = data.agents || {};
  state.bus = data.bus || [];
  render();
  detectEvents(knownAgents, knownCards);
  return true;
}

function startConnection() {
  el.conn.dataset.state = "poll";
  el.connLabel.textContent = "SSE";
  let es;
  try {
    es = new EventSource("api/events");
    es.addEventListener("change", () => loadViaServer().catch(() => {}));
    es.onerror = () => { el.conn.dataset.state = "offline"; el.connLabel.textContent = "reconectando"; };
  } catch { startPolling(); }
  startPolling();
}
function startPolling() {
  const poll = () => loadViaServer().catch(() => { if (!state.demo) runDemo(); });
  poll();
  setInterval(poll, 5000);
}

/* ============================================================
   DEMO: simulador honesto (banner visible, etiquetado)
   ============================================================ */
function runDemo() {
  state.demo = true;
  el.demoBanner.hidden = false;
  el.conn.dataset.state = "demo";
  el.connLabel.textContent = "demo";
  el.runId.textContent = "demo";

  const agents = [
    { id: "oficina-director", displayName: "Director", state: "idle_available" },
    { id: "ag-backend", displayName: "Backend", state: "working" },
    { id: "ag-frontend", displayName: "Frontend", state: "working" },
    { id: "ag-qa", displayName: "QA", state: "idle_available" },
    { id: "ag-reviewer", displayName: "Critico", state: "idle_available" },
  ];
  agents.forEach((a, i) => {
    state.agents[a.id] = {
      ...a,
      currentCard: i > 0 && i < 3 ? `T-0${i - 1}` : null,
      lastHeartbeat: new Date().toISOString(),
      role: a.id,
    };
  });

  state.cards = {
    "T-00": { id: "T-00", title: "Cablear el guard anti-gate-verde-vacio en el runner de gates", state: "done", owner: "ag-backend", reviewer: "ag-reviewer", rejections: 1, attempts: 2, acceptance: ["guard activo en runTechnicalGates", "tests de regresion en verde"], artifacts: ".oficina/artifacts/T-00" },
    "T-01": { id: "T-01", title: "Dashboard visual: mesa + bus + kanban en tiempo real", state: "in_progress", owner: "ag-frontend", reviewer: null, rejections: 0, attempts: 1, acceptance: ["mesa poblada", "bus con threading", "kanban 7 columnas"], artifacts: "" },
    "T-02": { id: "T-02", title: "Server SSE + watch recursivo de .oficina/", state: "review", owner: "ag-backend", reviewer: "ag-reviewer", rejections: 0, attempts: 1, acceptance: ["SSE emite change", "cero dependencias"], artifacts: ".oficina/artifacts/T-02" },
    "T-03": { id: "T-03", title: "Modo replay con scrub del bus", state: "todo", owner: null, reviewer: null, rejections: 0, attempts: 0, acceptance: ["slider recorre la sesion"], artifacts: "" },
    "T-04": { id: "T-04", title: "Fondo WebGL con bloom en la mesa", state: "blocked", owner: "ag-frontend", reviewer: null, rejections: 2, attempts: 3, acceptance: ["bloom sutil", "fallback a 2D"], artifacts: "" },
  };

  const t = (min) => new Date(Date.now() - min * 60000).toISOString();
  state.bus = [
    { id: "d1", from: "oficina-director", to: ["*"], kind: "NOTICE", subject: "Despacho: 4 cards, equipo de 4", body: { text: "T-00 a T-04 en el tablero. Factory on standby si hay card sin match." }, createdAt: t(30), priority: "normal", inReplyTo: null },
    { id: "d2", from: "ag-backend", to: ["*"], kind: "HELP_REQUEST", subject: "T-00: donde vive el guard del runner?", body: { text: "Necesito saber donde cablear el guard anti-gate-verde-vacio antes de tocar gates.ts." }, createdAt: t(24), priority: "high", inReplyTo: null },
    { id: "d3", from: "oficina-architect", to: ["ag-backend"], kind: "ANSWER", subject: "RE: T-00: donde vive el guard", body: { text: "En src/core/office.ts, funcion runTechnicalGates. Los tests van en tests/gates.test.ts." }, createdAt: t(23), priority: "normal", inReplyTo: "d2" },
    { id: "d4", from: "ag-reviewer", to: ["ag-backend"], kind: "STATUS", subject: "T-00 RECHAZADA (rework 1): guard degrada salidas verdes", body: { text: "La fase test reporta PASS sin correr nada. El guard debe detectar cero tests y marcar not_run." }, createdAt: t(18), priority: "high", inReplyTo: null },
    { id: "d5", from: "oficina-integrator", to: ["*"], kind: "CLAIM", subject: "T-01 reclamada por ag-frontend", body: { text: "Lease activo en T-01, mesa actualizada." }, createdAt: t(10), priority: "normal", inReplyTo: null },
  ];

  render();

  // loop demo: mensajes nuevos + transiciones de estado
  const script = [
    { kind: "HELP_REQUEST", from: "ag-frontend", to: ["*"], subject: "T-01: threading visual del bus", body: "Como represento inReplyTo en la lista? Indentado o con conector?", priority: "normal", replyTo: null },
    { kind: "ANSWER", from: "oficina-architect", to: ["ag-frontend"], subject: "RE: T-01 threading", body: "Indentado con conector de rama. La respuesta viaja dentro del thread del padre.", priority: "normal", replyTo: "d5" },
    { kind: "STATUS", from: "ag-reviewer", to: ["ag-backend"], subject: "T-02 APROBADA", body: "Gates en verde, review completo en artifacts. Pasa a DONE.", priority: "normal", replyTo: null },
    { kind: "SPAWN_REQUEST", from: "oficina-director", to: ["*"], subject: "Factory: agente visualizador-dashboard", body: "No hay match en el catalogo para dashboards temps-real. Fabricando agente persistente.", priority: "high", replyTo: null },
    { kind: "NOTICE", from: "oficina-integrator", to: ["*"], subject: "T-03 lista para reclamar", body: "Card sin owner visible en la mesa. Pool libre: ag-qa.", priority: "normal", replyTo: null },
  ];
  let si = 0;
  let phase = 0;
  setInterval(() => {
    if (state.replaying) return;
    const s = script[si % script.length];
    si++;
    const id = "dm" + Date.now();
    state.bus.push({
      id, from: s.from, to: s.to, kind: s.kind, subject: s.subject,
      body: { text: s.body }, createdAt: new Date().toISOString(),
      priority: s.priority, inReplyTo: s.replyTo,
    });
    if (s.kind === "SPAWN_REQUEST") {
      state.agents["ag-visualizer"] = { id: "ag-visualizer", displayName: "Visualizer", state: "idle_available", currentCard: null, lastHeartbeat: new Date().toISOString(), role: "visualizador-dashboard" };
    }
    if (s.kind === "STATUS" && s.subject.includes("T-02")) {
      state.cards["T-02"].state = "done";
      state.agents["ag-backend"].state = "idle_available";
      state.agents["ag-backend"].currentCard = null;
    }
    if (s.kind === "NOTICE" && phase === 0) {
      state.cards["T-03"].state = "in_progress";
      state.cards["T-03"].owner = "ag-qa";
      state.agents["ag-qa"].state = "working";
      state.agents["ag-qa"].currentCard = "T-03";
      phase = 1;
    }
    // heartbeat del demo
    Object.values(state.agents).forEach((a) => {
      if (a.state === "working") a.lastHeartbeat = new Date().toISOString();
    });
    render();
    detectEvents(knownAgents, knownCards);
  }, 4000);
}

/* ============================================================
   Fondo WebGL (three.js + bloom, degrada a nada)
   ============================================================ */
async function initWebGL() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  try {
    const THREE = await import("https://esm.sh/three@0.161.0");
    const { EffectComposer } = await import("https://esm.sh/three@0.161.0/examples/jsm/postprocessing/EffectComposer.js");
    const { RenderPass } = await import("https://esm.sh/three@0.161.0/examples/jsm/postprocessing/RenderPass.js");
    const { UnrealBloomPass } = await import("https://esm.sh/three@0.161.0/examples/jsm/postprocessing/UnrealBloomPass.js");
    const { OutputPass } = await import("https://esm.sh/three@0.161.0/examples/jsm/postprocessing/OutputPass.js");

    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = "position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.4;";
    document.body.prepend(canvas);

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.z = 10;

    // campo de puntos ámbar: el "campo de trabajo" de la oficina
    const N = 180;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 24;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 14;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 8;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xf59e0b, size: 0.05, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    scene.add(points);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.9, 0.5, 0.85));
    composer.addPass(new OutputPass());

    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      const t = clock.getElapsedTime() * 0.05;
      points.rotation.y = t;
      points.rotation.x = Math.sin(clock.getElapsedTime() * 0.02) * 0.1;
      composer.render();
    });
    window.addEventListener("resize", () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      composer.setSize(window.innerWidth, window.innerHeight);
    });
  } catch {
    /* sin red o sin WebGL: la mesa funciona igual (fallback honesto) */
  }
}

/* ---------------- Atajos ---------------- */
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea")) return;
  if (e.key === "t" || e.key === "T") el.btnTheme.click();
  if (e.key === "r" || e.key === "R") el.btnReplay.click();
  if (e.key === "Escape" && state.replaying) exitReplay();
});

/* ---------------- Boot ---------------- */
async function boot() {
  try {
    await loadViaServer();
    startConnection();
  } catch {
    runDemo();
  }
  initWebGL();
}
boot();
