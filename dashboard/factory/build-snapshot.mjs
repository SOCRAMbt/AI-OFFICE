#!/usr/bin/env node
/**
 * build-snapshot.mjs — embeds a read-only snapshot of .oficina/ into
 * dashboard/factory/snapshot.js so factory.html works from file:// (where
 * fetch() and ES modules are blocked by CORS).
 *
 *   node dashboard/factory/build-snapshot.mjs
 *
 * Reads:  .oficina/state.json, .oficina/roster.json, .opencode/agents/*.md
 * Writes: dashboard/factory/snapshot.js   (only file written)
 *
 * Run it again whenever you want the offline snapshot refreshed; the live mode
 * (dashboard/serve.mjs) always reads the real files.
 */
import { readFile, writeFile, readdir, stat } from "node:fs/promises"
import { join, resolve, dirname, basename } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "..", "..")
const officeDir = join(repoRoot, ".oficina")
const agentsDir = join(repoRoot, ".opencode", "agents")
const outFile = join(here, "snapshot.js")

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

/** Drop fields that are huge and irrelevant for the dashboard. */
function slimRoster(roster) {
  const agents = {}
  for (const [id, agent] of Object.entries(roster.agents || {})) {
    const source = agent.source ? { ...agent.source } : null
    if (source) delete source.sourcePrompt
    agents[id] = { ...agent, source }
    delete agents[id].raw
  }
  return { ...roster, agents }
}

const [state, rosterRaw] = await Promise.all([
  readJson(join(officeDir, "state.json")),
  readJson(join(officeDir, "roster.json")),
])
const roster = slimRoster(rosterRaw)

let files = []
try {
  files = (await readdir(agentsDir)).filter((name) => name.endsWith(".md"))
} catch {
  files = []
}

const fichas = {}
for (const name of files.sort()) {
  const full = join(agentsDir, name)
  const [content, info] = await Promise.all([readFile(full, "utf8"), stat(full)])
  fichas[`.opencode/agents/${name}`] = {
    name,
    bytes: info.size,
    modifiedAt: info.mtime.toISOString(),
    content,
  }
}

const snapshot = {
  source: "embedded-snapshot",
  capturedAt: new Date().toISOString(),
  projectRoot: repoRoot,
  state,
  roster,
  catalogo: Object.keys(fichas).map((path) => ({
    path,
    name: basename(path),
    bytes: fichas[path].bytes,
    modifiedAt: fichas[path].modifiedAt,
  })),
  fichas,
}

const banner =
  "/* GENERADO por dashboard/factory/build-snapshot.mjs — no editar a mano. */\n"
const body = `${banner}window.__FACTORY_SNAPSHOT__ = ${JSON.stringify(snapshot, null, 2)};\n`
await writeFile(outFile, body, "utf8")

const cards = Object.keys(state.cards || {}).length
console.log(
  `snapshot.js escrito: ${cards} cards, ${Object.keys(roster.agents || {}).length} agentes, ${Object.keys(fichas).length} fichas (${(body.length / 1024).toFixed(1)} KiB)`,
)
