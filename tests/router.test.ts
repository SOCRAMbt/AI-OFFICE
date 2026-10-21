import { describe, it, expect } from "vitest"
import { routeCard, routeHelp, ownerStreak, ROLE_BY_CARD_TYPE } from "../src/core/router.js"
import { decideRetry, recordRejection, hasBudget, consumeAgentCall } from "../src/core/retry.js"
import { DEFAULT_LIMITS, type Card, type OfficeState, type Roster, type RosterEntry } from "../src/core/types.js"

function entry(overrides: Partial<RosterEntry> = {}): RosterEntry {
  return {
    id: "e-a",
    role: "developer",
    displayName: "Dev",
    state: "deployed",
    capabilities: ["react", "css"],
    fichaPath: "",
    currentCard: null,
    lease: null,
    idleSince: null,
    canAccept: true,
    helpGiven: 0,
    helpReceived: 0,
    helpedPeers: [],
    lastHeartbeat: new Date().toISOString(),
    source: { kind: "factory" },
    ...overrides,
  }
}

function roster(entries: RosterEntry[]): Roster {
  const agents: Record<string, RosterEntry> = {}
  for (const e of entries) agents[e.id] = e
  return { version: 2, runId: "r", agents, updatedAt: new Date().toISOString() }
}

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: "T-00",
    title: "Test",
    type: "implementation",
    state: "todo",
    owner: null,
    reviewer: null,
    requiredCapabilities: [],
    scope: { mayTouch: ["src/**"], forbidden: [] },
    acceptance: [],
    gate: "g",
    dependsOn: [],
    attempts: 0,
    rejections: 0,
    artifacts: "",
    result: null,
    helpRequests: [],
    helpHops: 0,
    ...overrides,
  }
}

describe("Routing", () => {
  it("elige el rol canónico del tipo de card", () => {
    const r = roster([
      entry({ id: "e-1", role: "frontend-developer" }),
      entry({ id: "e-2", role: "code-architect" }),
    ])
    const result = routeCard(card({ type: "implementation" }), r)
    expect(result.owner?.role).toBe("frontend-developer")
  })

  it("el revisor NUNCA es el owner", () => {
    const r = roster([entry({ id: "e-only", role: "frontend-developer" })])
    const result = routeCard(card({ type: "implementation" }), r)
    expect(result.owner?.id).toBe("e-only")
    // Con un solo agente no hay revisor posible, pero nunca es el owner.
    expect(result.reviewer?.id).not.toBe("e-only")
  })

  it("el revisor es distinto del owner con varios agentes", () => {
    const r = roster([
      entry({ id: "e-1", role: "frontend-developer" }),
      entry({ id: "e-2", role: "code-architect" }),
    ])
    const result = routeCard(card({ type: "implementation" }), r)
    expect(result.reviewer?.id).not.toBe(result.owner?.id)
  })

  it("no elige un agente que ya tiene card", () => {
    const r = roster([
      entry({ id: "e-1", role: "frontend-developer", currentCard: "T-99" }),
      entry({ id: "e-2", role: "backend-developer" }),
    ])
    const result = routeCard(card({ type: "implementation" }), r)
    expect(result.owner?.id).toBe("e-2")
  })

  it("no elige un agente bloqueado", () => {
    const r = roster([
      entry({ id: "e-1", role: "frontend-developer", state: "blocked" }),
      entry({ id: "e-2", role: "backend-developer" }),
    ])
    const result = routeCard(card({ type: "implementation" }), r)
    expect(result.owner?.id).toBe("e-2")
  })

  it("rota el owner cuando la racha excede el umbral", () => {
    const r = roster([
      entry({ id: "e-1", role: "frontend-developer" }),
      entry({ id: "e-2", role: "backend-developer" }),
    ])
    const result = routeCard(card({ type: "implementation" }), r, [], { ownerStreak: 3 })
    expect(result.owner?.id).toBe("e-2")
    expect(result.reason).toContain("rotación")
  })

  it("reporta las capabilities faltantes cuando no hay owner", () => {
    const r = roster([entry({ id: "e-1", role: "frontend-developer" })])
    const result = routeCard(
      card({ type: "infra", requiredCapabilities: ["kubernetes", "terraform"] }),
      r,
    )
    expect(result.owner).toBeNull()
    expect(result.missing).toContain("kubernetes")
  })

  it("el mapa de roles cubre todos los tipos de card", () => {
    for (const type of Object.keys(ROLE_BY_CARD_TYPE)) {
      expect(ROLE_BY_CARD_TYPE[type as Card["type"]].length).toBeGreaterThan(0)
    }
  })
})

