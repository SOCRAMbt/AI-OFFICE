/**
 * Reconciliación: qué hacer cuando la corrida quedó a medias.
 *
 * ## Por qué existe
 *
 * La oficina escribe en disco, en varios archivos, sin transaccion. Eso
 * significa que un proceso que muere en el momento equivocado deja el
 * estado incoherente:
 *
 * - El agente escribió `handoff.md` pero murió antes de llamar a
 *   `oficina_submit`: la card sigue en `in_progress` con la entrega ya
 *   escrita en disco. Nadie la va a terminar.
 * - La card quedó en `done` pero `gates.md` no se escribió: se cerró sin
 *   gate. Eso es exactamente lo que el invariante `gate-required-before-done`
 *   dice que no puede pasar, y si pasó, fue por un crash.
 * - Un agente murió con el lease tomado: la card queda trabada hasta que
 *   el TTL vence (30 minutos por defecto).
 * - Un agente terminó su card pero quedó `working` en el roster: ocupa
 *   presupuesto de agentes para siempre.
 *
 * ## Qué hace
 *
 * Compara **estado vs artefactos vs filesystem** y reporta las
 * incoherencias. Algunas se reparan solas (un lease huerfano se libera); las
 * que requieren una decision (una card `done` sin gate) se reportan para
 * que el Integrador decida.
 *
 * ## Lo que NO hace
 *
 * No adivina. No "completa" una card a la que le falta evidencia: la marca
 * como incompleta y deja que un humano o un agente la retome. Un sistema
 * que se auto-repara inventando evidencia es peor que uno que dice "esto
 * esta roto".
 */

import path from "node:path"
import fs from "node:fs/promises"
import type { Card, OfficeState } from "./types.js"
import type { Office } from "./office.js"
import { logger } from "./log.js"

const log = logger("oficina:recovery")

export type RecoveryIssueKind =
  | "card-in-progress-without-owner"
  | "review-without-artifacts"
  | "done-without-gate"
  | "orphaned-artifact"
  | "stale-lease"
  | "lease-without-owner"
  | "agent-still-working-on-done-card"
  | "blocked-by-unresolvable-dependency"
  | "review-without-evidence"

export type RecoverySeverity = "critical" | "warning"

export interface RecoveryIssue {
  kind: RecoveryIssueKind
  severity: RecoverySeverity
  cardId?: string
  agentId?: string
  detail: string
  /** Accion sugerida. */
  repair: string
  /** true si la reconciliacion la resolvio sola. */
  repaired: boolean
}

export interface RecoveryReport {
  runId: string
  checkedAt: string
  issues: RecoveryIssue[]
  /** Resumen legible para el board. */
  summary: string
  /** healthy = no hay issues criticos sin reparar. */
  healthy: boolean
}

export interface ReconcileOptions {
  /** Aplicar las reparaciones seguras (liberar leases huerfanos). */
  autoRepair?: boolean
  /** Reloj inyectable para tests deterministas. */
  clock?: () => number
  /** No escribir nada, solo reportar. */
  dryRun?: boolean
}

/** ¿Existe un artefacto de la card? */
async function artifactExists(cardDir: string, name: string): Promise<boolean> {
  try {
    await fs.access(path.join(cardDir, name))
    return true
  } catch {
    return false
  }
}

/**
 * Reconcilia la corrida.
 *
 * Devuelve el reporte. Con `autoRepair` aplica las reparaciones que no
 * requieren decision humana (liberar leases, liberar agentes que
 * empezaron la card de otro).
 */
