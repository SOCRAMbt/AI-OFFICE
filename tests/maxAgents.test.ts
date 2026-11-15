/**
 * /oficina --maxagents N (v3.3.0): el usuario, no el modelo, manda en el
 * presupuesto de agentes. Sin flag: tope conservador 3. Con flag: exactamente
 * el tope pedido (hasta 14). El dispatch clampa contra el tope persistido en
 * el estado aunque el modelo intente despachar más.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { Office } from "../src/core/office.js"
import { buildTools, type OficinaTool } from "../src/tools/index.js"
import { CONSERVATIVE_MAX_AGENTS, DEFAULT_LIMITS } from "../src/core/types.js"

describe("/oficina --maxagents: tope persistido en el estado y respetado por dispatch", () => {
  let tmp: string
  let office: Office
  let tools: Record<string, OficinaTool>
  let spawnCalls: Array<Record<string, unknown>> = []
  let childSeq = 0

  const ctx = (agent: string, sessionID = "ses-cmd") => ({
    directory: tmp,
    sessionID,
    agent,
    messageID: "m1",
  })

  const mkCard = (i: number) => ({
    title: `Feature componente ${i}`,
    type: "implementation" as const,
    requiredCapabilities: ["react"],
    scope: { mayTouch: ["**"], forbidden: [] },
    acceptance: [`hecho ${i}`],
    gate: "npm test",
  })

  beforeEach(async () => {
    spawnCalls = []
    childSeq = 0
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-maxag-"))
    await fs.writeFile(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "cold", scripts: { test: "true" } }),
    )
    const dir = path.join(tmp, "agency", "engineering")
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      path.join(dir, "frontend-developer.md"),
      [
        "---",
        "name: Frontend Developer",
        "description: React and CSS specialist",
        "vibe: Performance obsessed.",
        "---",
        "",
        "## Critical Rules You Must Follow",
        "1. No ship without tests.",
        "",
      ].join("\n"),
    )
    const sc = await import("../src/core/catalog.js")
    office = new Office({
      cwd: tmp,
      limits: DEFAULT_LIMITS,
      catalog: await sc.scanCatalog({ root: path.join(tmp, "agency") }),
      spawner: async (input) => {
        spawnCalls.push(input as unknown as Record<string, unknown>)
        childSeq += 1
        return `child-${childSeq}`
      },
    })
    await office.init()
    tools = buildTools(office)
  })
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }) })

  it("sin flag: plan persiste tope conservador y despacha <= 3 aunque el modelo pida 10", async () => {
    const plan = await tools.oficina_plan!.execute(
      {
        objective: "seis componentes React",
        mode: "full",
        cards: [1, 2, 3, 4, 5, 6].map(mkCard),
      },
      ctx("build"),
    )
    expect(plan.output).toContain(`default conservador`)
    const state = await office.loadState()
    expect(state.maxAgents).toBe(CONSERVATIVE_MAX_AGENTS)
    expect(state.maxAgents).toBe(3)
    expect(state.decisions.some((d) => d.reason.includes("maxagents 3"))).toBe(true)

    const dispatch = await tools.oficina_dispatch!.execute(
      { agentId: "build", maxAgents: 10, maxComplements: 0, spawn: true } as never,
      ctx("build"),
    )
    expect(dispatch.output).toContain(`Tope --maxagents aplicado: 3 (pediste 10`)
    expect(spawnCalls.length).toBeLessThanOrEqual(3)
  })

  it("con flag --maxagents 5: el dispatch alcanza 5, no 3 ni 10", async () => {
    const plan = await tools.oficina_plan!.execute(
      {
        objective: "seis componentes React",
        mode: "full",
        maxAgents: 5,
        cards: [1, 2, 3, 4, 5, 6].map(mkCard),
      },
      ctx("build"),
    )
    expect(plan.output).toContain("(flag --maxagents)")
    const state = await office.loadState()
    expect(state.maxAgents).toBe(5)

    const dispatch = await tools.oficina_dispatch!.execute(
      { agentId: "build", maxAgents: 10, maxComplements: 0, spawn: true } as never,
      ctx("build"),
    )
    expect(dispatch.output).toContain(`Tope --maxagents aplicado: 5 (pediste 10`)
    expect(spawnCalls.length).toBeLessThanOrEqual(5)
  })

  it("con flag --maxagents 1: la oficina queda en 1 agente incluso pidiendo 14", async () => {
    const plan = await tools.oficina_plan!.execute(
      {
        objective: "tema chico",
        mode: "full",
        maxAgents: 1,
        cards: [mkCard(1)],
      },
      ctx("build"),
    )
    expect(plan.output).toContain("Agentes simultáneos máximo:** 1")
    const state = await office.loadState()
    expect(state.maxAgents).toBe(1)

    const dispatch = await tools.oficina_dispatch!.execute(
      { agentId: "build", maxAgents: 14, maxComplements: 0, spawn: true } as never,
      ctx("build"),
    )
    expect(dispatch.output).toContain(`Tope --maxagents aplicado: 1`)
    expect(spawnCalls.length).toBeLessThanOrEqual(1)
  })
})