describe("Routing de ayuda", () => {
  it("dirige al peer declarado", () => {
    const r = roster([
      entry({ id: "e-1", role: "frontend-developer" }),
      entry({ id: "e-2", role: "code-architect" }),
    ])
    const result = routeHelp("e-1", r, ["code-architect"])
    expect(result.targets).toEqual(["e-2"])
  })

  it("rota a un tercero si el par ya colaboró demasiado", () => {
    const r = roster([
      entry({ id: "e-1", role: "frontend-developer", helpedPeers: ["e-2"] }),
      entry({ id: "e-2", role: "code-architect" }),
      entry({ id: "e-3", role: "qa-engineer" }),
    ])
    const result = routeHelp("e-1", r, ["code-architect"], { pairCollaborationCount: 2 })
    expect(result.targets).toEqual(["e-3"])
    expect(result.reason).toContain("rotación")
  })
})

describe("Racha de owner", () => {
  it("cuenta las cards consecutivas del mismo tipo y owner", () => {
    const cards: Record<string, Card> = {
      "T-00": card({ id: "T-00", type: "implementation", owner: "e-1", state: "done" }),
      "T-01": card({ id: "T-01", type: "implementation", owner: "e-1", state: "done" }),
      "T-02": card({ id: "T-02", type: "implementation", owner: "e-2", state: "done" }),
    }
    expect(ownerStreak(cards, ["T-00", "T-01", "T-02"], "e-1", "implementation")).toBe(0)
    expect(ownerStreak(cards, ["T-00", "T-01", "T-02"], "e-2", "implementation")).toBe(1)
  })
})

describe("Política de 3 golpes", () => {
  it("el primer rechazo es rework", () => {
    const c = recordRejection(card(), "no anda")
    expect(c.rejections).toBe(1)
    const decision = decideRetry(c, DEFAULT_LIMITS)
    expect(decision.action).toBe("rework")
    expect(decision.rotateOwner).toBe(false)
  })

  it("el segundo rechazo es replan con rotación de owner", () => {
    const c = recordRejection(recordRejection(card(), "falla 1"), "falla 2")
    const decision = decideRetry(c, DEFAULT_LIMITS)
    expect(decision.action).toBe("replan")
    expect(decision.rotateOwner).toBe(true)
  })

  it("el tercer rechazo escala", () => {
    let c = card()
    for (let i = 0; i < 3; i++) c = recordRejection(c, `falla ${i}`)
    const decision = decideRetry(c, DEFAULT_LIMITS)
    expect(decision.action).toBe("escalate")
  })

  it("sin rechazos, la acción es aprobar", () => {
    expect(decideRetry(card(), DEFAULT_LIMITS).action).toBe("approve")
  })

  it("el presupuesto se agota y se reporta el motivo", () => {
    const base = {
      budget: { cardsUsed: 0, maxCards: 20, agentCallsUsed: 0, maxAgentCalls: 40, spawnsUsed: 0, maxSpawnsTotal: 20 },
    } as unknown as OfficeState
    expect(hasBudget(base, DEFAULT_LIMITS).ok).toBe(true)

    const exhausted = {
      ...base,
      budget: { ...base.budget, cardsUsed: 20 },
    }
    const result = hasBudget(exhausted, DEFAULT_LIMITS)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain("cards")
  })

  it("consumeAgentCall suma al presupuesto", () => {
    const state = {
      budget: { cardsUsed: 0, maxCards: 20, agentCallsUsed: 0, maxAgentCalls: 40, spawnsUsed: 0, maxSpawnsTotal: 20 },
      updatedAt: "",
    } as unknown as OfficeState
    consumeAgentCall(state, 3)
    expect(state.budget.agentCallsUsed).toBe(3)
  })
})
