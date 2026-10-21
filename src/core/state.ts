/**
 * Máquina de estados de la oficina.
 *
 * Regla de diseño (de `workflow-engine-design`): los estados y las transiciones
 * válidas se nombran ANTES de escribir código, y el estado se persiste
 * durablemente ANTES de ejecutar efectos. Acá está la tabla de transiciones y
 * los invariantes que el código —no el prompt— garantiza.
 */

import type { Card, CardState, OfficeState, RunStatus } from "./types.js"
import { DEFAULT_LIMITS, type Limits } from "./types.js"
import { nowIso } from "./fsx.js"

/** Transiciones válidas de card. Todo lo demás es un bug del motor. */
export const CARD_TRANSITIONS: Record<CardState, readonly CardState[]> = {
  todo: ["in_progress", "blocked", "escalated"],
  in_progress: ["review", "rework", "blocked", "escalated"],
  review: ["done", "rework", "blocked", "escalated"],
  // Desde rework se puede volver a trabajo o re-entregar directamente a
  // revisión: si el owner corrigió y volvió a entregar, la card vuelve al
  // ciclo sin pasar obrigatoriamente por in_progress.
  rework: ["in_progress", "review", "blocked", "escalated"],
  done: ["rework"],
  blocked: ["todo", "in_progress", "escalated"],
  escalated: ["todo", "in_progress", "rework"],
}

/** Estados terminales de una card. */
export const TERMINAL_CARD_STATES: readonly CardState[] = ["done"]

/** Estados que bloquean el avance del plan. */
export const BLOCKING_CARD_STATES: readonly CardState[] = ["blocked", "escalated"]

export class InvalidTransitionError extends Error {
  constructor(
    readonly cardId: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`Transición inválida para ${cardId}: ${from} → ${to}`)
    this.name = "InvalidTransitionError"
  }
}

export class InvariantViolationError extends Error {
  constructor(
    readonly invariant: string,
    readonly detail: string,
  ) {
    super(`Invariante violado [${invariant}]: ${detail}`)
    this.name = "InvariantViolationError"
  }
}

/** ¿La transición está permitida? */
export function canTransition(from: CardState, to: CardState): boolean {
  return CARD_TRANSITIONS[from].includes(to)
}

/**
 * Aplica una transición, validando la tabla.
 *
 * Mutar el estado en un solo lugar evita que dos rutas distintas construyan
 * estados imposibles.
 */
export function transitionCard(
  state: OfficeState,
  cardId: string,
  to: CardState,
  patch: Partial<Card> = {},
): Card {
  const card = state.cards[cardId]
  if (!card) throw new InvariantViolationError("card-exists", `No existe la card ${cardId}`)
  if (!canTransition(card.state, to)) {
    throw new InvalidTransitionError(cardId, card.state, to)
  }
  const next: Card = { ...card, ...patch, state: to }
  state.cards[cardId] = next
  state.updatedAt = nowIso()
  return next
}

// ─────────────────────────────────────────────────────────────────────────────
// Invariantes
// ─────────────────────────────────────────────────────────────────────────────

export interface InvariantContext {
  card?: Card
  state: OfficeState
  limits: Limits
  /** Veredicto de los gates de la card, si se corrieron. */
  gatesPassed?: boolean
}

/**
 * Verifica los invariantes duros.
 *
 * Estos no son sugerencias. Si un flujo de código intenta violarlos, el
 * sistema se niega a avanzar. Es la diferencia entre "el modelo se porto bien"
 * y "el modelo no puede romperlo".
 */
