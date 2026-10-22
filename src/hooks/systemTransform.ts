/**
 * Hook: inyección del estado de la oficina en el prompt del sistema (v1).
 *
 * El agente no debería necesitar preguntar "cómo va la oficina". El estado
 * viaja con cada llamada: qué cards hay, cuál es la siguiente, qué está
 * bloqueado, qué dice el ledger de contexto.
 *
 * Sin esto, el modelo pierde la noción de "ya hice esto" y repite trabajo —
 * exactamente el síntoma que la oficina existe para eliminar.
 *
 * **Este es el hook de OpenCode v1.** En v2 la misma inyección se hace con
 * `ctx.session.hook("context")`. El texto se construye en
 * `core/systemPrompt.ts`, que es el unico lugar donde vive.
 */

import type { Office } from "../core/office.js"
import { buildSystemPrompt } from "../core/systemPrompt.js"
import { logger } from "../core/log.js"

const log = logger("oficina:system")

export function createSystemTransformHook(office: Office) {
  return async function onSystemTransform(
    _input: { sessionID?: string; model: unknown },
    output: { system: string[] },
  ): Promise<void> {
    try {
      const state = await office.loadState()
      const texto = await buildSystemPrompt(office, state)
      if (!texto) return
      output.system.push(texto)
    } catch (err) {
      log.error("fallo inyectando el estado en el system prompt", { error: String(err) })
    }
  }
}
