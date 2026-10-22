/**
 * Hook: auto-reanudación al quedar idle.
 *
 * ESTE es el hook que convierte "la oficina trabaja" en algo real.
 *
 * El síntoma que lo motiva: un modelo rápido dice "listo, terminado" y para.
 * Con un skill, la oficina depende de que el modelo *quiera* seguir. Con este
 * hook, cuando la sesión queda `idle` y queda trabajo, el motor manda un
 * prompt sintético y la corrida sigue. El modelo no puede declarar que
 * terminó: el estado lo dice.
 *
 * ## La mesa entra en el prompt
 *
 * El hook no solo reanuda: también inyecta la **foto de la mesa**. Así el
 * agente que arranca sabe de entrada: quién está trabajando, qué hay libre,
 * qué pedidos de ayuda siguen sin responder y qué preguntas están abiertas.
 *
 * Sin esto, el peer mesh es un bus al que nadie mira.
 */

import type { Office } from "../core/office.js"
import { snapshotMesa, renderMesaBrief } from "../core/mesa.js"
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

  return async function onSessionIdle(input: {
    event: { type: string; properties?: Record<string, unknown> }
  }): Promise<void> {
    const event = input.event
    if (event.type !== "session.idle") return

    const sessionID = (event.properties as { sessionID?: string } | undefined)?.sessionID
    if (!sessionID) return

    try {
      const state = await office.loadState()

      // La oficina tiene que estar corriendo. Una corrida pausada, bloqueada
      // o entregada no se reanuda: eso es decisión del usuario.
      if (state.status !== "running") return

      const cards = Object.values(state.cards)
      if (cards.length === 0) return

      const pending = cards.filter((c) => c.state !== "done")
      const mesa = await snapshotMesa(office)
      const mesaBrief = renderMesaBrief(mesa)

      // ¿Hay algo que hacer? Trabajo pendiente, ayuda sin responder, preguntas
      // abiertas, o cards sin owner.
      const hayTrabajo =
        pending.length > 0 ||
        mesa.ayudaAbierta.length > 0 ||
        mesa.preguntasAbiertas.length > 0 ||
        mesa.sinOwner.length > 0

      if (!hayTrabajo) return

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
      const working = mesa.trabajando

      const sections: string[] = [
        "[OFICINA — auto-continuación]",
        "",
        `La corrida sigue abierta. Quedan ${pending.length} card(s) sin terminar.`,
      ]

      if (current) {
        sections.push(
          "",
          `**Próxima: ${current.id} — ${current.title}** (${current.state})`,
          `Owner: ${current.owner ?? "(sin owner)"}`,
          `Gate: ${current.gate}`,
          "Criterios de aceptación:",
          ...current.acceptance.map((a) => `- ${a}`),
        )
      }

      if (working.length > 0) {
        sections.push(
          "",
          `**Agentes trabajando ahora:** ${working.map((p) => `${p.displayName} → ${p.card ?? "—"}`).join(", ")}`,
        )
      }

      if (mesaBrief) {
        sections.push("", "---", "", "**La mesa:**", "", mesaBrief)
      }

      sections.push(
        "",
        "Usá `oficina_board` para el panorama, `oficina_assign` para tomar trabajo, `oficina_bus` (action=read) para leer el bus,",
        "y `oficina_mesa` (action=view) para ver la mesa.",
        "",
        "No declares la corrida terminada mientras queden cards sin DONE. Si estás trabado, pedí ayuda por el bus o escalá.",
      )

      state.sessions[sessionID] = {
        agentId: binding?.agentId ?? "primary",
        cardId: binding?.cardId ?? null,
        updatedAt: new Date().toISOString(),
        autoResumes: resumes + 1,
      }
      await office.saveState(state)

      log.info("auto-reanudando sesión", {
        sessionID,
        pending: pending.length,
        helpOpen: mesa.ayudaAbierta.length,
        resumes: resumes + 1,
      })
      await options.sendPrompt(sessionID, sections.join("\n"))
    } catch (err) {
      // Un fallo en el hook no debe tumbar la sesión. Se loguea y se sigue.
      log.error("fallo en el hook de auto-continuación", { sessionID, error: String(err) })
    }
  }
}
