#!/usr/bin/env node
/**
 * build-kanban-data.mjs — exporta el estado real de `.oficina/` al dataset que
 * consume `dashboard/kanban.html`.
 *
 * Lee (read-only):
 *   .oficina/state.json              cards, runId, status, decisions
 *   .oficina/roster.json             agentes y displayName
 *   .oficina/artifacts/<id>/gates.md resultados de gate por fase
 *   .oficina/evidence/<id>.json      grafo de evidencia por criterio
 *
 * Escribe (solo dentro de dashboard/):
 *   dashboard/kanban-data.json       snapshot completo (para `?data=`)
 *   dashboard/kanban.html            inyecta el snapshot entre los markers
 *                                    BEGIN_DATASET / END_DATASET
 *
 * Uso:
 *   node dashboard/build-kanban-data.mjs
 *   node dashboard/build-kanban-data.mjs --check   # valida el embed, no escribe
 */
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import "./kanban-source.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, "..")
const officeDir = path.join(repoRoot, ".oficina")
const htmlPath = path.join(here, "kanban.html")
const jsonPath = path.join(here, "kanban-data.json")

const BEGIN = "<!--BEGIN_DATASET-->"
const END = "<!--END_DATASET-->"

const CHECK = process.argv.includes("--check")

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"))
  } catch (err) {
    if (err.code === "ENOENT") return fallback
    throw new Error("No pude leer " + file + ": " + err.message)
  }
}

async function listDir(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (err.code === "ENOENT") return []
    throw err
  }
}

function splitRow(line) {
  // `escapeCell` escapa el pipe como `\|`; no partimos ahí.
  const cells = []
  let buffer = ""
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === "\\" && line[i + 1] === "|") {
      buffer += "|"
      i++
      continue
    }
    if (ch === "|") {
      cells.push(buffer.trim())
      buffer = ""
      continue
    }
    buffer += ch
  }
  if (buffer.trim()) cells.push(buffer.trim())
  // La fila empieza y termina con `|`: el primer hueco es el borde, no una celda.
  if (cells.length && cells[0] === "") cells.shift()
  return cells
}

function uncode(text) {
  return String(text || "").replace(/^`|`$/g, "").trim()
}

function outcomeOf(text) {
  const value = String(text || "").trim().toUpperCase()
  if (value === "PASS") return "pass"
  if (value === "FAIL") return "fail"
  if (value === "NA" || value === "N/A") return "na"
  return "not_run"
}

/**
 * Parsea el `gates.md` que escribe `renderGate` en src/core/gates.ts.
 * Tablas: `| # | Fase | Comando | Resultado | Detalle | Motivo |`
 * Footer: `**Gate técnico:** PASS` / `**Gate seguridad:** PASS` / `**Veredicto:** PASS`
 */
