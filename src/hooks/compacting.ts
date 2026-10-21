/**
 * Hook: el estado de la oficina sobrevive a la compactación.
 *
 * Cuando la sesión se compacta, el modelo pierde el contexto conversacional.
 * Sin este hook, la oficina se olvida de a mitad de camino: el agente deja de
 * saber qué hizo, repite trabajo y el ciclo se rompe.
 *
 * Con este hook, el resumen de compactación incluye el estado real de la
 * oficina — leído del disco, no del contexto que se está por perder.
 */

import type { Office } from "../core/office.js"
import { logger } from "../core/log.js"

const log = logger("oficina:compacting")

export function createCompactingHook(office: Office) {
  return async function onCompacting(
    input: { sessionID: string },
    output: { context: string[]; prompt?: string },
  ): Promise<void> {
    try {
      const state = await office.loadState()
      if (!state.objective) return

      const cards = Object.values(state.cards)
      const done = cards.filter((c) => c.state === "done")
      const pending = cards.filter((c) => c.state !== "done")
      const roster = await office.loadRoster(state.runId)

      const context = [
        "## 🏢 OFICINA — estado (leído del disco, sobrevivió a la compactación)",
        "",
        `**Objetivo:** ${state.objective}`,
        `**Estado de la corrida:** ${state.status}`,
        `**Progreso:** ${done.length}/${cards.length} cards DONE`,
        "",
        "### Cards terminadas",
        ...(done.length > 0
          ? done.map((c) => `- ${c.id}: ${c.title} — ${c.result ?? "completada"}`)
          : ["(ninguna)"]),
        "",
        "### Cards pendientes",
        ...(pending.length > 0
          ? pending.map(
              (c) =>
                `- ${c.id} [${c.state}] ${c.title} · owner=${c.owner ?? "—"} · gate: ${c.gate} · intentos=${c.attempts} · rechazos=${c.rejections}`,
            )
          : ["(ninguna)"]),
        "",
        `**Agentes en el roster:** ${Object.values(roster.agents)
          .map((a) => `${a.id}(${a.role}:${a.state})`)
          .join(", ") || "—"}`,
        "",
        "### Contexto acumulado",
        ...(state.context.decisions.length > 0
          ? ["", "**Decisiones:**", ...state.context.decisions.map((d) => `- ${d}`)]
          : []),
        ...(state.context.constraints.length > 0
          ? ["", "**Constraints:**", ...state.context.constraints.map((c) => `- ${c}`)]
          : []),
        ...(state.context.pieces.length > 0
          ? ["", "**Piezas construidas:**", ...state.context.pieces.map((p) => `- ${p}`)]
          : []),
        ...(state.context.traps.length > 0
          ? ["", "**Trampas:**", ...state.context.traps.map((t) => `- ${t}`)]
          : []),
        "",
        "Continuá desde donde quedó. No repitas trabajo ya hecho: leé `.oficina/artifacts/`.",
      ].join("\n")

      output.context.push(context)
      log.info("estado inyectado en la compactación", {
        sessionID: input.sessionID,
        done: done.length,
        pending: pending.length,
      })
    } catch (err) {
      log.error("fallo inyectando el estado en la compactación", { error: String(err) })
    }
  }
}
