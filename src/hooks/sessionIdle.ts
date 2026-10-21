/**
 * Hook: auto-reanudación al quedar idle.
 *
 * ESTE es el hook que convierte "la oficina trabaja" en algo real.
 *
 * El síntoma que lo motiva: un modelo rápido dice "listo, terminé" y para.
 * Con un skill, la oficina depende de que el modelo *quiera* seguir. Con este
 * hook, cuando la sesión queda idle y queda trabajo pendiente, el motor le
 * manda un prompt sintético y la oficina sigue. El modelo no puede decidir
 * que ya terminó: el estado lo dice, no la confianza.
 *
 * Las guardas evitan el loop infinito:
 * - Solo reanuda si queda trabajo real (cards sin DONE).
 * - Tope de auto-reanudaciones por sesión.
 * - Cooldown entre reanudaciones.
 * - Nunca reanuda si la corrida está pausada, bloqueada o entregada.
 */

import type { Office } from "../core/office.js"
import { logger } from "../core/log.js"

const log = logger("oficina:session-idle")

export interface SessionIdleOptions {
  /** Tope de auto-reanudaciones por sesión. */
  maxAutoResumes?: number
  /** Cooldown mínimo entre reanudaciones, en ms. */
  cooldownMs?: number
  /** Cliente del SDK para mandar el prompt sintético. */
  sendPrompt: (sessionID: string, text: string) => Promise<void>
}

export function createSessionIdleHook(office: Office, options: SessionIdleOptions) {
  const maxAutoResumes = options.maxAutoResumes ?? 25
  const cooldownMs = options.cooldownMs ?? 1_500
  const lastResume = new Map<string, number>()

  return async function onSessionIdle(input: { event: { type: string; properties?: Record<string, unknown> } }): Promise<void> {
    const event = input.event
    if (event.type !== "session.idle") return

    const sessionID = (event.properties as { sessionID?: string } | undefined)?.sessionID
    if (!sessionID) return

    try {
      const state = await office.loadState()

      // La oficina tiene que estar corriendo. Una corrida pausada, bloqueada
      // o entregada no se reanuda: eso es una decisión del usuario.
      if (state.status !== "running") return

      // ¿Queda trabajo? Si todo está DONE, no hay nada que reanudar.
      const cards = Object.values(state.cards)
      if (cards.length === 0) return
      const pending = cards.filter((c) => c.state !== "done")
      if (pending.length === 0) return

      // Tope de auto-reanudaciones.
      const binding = state.sessions[sessionID]
      const resumes = binding?.autoResumes ?? 0
      if (resumes >= maxAutoResumes) {
        log.warn("tope de auto-reanudaciones alcanzado", { sessionID, resumes })
        return
      }

      // Cooldown.
      const last = lastResume.get(sessionID)
      if (last !== undefined && Date.now() - last < cooldownMs) return
      lastResume.set(sessionID, Date.now())

      const next = pending
        .map((c) => ({
          card: c,
          ready: c.dependsOn.every((d) => state.cards[d]?.state === "done"),
        }))
        .filter((c) => c.ready || c.card.state === "in_progress" || c.card.state === "rework")

      const current = next[0]?.card
      const roster = await office.loadRoster(state.runId)
      const working = Object.values(roster.agents).filter((a) => a.state === "working")

      const prompt = [
        "[OFICINA — auto-continuación]",
        "",
        `La corrida sigue abierta. Quedan ${pending.length} card(s) sin terminar.`,
        "",
        current
          ? `**Próxima: ${current.id} — ${current.title}** (${current.state})\n` +
            `Owner: ${current.owner ?? "(sin owner)"}\n` +
            `Gate: ${current.gate}\n` +
            `Acceptance:\n${current.acceptance.map((a) => `- ${a}`).join("\n")}`
          : "La próxima card depende de otra. Revisá el board y pedí lo que falte por el bus.",
        "",
        `Agentes trabajando: ${working.map((a) => `${a.id}(${a.role})`).join(", ") || "—"}`,
        "",
        "Usá `oficina_board` para ver el panorama, `oficina_assign` para tomar trabajo, " +
        "y `oficina_bus` (action=receive) para leer lo que te llegó por el bus.",
        "",
        "No declares la corrida terminada mientras queden cards sin DONE. Si estás trabado, escalá con `oficina_escalate`.",
      ].join("\n")

      state.sessions[sessionID] = {
        agentId: binding?.agentId ?? "primary",
        cardId: binding?.cardId ?? null,
        updatedAt: new Date().toISOString(),
        autoResumes: resumes + 1,
      }
      await office.saveState(state)

      log.info("auto-reanudando sesión", { sessionID, pending: pending.length, resumes: resumes + 1 })
      await options.sendPrompt(sessionID, prompt)
    } catch (err) {
      // Un fallo en el hook no debe tumbar la sesión. Se loguea y se sigue.
      log.error("fallo en el hook de auto-continuación", { sessionID, error: String(err) })
    }
  }
}
