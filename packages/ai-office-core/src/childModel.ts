/**
 * childModel: el modelo que cada agente hijo de la oficina debe usar.
 *
 * ## Por qué
 *
 * El plugin spawneba hijos con `agent: "general"` y SIN modelo. El host
 * resolvía por defecto hacia el primer provider/modelo disponible que
 * encontraba (p. ej. Google AI Studio por env vars), ajenos al elegido por
 * el usuario para esa sesión. Marcos: «elijo inkling 2 small, /oficina —
 * espero que mis agentes corran con ese mismo modelo».
 *
 * Este módulo extrae el modelo de la sesión padre (session.get) y lo
 * valida con la forma exacta que SessionCreateInput.model acepta.
 */
export interface ChildModel {
  readonly id: string
  readonly providerID: string
  readonly variant?: string
}

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0

/**
 * Extrae el modelo de una respuesta controlada de ctx.session.get().
 * Devuelve undefined si el padre no reporta un modelo usable —
 * en ese caso el host seguirá con su default histórico.
 */
export function childModelFrom(info: unknown): ChildModel | undefined {
  if (!info || typeof info !== "object") return undefined
  const m = (info as Record<string, unknown>)["model"]
  if (!m || typeof m !== "object") return undefined
  const id = (m as Record<string, unknown>)["id"]
  const providerID = (m as Record<string, unknown>)["providerID"]
  const variant = (m as Record<string, unknown>)["variant"]
  if (!isNonEmptyString(id) || !isNonEmptyString(providerID)) return undefined
  return isNonEmptyString(variant) ? { id, providerID, variant } : { id, providerID }
}
