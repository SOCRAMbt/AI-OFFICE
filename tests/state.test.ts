import { describe, it, expect } from "vitest"
import {
  canTransition,
  transitionCard,
  assertInvariants,
  createRun,
  transitionRun,
  selectNextCard,
  isRunComplete,
  InvalidTransitionError,
  InvariantViolationError,
} from "../src/core/state.js"
import { DEFAULT_LIMITS, type Card, type OfficeState } from "../src/core/types.js"

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: "T-00",
    title: "Test",
    type: "implementation",
    state: "todo",
    owner: "e-a",
    reviewer: "e-b",
    requiredCapabilities: [],
    scope: { mayTouch: ["src/**"], forbidden: ["**/*.env"] },
    acceptance: ["a"],
    gate: "g",
    dependsOn: [],
    attempts: 0,
    rejections: 0,
    artifacts: ".oficina/artifacts/T-00",
    result: null,
    helpRequests: [],
    helpHops: 0,
    ...overrides,
  }
}

function makeState(cards: Card[]): OfficeState {
  const state = createRun("objetivo", "run-1", DEFAULT_LIMITS)
  for (const card of cards) {
    state.cards[card.id] = card
    state.order.push(card.id)
  }
  return state
}

describe("Transiciones de card", () => {
  it("permite el camino normal todo → in_progress → review → done", () => {
    expect(canTransition("todo", "in_progress")).toBe(true)
    expect(canTransition("in_progress", "review")).toBe(true)
    expect(canTransition("review", "done")).toBe(true)
  })

  it("rechaza una transición imposible", () => {
    expect(canTransition("todo", "done")).toBe(false)
    expect(canTransition("done", "in_progress")).toBe(false)
  })

  it("lanza al intentar una transición inválida", () => {
    const state = makeState([makeCard()])
    expect(() => transitionCard(state, "T-00", "done")).toThrow(InvalidTransitionError)
  })

  it("lanza si la card no existe", () => {
    const state = makeState([])
    expect(() => transitionCard(state, "T-99", "in_progress")).toThrow(InvariantViolationError)
  })

  it("done solo puede volver a rework", () => {
    expect(canTransition("done", "rework")).toBe(true)
    expect(canTransition("done", "in_progress")).toBe(false)
  })
})

describe("Invariantes duros", () => {
  it("rechaza DONE sin gates en PASS", () => {
    const state = makeState([makeCard({ state: "done" })])
    expect(() =>
      assertInvariants({ card: state.cards["T-00"], state, limits: DEFAULT_LIMITS, gatesPassed: false }),
    ).toThrow(InvariantViolationError)
  })

  it("acepta DONE con gates en PASS y evidencia completa", () => {
    const state = makeState([makeCard({ state: "done" })])
    expect(() =>
      assertInvariants({
        card: state.cards["T-00"],
        state,
        limits: DEFAULT_LIMITS,
        gatesPassed: true,
        evidenceComplete: true,
      }),
    ).not.toThrow()
  })

  it("rechaza DONE sin evidencia de requisitos (fail-closed)", () => {
    // `evidenceComplete` ausente significa "no se evaluo". No se puede
    // asumir que este bien: un invariante de cierre tiene que fallar
    // cuando no hay veredicto, no cuando hay veredicto negativo.
    const state = makeState([makeCard({ state: "done" })])
    expect(() =>
      assertInvariants({
        card: state.cards["T-00"],
        state,
        limits: DEFAULT_LIMITS,
        gatesPassed: true,
      }),
    ).toThrow(/evidence-required-before-done/)
  })

  it("rechaza DONE con evidencia incompleta", () => {
    const state = makeState([makeCard({ state: "done" })])
    expect(() =>
      assertInvariants({
        card: state.cards["T-00"],
        state,
        limits: DEFAULT_LIMITS,
        gatesPassed: true,
        evidenceComplete: false,
      }),
    ).toThrow(/evidence-required-before-done/)
  })

  it("rechaza que el revisor sea el owner", () => {
    const state = makeState([makeCard({ owner: "e-a", reviewer: "e-a" })])
    expect(() =>
      assertInvariants({ card: state.cards["T-00"], state, limits: DEFAULT_LIMITS }),
    ).toThrow(/reviewer-neq-owner/)
  })

  it("rechaza exceder el máximo de rechazos", () => {
    const state = makeState([makeCard({ rejections: 4 })])
    expect(() =>
      assertInvariants({ card: state.cards["T-00"], state, limits: DEFAULT_LIMITS }),
    ).toThrow(/max-review-rejections/)
  })

  it("rechaza exceder los saltos de la cadena de ayuda", () => {
    const state = makeState([makeCard({ helpHops: 3 })])
    expect(() =>
      assertInvariants({ card: state.cards["T-00"], state, limits: DEFAULT_LIMITS }),
    ).toThrow(/max-help-chain-hops/)
  })

  it("rechaza exceder el presupuesto de cards", () => {
    const state = makeState([])
    state.budget.cardsUsed = 21
    expect(() => assertInvariants({ state, limits: DEFAULT_LIMITS })).toThrow(/max-cards/)
  })

  it("rechaza exceder el presupuesto de invocaciones", () => {
    const state = makeState([])
    state.budget.agentCallsUsed = 41
    expect(() => assertInvariants({ state, limits: DEFAULT_LIMITS })).toThrow(/max-agent-calls/)
  })

  it("rechaza exceder el presupuesto de spawns", () => {
    const state = makeState([])
    state.budget.spawnsUsed = 21
    expect(() => assertInvariants({ state, limits: DEFAULT_LIMITS })).toThrow(/max-spawns-total/)
  })
})

