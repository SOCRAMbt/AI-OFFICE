/**
 * Diagnostico de una corrida de la oficina.
 *
 *     npx tsx scripts/diagnose-run.ts [directorio-del-proyecto]
 *
 * ## Que mira
 *
 * - El estado de cada card y quien la tiene.
 * - **Que rol se eligio de verdad y con que cobertura.** Esta es la parte
 *   que mas falla: un rol equivocado hace que todo lo demas parezca bien
 *   y no llegue a ningun lado.
 * - Los artefactos, los gates y el grafo de evidencia.
 * - El bus:AYUDA pedida, aceptada, y donde quedo.
 * - El costo.
 *
 * ## Que NO hace
 *
 * No arregla nada. Diagnostica. La diferencia importa: un diagnostico que
 * repara es un diagnostico que no se puede usar para comparar.
 */

import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"

const proyecto = path.resolve(process.argv[2] ?? process.cwd())
const office = path.join(proyecto, ".oficina")

const C = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  rojo: "\u001b[31m",
  verde: "\u001b[32m",
  amarillo: "\u001b[33m",
  azul: "\u001b[36m",
  gris: "\u001b[90m",
}

function ok(t: string) {
  console.log(`  ${C.verde}OK${C.reset}    ${t}`)
}
function mal(t: string) {
  console.log(`  ${C.rojo}FALLA${C.reset} ${t}`)
}
function aviso(t: string) {
  console.log(`  ${C.amarillo}AVISO${C.reset} ${t}`)
}
function dim(t: string) {
  console.log(`    ${C.gris}${t}${C.reset}`)
}

/** Lee un JSON si existe. */
async function leerJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch {
    return undefined
  }
}

