import { describe, it, expect } from "vitest"
import {
  createLedger,
  recordUsage,
  checkBudget,
  estimateRun,
  renderCostReport,
  detectRedundantWork,
  totalTokens,
  DEFAULT_COST_LIMITS,
  ASSUMED_TOKENS_PER_CALL,
  type CostLedger,
  type CostLimits,
  type ToolEvent,
  type UsageInput,
  type WorkPhase,
} from "../src/core/cost.js"

/** Reloj falso: el tiempo lo mueve el test, no el reloj del sistema. */
function fakeClock(start = 0): { clock: () => number; advance: (ms: number) => void } {
  let now = start
  return {
    clock: () => now,
    advance: (ms: number) => {
      now += ms
    },
  }
}

/** Límites generosos: los tests que cortan los setean a medida. */
function permissiveLimits(overrides: Partial<CostLimits> = {}): CostLimits {
  return {
    maxUsdPerRun: 100,
    maxUsdPerCard: 50,
    maxTokensPerRun: 10_000_000,
    maxWallClockMsPerRun: 24 * 60 * 60 * 1000,
    perPhaseUsd: {},
    warnUsdPerCard: 10,
    ...overrides,
  }
}

/** Uso de ejemplo con los campos que el motor reporta. */
function usage(overrides: Partial<UsageInput> = {}): UsageInput {
  return {
    agentId: "e-impl",
    role: "implementador",
    cardId: "C-01",
    phase: "implementation" satisfies WorkPhase,
    model: "claude-sonnet-4",
    provider: "anthropic",
    cost: 0.25,
    tokens: { input: 1000, output: 500, reasoning: 100 },
    latencyMs: 1200,
    ...overrides,
  }
}

describe("createLedger", () => {
  it("arranca en cero con la forma correcta", () => {
    const ledger = createLedger("run-1", () => 0)

    expect(ledger.version).toBe(1)
    expect(ledger.runId).toBe("run-1")
    expect(ledger.byCard).toEqual({})
    expect(ledger.byAgent).toEqual({})
    expect(ledger.byPhase).toEqual({})
    expect(ledger.total.usd).toBe(0)
    expect(ledger.total.calls).toBe(0)
    expect(ledger.total.wallClockMs).toBe(0)
    expect(ledger.total.tokens).toEqual({
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
    })
    expect(ledger.startedAt).toBe(new Date(0).toISOString())
    expect(ledger.updatedAt).toBe(ledger.startedAt)
  })

  it("es JSON-serializable y sobrevive un round-trip", () => {
    const ledger = createLedger("run-1", () => 0)
    recordUsage(ledger, usage(), () => 0)

    const roundTrip = JSON.parse(JSON.stringify(ledger)) as CostLedger
    expect(roundTrip).toEqual(ledger)
    expect(roundTrip.total.usd).toBe(0.25)
  })
})

