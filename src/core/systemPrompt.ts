/**
 * El estado de la oficina, como texto para el prompt del sistema.
 *
 * ## Por qué vive acá y no en un hook
 *
 * La inyección del estado es **la misma** en OpenCode v1 y v2, pero los hooks
 * son distintos: v1 tiene `experimental.chat.system.transform` y v2 tiene
 * `ctx.session.hook("context")`. Si el texto viviera dentro del hook, cada
 * version tendria su copia y se desincronizarian.
 *
 * Asi que el texto se construye una vez, acá, y cada entry lo inyecta donde
 * su API lo permita.
 */

import type { Office } from "./office.js"
import type { OfficeState } from "./types.js"

/**
 * Construye el bloque de estado.
 *
 * Devuelve cadena vacia si no hay nada que decir: una corrida que no empezo
 * no necesita ensuciar el prompt del sistema.
 */
export async function buildSystemPrompt(office: Office, state: OfficeState): Promise<string> {
  if (!state.objective) return ""
  const cards = Object.values(state.cards)
  if (cards.length === 0) return ""

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

  return lines.join("\n")
}