async function existe(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

interface Card {
  id: string
  title: string
  type: string
  state: string
  owner: string | null
  reviewer: string | null
  requiredCapabilities: string[]
  scope: { mayTouch: string[]; forbidden: string[] }
  acceptance: string[]
  gate: string
  attempts: number
  rejections: number
  dependsOn: string[]
}

interface State {
  runId: string
  objective: string
  status: string
  iteration: number
  cards: Record<string, Card>
  order: string[]
  budget: { cardsUsed: number; maxCards: number; agentCallsUsed: number; maxAgentCalls: number; spawnsUsed: number; maxSpawnsTotal: number }
  halt: { reason: string; at: string; by: string } | null
  sessions: Record<string, { agentId: string; cardId: string | null; autoResumes: number }>
  pendingGates: string[]
}

interface RosterEntry {
  id: string
  role: string
  displayName: string
  state: string
  currentCard: string | null
  capabilities: string[]
  source: { kind: string; division?: string; path?: string }
}

async function main() {
  console.log("")
  console.log(`${C.azul}DIAGNÓSTICO DE LA CORRIDA${C.reset}  ${proyecto}`)
  console.log("=".repeat(72))

  if (!(await existe(office))) {
    mal(`No hay corrida en ${office}`)
    console.log("")
    console.log("  Ejecutá `/oficina <objetivo>` en una sesión abierta en ese directorio.")
    process.exit(1)
  }

  const state = await leerJson<State>(path.join(office, "state.json"))
  if (!state) {
    mal("state.json ilegible o ausente")
    process.exit(1)
  }

  /* ── 1. Estado general ──────────────────────────────────────────────── */
  console.log("")
  console.log(`${C.azul}1. ESTADO${C.reset}`)
  dim(`objetivo: ${state.objective}`)
  dim(`run: ${state.runId} · status: ${state.status} · iteración: ${state.iteration}`)
  dim(
    `presupuesto: ${state.budget.cardsUsed}/${state.budget.maxCards} cards · ` +
      `${state.budget.agentCallsUsed}/${state.budget.maxAgentCalls} llamadas · ` +
      `${state.budget.spawnsUsed}/${state.budget.maxSpawnsTotal} spawns`,
  )
  if (state.halt) {
    aviso(`FRENADA: ${state.halt.reason} (por ${state.halt.by} a las ${state.halt.at})`)
  }
  if (state.order.length === 0) {
    mal("no hay cards: el plan no se guardó, o la corrida se limpió")
  }

  /* ── 2. Cards ───────────────────────────────────────────────────────── */
  console.log("")
  console.log(`${C.azul}2. CARDS${C.reset}`)
  for (const id of state.order) {
    const c = state.cards[id]
    if (!c) {
      mal(`${id}: no está en el estado`)
      continue
    }
    const cerrado = c.state === "done"
    console.log(`  ${cerrado ? C.verde + "OK" : C.amarillo + "ABIERTA"}${C.reset} ${c.id} [${c.state}] ${c.title}`)
    dim(`caps: ${c.requiredCapabilities.join(", ") || "(ninguna)"}`)
    dim(`scope: ${c.scope.mayTouch.join(", ")} | prohibido: ${c.scope.forbidden.join(", ") || "—"}`)
    dim(`gate: ${c.gate}`)
    dim(`acceptance (${c.acceptance.length}): ${c.acceptance.join(" · ")}`)
    dim(`owner=${c.owner ?? "—"} reviewer=${c.reviewer ?? "—"} intentos=${c.attempts} rechazos=${c.rejections}`)
    if (c.owner && c.reviewer && c.owner === c.reviewer) {
      mal("el owner y el reviewer son el mismo agente (auto-aprobación)")
    }
    if (c.state === "done" && c.attempts > 3) {
      aviso(`cerró con ${c.attempts} intentos`)
    }
  }

  /* ── 3. El equipo: que rol se eligio ───────────────────────────────── */
  console.log("")
  console.log(`${C.azul}3. EL EQUIPO (esto es lo que más falla)${C.reset}`)
  const roster = await leerJson<{ agents: Record<string, RosterEntry> }>(path.join(office, "roster.json"))
  if (!roster || Object.keys(roster.agents).length === 0) {
    aviso("no hay roster: el dispatch no se ejecutó, o no creó agentes")
  } else {
    for (const a of Object.values(roster.agents)) {
      const card = a.currentCard ? state.cards[a.currentCard] : undefined
      console.log(`  ${C.azul}·${C.reset} ${a.id}`)
      dim(`rol: ${a.role} (${a.source.kind}${a.source.division ? ` / ${a.source.division}` : ""})`)
      dim(`display: ${a.displayName}`)
      dim(`state: ${a.state} · card: ${a.currentCard ?? "—"}`)
      if (card && a.source.kind === "agency-agents") {
        // Un rol del catálogo que no matchea las capabilities de su card es
        // la senal de que el matcher eligio por el orden de la lista.
        const caps = card.requiredCapabilities.join(" ").toLowerCase()
        const nombre = `${a.role} ${a.displayName}`.toLowerCase()
        const共享 = caps
          .split(/[^a-z0-9]+/)
          .filter((t) => t.length > 3)
          .some((t) => nombre.includes(t))
        if (!compartido) {
          aviso(
            `el rol "${a.role}" no comparte ninguna capability con la card ` +
              `(${card.requiredCapabilities.join(", ")}). ¿Match por el orden de la lista?`,
          )
        }
      }
      if (a.source.kind === "factory") {
        dim("rol FABRICADO: el catálogo no cubría la card")
      }
    }
  }

  /* ── 4. Artefactos, gates y evidencia ──────────────────────────────── */
  console.log("")
  console.log(`${C.azul}4. ARTEFACTOS, GATES Y EVIDENCIA${C.reset}`)
  const artsDir = path.join(office, "artifacts")
  for (const id of state.order) {
    const dir = path.join(artsDir, id)
    if (!(await existe(dir))) {
      aviso(`${id}: sin artefactos`)
      continue
    }
    const files = await fs.readdir(dir)
    console.log(`  ${id}: ${files.join(", ")}`)
    if (!files.includes("handoff.md")) aviso(`${id}: falta handoff.md`)
    if (!files.includes("evidence.md")) aviso(`${id}: falta evidence.md`)
    if (!files.includes("gates.md")) aviso(`${id}: falta gates.md (el gate no corrió)`)

    if (files.includes("gates.md")) {
      const gates = await fs.readFile(path.join(dir, "gates.md"), "utf8")
      const fallo = /\| (build|typecheck|lint|test|secrecy|diff|verify) \|[^|]*\|\s*(FAIL|NOT RUN|na)/i.exec(gates)
      if (fallo) mal(`${id}: una fase del gate no pasó (${fallo[1]})`)
      else ok(`${id}: gates en PASS`)
    }

    const evDir = path.join(office, "evidence", `${id}.json`)
    const ev = await leerJson<{ nodes?: unknown[] }>(evDir)
    if (!ev || !ev.nodes || ev.nodes.length === 0) {
      aviso(`${id}: sin evidencia registrada — sin evidencia la card no debería cerrarse`)
    } else {
      dim(`${id}: ${ev.nodes.length} evidencia(s)`)
    }
  }

  /* ── 5. El bus ──────────────────────────────────────────────────────── */
  console.log("")
  console.log(`${C.azul}5. EL BUS${C.reset}`)
  let mensajes = 0
  for (const canal of ["peer", "coord-command", "coord-arch", "coord-flow"]) {
    const dir = path.join(office, "bus", canal)
    if (!(await existe(dir))) continue
    const files = await fs.readdir(dir)
    if (files.length === 0) continue
    mensajes += files.length
    console.log(`  ${canal}: ${files.length} mensajes`)
    for (const f of files.slice(-6)) {
      const m = await leerJson<{ kind: string; from: string; subject: string }>(path.join(dir, f))
      if (m) dim(`${m.kind} · de ${m.from} · ${m.subject}`)
    }
  }
  if (mensajes === 0) dim("sin mensajes: los subagentes no se pidieron ayuda ni se coordinaron")

  /* ── 6. Costo ───────────────────────────────────────────────────────── */
  console.log("")
  console.log(`${C.azul}6. COSTO${C.reset}`)
  const cost = await leerJson<{ total?: { usd?: number; calls?: number; tokens?: Record<string, number> } }>(
    path.join(office, "cost.json"),
  )
  if (!cost?.total) {
    dim("sin ledger de costo todavía (o el modelo no consumió nada)")
  } else {
    const t = cost.total
    dim(`USD: $${(t.usd ?? 0).toFixed(4)} · llamadas: ${t.calls ?? 0}`)
    dim(`tokens: ${JSON.stringify(t.tokens ?? {})}`)
  }

  /* ── 7. Reconciliación ──────────────────────────────────────────────── */
  console.log("")
  console.log(`${C.azul}7. RECONCILIACIÓN${C.reset}`)
  console.log(`  ${C.gris}(estado vs artefactos vs filesystem)${C.reset}`)
  try {
    const { reconcile } = await import("../src/core/recovery.ts")
    const { Office } = await import("../src/core/office.ts")
    const office = new Office({ cwd: proyecto })
    await office.init()
    const report = await reconcile(office, { autoRepair: false })
    if (report.issues.length === 0) {
      ok("sin inconsistencias")
    } else {
      for (const issue of report.issues) {
        const marca = issue.severity === "critical" ? C.rojo + "CRITICO" : C.amarillo + "AVISO"
        console.log(`  ${marca}${C.reset} ${issue.kind}${issue.cardId ? ` (${issue.cardId})` : ""}`)
        dim(issue.detail)
      }
    }
  } catch (err) {
    dim(`no se pudo reconciliar: ${String(err)}`)
  }

  /* ── 8. Veredicto ───────────────────────────────────────────────────── */
  console.log("")
  console.log(`${C.azul}8. VEREDICTO${C.reset}`)
  const cardsDone = state.order.filter((id) => state.cards[id]?.state === "done").length
  if (cardsDone === state.order.length && state.order.length > 0) {
    ok(`las ${cardsDone} cards cerraron`)
  } else {
    aviso(`${cardsDone}/${state.order.length} cards cerradas`)
    const trabadas = state.order.filter((id) => {
      const c = state.cards[id]
      return c && c.state !== "done" && c.attempts >= 3
    })
    for (const id of trabadas) {
      mal(`${id} lleva ${state.cards[id]!.attempts} intentos sin cerrar`)
    }
  }
  const reanudaciones = Object.values(state.sessions).reduce((a, s) => a + s.autoResumes, 0)
  dim(`auto-reanudaciones: ${reanudaciones}`)
  console.log("")
}

main().catch((err) => {
  console.error("FALLO:", err)
  process.exit(1)
})
