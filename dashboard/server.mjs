#!/usr/bin/env node
/* ============================================================
   Oficina · servidor del dashboard
   Node puro, cero dependencias. Sirve dashboard/ + API:
     GET /api/state      — agrega state.json, roster.json, bus/, leases
     GET /api/events     — SSE: avisa cuando cambia algo en .oficina/
     GET /api/artifacts?card=T-00 — parsea gates.md → [{name,status}]
   Uso: node server.mjs [--port 7333] [--oficina <abs>] [--no-open]
     --oficina  dir .oficina del proyecto (default: ../.oficina)
     --no-open  no abre el navegador (el plugin lo abre cuando arranca
                la corrida; el arranque manual sí abre)
   Al escuchar escribe <officeDir>/dashboard.json (url + port) para el
   handshake con el plugin. Si el puerto está ocupado por OTRO proyecto
   negocia el siguiente; si es el MISMO proyecto, solo abre el browser.
   ============================================================ */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/* ---- CLI args ---- */
const argv = process.argv.slice(2);
let portArg = 7333;
let oficinaArg = null;
let openArg = true;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--oficina") oficinaArg = argv[++i];
  else if (argv[i] === "--port") portArg = Number(argv[++i]);
  else if (argv[i] === "--no-open") openArg = false;
  else if (argv[i] === "--open") openArg = true;
  else if (!argv[i].startsWith("--")) portArg = Number(argv[i]);
}

const OFICINA = path.resolve(oficinaArg || path.join(ROOT, ".oficina"));
const DASH = __dirname;

function openBrowser(url) {
  try {
    const stdio = { detached: true, stdio: "ignore", windowsHide: true };
    if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url], stdio).unref();
    else if (process.platform === "darwin") spawn("open", [url], stdio).unref();
    else spawn("xdg-open", [url], stdio).unref();
  } catch { /* sin navegador no hay drama: la URL queda en el log */ }
}

/* handshake con el plugin: url y puerto reales */
function writeHandshake(port) {
  try {
    fs.writeFileSync(path.join(OFICINA, "dashboard.json"), JSON.stringify({ url: `http://localhost:${port}`, port }));
  } catch { /* .oficina no existe todavía: el dashboard queda en modo demo */ }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function listBus() {
  const out = [];
  const dir = path.join(OFICINA, "bus");
  if (!fs.existsSync(dir)) return out;
  for (const sub of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!sub.isDirectory()) continue;
    const subDir = path.join(dir, sub.name);
    for (const f of fs.readdirSync(subDir).sort()) {
      if (!f.endsWith(".json")) continue;
      const m = readJson(path.join(subDir, f));
      if (m) out.push(m);
    }
  }
  out.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  return out;
}

function aggregate() {
  const stateFile = readJson(path.join(OFICINA, "state.json")) || {};
  const rosterFile = readJson(path.join(OFICINA, "roster.json")) || {};
  return {
    runId: stateFile.runId || rosterFile.runId || null,
    objective: stateFile.objective || "",
    status: stateFile.status || "unknown",
    mode: stateFile.mode || "full",
    cards: stateFile.cards || {},
    agents: rosterFile.agents || {},
    bus: listBus(),
  };
}

function parseGates(cardId) {
  const artifactsDir = path.join(OFICINA, "artifacts");
  const dir = path.join(artifactsDir, cardId || "");
  const rel = path.relative(artifactsDir, dir);
  if (!cardId || rel.startsWith("..") || path.isAbsolute(rel)) {
    return { gates: [], evidence: false, handoff: false };
  }
  const out = { gates: [], evidence: false, handoff: false };
  if (!fs.existsSync(dir)) return out;
  const gatesFile = path.join(dir, "gates.md");
  if (fs.existsSync(gatesFile)) {
    const text = fs.readFileSync(gatesFile, "utf8");
    for (const line of text.split("\n")) {
      // tabla real: | # | Fase | Comando | Resultado | Detalle |
      if (!/^\|\s*\d+\s*\|/.test(line)) continue;
      const cells = line.split("|").map((s) => s.trim());
      const fase = cells[2] || "";
      const result = (cells[4] || "").toUpperCase();
      if (!fase) continue;
      const status = result.startsWith("PASS") ? "pass" : result.startsWith("FAIL") ? "fail" : "na";
      out.gates.push({ name: fase, status, command: cells[3] || "" });
    }
  }
  out.evidence = fs.existsSync(path.join(dir, "evidence.md"));
  out.handoff = fs.existsSync(path.join(dir, "handoff.md"));
  return out;
}

/** Id de card: solo caracteres seguros (previene traversal en cualquier endpoint). */
const CARD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

/* sirve un artifact crudo (evidence.md / handoff.md) para abrirlo en pestaña */
function serveArtifactFile(req, res, url, name) {
  const card = url.searchParams.get("card");
  if (!card || !CARD_ID_RE.test(card)) { res.writeHead(404); res.end("not found"); return; }
  // Contención por path.relative: `..` no pasa, rutas absolutas no pasan.
  const artifactsDir = path.join(OFICINA, "artifacts");
  const file = path.join(artifactsDir, card, name);
  const relArtifact = path.relative(artifactsDir, file);
  if (relArtifact.startsWith("..") || path.isAbsolute(relArtifact) || !fs.existsSync(file)) {
    res.writeHead(404); res.end("not found"); return;
  }
  res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
  res.end(fs.readFileSync(file));
}

