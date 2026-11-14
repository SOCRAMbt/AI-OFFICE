/**
 * Arranque en frío (v3.2.6): una oficina sin agentes con canDelegate
 * se auto-ampara con un Comandante builtin cuando la sesión del host
 * es confiable. Patrón del caso /oficina en root nuevo.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { Office } from "../src/core/office.js"
import { buildTools, type OficinaTool } from "../src/tools/index.js"
import { DEFAULT_LIMITS } from "../src/core/types.js"

describe("Arranque en frío: oficina vacía + host confiable => auto-Comandante", () => {
  let tmp: string
  let office: Office
  let tools: Record<string, OficinaTool>
  let spawnCalls: Array<Record<string, unknown>> = []
  let childSeq = 0

  beforeEach(async () => {
    spawnCalls = []
    childSeq = 0
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-cold-"))
    await fs.writeFile(path.join(tmp, "package.json"), JSON.stringify({ name: "cold", scripts: { test: "true" } }))
    // Mini-catálogo de agency-agents para poder despachar.
    const dir = path.join(tmp, "agency", "engineering")
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, "frontend-developer.md"), [
      "---",
      "name: Frontend Developer",
      "description: React and CSS specialist",
      "vibe: Performance obsessed.",
      "---",
      "",
      "## Critical Rules You Must Follow",
      "1. No ship without tests.",
      "",
    ].join("\n"))
    office = new Office({
      cwd: tmp,
      limits: DEFAULT_LIMITS,
      catalog: undefined,
      spawner: async (input) => {
        spawnCalls.push(input as unknown as Record<string, unknown>)
        childSeq += 1
        return `child-${childSeq}`
      },
    })
    await office.init()
    // plugin mínimo que provea un catalog ambient si se necesita para plan/routing
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

  const ctx = (agent: string, sessionID = "ses-cmd") => ({ directory: tmp, sessionID, agent, messageID: "m1" })

  it("oficina_plan en frío despliega Comandante builtin canDelegate", async () => {
    // Oficina sin agentes todavía
    const pre = await office.loadRoster("run-cold-000")
    expect(Object.keys(pre.agents)).toHaveLength(0)

    const result = await tools.oficina_plan!.execute({
      objective: "mum",
      cards: [{ title: "A1", type: "implementation", requiredCapabilities: [], scope: { mayTouch: ["**"], forbidden: [] }, acceptance: ["a"], gate: "npm test" }],
    }, ctx("build"))
    expect(result.output).toContain("Plan guardado")

    const state = await office.loadState()
    const roster = await office.loadRoster(state.runId)
    expect(roster.agents["build"]).toBeDefined()
    expect(roster.agents["build"]!.canDelegate).toBe(true)
    expect(roster.agents["build"]!.role).toBe("commander")
  })

  it("oficina_dispatch en frío despacha al equipo con el Comandante builtin", async () => {
    const planResult = await tools.oficina_plan!.execute({
      objective: "una card",
      cards: [{ title: "A1", type: "implementation", requiredCapabilities: ["react"], scope: { mayTouch: ["**"], forbidden: [] }, acceptance: ["a"], gate: "npm test" }],
    }, ctx("build"))
    expect(planResult.output).toContain("Plan guardado")

    const dispatchResult = await tools.oficina_dispatch!.execute({
      agentId: "build",
      maxAgents: 2,
      maxComplements: 0,
      spawn: true,
    } as never, ctx("build"))
    expect(dispatchResult.output).toContain("Equipo despachado")
    expect(dispatchResult.output).not.toEqual(expect.stringContaining("agente sin canDelegate"))
  })

  it("agentId NO confiado no auto-despliega Comandante; dispatch sigue rechazando", async () => {
    const planResult = await tools.oficina_plan!.execute({
      objective: "x",
      cards: [{ title: "A1", type: "implementation", requiredCapabilities: [], scope: { mayTouch: ["**"], forbidden: [] }, acceptance: ["a"], gate: "npm test" }],
    }, ctx("mi-cute-session-id"))
    expect(planResult.output).toContain("Plan guardado")

    const state = await office.loadState()
    const roster = await office.loadRoster(state.runId)
    expect(roster.agents["mi-cute-session-id"]).toBeUndefined()

    const dispatchResult = await tools.oficina_dispatch!.execute({ agentId: "mi-cute-session-id" } as never, ctx("mi-cute-session-id"))
    expect(dispatchResult.output).toContain("Solo agentes con canDelegate")
  })
})
