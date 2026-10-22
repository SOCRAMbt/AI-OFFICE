#!/usr/bin/env node
/**
 * CLI de la OFICINA.
 *
 * Operaciones: init, status, resume, audit, reset, catalog.
 *
 * El CLI es la superficie de operación: listar corridas atascadas, auditar el
 * bus, forzar el cierre de una card, promover roles de factory a skill. Si
 * un operador no puede ver qué está pasando, el sistema no es operable.
 */

import path from "node:path"
import process from "node:process"
import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"
import { Office } from "./core/office.js"
import { logger, configureLogging } from "./core/log.js"
import { listFiles, readJson, ensureDir, writeJsonAtomic } from "./core/fsx.js"
import { cardDir } from "./core/paths.js"
import { scanCatalog } from "./core/catalog.js"
import type { OfficeState } from "./core/types.js"

const log = logger("oficina:cli")

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function usage(): void {
  process.stdout.write(`
OFICINA — CLI de la Oficina de Agents

Uso: oficina <comando> [opciones]

Comandos:
  init [objetivo]      Crea la estructura .oficina/ en el proyecto
  status               Muestra el estado de la corrida
  board                Muestra el tablero Kanban
  bus                  Muestra estadísticas del bus
  audit [cardId]       Audita una card: artefactos, gates, review
  verify               Corre los gates de todas las cards en review
  install              Instala skill, agentes y comando en un directorio de OpenCode
  catalog              Lista el catálogo de roles disponible
  reset [--force]      Borra el estado de la corrida

Opciones:
  --directory <path>   Directorio del proyecto (default: cwd)
  --agency-root <path> Raíz del repo agency-agents
  --target <path>      Destino de install (default: ~/.config/opencode)
  --json               Salida en JSON
  --force              No pedir confirmación
`)
}