export function assertInvariants(ctx: InvariantContext): void {
  const { card, state, limits, gatesPassed } = ctx

  if (card) {
    // Invariante duro: el revisor nunca es el owner.
    if (limits.reviewerNeqOwner && card.owner && card.reviewer && card.owner === card.reviewer) {
      throw new InvariantViolationError(
        "reviewer-neq-owner",
        `${card.id}: owner y reviewer son el mismo agente (${card.owner})`,
      )
    }

    // Invariante duro: sin gates en PASS no hay DONE.
    if (limits.gateRequiredBeforeDone && card.state === "done") {
      if (gatesPassed !== true) {
        throw new InvariantViolationError(
          "gate-required-before-done",
          `${card.id}: marcada DONE sin gates en PASS`,
        )
      }
    }

    // Invariante duro: una card no puede reventar el presupuesto de reviews.
    if (card.rejections > limits.maxReviewRejections) {
      throw new InvariantViolationError(
        "max-review-rejections",
        `${card.id}: ${card.rejections} rechazos exceden el máximo ${limits.maxReviewRejections}`,
      )
    }

    // Invariante duro: la cadena de ayuda no excede los saltos permitidos.
    if (card.helpHops > limits.maxHelpChainHops) {
      throw new InvariantViolationError(
        "max-help-chain-hops",
        `${card.id}: cadena de ayuda de ${card.helpHops} saltos excede el máximo ${limits.maxHelpChainHops}`,
      )
    }
  }

  // Invariante duro: el presupuesto de cards no se excede.
  if (state.budget.cardsUsed > state.budget.maxCards) {
    throw new InvariantViolationError(
      "max-cards",
      `Presupuesto de cards excedido: ${state.budget.cardsUsed} > ${state.budget.maxCards}`,
    )
  }

  // Invariante duro: el presupuesto de invocaciones no se excede.
  if (state.budget.agentCallsUsed > state.budget.maxAgentCalls) {
    throw new InvariantViolationError(
      "max-agent-calls",
      `Presupuesto de agentes excedido: ${state.budget.agentCallsUsed} > ${state.budget.maxAgentCalls}`,
    )
  }

  // Invariante duro: el presupuesto de spawns no se excede.
  if (state.budget.spawnsUsed > state.budget.maxSpawnsTotal) {
    throw new InvariantViolationError(
      "max-spawns-total",
      `Presupuesto de spawns excedido: ${state.budget.spawnsUsed} > ${state.budget.maxSpawnsTotal}`,
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ciclo de vida de la corrida
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Migra un estado v1 (el que escribía el skill de OFICINA v1) al schema v2.
 *
 * Sin esto, una corrida empezada con el skill queda ilegible para el
 * plugin: los budgets vienen con nombres distintos, el `scope` era un array
 * en vez de un objeto, y las cards no tienen los campos de malla.
 *
 * La migración es aditiva y no destructiva: el objetivo, las cards y sus
 * resultados se conservan. Lo que se completa son los campos nuevos con
 * valores por defecto seguros.
 */
export function migrateState(raw: unknown, limits: Limits = DEFAULT_LIMITS): OfficeState | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const input = raw as Record<string, unknown>

  // Ya es v2: tiene `budget.maxCards`.
  const budgetRaw = (input.budget ?? {}) as Record<string, unknown>
  if (typeof budgetRaw.maxCards === "number") {
    return raw as OfficeState
  }

  const num = (value: unknown, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback

  const cards: Record<string, Card> = {}
  const rawCards = (input.cards ?? {}) as Record<string, Record<string, unknown>>

  for (const [id, rawCard] of Object.entries(rawCards)) {
    const scopeRaw = rawCard.scope
    const scope = Array.isArray(scopeRaw)
      ? { mayTouch: scopeRaw as string[], forbidden: ["**/*.env", "**/*.env.*"] }
      : {
          mayTouch: ((scopeRaw as { mayTouch?: string[] })?.mayTouch ?? ["**"]) as string[],
          forbidden: ((scopeRaw as { forbidden?: string[] })?.forbidden ?? ["**/*.env"]) as string[],
        }

    const rejectionsRaw = rawCard.rejections
    const rejections = Array.isArray(rejectionsRaw) ? rejectionsRaw.length : num(rejectionsRaw, 0)

    cards[id] = {
      id: (rawCard.id as string) ?? id,
      title: (rawCard.title as string) ?? id,
      type: (rawCard.type as Card["type"]) ?? "implementation",
      state: ((rawCard.state as CardState) ?? "todo") as CardState,
      owner: (rawCard.owner as string | null) ?? null,
      reviewer: (rawCard.reviewer as string | null) ?? null,
      requiredCapabilities: (rawCard.requiredCapabilities as string[]) ?? [],
      scope,
      acceptance: (rawCard.acceptance as string[]) ?? [],
      gate: (rawCard.gate as string) ?? "",
      dependsOn: (rawCard.dependsOn as string[]) ?? ((rawCard.depends_on as string[]) ?? []),
      attempts: num(rawCard.attempts, 0),
      rejections,
      artifacts: (rawCard.artifacts as string) ?? `.oficina/artifacts/${id}`,
      result: (rawCard.result as string | null) ?? null,
      helpRequests: (rawCard.helpRequests as string[]) ?? [],
      helpHops: num(rawCard.helpHops, 0),
    }
  }

  const order = (input.order as string[]) ?? Object.keys(cards)

  return {
    version: 2,
    runId: (input.runId as string) ?? `run-${num(input.created, Date.now())}`,
    objective: (input.objective as string) ?? "",
    createdAt: (input.createdAt as string) ?? (input.created as string) ?? new Date().toISOString(),
    updatedAt: (input.updatedAt as string) ?? (input.updated as string) ?? new Date().toISOString(),
    status: ((input.status as RunStatus) ?? "planning") as RunStatus,
    cards,
    order,
    budget: {
      cardsUsed: num(budgetRaw.cardsUsed ?? budgetRaw.cards_used, Object.keys(cards).length),
      maxCards: num(budgetRaw.maxCards ?? budgetRaw.max_cards, limits.maxCards),
      agentCallsUsed: num(budgetRaw.agentCallsUsed ?? budgetRaw.agent_calls_used, 0),
      maxAgentCalls: num(budgetRaw.maxAgentCalls ?? budgetRaw.max_agent_calls, limits.maxAgentCalls),
      spawnsUsed: num(budgetRaw.spawnsUsed ?? budgetRaw.spawns_used, 0),
      maxSpawnsTotal: num(budgetRaw.maxSpawnsTotal ?? budgetRaw.max_spawns_total, limits.maxSpawnsTotal),
    },
    decisions: (input.decisions as OfficeState["decisions"]) ?? [],
    escalations: [],
    context: {
      decisions: [],
      constraints: [],
      pieces: [],
      traps: [],
      open: [],
    },
    iteration: num(input.iteration, 0),
    pendingGates: [],
    sessions: {},
  }
}

/** Crea una corrida nueva. */
export function createRun(objective: string, runId: string, limits: Limits = DEFAULT_LIMITS): OfficeState {
  const ts = nowIso()
  return {
    version: 2,
    runId,
    objective,
    createdAt: ts,
    updatedAt: ts,
    status: "planning",
    cards: {},
    order: [],
    budget: {
      cardsUsed: 0,
      maxCards: limits.maxCards,
      agentCallsUsed: 0,
      maxAgentCalls: limits.maxAgentCalls,
      spawnsUsed: 0,
      maxSpawnsTotal: limits.maxSpawnsTotal,
    },
    decisions: [],
    escalations: [],
    context: { decisions: [], constraints: [], pieces: [], traps: [], open: [] },
    iteration: 0,
    pendingGates: [],
    sessions: {},
  }
}

/** Transiciones de la corrida. */
export const RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  planning: ["running", "abandoned"],
  running: ["paused", "delivered", "blocked", "escalated", "abandoned"],
  paused: ["running", "abandoned"],
  delivered: ["running"],
  blocked: ["running", "escalated", "abandoned"],
  escalated: ["running", "abandoned"],
  abandoned: [],
}

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return RUN_TRANSITIONS[from].includes(to)
}

export function transitionRun(state: OfficeState, to: RunStatus): void {
  if (!canTransitionRun(state.status, to)) {
    throw new InvalidTransitionError("run", state.status, to)
  }
  state.status = to
  state.updatedAt = nowIso()
}

// ─────────────────────────────────────────────────────────────────────────────
// Selección de la próxima card
// ─────────────────────────────────────────────────────────────────────────────

export interface NextCardResult {
  card: Card | null
  reason: string
}

/**
 * Elige la próxima card a trabajar.
 *
 * Orden de prioridad:
 * 1. Rework (trabajo ya empezado, hay que terminarlo).
 * 2. Cards `todo` cuyas dependencias estén todas `done`.
 * 3. Cards `in_progress` (retomar).
 *
 * Empates se rompen por posición en `order`, que el planificador define.
 */
export function selectNextCard(state: OfficeState): NextCardResult {
  const byOrder = (a: Card, b: Card) => state.order.indexOf(a.id) - state.order.indexOf(b.id)

  const ordered = state.order
    .map((id) => state.cards[id])
    .filter((c): c is Card => !!c)

  // 1. Trabajo ya empezado: terminarlo antes de abrir algo nuevo. Una card
  //    en rework tiene contexto, evidencia parcial y un owner esperando: es
  //    la que más rinde continuar.
  const inFlight = ordered
    .filter((c) => c.state === "in_progress" || c.state === "rework")
    .sort(byOrder)

  if (inFlight.length > 0) {
    const card = inFlight[0]!
    return { card, reason: "retomando card en curso" }
  }

  // 2. Cards nuevas cuyas dependencias estén satisfechas.
  const ready = ordered
    .filter((c) => c.state === "todo")
    .filter((c) => c.dependsOn.every((dep) => state.cards[dep]?.state === "done"))
    .sort(byOrder)

  if (ready.length > 0) {
    const card = ready[0]!
    return { card, reason: "card lista (dependencias satisfechas)" }
  }

  const blocked = ordered.filter((c) => c.state === "blocked" || c.state === "escalated")

  if (blocked.length > 0) {
    return { card: null, reason: `bloqueada: ${blocked.map((c) => c.id).join(", ")}` }
  }

  const pending = ordered.filter((c) => c.state === "review")

  if (pending.length > 0) {
    return { card: null, reason: `esperando gates de: ${pending.map((c) => c.id).join(", ")}` }
  }

  return { card: null, reason: "no quedan cards pendientes" }
}

/** ¿La corrida terminó? Todas las cards en done. */
export function isRunComplete(state: OfficeState): boolean {
  const cards = Object.values(state.cards)
  return cards.length > 0 && cards.every((c) => c.state === "done")
}

/** Cards bloqueadas o escaladas. */
export function blockingCards(state: OfficeState): Card[] {
  return Object.values(state.cards).filter((c) => BLOCKING_CARD_STATES.includes(c.state))
}