describe("recordUsage", () => {
  it("suma usd, tokens y calls al total", () => {
    const ledger = createLedger("run-1", () => 0)

    recordUsage(ledger, usage({ cost: 0.25 }), () => 0)
    recordUsage(ledger, usage({ cost: 0.5, tokens: { input: 200, output: 100, reasoning: 0 } }), () => 0)

    expect(ledger.total.usd).toBeCloseTo(0.75, 9)
    expect(ledger.total.calls).toBe(2)
    expect(ledger.total.tokens.input).toBe(1200)
    expect(ledger.total.tokens.output).toBe(600)
    expect(ledger.total.tokens.reasoning).toBe(100)
  })

  it("desglosa por card, por agente y por fase", () => {
    const ledger = createLedger("run-1", () => 0)

    recordUsage(ledger, usage({ cardId: "C-01", agentId: "e-a", phase: "implementation", cost: 0.3 }), () => 0)
    recordUsage(ledger, usage({ cardId: "C-02", agentId: "e-b", phase: "review", cost: 0.2 }), () => 0)
    recordUsage(ledger, usage({ cardId: "C-01", agentId: "e-a", phase: "implementation", cost: 0.1 }), () => 0)

    expect(Object.keys(ledger.byCard).sort()).toEqual(["C-01", "C-02"])
    expect(ledger.byCard["C-01"]?.usd).toBeCloseTo(0.4, 9)
    expect(ledger.byCard["C-01"]?.calls).toBe(2)
    expect(ledger.byCard["C-02"]?.usd).toBeCloseTo(0.2, 9)

    expect(Object.keys(ledger.byAgent).sort()).toEqual(["e-a", "e-b"])
    expect(ledger.byAgent["e-a"]?.usd).toBeCloseTo(0.4, 9)
    expect(ledger.byAgent["e-a"]?.calls).toBe(2)
    expect(ledger.byAgent["e-b"]?.usd).toBeCloseTo(0.2, 9)

    expect(Object.keys(ledger.byPhase).sort()).toEqual(["implementation", "review"])
    expect(ledger.byPhase.implementation?.usd).toBeCloseTo(0.4, 9)
    expect(ledger.byPhase.review?.usd).toBeCloseTo(0.2, 9)
  })

  it("contabiliza el cache read/write aparte de entrada y salida", () => {
    const ledger = createLedger("run-1", () => 0)

    recordUsage(
      ledger,
      usage({ tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 900, write: 25 } } }),
      () => 0,
    )

    expect(ledger.total.tokens).toEqual({
      input: 100,
      output: 50,
      reasoning: 0,
      cacheRead: 900,
      cacheWrite: 25,
    })
    expect(totalTokens(ledger.total.tokens)).toBe(1075)
  })

  it("no crea entrada de card cuando cardId es null", () => {
    const ledger = createLedger("run-1", () => 0)

    recordUsage(ledger, usage({ cardId: null, phase: "exploration" }), () => 0)

    expect(ledger.byCard).toEqual({})
    expect(ledger.total.calls).toBe(1)
    expect(ledger.byPhase.exploration?.usd).toBeCloseTo(0.25, 9)
  })

  it("acumula latencia por agente y guarda modelo/proveedor", () => {
    const ledger = createLedger("run-1", () => 0)

    recordUsage(ledger, usage({ agentId: "e-a", latencyMs: 1000 }), () => 0)
    recordUsage(ledger, usage({ agentId: "e-a", latencyMs: 500, model: "otro-modelo" }), () => 0)

    expect(ledger.byAgent["e-a"]?.latencyMs).toBe(1500)
    expect(ledger.byAgent["e-a"]?.calls).toBe(2)
    expect(ledger.byAgent["e-a"]?.model).toBe("otro-modelo")
    expect(ledger.byAgent["e-a"]?.provider).toBe("anthropic")
  })

  it("acumula el wall clock de la corrida", () => {
    const time = fakeClock(0)
    const ledger = createLedger("run-1", time.clock)

    time.advance(5_000)
    recordUsage(ledger, usage(), time.clock)

    expect(ledger.total.wallClockMs).toBe(5_000)
  })
})