async function main(): Promise<number> {
  const command = process.argv[2]
  const cwd = path.resolve(arg("directory") ?? process.cwd())
  const json = flag("json")

  if (!command || command === "help" || command === "--help") {
    usage()
    return 0
  }

  configureLogging({ level: flag("quiet") ? "error" : "warn" })

  const office = new Office({
    cwd,
    agencyRoot: arg("agency-root"),
  })
  await office.init()

  switch (command) {
    case "init": {
      const objective = process.argv.slice(3).filter((a) => !a.startsWith("--")).join(" ")
      const state = await office.loadState(objective || "(sin objetivo)")
      state.objective = objective || state.objective
      await office.saveState(state)
      const roster = await office.loadRoster(state.runId)
      await office.saveRoster(roster)
      emit(json, {
        ok: true,
        officeDir: office.paths.officeDir,
        projectRoot: office.paths.projectRoot,
        runId: state.runId,
        fallback: office.paths.fallback,
      })
      return 0
    }

    case "status": {
      const state = await office.loadState()
      const roster = await office.loadRoster(state.runId)
      const cards = Object.values(state.cards)
      const done = cards.filter((c) => c.state === "done")
      const pending = cards.filter((c) => c.state !== "done")
      const blocked = cards.filter((c) => c.state === "blocked" || c.state === "escalated")
      const dead = office.rosterStore.deadAgents(roster, office.limits.heartbeatSec * 3)

      const payload = {
        objective: state.objective,
        status: state.status,
        iteration: state.iteration,
        progress: `${done.length}/${cards.length}`,
        budget: state.budget,
        pending: pending.map((c) => `${c.id} [${c.state}] ${c.title}`),
        blocked: blocked.map((c) => `${c.id}: ${c.result ?? "sin motivo"}`),
        deadAgents: dead.map((a) => `${a.id} (${a.role})`),
        agents: Object.values(roster.agents).map((a) => ({
          id: a.id,
          role: a.role,
          state: a.state,
          card: a.currentCard,
        })),
        escalations: state.escalations.filter((e) => e.status === "open"),
      }

      if (json) {
        emit(true, payload)
        return 0
      }

      process.stdout.write(`\n🏢 OFICINA — ${state.objective}\n\n`)
      process.stdout.write(`Estado:    ${state.status}\n`)
      process.stdout.write(`Progreso:  ${payload.progress} cards DONE\n`)
      process.stdout.write(
        `Presupuesto: ${state.budget.cardsUsed}/${state.budget.maxCards} cards · ${state.budget.agentCallsUsed}/${state.budget.maxAgentCalls} agentes · ${state.budget.spawnsUsed}/${state.budget.maxSpawnsTotal} spawns\n\n`,
      )
      if (payload.pending.length) {
        process.stdout.write("Pendientes:\n")
        for (const p of payload.pending) process.stdout.write(`  - ${p}\n`)
        process.stdout.write("\n")
      }
      if (payload.blocked.length) {
        process.stdout.write("Bloqueadas:\n")
        for (const b of payload.blocked) process.stdout.write(`  - ${b}\n`)
        process.stdout.write("\n")
      }
      if (payload.deadAgents.length) {
        process.stdout.write(`Sin heartbeat: ${payload.deadAgents.join(", ")}\n\n`)
      }
      if (payload.escalations.length) {
        process.stdout.write("Escalaciones abiertas:\n")
        for (const e of payload.escalations) {
          process.stdout.write(`  - ${e.cardId}: ${e.cause}\n`)
          process.stdout.write(`    recomendación: ${e.recommendation}\n`)
        }
        process.stdout.write("\n")
      }
      return 0
    }

    case "board": {
      const state = await office.loadState()
      const lines: string[] = [`# Tablero — ${state.objective}`, ""]
      const groups: Record<string, typeof state.order> = {
        TODO: [],
        IN_PROGRESS: [],
        REVIEW: [],
        DONE: [],
        BLOCKED: [],
        ESCALATED: [],
      }
      for (const id of state.order) {
        const card = state.cards[id]
        if (!card) continue
        const key = card.state.toUpperCase()
        if (groups[key]) groups[key]!.push(id)
      }
      for (const [name, ids] of Object.entries(groups)) {
        if (ids.length === 0) continue
        lines.push(`## ${name}`)
        for (const id of ids) {
          const c = state.cards[id]!
          lines.push(`- **${id}** ${c.title} · owner=${c.owner ?? "—"} · ${c.result ?? ""}`)
        }
        lines.push("")
      }
      const text = lines.join("\n")
      if (json) emit(true, { board: text })
      else process.stdout.write(`\n${text}\n`)
      return 0
    }

    case "bus": {
      const stats = await office.bus.stats()
      const channels = await listFiles(office.paths.busDir)
      const detail: Record<string, unknown[]> = {}
      for (const channel of channels) {
        const messages = await office.bus.readChannel(channel)
        detail[channel] = messages.slice(-5).map((m) => ({
          id: m.id,
          seq: m.seq,
          from: m.from,
          kind: m.kind,
          subject: m.subject,
          at: m.createdAt,
        }))
      }
      if (json) emit(true, { stats, detail })
      else {
        process.stdout.write("\n📬 Bus de mensajes\n\n")
        for (const [channel, count] of Object.entries(stats)) {
          process.stdout.write(`  ${channel}: ${count} mensajes\n`)
        }
        process.stdout.write("\n")
      }
      return 0
    }

    case "audit": {
      const cardId = process.argv[3]
      if (!cardId) {
        process.stderr.write("Falta el id de la card.\n")
        return 1
      }
      const state = await office.loadState()
      const card = state.cards[cardId]
      if (!card) {
        process.stderr.write(`No existe la card ${cardId}.\n`)
        return 1
      }
      const dir = cardDir(office.paths, cardId)
      const files = await listFiles(dir)
      const gates = await readJson<unknown>(path.join(dir, "gates.md"))
      const payload = {
        card: {
          id: card.id,
          title: card.title,
          state: card.state,
          owner: card.owner,
          reviewer: card.reviewer,
          attempts: card.attempts,
          rejections: card.rejections,
          result: card.result,
        },
        artifacts: files,
        hasHandoff: files.includes("handoff.md"),
        hasEvidence: files.includes("evidence.md"),
        hasReview: files.includes("review.md"),
        hasGates: files.includes("gates.md"),
        gates: gates ?? null,
      }
      if (json) emit(true, payload)
      else {
        process.stdout.write(`\n🔍 Auditoría — ${card.id}: ${card.title}\n\n`)
        process.stdout.write(`Estado: ${card.state} · owner=${card.owner} reviewer=${card.reviewer}\n`)
        process.stdout.write(`Intentos: ${card.attempts} · rechazos: ${card.rejections}\n`)
        process.stdout.write(`Resultado: ${card.result ?? "—"}\n\n`)
        process.stdout.write("Artefactos:\n")
        for (const f of files) process.stdout.write(`  ${files.includes(f) ? "✓" : "·"} ${f}\n`)
        process.stdout.write("\n")
      }
      return 0
    }

    case "verify": {
      const state = await office.loadState()
      const inReview = state.order.filter((id) => state.cards[id]?.state === "review")
      const results: Record<string, unknown> = {}
      for (const id of inReview) {
        const gates = await office.runGates(state, id)
        results[id] = {
          passed: gates.passed,
          technical: gates.technicalOutcome,
          security: gates.securityOutcome,
        }
      }
      if (json) emit(true, { results })
      else {
        process.stdout.write("\n🔬 Gates\n\n")
        for (const [id, r] of Object.entries(results)) {
          process.stdout.write(`  ${id}: ${(r as { passed: boolean }).passed ? "PASS" : "FAIL"}\n`)
        }
        process.stdout.write("\n")
      }
      return 0
    }

    case "catalog": {
      const root = arg("agency-root")
      if (!root) {
        process.stderr.write("Falta --agency-root.\n")
        return 1
      }
      const catalog = await scanCatalog({ root })
      if (json) {
        emit(true, { count: catalog.length, agents: catalog.map((a) => ({ slug: a.slug, division: a.division, capabilities: a.capabilities })) })
        return 0
      }
      process.stdout.write(`\n📚 Catálogo — ${catalog.length} agentes\n\n`)
      for (const agent of catalog) {
        process.stdout.write(`  ${agent.division}/${agent.slug}\n`)
        process.stdout.write(`    ${agent.displayName} — ${agent.capabilities.slice(0, 8).join(", ")}\n`)
      }
      process.stdout.write("\n")
      return 0
    }

    case "install": {
      // Instala los assets del protocolo (skill + agentes + comando) en el
      // directorio de configuración de OpenCode.
      const target = path.resolve(arg("target") ?? path.join(homedir(), ".config", "opencode"))
      const packageRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..")

      const installed: string[] = []
      const skipped: string[] = []

      // Skill
      const skillSrc = path.join(packageRoot, "skills", "oficina")
      const skillDst = path.join(target, "skills", "oficina")
      if (existsSync(skillSrc)) {
        await fs.cp(skillSrc, skillDst, { recursive: true, force: true })
        installed.push(path.join(target, "skills", "oficina"))
      } else {
        skipped.push("skills/oficina (no encontrado en el paquete)")
      }

      // Agentes
      const agentsSrc = path.join(packageRoot, "agents")
      const agentsDst = path.join(target, "agents")
      if (existsSync(agentsSrc)) {
        await fs.mkdir(agentsDst, { recursive: true })
        const files = (await fs.readdir(agentsSrc)).filter((f) => f.endsWith(".md"))
        for (const file of files) {
          await fs.copyFile(path.join(agentsSrc, file), path.join(agentsDst, file))
        }
        installed.push(`${agentsDst} (${files.length} agentes)`)
      } else {
        skipped.push("agents/ (no encontrado en el paquete)")
      }

      // Comando
      const cmdSrc = path.join(packageRoot, "commands", "oficina.md")
      const cmdDst = path.join(target, "commands", "oficina.md")
      if (existsSync(cmdSrc)) {
        await fs.mkdir(path.dirname(cmdDst), { recursive: true })
        await fs.copyFile(cmdSrc, cmdDst)
        installed.push(cmdDst)
      } else {
        skipped.push("commands/oficina.md (no encontrado en el paquete)")
      }

      // Entry point del plugin
      //
      // Para OpenCode v2 el entry tiene que resolver el paquete en runtime:
      // el loader de v2 no resuelve bare specifiers desde
      // ~/.config/opencode/plugins/. El archivo `plugin-entry.js` hace esa
      // busqueda y lo importa por ruta absoluta.
      const pluginDir = path.join(target, "plugins")
      await fs.mkdir(pluginDir, { recursive: true })
      const pluginEntry = path.join(pluginDir, "oficina.js")
      const entrySrc = path.join(packageRoot, "dist", "pluginEntry.js")
      if (existsSync(entrySrc)) {
        await fs.copyFile(entrySrc, pluginEntry)
      } else {
        // Fallback: el paquete se instalo sin compilar. Se escribe un
        // import directo, que es lo que funciona en v1.
        await fs.writeFile(
          pluginEntry,
          'export { default } from "oficina-opencode"\n',
          "utf8",
        )
      }
      installed.push(pluginEntry)

      emit(json, { ok: true, target, installed, skipped })
      if (!json) {
        process.stdout.write(`\n✅ Instalado en ${target}\n\n`)
        for (const item of installed) process.stdout.write(`  + ${item}\n`)
        for (const item of skipped) process.stdout.write(`  - ${item} (omitido)\n`)
        process.stdout.write(
          `\nRecordá setear \`experimental.subagent_depth: 3\` en ${path.join(target, "opencode.json")}\n\n`,
        )
      }
      return 0
    }

    case "reset": {
      if (!flag("force")) {
        process.stdout.write(
          `Esto borra el estado de la corrida en ${office.paths.officeDir}.\nRe-ejecutá con --force para confirmar.\n`,
        )
        return 1
      }
      const state = await office.loadState()
      await writeJsonAtomic(office.paths.statePath, {
        ...state,
        status: "abandoned",
        cards: {},
        order: [],
        sessions: {},
      })
      await ensureDir(office.paths.officeDir)
      emit(json, { ok: true, reset: true })
      return 0
    }

    default:
      process.stderr.write(`Comando desconocido: ${command}\n\n`)
      usage()
      return 1
  }
}

function emit(json: boolean, payload: unknown): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
  } else {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    log.error("fallo en el CLI", { error: String(err) })
    process.stderr.write(`${String(err)}\n`)
    process.exit(1)
  })
