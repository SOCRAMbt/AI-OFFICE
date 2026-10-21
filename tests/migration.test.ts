import { describe, it, expect } from "vitest"
import { migrateState } from "../src/core/state.js"
import { DEFAULT_LIMITS } from "../src/core/types.js"

describe("Migración v1 → v2", () => {
  const v1 = {
    objective: "Correr el bug de conteo",
    created: "2026-10-21T12:00:00.000Z",
    updated: "2026-10-21T13:00:00.000Z",
    status: "delivered",
    iteration: 3,
    current_card: "T-04",
    budget: {
      max_cards: 20,
      cards_used: 5,
      max_agent_calls: 40,
      agent_calls_used: 22,
    },
    cards: {
      "T-00": {
        id: "T-00",
        title: "Explorar",
        type: "exploration",
        state: "done",
        owner: "code-explorer",
        reviewer: "code-architect",
        scope: ["src/**", "test/**"],
        acceptance: ["mapa con file:line"],
        gate: "handoff existe",
        depends_on: [],
        attempts: 1,
        rejections: [],
        artifacts: ".oficina/artifacts/T-00",
        result: "APROBADO",
      },
      "T-01": {
        id: "T-01",
        title: "Reparar",
        type: "implementation",
        state: "review",
        owner: "general",
        reviewer: "code-reviewer",
        scope: { mayTouch: ["src/x.ts"], forbidden: ["**/*.env"] },
        acceptance: ["a", "b"],
        gate: "npm test",
        depends_on: ["T-00"],
        attempts: 2,
        rejections: 1,
        result: null,
      },
    },
    escalations: [],
    checkpoints: [],
  }

  it("migra el objetivo y el estado de la corrida", () => {
    const state = migrateState(v1)!
    expect(state.objective).toBe("Correr el bug de conteo")
    expect(state.status).toBe("delivered")
    expect(state.iteration).toBe(3)
    expect(state.version).toBe(2)
  })

  it("migra el budget de snake_case a camelCase", () => {
    const state = migrateState(v1)!
    expect(state.budget.cardsUsed).toBe(5)
    expect(state.budget.maxCards).toBe(20)
    expect(state.budget.agentCallsUsed).toBe(22)
    expect(state.budget.maxAgentCalls).toBe(40)
    expect(state.budget.spawnsUsed).toBe(0)
    expect(state.budget.maxSpawnsTotal).toBe(DEFAULT_LIMITS.maxSpawnsTotal)
  })

  it("migra el scope array al objeto con may_touch/forbidden", () => {
    const state = migrateState(v1)!
    const card = state.cards["T-00"]!
    expect(card.scope.mayTouch).toEqual(["src/**", "test/**"])
    expect(card.scope.forbidden).toContain("**/*.env")
  })

  it("migra rejections como array a contador", () => {
    const state = migrateState(v1)!
    expect(state.cards["T-00"]!.rejections).toBe(0)
    expect(state.cards["T-01"]!.rejections).toBe(1)
  })

  it("migra depends_on a dependsOn", () => {
    const state = migrateState(v1)!
    expect(state.cards["T-01"]!.dependsOn).toEqual(["T-00"])
  })

  it("conserva los resultados y las cards", () => {
    const state = migrateState(v1)!
    expect(state.cards["T-00"]!.result).toBe("APROBADO")
    expect(state.cards["T-00"]!.state).toBe("done")
    expect(state.cards["T-01"]!.state).toBe("review")
    expect(state.order).toEqual(["T-00", "T-01"])
  })

  it("deja un estado v2 intacto", () => {
    const v2 = migrateState(v1)!
    const again = migrateState(v2)!
    expect(again).toBe(v2)
  })

  it("devuelve undefined para basura", () => {
    expect(migrateState(null)).toBeUndefined()
    expect(migrateState("nope")).toBeUndefined()
    expect(migrateState(42)).toBeUndefined()
  })
})
