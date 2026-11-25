#!/usr/bin/env node
/*
 * snapshot.mjs — congela un snapshot de .oficina/ en dashboard/data/snapshot.json.
 *
 *   node dashboard/scripts/snapshot.mjs
 *
 * Sirve para abrir leadership.html con doble click (file://), donde el
 * navegador no deja hacer fetch() de ../.oficina/state.json. El snapshot es
 * una foto: para datos en vivo usar dashboard/scripts/serve.mjs.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSnapshot } from "./snapshot-data.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const OUT = path.resolve(HERE, "..", "data", "snapshot.json");

const snap = await buildSnapshot(REPO_ROOT);
await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(snap, null, 2), "utf8");

const cards = snap.state && snap.state.cards ? Object.keys(snap.state.cards).length : 0;
const decisions = snap.state && Array.isArray(snap.state.decisions) ? snap.state.decisions.length : 0;
console.log(
  `[snapshot] ${path.relative(REPO_ROOT, OUT)} · ${cards} cards · ${decisions} decisions · ${snap.messages.length} mensajes · ${Object.keys(snap.artifacts).length} artifacts`
);
