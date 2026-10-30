#!/usr/bin/env node
/*
 * serve.mjs — servidor estatico + endpoint de snapshot para el dashboard.
 *
 *   node dashboard/scripts/serve.mjs [--port 7331] [--host 127.0.0.1]
 *
 * Por que existe: los navegadores bloquean fetch() sobre file:// (CORS), asi que
 * el panel necesita http para leer .oficina/ en vivo. Este server tiene cero
 * dependencias, es read-only y escucha en loopback por defecto.
 *
 * Rutas:
 *   GET /api/snapshot   -> { state, roster, messages[], artifacts }
 *   GET /dashboard/...  -> archivos del dashboard
 *   GET /.oficina/...   -> artifacts (handoff.md, evidence.md) servidos como texto
 */
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSnapshot } from "./snapshot-data.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : fallback;
}

const PORT = Number(arg("port", process.env.PORT || 7331));
const HOST = String(arg("host", "127.0.0.1"));

/** Resuelve dentro de la raiz del repo; cualquier escape devuelve null. */
function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const resolved = path.resolve(root, "." + decoded);
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return resolved;
}

async function serveFile(res, file) {
  try {
    const stat = await fs.stat(file);
    if (stat.isDirectory()) return serveFile(res, path.join(file, "index.html"));
    const body = await fs.readFile(file);
    res.writeHead(200, {
      "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
      "content-length": body.length,
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404 " + path.relative(REPO_ROOT, file));
  }
}

const server = http.createServer(async (req, res) => {
  const url = req.url || "/";
  const pathname = url.split("?")[0];

  try {
    if (pathname === "/api/snapshot") {
      const snap = await buildSnapshot(REPO_ROOT);
      const body = JSON.stringify(snap);
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "content-length": Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }

    if (pathname === "/" || pathname === "") {
      res.writeHead(302, { location: "/dashboard/leadership.html" });
      res.end();
      return;
    }

    const allowed = ["/dashboard/", "/.oficina/"];
    if (!allowed.some((p) => pathname.startsWith(p))) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      res.end("403 solo /dashboard y /.oficina");
      return;
    }

    const file = safeJoin(REPO_ROOT, pathname);
    if (!file) {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end("400 ruta invalida");
      return;
    }
    await serveFile(res, file);
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("500 " + (err && err.message ? err.message : "error"));
  }
});

server.listen(PORT, HOST, () => {
  const base = `http://${HOST}:${PORT}`;
  console.log(`[dashboard] ${base}/dashboard/leadership.html`);
  console.log(`[dashboard] snapshot: ${base}/api/snapshot`);
  console.log(`[dashboard] raiz: ${REPO_ROOT}`);
});