describe("checkBudget", () => {
  it("permite mientras está debajo del límite", () => {
    const ledger = createLedger("run-1", () => 0)
    recordUsage(ledger, usage({ cost: 1 }), () => 0)

    const decision = checkBudget(ledger, permissiveLimits({ maxUsdPerRun: 10 }), "C-01", "implementation")

    expect(decision.allowed).toBe(true)
    expect(decision.breached).toBeNull()
    expect(decision.current.usd).toBeCloseTo(1, 9)
    expect(decision.reason).toContain("Dentro de presupuesto")
  })

  it("bloquea al superar maxUsdPerRun", () => {
    const ledger = createLedger("run-1", () => 0)
    recordUsage(ledger, usage({ cost: 6 }), () => 0)

    const decision = checkBudget(ledger, permissiveLimits({ maxUsdPerRun: 5 }))

    expect(decision.allowed).toBe(false)
    expect(decision.breached).toBe("run-usd")
    expect(decision.reason).toContain("6.0000")
  })

  it("bloquea al superar maxUsdPerCard", () => {
    const ledger = createLedger("run-1", () => 0)
    recordUsage(ledger, usage({ cardId: "C-01", cost: 3 }), () => 0)

    const decision = checkBudget(ledger, permissiveLimits({ maxUsdPerCard: 2 }), "C-01")

    expect(decision.allowed).toBe(false)
    expect(decision.breached).toBe("card-usd")
    expect(decision.reason).toContain("C-01")
  })

  it("bloquea al superar maxTokensPerRun", () => {
    const ledger = createLedger("run-1", () => 0)
    recordUsage(ledger, usage({ tokens: { input: 5_000, output: 1_000, reasoning: 0 } }), () => 0)

    const decision = checkBudget(ledger, permissiveLimits({ maxTokensPerRun: 1_000 }))

    expect(decision.allowed).toBe(false)
    expect(decision.breached).toBe("run-tokens")
  })

  it("bloquea al superar el presupuesto de una fase", () => {
    const ledger = createLedger("run-1", () => 0)
    recordUsage(ledger, usage({ phase: "repair", cost: 2 }), () => 0)

    const decision = checkBudget(
      ledger,
      permissiveLimits({ perPhaseUsd: { repair: 1, implementation: 100 } }),
      undefined,
      "repair",
    )

    expect(decision.allowed).toBe(false)
    expect(decision.breached).toBe("phase-usd")
    expect(decision.reason).toContain("repair")
  })

  it("bloquea al superar el wall clock", () => {
    const time = fakeClock(0)
    const ledger = createLedger("run-1", time.clock)
    time.advance(3_600_000)
    recordUsage(ledger, usage(), time.clock)

    const decision = checkBudget(ledger, permissiveLimits({ maxWallClockMsPerRun: 60_000 }))

    expect(decision.allowed).toBe(false)
    expect(decision.breached).toBe("wall-clock")
  })

  it("el límite de card no aplica si no se pasó cardId", () => {
    const ledger = createLedger("run-1", () => 0)
    recordUsage(ledger, usage({ cardId: "C-01", cost: 3 }), () => 0)

    const decision = checkBudget(ledger, permissiveLimits({ maxUsdPerCard: 2 }))

    expect(decision.allowed).toBe(true)
    expect(decision.breached).toBeNull()
  })

  it("el límite de fase no aplica si no se pasó phase", () => {
    const ledger = createLedger("run-1", () => 0)
    recordUsage(ledger, usage({ phase: "repair", cost: 2 }), () => 0)

    const decision = checkBudget(ledger, permissiveLimits({ perPhaseUsd: { repair: 1 } }))

    expect(decision.allowed).toBe(true)
    expect(decision.breached).toBeNull()
  })

  it("avisa sin bloquear cuando una card pasa el umbral de warnUsdPerCard", () => {
    const ledger = createLedger("run-1", () => 0)
    recordUsage(ledger, usage({ cardId: "C-01", cost: 1.5 }), () => 0)

    const decision = checkBudget(ledger, permissiveLimits({ warnUsdPerCard: 1 }), "C-01")

    expect(decision.allowed).toBe(true)
    expect(decision.breached).toBeNull()
    expect(decision.warnings.length).toBe(1)
    expect(decision.warnings[0]).toContain("C-01")
  })

  it("un límite en cero significa sin límite", () => {
    const ledger = createLedger("run-1", () => 0)
    recordUsage(ledger, usage({ cost: 1_000 }), () => 0)

    const decision = checkBudget(
      ledger,
      permissiveLimits({ maxUsdPerRun: 0, maxUsdPerCard: 0, maxTokensPerRun: 0, maxWallClockMsPerRun: 0 }),
    )

    expect(decision.allowed).toBe(true)
    expect(decision.breached).toBeNull()
  })
})

describe("estimateRun", () => {
  it("escala linealmente y devuelve una nota", () => {
    const small = estimateRun(2, 2, 5, 0.01)
    const big = estimateRun(4, 2, 5, 0.01)

    expect(small.usd).toBeCloseTo(0.2, 9)
    expect(big.usd).toBeCloseTo(0.4, 9)
    expect(big.usd).toBeCloseTo(small.usd * 2, 9)
    expect(big.tokens).toBe(small.tokens * 2)
    expect(big.tokens).toBe(40 * ASSUMED_TOKENS_PER_CALL)
    expect(small.note).toContain("Supuesto")
    expect(small.note.length).toBeGreaterThan(50)
  })

  it("no devuelve números negativos con entradas inválidas", () => {
    const estimate = estimateRun(-3, 2, 5, 0.01)

    expect(estimate.usd).toBe(0)
    expect(estimate.tokens).toBe(0)
    expect(estimate.note).toContain("inválidas")
  })
})

describe("renderCostReport", () => {
  it("incluye los totales y el desglose", () => {
    const ledger = createLedger("run-42", () => 0)
    recordUsage(ledger, usage({ cardId: "C-01", agentId: "e-a", phase: "implementation" }), () => 0)
    recordUsage(ledger, usage({ cardId: "C-02", agentId: "e-b", phase: "review", cost: 0.5 }), () => 0)

    const report = renderCostReport(ledger, DEFAULT_COST_LIMITS)

    expect(report).toContain("# Costo — corrida `run-42`")
    expect(report).toContain("## Totales")
    expect(report).toContain("## Por card")
    expect(report).toContain("## Por agente")
    expect(report).toContain("## Por fase")
    expect(report).toContain("## Límites")
    expect(report).toContain("C-01")
    expect(report).toContain("C-02")
    expect(report).toContain("e-a")
    expect(report).toContain("implementation")
    expect(report).toContain("review")
    expect(report).toContain("$0.7500")
  })

  it("señala el límite que está más cerca de romperse", () => {
    const ledger = createLedger("run-42", () => 0)
    recordUsage(ledger, usage({ cost: 4 }), () => 0)

    const report = renderCostReport(ledger, permissiveLimits({ maxUsdPerRun: 5, maxUsdPerCard: 100 }))

    expect(report).toContain("Más cerca de romperse")
    expect(report).toContain("run-usd")
  })
})

