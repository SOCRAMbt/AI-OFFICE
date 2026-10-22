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
import { pathToFileURL } from "node:url"

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

/** Resultado de un diagnostico. */
export interface DiagnoseResult {
  /** Invariantes rotos. */
  fallas: number
  /** Cosas que hay que mirar pero no son una rotura. */
  avisos: number
  /** Cards cerradas sobre el total. */
  cardsDone: number
  cardsTotal: number
  /** Por que no se pudo diagnosticar. */
  error?: string
}

/**
 * Diagnostica una corrida.
 *
 * Devuelve un resultado en vez de solo imprimir: asi los tests pueden
 * afirmar que el diagnostico DETECTA las roturas, y no solo que dice
 * cosas lindas.
 */
export async function diagnose(dir: string): Promise<DiagnoseResult> {
  const proyecto = path.resolve(dir)
  const office = path.join(proyecto, ".oficina")

  console.log("")
  console.log(`${C.azul}DIAGNÓSTICO DE LA CORRIDA${C.reset}  ${proyecto}`)
  console.log("=".repeat(72))

  if (!(await existe(office))) {
    mal(`No hay corrida en ${office}`)
    console.log("")
    console.log("  Ejecutá `/oficina <objetivo>` en una sesión abierta en ese directorio.")
    return { fallas: 1, avisos: 0, cardsDone: 0, cardsTotal: 0, error: "sin-corrida" }
  }

  const state = await leerJson<State>(path.join(office, "state.json"))
  if (!state) {
    mal("state.json ilegible o ausente")
    return { fallas: 1, avisos: 0, cardsDone: 0, cardsTotal: 0, error: "estado-ilegible" }
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
      // Un roster escrito a mano o de otra version puede no tener `source`.
      // Un diagnostico que se rompe por eso no sirve: no podes concluir
      // nada de una corrida que ni miro.
      const kind = a.source?.kind ?? "desconocido"
      console.log(`  ${C.azul}·${C.reset} ${a.id}`)
      dim(`rol: ${a.role} (${kind}${a.source?.division ? ` / ${a.source.division}` : ""})`)
      dim(`display: ${a.displayName ?? "—"}`)
      dim(`state: ${a.state ?? "—"} · card: ${a.currentCard ?? "—"}`)
      if (card && kind === "agency-agents") {
        // Un rol del catálogo que no matchea las capabilities de su card es
        // la senal de que el matcher eligio por el orden de la lista.
        const caps = card.requiredCapabilities.join(" ").toLowerCase()
        const nombre = `${a.role} ${a.displayName}`.toLowerCase()
        const coincide = caps
          .split(/[^a-z0-9]+/)
          .filter((t) => t.length > 3)
          .some((t) => nombre.includes(t))
        if (!coincide) {
          aviso(
            `el rol "${a.role}" no comparte ninguna capability con la card ` +
              `(${card.requiredCapabilities.join(", ")}). ¿Match por el orden de la lista?`,
          )
        }
      }
      if (kind === "factory") {
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
    const { reconcile } = await import("../src/core/recovery.js")
    const { Office } = await import("../src/core/office.js")
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

  /* ── 8. Invariantes ─────────────────────────────────────────────────── */
  //
  // Esto es lo que la oficina PROMETE. Cada invariante se verifica contra
  // el disco, no contra la opinion de nadie.
  //
  //   1. Ninguna card se cierra sin gates.md en PASS
  //   2. Ninguna card se cierra sin evidencia para cada criterio
  //   3. Nadie se auto-aprueba
  //   4. Ninguna card queda sin owner
  //   5. El owner de una card existe en el roster
  //   6. No se excedio el presupuesto
  //   7. Los gates con NA dicen POR QUE
  //
  console.log("")
  console.log(`${C.azul}8. INVARIANTES${C.reset}`)

  let fallas = 0
  let avisos = 0
  const check = (pasó: boolean, titulo: string, detalle?: string) => {
    if (pasó) {
      ok(titulo)
    } else {
      fallas++
      mal(titulo)
      if (detalle) dim(detalle)
    }
  }
  const checkSoft = (pasó: boolean, titulo: string, detalle?: string) => {
    if (pasó) {
      ok(titulo)
    } else {
      avisos++
      aviso(titulo)
      if (detalle) dim(detalle)
    }
  }

  // 1. Toda card cerrada tiene gates.md en PASS.
  {
    const cerradas = state.order.filter((id) => state.cards[id]?.state === "done")
    const sinPass: string[] = []
    const naSinMotivo: string[] = []
    for (const id of cerradas) {
      const g = path.join(artsDir, id, "gates.md")
      if (!(await existe(g))) {
        sinPass.push(`${id}: sin gates.md`)
        continue
      }
      const txt = await fs.readFile(g, "utf8")
      const filas = txt.split("\n").filter((l) => /^\|\s*\d+\s*\|/.test(l))
      const fallos = filas.filter((l) => /\|\s*(FAIL|NOT RUN)\s*\|/i.test(l))
      if (fallos.length > 0) sinPass.push(`${id}: gate en FAIL`)
      // Un NA tiene que explicar por que: "NA" pelado es una fase que
      // nadie corrio y no se?to de nada.
      for (const l of filas) {
        if (/\|\s*NA\s*\|/i.test(l)) {
          const cols = l.split("|").map((c) => c.trim())
          const motivo = cols[4] ?? ""
          if (motivo.length < 5) naSinMotivo.push(`${id}: NA sin motivo`)
        }
      }
    }
    check(sinPass.length === 0, "ninguna card cerrada sin gates en PASS", sinPass.join(" · "))
    checkSoft(naSinMotivo.length === 0, "todo gate NA explica por que", naSinMotivo.join(" · "))
  }

  // 2. Toda card cerrada tiene evidencia para CADA criterio de aceptacion.
  {
    const cerradas = state.order.filter((id) => state.cards[id]?.state === "done")
    const sinEvidencia: string[] = []
    for (const id of cerradas) {
      const card = state.cards[id]!
      const ev = await leerJson<{ nodes?: { requirement?: string; requirementIndex?: number }[] }>(
        path.join(office, "evidence", `${id}.json`),
      )
      const nodes = ev?.nodes ?? []
      if (nodes.length === 0) {
        sinEvidencia.push(`${id}: sin evidencia`)
        continue
      }
      // Cada criterio de aceptacion tiene que tener al menos un nodo que
      // lo referencie, por texto o por indice.
      for (let i = 0; i < card.acceptance.length; i++) {
        const criterio = card.acceptance[i] ?? ""
        const cubierto = nodes.some(
          (n) =>
            n.requirementIndex === i ||
            (typeof n.requirement === "string" &&
              n.requirement.trim() !== "" &&
              (n.requirement.trim() === criterio.trim() ||
                criterio.includes(n.requirement.trim()) ||
                n.requirement.trim().includes(criterio.trim()))),
        )
        if (!cubierto) {
          sinEvidencia.push(`${id}: criterio ${i + 1} sin evidencia ("${criterio.slice(0, 48)}...")`)
        }
      }
    }
    check(
      sinEvidencia.length === 0,
      "ninguna card cerrada sin evidencia para cada criterio",
      sinEvidencia.join(" · "),
    )
  }

  // 3. Nadie se auto-aprueba.
  {
    const auto = state.order.filter((id) => {
      const c = state.cards[id]
      return c?.owner && c?.reviewer && c.owner === c.reviewer
    })
    check(auto.length === 0, "nadie se auto-aprueba", auto.join(" · "))
  }

  // 4. Ninguna card sin owner, salvo las que todavia no arrancaron.
  {
    const huerfanas = state.order.filter((id) => {
      const c = state.cards[id]
      return c && !c.owner && c.state !== "done"
    })
    checkSoft(huerfanas.length === 0, "ninguna card sin owner", huerfanas.join(" · "))
  }

  // 5. El owner existe en el roster.
  {
    const rosterRaw = await leerJson<{ agents: Record<string, unknown> }>(
      path.join(office, "roster.json"),
    )
    const agentes = rosterRaw?.agents ?? {}
    const fantasma = state.order.filter((id) => {
      const c = state.cards[id]
      return c?.owner && !agentes[c.owner]
    })
    check(fantasma.length === 0, "todo owner existe en el roster", fantasma.join(" · "))
  }

  // 6. Presupuesto respetado.
  {
    const b = state.budget
    const excedido: string[] = []
    if (b.cardsUsed > b.maxCards) excedido.push(`cards ${b.cardsUsed}/${b.maxCards}`)
    if (b.agentCallsUsed > b.maxAgentCalls)
      excedido.push(`llamadas ${b.agentCallsUsed}/${b.maxAgentCalls}`)
    if (b.spawnsUsed > b.maxSpawnsTotal) excedido.push(`spawns ${b.spawnsUsed}/${b.maxSpawnsTotal}`)
    check(excedido.length === 0, "presupuesto respetado", excedido.join(" · "))
  }

  console.log("")
  console.log(
    `  ${fallas === 0 ? C.verde : C.rojo}${fallas} falla(s)${C.reset}` +
      ` · ${avisos} aviso(s)` +
      `  ${C.gris}(una falla = un invariante roto; un aviso = mirarlo)${C.reset}`,
  )

  /* ── 9. Veredicto ───────────────────────────────────────────────────── */
  console.log("")
  console.log(`${C.azul}9. VEREDICTO${C.reset}`)
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
  if (fallas > 0) process.exitCode = 1
  return { fallas, avisos, cardsDone, cardsTotal: state.order.length }
}

// ── CLI ────────────────────────────────────────────────────────────────
//
// Solo corre si este archivo es el entry point. Si lo importan (los
// tests), no debe arrancar la CLI.
const esEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (esEntryPoint) {
  const dir = process.argv[2] ?? process.cwd()
  diagnose(dir)
    .then((r) => {
      if (r.error) process.exit(1)
    })
    .catch((err) => {
      console.error("FALLO:", err)
      process.exit(1)
    })
}
