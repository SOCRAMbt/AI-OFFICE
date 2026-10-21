/**
 * Hook: inyección del estado de la oficina en el prompt del sistema.
 *
 * El agente no debería necesitar preguntar "cómo va la oficina". El estado
 * viaja con cada llamada: qué cards hay, cuál es la siguiente, qué está
 * bloqueado, qué dice el ledger de contexto.
 *
 * Sin esto, el modelo pierde la noción de "ya hice esto" y repite trabajo —
 * exactamente el síntoma que la oficina existe para eliminar.
 */

import type { Office } from "../core/office.js"
import { logger } from "../core/log.js"

const log = logger("oficina:system")

export function createSystemTransformHook(office: Office) {
  return async function onSystemTransform(
    _input: { sessionID?: string; model: unknown },
    output: { system: string[] },
  ): Promise<void> {
    try {
      const state = await office.loadState()
      if (!state.objective) return

      const cards = Object.values(state.cards)
      if (cards.length === 0) return

      const roster = await office.loadRoster(state.runId)
      const idle = Object.values(roster.agents).filter((a) => a.state === "idle_available")
      const working = Object.values(roster.agents).filter((a) => a.state === "working")

      const lines: string[] = [
        "",
        "## 🏢 OFICINA — estado de la corrida",
        "",
        `**Objetivo:** ${state.objective}`,
        `**Estado:** ${state.status} · iteración ${state.iteration} · presupuesto ${state.budget.cardsUsed}/${state.budget.maxCards} cards, ${state.budget.agentCallsUsed}/${state.budget.maxAgentCalls} agentes`,
        "",
        "### Cards",
        "",
        ...cards.map(
          (c) =>
            `- **${c.id}** [${c.state}] ${c.title} · owner=${c.owner ?? "—"} reviewer=${c.reviewer ?? "—"} · gate: ${c.gate}`,
        ),
        "",
        `**Trabajando:** ${working.map((a) => `${a.id}(${a.role})`).join(", ") || "—"}`,
        `**Libres:** ${idle.map((a) => `${a.id}(${a.role})`).join(", ") || "—"}`,
      ]

      if (state.context.decisions.length > 0) {
        lines.push("", "### Decisiones ya tomadas (no las repitas)", "")
        lines.push(...state.context.decisions.map((d) => `- ${d}`))
      }
      if (state.context.constraints.length > 0) {
        lines.push("", "### Constraints descubiertos", "")
        lines.push(...state.context.constraints.map((c) => `- ${c}`))
      }
      if (state.context.traps.length > 0) {
        lines.push("", "### Trampas (no toques esto)", "")
        lines.push(...state.context.traps.map((t) => `- ${t}`))
      }
      if (state.context.open.length > 0) {
        lines.push("", "### Temas abiertos", "")
        lines.push(...state.context.open.map((t) => `- ${t}`))
      }

      lines.push(
        "",
        "Usá `oficina_board` para el panorama, `oficina_assign` para tomar trabajo, `oficina_bus` para el bus.",
        "",
      )

      output.system.push(lines.join("\n"))
    } catch (err) {
      log.error("fallo inyectando el estado en el system prompt", { error: String(err) })
    }
  }
}
