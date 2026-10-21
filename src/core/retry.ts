/**
 * Retry: la política de 3 golpes.
 *
 * Un rechazo de review no es un evento, es un estado. Un agente que "no
 * cumple" y se le deja reintentar sin límite produce un loop infinito que
 * quema presupuesto sin avanzar. Los contadores viven acá, en código.
 *
 *   rechazo 1 → REWORK   (mismo owner, con el feedback del review)
 *   rechazo 2 → REPLAN   (el Director rehace la card: puede cambiar owner,
 *                          scope o enfoque; si el owner ya falló dos veces,
 *                          se rota)
 *   rechazo 3 → ESCALATE (al usuario, con opciones concretas)
 */

import type { Card, Limits, OfficeState } from "./types.js"
import { nowIso } from "./fsx.js"

export type RetryAction = "rework" | "replan" | "escalate" | "approve"

export interface RetryDecision {
  action: RetryAction
  /** Qué tiene que pasar, en texto, para el siguiente intento. */
  instruction: string
  /** Si el owner debe cambiar. */
  rotateOwner: boolean
  reason: string
}

/** Calcula la próxima acción dado el estado de rechazo de una card. */
export function decideRetry(card: Card, limits: Limits = {} as Limits): RetryDecision {
  const max = limits.maxReviewRejections ?? 3
  const rejections = card.rejections

  if (rejections <= 0) {
    return { action: "approve", instruction: "", rotateOwner: false, reason: "sin rechazos previos" }
  }
  if (rejections < max) {
    const rotate = rejections >= 2
    return {
      action: rejections === 1 ? "rework" : "replan",
      instruction: rotate
        ? "Rehacé la card desde cero: revisá el scope, elegí un owner distinto y atacá el problema de otra forma. No repitas el intento anterior."
        : "Corregí exactamente lo que el review marcó. No reescribas lo que ya estaba bien.",
      rotateOwner: rotate,
      reason: `${rejections} de ${max} rechazos`,
    }
  }
  return {
    action: "escalate",
    instruction: "",
    rotateOwner: true,
    reason: `${rejections} rechazos agotaron el máximo de ${max}`,
  }
}

/** Registra un rechazo y devuelve la card actualizada. */
export function recordRejection(card: Card, reason: string): Card {
  card.rejections += 1
  card.attempts += 1
  card.result = `RECHAZADO (${card.rejections}): ${reason}`
  return card
}

/** Registra una aprobación. */
export function recordApproval(card: Card, note: string): Card {
  card.result = `APROBADO: ${note}`
  return card
}

/** Suma el presupuesto de llamadas a subagentes. */
export function consumeAgentCall(state: OfficeState, calls = 1): void {
  state.budget.agentCallsUsed += calls
  state.updatedAt = nowIso()
}

/** Suma el presupuesto de cards. */
export function consumeCard(state: OfficeState): void {
  state.budget.cardsUsed += 1
  state.updatedAt = nowIso()
}

/** Suma el presupuesto de spawns. */
export function consumeSpawn(state: OfficeState): void {
  state.budget.spawnsUsed += 1
  state.updatedAt = nowIso()
}

/** ¿Queda presupuesto? */
export function hasBudget(state: OfficeState, limits: Limits): { ok: boolean; reason: string } {
  if (state.budget.cardsUsed >= state.budget.maxCards) {
    return { ok: false, reason: `presupuesto de cards agotado (${state.budget.cardsUsed}/${state.budget.maxCards})` }
  }
  if (state.budget.agentCallsUsed >= state.budget.maxAgentCalls) {
    return {
      ok: false,
      reason: `presupuesto de invocaciones agotado (${state.budget.agentCallsUsed}/${state.budget.maxAgentCalls})`,
    }
  }
  if (state.budget.spawnsUsed >= state.budget.maxSpawnsTotal) {
    return {
      ok: false,
      reason: `presupuesto de spawns agotado (${state.budget.spawnsUsed}/${state.budget.maxSpawnsTotal})`,
    }
  }
  return { ok: true, reason: "presupuesto disponible" }
}