/* ---- Watch: recursively notify SSE clients, con cursor monotónico ---- */
const sseClients = new Set();
let watchReady = false;
let sseCursor = 0;
function watchOficina() {
  if (!fs.existsSync(OFICINA)) return;
  try {
    fs.watch(OFICINA, { recursive: true }, () => {
      sseCursor += 1;
      const msg = `id: ${sseCursor}\nevent: change\ndata: {"cursor":${sseCursor}}\n\n`;
      for (const res of sseClients) res.write(msg);
    });
    watchReady = true;
  } catch { /* fs.watch recursivo no disponible → los clientes usan polling */ }
}

/* ---- Static ---- */
function serveStatic(req, res) {
  let urlPath = new URL(req.url, "http://x").pathname;
  if (urlPath === "/") urlPath = "/dashboard.html";
  const filePath = path.join(DASH, path.normalize(urlPath).replace(/^[/\\]/, ""));
  const rel = path.relative(DASH, filePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

/* ---- API ---- */
function serveApi(req, res, url) {
  const sendJson = (obj, code = 200) => {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(obj));
  };

  if (url.pathname === "/api/state") {
    sendJson({ oficina: OFICINA, ...aggregate() });
    return;
  }
  if (url.pathname === "/api/artifacts") {
    const card = url.searchParams.get("card");
    if (!card || !CARD_ID_RE.test(card)) { sendJson({ error: "invalid card id" }, 400); return; }
    sendJson(parseGates(card));
    return;
  }
  // Gates de TODAS las cards: el dashboard pinta el tablero completo en una llamada.
  if (url.pathname === "/api/gates") {
    const state = readJson(path.join(OFICINA, "state.json")) || {};
    const cards = Object.values(state.cards || {});
    const out = [];
    for (const card of cards) {
      const g = parseGates(card.id);
      out.push({ cardId: card.id, state: card.state, gates: g.gates });
    }
    sendJson({ cards: out });
    return;
  }
  if (url.pathname === "/api/memory") {
    const file = path.join(OFICINA, "memory.md");
    try {
      const text = fs.readFileSync(file, "utf8");
      res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store" });
      res.end(text);
    } catch {
      res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store" });
      res.end("memory.md todavía no existe — la oficina lo crea en el primer cierre.");
    }
    return;
  }
  if (url.pathname === "/api/evidence") { serveArtifactFile(req, res, url, "evidence.md"); return; }
  if (url.pathname === "/api/handoff") { serveArtifactFile(req, res, url, "handoff.md"); return; }
  if (url.pathname === "/api/events") {
    // SSE limpio: sin Last-Event-ID = envío inmediato `sync` + cursor para reconexión.
    const lastEventId = Number(req.headers["last-event-id"] || 0);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    res.write("retry: 3000\n\n");
    sseCursor += 1;
    // Reconexión: si el cliente viene de un cursor menor o no sabe nada, mandamos sync.
    if (lastEventId <= 0 || lastEventId < sseCursor) {
      res.write(`id: ${sseCursor}\nevent: sync\ndata: {"cursor":${sseCursor}}\n\n`);
    }
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    // Heartbeat cada 15s para detect connection drop
    const hb = setInterval(() => {
      try { res.write(": ping\n\n"); } catch { clearInterval(hb); }
    }, 15000);
    req.on("close", () => clearInterval(hb));
    return;
  }
  res.writeHead(404); res.end();
}

/* ---- Server ---- */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/api/")) serveApi(req, res, url);
  else serveStatic(req, res);
});

/* ---- Arranque con negociación de puerto ---- */
function probe(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/api/state", timeout: 1500 }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        try { resolve({ ok: true, oficina: JSON.parse(data).oficina }); }
        catch { resolve({ ok: true, oficina: null }); }
      });
    });
    req.on("error", () => resolve({ ok: false }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false }); });
  });
}

async function boot() {
  let port = portArg;
  for (let i = 0; i < 10; i++) {
    const p = await probe(port);
    if (!p.ok) break;                          // puerto libre
    if (p.oficina === OFICINA) {
      // Mismo proyecto: ya está corriendo. Solo abrir el navegador.
      writeHandshake(port);
      console.log(`Oficina dashboard ya corriendo → http://localhost:${port}`);
      if (openArg) openBrowser(`http://localhost:${port}`);
      process.exit(0);
    }
    port = portArg + i + 1;                    // otro proyecto: negociar
  }

  // Bind a loopback SOLAMENTE: el dashboard expone datos de la corrida
  // (/api/state, /api/evidence, /api/handoff). Sin host explícito, Node
  // bindeá a 0.0.0.0 — legible desde la red local (WiFi público incluido).
  // El browser lo abre en localhost, así que loopback no cambia nada legítimo.
  server.listen(port, "127.0.0.1", () => {
    console.log(`Oficina dashboard → http://localhost:${port}`);
    console.log(`  datos: ${OFICINA}`);
    writeHandshake(port);
    watchOficina();
    if (!watchReady) console.log("  fs.watch no disponible → los clientes usan polling de 4s");
    if (openArg) openBrowser(`http://localhost:${port}`);
  });
}

boot();