export async function reconcile(
  office: Office,
  options: ReconcileOptions = {},
): Promise<RecoveryReport> {
  const autoRepair = options.autoRepair ?? true
  const dryRun = options.dryRun ?? false
  const clock = options.clock ?? Date.now
  const now = new Date(clock()).toISOString()

  const state = await office.loadState()
  const roster = await office.loadRoster(state.runId)
  const issues: RecoveryIssue[] = []

  const artifactsRoot = office.paths.artifactsDir
  const leasesDir = office.paths.leasesDir

  /* ── Cards vs artefactos ─────────────────────────────────────────────── */

  for (const cardId of state.order) {
    const card: Card | undefined = state.cards[cardId]
    if (!card) continue

    const cardDir = path.join(artifactsRoot, cardId)

    // Una card en review sin handoff: la entrega se perdio en el camino.
    if (card.state === "review") {
      const tieneHandoff = await artifactExists(cardDir, "handoff.md")
      const tieneEvidencia = await artifactExists(cardDir, "evidence.md")
      if (!tieneHandoff) {
        issues.push({
          kind: "review-without-artifacts",
          severity: "warning",
          cardId,
          detail:
            `La card esta en review pero no tiene handoff.md. ` +
            `Lo mas probable es que el agente escribiera el artefacto y muriera antes de entregar.`,
          repair: "Devolver la card a in_progress para que el agente la retome, o revisar el handoff a mano.",
          repaired: false,
        })
      } else if (!tieneEvidencia) {
        issues.push({
          kind: "review-without-evidence",
          severity: "warning",
          cardId,
          detail: `La card esta en review sin evidence.md: no hay evidencia de que se haya hecho el trabajo.`,
          repair: "Pedir la evidencia antes de correr los gates.",
          repaired: false,
        })
      }
    }

    // Una card cerrada sin gate: el invariante deberia haberlo impedido.
    if (card.state === "done") {
      const tieneGate = await artifactExists(cardDir, "gates.md")
      if (!tieneGate) {
        issues.push({
          kind: "done-without-gate",
          severity: "critical",
          cardId,
          detail:
            `La card esta en done pero no tiene gates.md. Se cerro sin gate: ` +
            `el invariante gate-required-before-done fue vulnerado (probablemente por un crash).`,
          repair: "Reabrir la card y correr los gates de verdad.",
          repaired: false,
        })
      }
    }

    // Una card en progreso sin dueño.
    if ((card.state === "in_progress" || card.state === "rework") && !card.owner) {
      issues.push({
        kind: "card-in-progress-without-owner",
        severity: "critical",
        cardId,
        detail: `La card esta en ${card.state} pero no tiene owner. Nadie la va a terminar.`,
        repair: "Liberar la card para que otro agente la reclame.",
        repaired: false,
      })
    }

    // Una dependencia que nunca se va a resolver.
    if (card.state === "blocked") {
      const pendientes = card.dependsOn.filter((d) => {
        const dep = state.cards[d]
        return dep && dep.state !== "done"
      })
      if (pendientes.length > 0) {
        issues.push({
          kind: "blocked-by-unresolvable-dependency",
          severity: "warning",
          cardId,
          detail: `La card esta bloqueada y depende de ${pendientes.join(", ")}, que no estan en done.`,
          repair: "Revisar la dependencia o replanificar.",
          repaired: false,
        })
      }
    }
  }

  /* ── Artefactos huerfanos ────────────────────────────────────────────── */

  let cardDirs: string[] = []
  try {
    cardDirs = (await fs.readdir(artifactsRoot, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    cardDirs = []
  }

  for (const dirName of cardDirs) {
    if (state.cards[dirName]) continue
    issues.push({
      kind: "orphaned-artifact",
      severity: "warning",
      cardId: dirName,
      detail: `Hay artefactos de una card que no existe en el estado (${dirName}).`,
      repair: "Se puede borrar el directorio: no lo va a usar nadie.",
      repaired: false,
    })
  }

  /* ── Leases vs estado ────────────────────────────────────────────────── */

  let leaseFiles: string[] = []
  try {
    leaseFiles = (await fs.readdir(leasesDir)).filter((f) => f.endsWith(".json"))
  } catch {
    leaseFiles = []
  }

  for (const file of leaseFiles) {
    const taskId = file.replace(/\.json$/, "")
    const card = state.cards[taskId]
    if (!card) {
      issues.push({
        kind: "stale-lease",
        severity: "warning",
        cardId: taskId,
        detail: `Hay un lease de una task que no existe en el estado.`,
        repair: "Liberar el lease.",
        repaired: false,
      })
      if (autoRepair && !dryRun) {
        await office.leases.release(taskId, "desconocido").catch(() => false)
        const last = issues[issues.length - 1]!
        last.repaired = true
      }
      continue
    }

    if (card.state === "done" || card.state === "review") {
      const holder = await office.leases.holder(taskId)
      if (holder) {
        issues.push({
          kind: "stale-lease",
          severity: "warning",
          cardId: taskId,
          agentId: holder,
          detail: `La card esta en ${card.state} pero ${holder} sigue con el lease tomado.`,
          repair: "Liberar el lease.",
          repaired: false,
        })
        if (autoRepair && !dryRun) {
          await office.leases.release(taskId, holder).catch(() => false)
          const last = issues[issues.length - 1]!
          last.repaired = true
        }
      }
    }

    if (!card.owner) {
      issues.push({
        kind: "lease-without-owner",
        severity: "warning",
        cardId: taskId,
        detail: `Hay un lease tomado de una card sin owner.`,
        repair: "Liberar el lease.",
        repaired: false,
      })
    }
  }

  /* ── Roster vs estado ────────────────────────────────────────────────── */

  for (const agent of Object.values(roster.agents)) {
    if (!agent.currentCard) continue
    const card = state.cards[agent.currentCard]
    if (!card) {
      issues.push({
        kind: "stale-lease",
        severity: "warning",
        agentId: agent.id,
        cardId: agent.currentCard,
        detail: `El agente apunta a una card que no existe.`,
        repair: "Liberar el agente.",
        repaired: false,
      })
      continue
    }
    if (card.state === "done" && agent.state === "working") {
      issues.push({
        kind: "agent-still-working-on-done-card",
        severity: "warning",
        agentId: agent.id,
        cardId: card.id,
        detail: `La card esta en done pero el agente sigue marcado como working.`,
        repair: "Liberar el agente a idle_available.",
        repaired: false,
      })
      if (autoRepair && !dryRun) {
        agent.state = "idle_available"
        agent.currentCard = null
        agent.canAccept = true
        agent.idleSince = now
        await office.saveRoster(roster)
        const last = issues[issues.length - 1]!
        last.repaired = true
      }
    }
  }

  // ── El owner de una card tiene que existir en el roster ──
  //
  // Si el roster se perdio (una limpieza, un borrado manual, un crash) y
  // el estado sigue diciendo que la card tiene owner, la card esta
  // "trabajando" con un agente que no existe: nadie la va a terminar y
  // nadie lo va a notar.
  for (const cardId of state.order) {
    const card = state.cards[cardId]
    if (!card?.owner) continue
    if (roster.agents[card.owner]) continue
    issues.push({
      kind: "card-in-progress-without-owner",
      severity: "critical",
      cardId,
      agentId: card.owner,
      detail:
        `La card declara a \`${card.owner}\` como owner, pero ese agente no esta en el roster. ` +
        `Nadie la va a terminar: el agente que la tenia dejo de existir.`,
      repair: "Liberar la card para que otro agente la reclame.",
      repaired: false,
    })
  }

  const criticas = issues.filter((i) => i.severity === "critical" && !i.repaired)
  const report: RecoveryReport = {
    runId: state.runId,
    checkedAt: now,
    issues,
    summary: renderRecoveryReport(issues),
    healthy: criticas.length === 0,
  }

  log.info("reconciliacion completa", {
    runId: state.runId,
    issues: issues.length,
    criticas: criticas.length,
    reparadas: issues.filter((i) => i.repaired).length,
  })

  return report
}

/** Renderiza el reporte como markdown. */
export function renderRecoveryReport(issues: RecoveryIssue[]): string {
  if (issues.length === 0) return "Todo consistente. Sin nada que reconciliar."

  const lines: string[] = []
  const criticas = issues.filter((i) => i.severity === "critical")
  const avisos = issues.filter((i) => i.severity === "warning")

  if (criticas.length > 0) {
    lines.push(`## Criticos (${criticas.length})`, "")
    for (const i of criticas) {
      lines.push(`- **${i.kind}**${i.cardId ? ` \`${i.cardId}\`` : ""}: ${i.detail}`)
      lines.push(`  - Repair: ${i.repair}${i.repaired ? " *(ya reparado)*" : ""}`)
    }
    lines.push("")
  }
  if (avisos.length > 0) {
    lines.push(`## Avisos (${avisos.length})`, "")
    for (const i of avisos) {
      lines.push(`- **${i.kind}**${i.cardId ? ` \`${i.cardId}\`` : ""}: ${i.detail}`)
      lines.push(`  - Repair: ${i.repair}${i.repaired ? " *(ya reparado)*" : ""}`)
    }
  }
  return lines.join("\n")
}

/**
 * El estado que una card deberia tener, dado lo que hay en disco.
 *
 * Se usa para el caso "el agente escribio y murio": si el handoff esta
 * escrito pero la card sigue en `in_progress`, la card puede pasar a
 * `review` sin que el agente tenga que volver a trabajar.
 */
export async function inferCardStateFromDisk(
  office: Office,
  cardId: string,
): Promise<"incomplete" | "deliverable" | "unknown"> {
  const cardDir = path.join(office.paths.artifactsDir, cardId)
  if (await artifactExists(cardDir, "handoff.md")) {
    if (await artifactExists(cardDir, "evidence.md")) return "deliverable"
    return "incomplete"
  }
  return "unknown"
}

/** Snapshot del estado para detectar cambios inesperados. */
export function stateFingerprint(state: OfficeState): string {
  const parts = state.order.map((id) => {
    const c = state.cards[id]
    if (!c) return `${id}:?`
    return `${id}:${c.state}:${c.owner ?? "-"}:${c.attempts}:${c.rejections}`
  })
  return parts.join("|")
}