describe("Selección de la próxima card", () => {
  it("elige la card con dependencias satisfechas", () => {
    const state = makeState([
      makeCard({ id: "T-00", state: "todo" }),
      makeCard({ id: "T-01", state: "todo", dependsOn: ["T-00"] }),
    ])
    const next = selectNextCard(state)
    expect(next.card?.id).toBe("T-00")
  })

  it("no elige una card bloqueada por dependencias", () => {
    const state = makeState([
      makeCard({ id: "T-00", state: "in_progress" }),
      makeCard({ id: "T-01", state: "todo", dependsOn: ["T-00"] }),
    ])
    const next = selectNextCard(state)
    expect(next.card?.id).toBe("T-00")
  })

  it("prioriza el rework sobre el trabajo nuevo", () => {
    const state = makeState([
      makeCard({ id: "T-00", state: "todo" }),
      makeCard({ id: "T-01", state: "rework" }),
    ])
    const next = selectNextCard(state)
    expect(next.card?.id).toBe("T-01")
  })

  it("devuelve null cuando no queda nada", () => {
    const state = makeState([makeCard({ state: "done" })])
    const next = selectNextCard(state)
    expect(next.card).toBeNull()
    expect(next.reason).toContain("no quedan")
  })

  it("reporta las cards bloqueadas", () => {
    const state = makeState([makeCard({ state: "blocked" })])
    const next = selectNextCard(state)
    expect(next.card).toBeNull()
    expect(next.reason).toContain("bloqueada")
  })
})

describe("Ciclo de la corrida", () => {
  it("arranca en planning y puede pasar a running", () => {
    const state = createRun("obj", "run-1", DEFAULT_LIMITS)
    expect(state.status).toBe("planning")
    transitionRun(state, "running")
    expect(state.status).toBe("running")
  })

  it("rechaza una transición de corrida inválida", () => {
    const state = createRun("obj", "run-1", DEFAULT_LIMITS)
    expect(() => transitionRun(state, "delivered")).toThrow(InvalidTransitionError)
  })

  it("detecta la corrida completa", () => {
    const state = makeState([makeCard({ state: "done" }), makeCard({ id: "T-01", state: "done" })])
    expect(isRunComplete(state)).toBe(true)
  })

  it("una card sin terminar no completa la corrida", () => {
    const state = makeState([makeCard({ state: "done" }), makeCard({ id: "T-01", state: "review" })])
    expect(isRunComplete(state)).toBe(false)
  })
})
