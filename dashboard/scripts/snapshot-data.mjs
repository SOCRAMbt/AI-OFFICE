/*
 * snapshot-data.mjs — arma el snapshot que consumen los paneles del dashboard.
 *
 * Un unico objeto { state, roster, messages[], artifacts } evita que el panel
 * lea state.json y el bus en momentos distintos y muestre una foto rasgada.
 *
 * Lo usan:
 *   - dashboard/scripts/serve.mjs    -> GET /api/snapshot (live)
 *   - dashboard/scripts/snapshot.mjs -> dashboard/data/snapshot.json (file://)
 */
import fs from "node:fs/promises";
import path from "node:path";

/** Canales de coordinadores + peer. Una carpeta ausente no es un error. */
export const CHANNELS = ["coord-command", "coord-arch", "coord-flow", "peer"];

const MAX_MESSAGES = 500;

async function readJson(file) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function listDir(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries;
  } catch {
    return [];
  }
}

/** Lee todos los mensajes del bus, ordenados por canal y nombre (seq). */
export async function readBus(oficinaDir) {
  const messages = [];
  for (const channel of CHANNELS) {
    const dir = path.join(oficinaDir, "bus", channel);
    const files = (await listDir(dir))
      .filter((e) => e.isFile() && e.name.endsWith(".json"))
      .map((e) => e.name)
      .sort();
    for (const name of files) {
      const msg = await readJson(path.join(dir, name));
      if (!msg || typeof msg !== "object" || !msg.id) continue;
      messages.push({ channel, file: name, message: msg });
    }
  }
  // Los paneles muestran lo mas reciente: recortar sin perder el orden original.
  const sorted = messages
    .map((m) => ({ m, t: Date.parse(m.message.createdAt) || 0 }))
    .sort((a, b) => a.t - b.t)
    .map((x) => x.m);
  return sorted.length > MAX_MESSAGES ? sorted.slice(sorted.length - MAX_MESSAGES) : sorted;
}

/** Lista de artifacts por card: { "T-06": { dir, files[] } }. */
export async function readArtifacts(oficinaDir) {
  const root = path.join(oficinaDir, "artifacts");
  const out = {};
  const cards = (await listDir(root)).filter((e) => e.isDirectory());
  for (const card of cards) {
    const dir = path.join(root, card.name);
    const files = (await listDir(dir)).filter((e) => e.isFile()).map((e) => e.name).sort();
    out[card.name] = { dir: `../.oficina/artifacts/${card.name}/`, files };
  }
  return out;
}

/**
 * @param {string} repoRoot  raiz del repo (contiene .oficina/)
 * @returns {Promise<{generatedAt:string, source:string, state:object|null, roster:object|null, messages:object[], artifacts:object}>}
 */
export async function buildSnapshot(repoRoot) {
  const oficinaDir = path.join(repoRoot, ".oficina");
  const [state, roster, messages, artifacts] = await Promise.all([
    readJson(path.join(oficinaDir, "state.json")),
    readJson(path.join(oficinaDir, "roster.json")),
    readBus(oficinaDir),
    readArtifacts(oficinaDir),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    source: "live",
    state,
    roster: roster || { agents: {} },
    messages,
    artifacts,
  };
}
