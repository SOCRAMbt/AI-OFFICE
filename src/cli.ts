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
import { RosterStore } from "./core/roster.js"
import { migrateState } from "./core/state.js"
import { resolveProjectRoot } from "./core/paths.js"
import { logger, configureLogging } from "./core/log.js"
import { listFiles, readJson, readText, ensureDir, writeJsonAtomic } from "./core/fsx.js"
import { cardDir } from "./core/paths.js"
import { scanCatalog } from "./core/catalog.js"
import type { OfficeState, Roster } from "./core/types.js"
import { DEFAULT_LIMITS, StateCorruptionError } from "./core/types.js"

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
AI-OFFICE - CLI de la Oficina de Agents (alias: office)

Uso: oficina <comando> [opciones]

Comandos:
  init [objetivo]      Crea la estructura .oficina/ en el proyecto
  status               Muestra el estado de la corrida
  dashboard            Abre el dashboard visual en tiempo real (http://localhost:7333)
  demo                 Abre el dashboard con una corrida pregrabada (no requiere OpenCode)
  board                Muestra el tablero Kanban
  bus                  Muestra estadísticas del bus
  stats                Resume la corrida: estado, cards por columna, iteración y agentes vivos
  audit [cardId]       Audita una card: artefactos, gates, review
  verify               Corre los gates de todas las cards en review
  install              Instala skill, agentes y comando en un directorio de OpenCode
  catalog              Lista el catálogo de roles disponible
  reset [--force]      Borra el estado de la corrida

Opciones:
  --directory <path>     Directorio del proyecto (default: cwd)
  --agency-root <path>   Raíz del repo agency-agents
  --target <path>        Destino de install (default: ~/.config/opencode)
  --json                 Salida en JSON
  --force                No pedir confirmación (para reset)
  --force-new-run        Crear nueva corrida aunque exista estado corrupto (para init)
  --port <n>             Puerto del dashboard (default 7333; negocia el siguiente si está ocupado)
  --no-open              No abrir el navegador al arrancar el dashboard
`)
}

async function main(): Promise<number> {
  // Alias: /office → /oficina (English primary, Spanish deprecated)
  const rawCommand = process.argv[2]
  const command = rawCommand === "office" ? "oficina" : rawCommand
  const cwd = path.resolve(arg("directory") ?? process.cwd())
  const json = flag("json")

  if (!command || command === "help" || command === "--help") {
    usage()
    return 0
  }

  configureLogging({ level: flag("quiet") ? "error" : "warn" })

  // `stats` solo lee: se resuelve antes de armar la Oficina, que crea `.oficina/`.
  if (command === "stats") return statsCommand(cwd, json)

  // `demo` abre el dashboard con una corrida pregrabada (no requiere OpenCode)
  if (command === "demo") {
    const { spawn } = await import("node:child_process")
    const packageRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..")
    const seedScript = path.join(packageRoot, "dashboard", "scripts", "seed-demo.mjs")
    const serverScript = path.join(packageRoot, "dashboard", "scripts", "serve.mjs")
    const demoDir = path.join(cwd, ".oficina-demo")
    // Seed demo data
    const seed = spawn(process.execPath, [seedScript, demoDir], { stdio: "inherit", cwd: packageRoot })
    await new Promise<void>((resolve, reject) => {
      seed.on("close", (code) => {
        if (code === 0) resolve()
        else reject(new Error(`seed failed: ${code}`))
      })
    })
    // Start dashboard server
    const server = spawn(process.execPath, [serverScript, "--oficina", demoDir], { stdio: "inherit", cwd: packageRoot, detached: true })
    server.unref()
    process.stdout.write(`\nDemo iniciada en http://localhost:7333\n`)
    process.stdout.write(`Directorio demo: ${demoDir}\n`)
    process.stdout.write(`Para detener: Ctrl+C o matar el proceso del servidor\n\n`)
    return 0
  }

  const office = new Office({
    cwd,
    agencyRoot: arg("agency-root"),
  })
  await office.init()

  switch (command) {
    case "init": {
      const objective = process.argv.slice(3).filter((a) => !a.startsWith("--")).join(" ")
      const forceNewRun = flag("force-new-run")
      let state: OfficeState
      try {
        state = await office.loadState(objective || "(sin objetivo)")
      } catch (err) {
        if (err instanceof StateCorruptionError && forceNewRun) {
          // El usuario solicita explícitamente crear una nueva corrida
          const { createRun } = await import("./core/state.js")
          const { DEFAULT_LIMITS } = await import("./core/types.js")
          const { shortId } = await import("./core/fsx.js")
          state = createRun(objective ?? "", shortId("run"), DEFAULT_LIMITS)
          await office.saveState(state)
        } else {
          throw err
        }
      }
      state.objective = objective || state.objective
      await office.saveState(state)
      const roster = await office.loadRoster(state.runId)
      await office.saveRoster(roster)
      const payload = {
        ok: true,
        officeDir: office.paths.officeDir,
        projectRoot: office.paths.projectRoot,
        runId: state.runId,
        fallback: office.paths.fallback,
      }
      if (json) {
        emit(true, payload)
      } else {
        process.stdout.write(`\n✅ Oficina inicializada\n\n`)
        process.stdout.write(`  Directorio: ${payload.officeDir}\n`)
        process.stdout.write(`  Proyecto:   ${payload.projectRoot}\n`)
        process.stdout.write(`  Run ID:     ${payload.runId}\n`)
        if (payload.fallback) process.stdout.write(`  Fallback:   SÍ (proyecto de solo lectura)\n`)
        process.stdout.write(`\n`)
      }
      return 0
    }

    case "status": {
      let state: OfficeState
      try {
        state = await office.loadState()
      } catch (err) {
        if (err instanceof StateCorruptionError) {
          if (json) emit(true, { ok: false, error: "STATE_CORRUPT", message: err.message })
          else process.stderr.write(`\n❌ ${err.message}\n\n`)
          return 1
        }
        throw err
      }
      const roster = await office.loadRoster(state.runId)
      const cards = Object.values(state.cards)
      const done = cards.filter((c) => c.state === "done")
      const pending = cards.filter((c) => c.state !== "done")
      const blocked = cards.filter((c) => c.state === "blocked" || c.state === "escalated" || c.state === "blocked_escalated")
      const dead = office.rosterStore.deadAgents(roster, office.limits.heartbeatSec * 3)

      const payload = {
        objective: state.objective,
        status: state.status,
        iteration: state.iteration,
        progress: `${done.length}/${cards.length}`,
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
      process.stdout.write(`Cards:     ${Object.keys(state.cards).length} total\n\n`)
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
      let state: OfficeState
      try {
        state = await office.loadState()
      } catch (err) {
        if (err instanceof StateCorruptionError) {
          if (json) emit(true, { ok: false, error: "STATE_CORRUPT", message: err.message })
          else process.stderr.write(`\n❌ ${err.message}\n\n`)
          return 1
        }
        throw err
      }
      const lines: string[] = [`# Tablero — ${state.objective}`, ""]
      const groups: Record<string, typeof state.order> = {
        TODO: [],
        IN_PROGRESS: [],
        REWORK: [],
        REVIEW: [],
        DONE: [],
        BLOCKED: [],
        ESCALATED: [],
        BLOCKED_ESCALATED: [],
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

    case "dashboard": {
      const { startDashboard, openBrowser } = await import("./core/dashboard.js")
      const portArg = arg("port")
      const info = await startDashboard(office.paths.projectRoot, office.paths.officeDir, {
        port: portArg ? Number(portArg) : undefined,
      })
      if (info) {
        if (!flag("no-open")) openBrowser(info.url)
        if (json) emit(true, { ok: true, url: info.url, port: info.port })
        else process.stdout.write(`\n✅ Dashboard en vivo: ${info.url}\n`)
        return 0
      }
      if (json) emit(true, { ok: false, error: "DASHBOARD_UNAVAILABLE" })
      else process.stderr.write("\n❌ No se pudo arrancar el dashboard (¿falta el paquete instalado?).\n")
      return 1
    }

    case "audit": {
      const cardId = process.argv[3]
      if (!cardId) {
        process.stderr.write("Falta el id de la card.\n")
        return 1
      }
      let state: OfficeState
      try {
        state = await office.loadState()
      } catch (err) {
        if (err instanceof StateCorruptionError) {
          if (json) emit(true, { ok: false, error: "STATE_CORRUPT", message: err.message })
          else process.stderr.write(`\n❌ ${err.message}\n\n`)
          return 1
        }
        throw err
      }
      const card = state.cards[cardId]
      if (!card) {
        process.stderr.write(`No existe la card ${cardId}.\n`)
        return 1
      }
      const dir = cardDir(office.paths, cardId)
      const files = await listFiles(dir)
      const gatesText = await readText(path.join(dir, "gates.md"))
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
        gates: gatesText ?? null,
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
      let state: OfficeState
      try {
        state = await office.loadState()
      } catch (err) {
        if (err instanceof StateCorruptionError) {
          if (json) emit(true, { ok: false, error: "STATE_CORRUPT", message: err.message })
          else process.stderr.write(`\n❌ ${err.message}\n\n`)
          return 1
        }
        throw err
      }
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

      // Comando (office.md es el primario, oficina.md es el alias deprecado)
      for (const cmdName of ["office", "oficina"]) {
        const cmdSrc = path.join(packageRoot, "commands", `${cmdName}.md`)
        const cmdDst = path.join(target, "commands", `${cmdName}.md`)
        if (existsSync(cmdSrc)) {
          await fs.mkdir(path.dirname(cmdDst), { recursive: true })
          await fs.copyFile(cmdSrc, cmdDst)
          installed.push(cmdDst)
        } else {
          skipped.push(`commands/${cmdName}.md (no encontrado en el paquete)`)
        }
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
      let state: OfficeState
      try {
        state = await office.loadState()
      } catch (err) {
        if (err instanceof StateCorruptionError) {
          // Si el estado está corrupto, creamos uno nuevo abandonado directamente
          const { createRun } = await import("./core/state.js")
          const { DEFAULT_LIMITS } = await import("./core/types.js")
          const { shortId } = await import("./core/fsx.js")
          state = createRun("(corrupto - reiniciado)", shortId("run"), DEFAULT_LIMITS)
        } else {
          throw err
        }
      }
      await writeJsonAtomic(office.paths.statePath, {
        ...state,
        status: "abandoned",
        cards: {},
        order: [],
        sessions: {},
      })
      await ensureDir(office.paths.officeDir)
      if (json) {
        emit(true, { ok: true, reset: true })
      } else {
        process.stdout.write(`\n🗑️  Estado reiniciado (corrida abandonada)\n\n`)
      }
      return 0
    }

    default:
      process.stderr.write(`Comando desconocido: ${command}\n\n`)
      usage()
      return 1
  }
}

/** Lee un JSON sin tocarlo: a diferencia de `readJson`, no pone en cuarentena un archivo corrupto. */
async function peekJson(filePath: string): Promise<{ kind: "ok"; value: unknown } | { kind: "missing" } | { kind: "corrupt"; message: string }> {
  let raw: string
  try {
    raw = await fs.readFile(filePath, "utf8")
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" }
    throw err
  }
  try {
    return { kind: "ok", value: JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw) }
  } catch (err) {
    return { kind: "corrupt", message: String(err) }
  }
}

/**
 * `oficina stats`: resumen de la corrida a partir de `<proyecto>/.oficina/state.json`.
 *
 * Solo lee. No crea la carpeta, no migra el archivo y no inicia una corrida
 * nueva si no hay ninguna.
 */
async function statsCommand(cwd: string, json: boolean): Promise<number> {
  const officeDir = path.join(await resolveProjectRoot(cwd), ".oficina")
  const statePath = path.join(officeDir, "state.json")
  const fail = (error: string, message: string): number => {
    if (json) emit(true, { ok: false, error, message })
    else process.stderr.write(`\n❌ ${message}\n\n`)
    return 1
  }

  const stateFile = await peekJson(statePath)
  if (stateFile.kind === "missing") {
    return fail("NO_RUN", `No hay una corrida en ${officeDir} (falta state.json). Creala con "oficina init <objetivo>".`)
  }
  if (stateFile.kind === "corrupt") {
    return fail("STATE_CORRUPT", `El estado de la corrida está corrupto (${statePath}): ${stateFile.message}`)
  }
  const state = migrateState(stateFile.value)
  if (!state) return fail("STATE_CORRUPT", `El estado de la corrida no tiene un formato válido (${statePath}).`)

  const counts = { todo: 0, in_progress: 0, review: 0, done: 0, other: 0 }
  const cards = Object.values(state.cards ?? {})
  for (const card of cards) {
    if (card.state === "todo" || card.state === "in_progress" || card.state === "review" || card.state === "done") counts[card.state]++
    else counts.other++
  }

  // Un roster ausente o de otra corrida cuenta como sin agentes.
  const rosterFile = await peekJson(path.join(officeDir, "roster.json"))
  const roster: Roster = { version: 2, runId: state.runId, updatedAt: "", agents: {} }
  if (rosterFile.kind === "ok") {
    const raw = rosterFile.value as Partial<Roster> | null
    if (raw && raw.runId === state.runId && raw.agents && typeof raw.agents === "object") roster.agents = raw.agents
  }
  const active = Object.values(roster.agents).filter((a) => a.state !== "retired")
  const silent = new RosterStore(path.join(officeDir, "roster.json")).deadAgents(roster, DEFAULT_LIMITS.heartbeatSec * 3)
  const alive = active.length - silent.length

  const payload = {
    runId: state.runId,
    status: state.status,
    iteration: state.iteration,
    cards: { ...counts, total: cards.length },
    agents: { alive, withoutHeartbeat: silent.length },
  }
  if (json) {
    emit(true, payload)
    return 0
  }

  const rows: Array<[string, string | number]> = [
    ["Run ID", payload.runId],
    ["Estado", payload.status],
    ["Iteración", payload.iteration],
    ["Cards todo", counts.todo],
    ["Cards in_progress", counts.in_progress],
    ["Cards review", counts.review],
    ["Cards done", counts.done],
    ...(counts.other ? ([["Cards otras", counts.other]] as Array<[string, number]>) : []),
    ["Cards total", cards.length],
    ["Agentes vivos", alive],
    ["Agentes sin heartbeat", silent.length],
  ]
  const width = Math.max(...rows.map(([label]) => label.length))
  process.stdout.write(`\n📊 OFICINA — ${state.objective}\n\n`)
  for (const [label, value] of rows) process.stdout.write(`  ${label.padEnd(width)}  ${value}\n`)
  process.stdout.write("\n")
  return 0
}

function emit(_json: boolean, payload: unknown): void {
  // Only called with json=true now. Text output is handled per-command.
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    log.error("fallo en el CLI", { error: String(err) })
    process.stderr.write(`${String(err)}\n`)
    process.exit(1)
  })