export function parseGates(markdown) {
  const result = {
    ranAt: null,
    technical: [],
    security: [],
    requirements: [],
    technicalOutcome: "not_run",
    securityOutcome: "not_run",
    requirementsOutcome: "not_run",
    verdict: "not_run"
  }
  if (!markdown) return result

  const lines = markdown.split(/\r?\n/)
  let section = null

  for (const line of lines) {
    const ranAt = /^\*\*Corredor:\*\*\s*(.+)$/.exec(line)
    if (ranAt) result.ranAt = ranAt[1].trim()

    const heading = /^##\s+(.+)$/.exec(line)
    if (heading) {
      const title = heading[1].trim().toLowerCase()
      if (title.startsWith("t") && title.includes("cnico")) section = "technical"
      else if (title.startsWith("seguridad")) section = "security"
      else if (title.startsWith("requisitos")) section = "requirements"
      else section = null
      continue
    }

    if (section && line.trim().startsWith("|")) {
      const cells = splitRow(line.trim())
      if (cells.length < 4) continue
      if (/^#?$/.test(cells[0]) || /^:?-{2,}/.test(cells[0])) continue
      result[section].push({
        phase: cells[1] || "—",
        command: uncode(cells[2]) === "—" ? null : uncode(cells[2]),
        outcome: outcomeOf(cells[3]),
        detail: cells[4] || "",
        reason: cells[5] && cells[5] !== "—" ? cells[5] : ""
      })
    }

    const technical = /^\*\*Gate t[eé]cnico:\*\*\s*(\w+)/i.exec(line)
    if (technical) result.technicalOutcome = outcomeOf(technical[1])
    const security = /^\*\*Gate seguridad:\*\*\s*(\w+)/i.exec(line)
    if (security) result.securityOutcome = outcomeOf(security[1])
    const verdict = /^\*\*Veredicto:\*\*\s*(\w+)/i.exec(line)
    if (verdict) result.verdict = outcomeOf(verdict[1])
  }

  return result
}

async function loadGates(cardIds) {
  const gates = {}
  for (const cardId of cardIds) {
    const file = path.join(officeDir, "artifacts", cardId, "gates.md")
    const markdown = await fs.readFile(file, "utf8").catch(() => null)
    if (markdown) gates[cardId] = parseGates(markdown)
  }
  return gates
}

async function loadEvidence(cardIds) {
  const evidence = {}
  for (const cardId of cardIds) {
    const file = path.join(officeDir, "evidence", cardId + ".json")
    const raw = await readJson(file, null)
    if (raw && Array.isArray(raw.nodes)) evidence[cardId] = raw.nodes
  }
  return evidence
}

function normalizeAgent(raw) {
  return {
    id: raw.id,
    displayName: raw.displayName || raw.id,
    role: raw.role || "",
    state: raw.state || null,
    currentCard: raw.currentCard || null
  }
}

export async function buildDataset() {
  const state = await readJson(path.join(officeDir, "state.json"), null)
  if (!state) throw new Error("Falta .oficina/state.json: no hay corrida para exportar.")
  if (!state.cards || typeof state.cards !== "object") throw new Error("state.json no tiene `cards`.")

  const roster = await readJson(path.join(officeDir, "roster.json"), { agents: {} })
  const cards = Object.values(state.cards)
  const cardIds = cards.map((card) => card.id)

  const agents = {}
  for (const agent of Object.values(roster.agents || {})) {
    if (agent && agent.id) agents[agent.id] = normalizeAgent(agent)
  }

  const gates = await loadGates(cardIds)
  const evidence = await loadEvidence(cardIds)

  return {
    meta: {
      runId: state.runId || "",
      objective: state.objective || "",
      status: state.status || "",
      iteration: state.iteration || 0,
      updatedAt: state.updatedAt || null,
      generatedAt: new Date().toISOString(),
      generator: "dashboard/build-kanban-data.mjs"
    },
    agents,
    cards,
    gates,
    evidence
  }
}

function embedInto(html, dataset) {
  const begin = html.indexOf(BEGIN)
  const end = html.indexOf(END)
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error("kanban.html no tiene los markers " + BEGIN + " / " + END)
  }
  const payload = JSON.stringify(dataset).replace(/</g, "\\u003c")
  const script = '<script type="application/json" id="kanban-dataset">' + payload + "</script>"
  return html.slice(0, begin + BEGIN.length) + "\n" + script + "\n" + html.slice(end)
}

function summarize(dataset) {
  const counts = {}
  for (const card of dataset.cards) counts[card.state] = (counts[card.state] || 0) + 1
  const order = ["todo", "in_progress", "review", "done", "rework", "blocked", "escalated"]
  const byState = order.map((id) => id + "=" + (counts[id] || 0)).join(" ")
  return {
    cards: dataset.cards.length,
    agents: Object.keys(dataset.agents).length,
    gates: Object.keys(dataset.gates).length,
    evidence: Object.keys(dataset.evidence).length,
    byState
  }
}

async function main() {
  const dataset = await buildDataset()
  const html = await fs.readFile(htmlPath, "utf8")
  const embedded = embedInto(html, dataset)

  const normalized = globalThis.KanbanSource.normalizeDataset(dataset)
  if (normalized.cards.length !== dataset.cards.length) {
    throw new Error("normalizeDataset perdió cards: " + normalized.cards.length + "/" + dataset.cards.length)
  }

  if (CHECK) {
    const current = await fs.readFile(htmlPath, "utf8")
    const match = /<script[^>]+id="kanban-dataset"[^>]*>([\s\S]*?)<\/script>/.exec(current)
    if (!match) throw new Error("kanban.html no contiene el script #kanban-dataset")
    const inFile = JSON.parse(match[1])
    const a = inFile.cards.map((card) => card.id).sort().join(",")
    const b = dataset.cards.map((card) => card.id).sort().join(",")
    if (a !== b) {
      throw new Error("Dataset embebido desactualizado. cards embebidas: [" + a + "] vs state.json: [" + b + "]")
    }
    console.log("OK  datos embebidos al día (card ids coinciden con .oficina/state.json)")
    console.log("    " + JSON.stringify(summarize(dataset)))
    return
  }

  await fs.writeFile(jsonPath, JSON.stringify(dataset, null, 2) + "\n", "utf8")
  await fs.writeFile(htmlPath, embedded, "utf8")

  const summary = summarize(dataset)
  console.log("OK  dashboard/kanban-data.json        " + summary.cards + " cards · " + summary.agents + " agentes")
  console.log("OK  dashboard/kanban.html            dataset embebido (" + summary.byState + ")")
  console.log("    gates.md leídos: " + summary.gates + " · evidence/*.json leídos: " + summary.evidence)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((err) => {
    console.error("FAIL " + err.message)
    process.exitCode = 1
  })
}