describe("detectRedundantWork", () => {
  it("detecta lecturas repetidas del mismo path", () => {
    const events: ToolEvent[] = [
      { agentId: "e-a", tool: "read", target: "src/core/cost.ts", at: "2026-01-01T00:00:00.000Z" },
      { agentId: "e-a", tool: "read", target: "src/core/cost.ts", at: "2026-01-01T00:00:01.000Z" },
      { agentId: "e-a", tool: "read", target: "src/core/cost.ts", at: "2026-01-01T00:00:02.000Z" },
      { agentId: "e-a", tool: "read", target: "src/otro.ts", at: "2026-01-01T00:00:03.000Z" },
    ]

    const report = detectRedundantWork(events)

    expect(report.repeatedReads.length).toBe(1)
    expect(report.repeatedReads[0]?.target).toBe("src/core/cost.ts")
    expect(report.repeatedReads[0]?.count).toBe(3)
    expect(report.repeatedReads.length).toBe(1)
  })

  it("detecta comandos repetidos", () => {
    const events: ToolEvent[] = [
      { agentId: "e-a", tool: "bash", target: "npm test", at: "2026-01-01T00:00:00.000Z" },
      { agentId: "e-a", tool: "bash", target: "npm  test", at: "2026-01-01T00:00:01.000Z" },
      { agentId: "e-a", tool: "bash", target: "npm run build", at: "2026-01-01T00:00:02.000Z" },
    ]

    const report = detectRedundantWork(events)

    expect(report.repeatedCommands.length).toBe(1)
    expect(report.repeatedCommands[0]?.target).toBe("npm test")
    expect(report.repeatedCommands[0]?.count).toBe(2)
  })

  it("calcula wastedFraction", () => {
    const events: ToolEvent[] = [
      { agentId: "e-a", tool: "read", target: "a.ts", at: "2026-01-01T00:00:00.000Z" },
      { agentId: "e-a", tool: "read", target: "a.ts", at: "2026-01-01T00:00:01.000Z" },
      { agentId: "e-a", tool: "read", target: "b.ts", at: "2026-01-01T00:00:02.000Z" },
      { agentId: "e-a", tool: "read", target: "b.ts", at: "2026-01-01T00:00:03.000Z" },
    ]

    const report = detectRedundantWork(events)

    // 4 eventos considerados, 2 repeticiones → 0.5
    expect(report.wastedFraction).toBeCloseTo(0.5, 9)
    expect(report.summary).toContain("repeticiones")
  })

  it("no cuenta como redundante a dos agentes distintos que leen lo mismo", () => {
    const events: ToolEvent[] = [
      { agentId: "e-a", tool: "read", target: "a.ts", at: "2026-01-01T00:00:00.000Z" },
      { agentId: "e-b", tool: "read", target: "a.ts", at: "2026-01-01T00:00:01.000Z" },
    ]

    const report = detectRedundantWork(events)

    expect(report.wastedFraction).toBe(0)
    expect(report.repeatedReads.length).toBe(1)
    expect(report.repeatedReads[0]?.count).toBe(2)
  })

  it("ignora tools sin objetivo y tools que no son lecturas ni comandos", () => {
    const events: ToolEvent[] = [
      { agentId: "e-a", tool: "read", target: null, at: "2026-01-01T00:00:00.000Z" },
      { agentId: "e-a", tool: "edit", target: "a.ts", at: "2026-01-01T00:00:01.000Z" },
      { agentId: "e-a", tool: "edit", target: "a.ts", at: "2026-01-01T00:00:02.000Z" },
    ]

    const report = detectRedundantWork(events)

    expect(report.repeatedReads.length).toBe(0)
    expect(report.repeatedCommands.length).toBe(0)
    expect(report.wastedFraction).toBe(0)
    expect(report.summary).toContain("no hay redundancia")
  })
})

describe("determinismo", () => {
  it("dos corridas con el mismo reloj dan el mismo ledger", () => {
    const build = (): CostLedger => {
      const time = fakeClock(1_700_000_000_000)
      const ledger = createLedger("run-x", time.clock)
      recordUsage(ledger, usage({ cost: 0.1 }), time.clock)
      time.advance(1_000)
      recordUsage(ledger, usage({ cost: 0.2, cardId: "C-02", agentId: "e-b", phase: "review" }), time.clock)
      return ledger
    }

    const a = build()
    const b = build()

    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(a.updatedAt).toBe(b.updatedAt)
    expect(a.total.wallClockMs).toBe(b.total.wallClockMs)
  })
})
