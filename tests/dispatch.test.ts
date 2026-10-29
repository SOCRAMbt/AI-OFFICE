import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { Office } from "../src/core/office.js"
import { dispatchOffice, buildAgentPrompt, agentNameFor, materializeAgent } from "../src/core/dispatch.js"
import { scanCatalog } from "../src/core/catalog.js"
import { buildBriefing } from "../src/core/briefing.js"
import { DEFAULT_LIMITS, type Card } from "../src/core/types.js"

let tmp: string
let office: Office
let catalog: Awaited<ReturnType<typeof scanCatalog>>

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-dispatch-"))
  await fs.writeFile(
    path.join(tmp, "package.json"),
    JSON.stringify({ name: "demo", scripts: { test: "true", lint: "true" } }),
  )
  await fs.mkdir(path.join(tmp, "src"), { recursive: true })
  await fs.writeFile(path.join(tmp, "src", "app.js"), "export const x = 1\n")

  // Mini-catalog de agency-agents, para no depender del repo externo.
  const dir = path.join(tmp, "agency", "engineering")
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    path.join(dir, "frontend-developer.md"),
    [
      "---",
      "name: Frontend Developer",
      "description: React and CSS specialist",
      "vibe: Pixel obsessive.",
      "---",
      "",
      "# Frontend Developer Agent Personality",
      "",
      "## Your Core Mission",
      "",
      "### Build React Components",
      "",
      "### Design CSS Systems",
      "",
      "## Critical Rules You Must Follow",
      "",
      "1. Never ship a component without a test.",
      "",
    ].join("\n"),
  )
  await fs.writeFile(
    path.join(dir, "a11y-specialist.md"),
    [
      "---",
      "name: Accessibility Specialist",
      "description: WCAG and ARIA auditor",
      "---",
      "",
      "# Accessibility Specialist",
      "",
      "## Your Core Mission",
      "",
      "### Audit ARIA Semantics",
      "",
      "### Test Keyboard Operability",
      "",
    ].join("\n"),
  )
  catalog = await scanCatalog({ root: path.join(tmp, "agency") })

  office = new Office({ cwd: tmp, limits: DEFAULT_LIMITS, catalog })
  await office.init()
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: "T-00",
    title: "Login",
    type: "implementation",
    state: "todo",
    owner: null,
    reviewer: null,
    requiredCapabilities: ["react"],
    scope: { mayTouch: ["src/auth/**"], forbidden: ["src/server/**"] },
    acceptance: ["funciona"],
    gate: "npm test",
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

describe("Nombre del agente OpenCode", () => {
  it("deriva un nombre válido del slug", () => {
    expect(agentNameFor("frontend-developer")).toBe("oficina-frontend-developer")
    expect(agentNameFor("Some Weird Role!")).toBe("oficina-some-weird-role")
  })

  it("nunca supera el límite de longitud", () => {
    expect(agentNameFor("a".repeat(200)).length).toBeLessThanOrEqual(48)
  })
})

describe("Materialización del agente", () => {
  it("escribe el archivo en .opencode/agents/ del proyecto", async () => {
    const { ficha } = await office.resolveFicha({ role: "frontend-developer", capabilities: ["react"] })
    expect(ficha.source.kind).toBe("agency-agents")

    const card = makeCard()
    const briefing = buildBriefing({ ficha, card, objective: "Test" })
    const file = await materializeAgent(tmp, ficha, briefing)

    expect(file).toBe(path.join(tmp, ".opencode", "agents", "oficina-frontend-developer.md"))
    const content = await fs.readFile(file, "utf8")
    expect(content).toContain("mode: subagent")
    expect(content).toContain("hidden: true")
    expect(content).toContain("Build React Components")
    expect(content).toContain("Frontend Developer")
  })
})

describe("Prompt de arranque", () => {
  it("incluye el prompt de origen, la ficha y el briefing", async () => {
    const { ficha } = await office.resolveFicha({ role: "frontend-developer", capabilities: ["react"] })
    const card = makeCard()
    const briefing = buildBriefing({ ficha, card, objective: "Test" })
    const prompt = buildAgentPrompt(ficha, briefing)

    // 1. La especialidad viene del catálogo, verbatim.
    expect(prompt).toContain("Build React Components")
    // 2. El contrato del rol.
    expect(prompt).toContain("src/auth/**")
    expect(prompt).toContain("no aprobar tu propio trabajo")
    // 3. La misión concreta.
    expect(prompt).toContain("Tu misión")
    expect(prompt).toContain("npm test")
    // 4. Cómo se trabaja en la mesa.
    expect(prompt).toContain("mesa")
    expect(prompt).toContain("HELP_REQUEST")
  })
})

describe("Dispatch del equipo", () => {
  async function setupPlan() {
    const state = await office.loadState("Implementar login")
    await office.savePlan(state, [
      {
        title: "Construir el login",
        type: "implementation",
        requiredCapabilities: ["react", "css"],
        scope: { mayTouch: ["src/auth/**"], forbidden: ["src/server/**"] },
        acceptance: ["el login funciona"],
        gate: "npm test",
      },
      {
        title: "Auditar accesibilidad",
        type: "security",
        requiredCapabilities: ["accessibility", "aria"],
        scope: { mayTouch: ["src/auth/**"], forbidden: [] },
        acceptance: ["sin violaciones WCAG"],
        gate: "npm test",
      },
    ])
    return office.loadState("Implementar login")
  }

  it("crea un agente por card y le asigna owner", async () => {
    const state = await setupPlan()
    const roster = await office.loadRoster(state.runId)

    const result = await dispatchOffice(office, state, {
      projectRoot: tmp,
      catalog,
      objective: state.objective,
      maxAgents: 10,
      maxComplements: 2,
      minCoverage: 0.3,
      existing: Object.values(roster.agents),
    })

    const owners = result.dispatched.filter((a) => !a.isPeer)
    expect(owners.length).toBeGreaterThanOrEqual(2)
    expect(state.cards["T-00"]!.owner).toBeTruthy()
    expect(state.cards["T-01"]!.owner).toBeTruthy()
  })

  it("materializa los archivos de agente en .opencode/agents/", async () => {
    const state = await setupPlan()
    const roster = await office.loadRoster(state.runId)

    await dispatchOffice(office, state, {
      projectRoot: tmp,
      catalog,
      objective: state.objective,
      maxAgents: 10,
      maxComplements: 2,
      minCoverage: 0.3,
      existing: Object.values(roster.agents),
    })

    const dir = path.join(tmp, ".opencode", "agents")
    const files = await fs.readdir(dir)
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) {
      expect(f).toMatch(/^oficina-/)
      const content = await fs.readFile(path.join(dir, f), "utf8")
      expect(content).toContain("mode: subagent")
    }
  })

  it("los complementos quedan como pares libres, sin card", async () => {
    const state = await setupPlan()
    const roster = await office.loadRoster(state.runId)

    const result = await dispatchOffice(office, state, {
      projectRoot: tmp,
      catalog,
      objective: state.objective,
      maxAgents: 10,
      maxComplements: 2,
      minCoverage: 0.3,
      existing: Object.values(roster.agents),
    })

    const peers = result.dispatched.filter((a) => a.isPeer)
    const after = await office.loadRoster(state.runId)
    for (const peer of peers) {
      expect(peer.cardId).toBeNull()
      expect(after.agents[peer.agentId]!.state).toBe("idle_available")
    }
  })

  it("respeta el presupuesto de agentes", async () => {
    const state = await setupPlan()
    const roster = await office.loadRoster(state.runId)

    const result = await dispatchOffice(office, state, {
      projectRoot: tmp,
      catalog,
      objective: state.objective,
      maxAgents: 1,
      maxComplements: 2,
      minCoverage: 0.3,
      existing: Object.values(roster.agents),
    })

    expect(result.dispatched.length).toBe(1)
    expect(result.unassigned.length).toBeGreaterThan(0)
  })

  it("el owner se escribe en la card y en el roster", async () => {
    const state = await setupPlan()
    const roster = await office.loadRoster(state.runId)

    await dispatchOffice(office, state, {
      projectRoot: tmp,
      catalog,
      objective: state.objective,
      maxAgents: 10,
      maxComplements: 2,
      minCoverage: 0.3,
      existing: Object.values(roster.agents),
    })

    const after = await office.loadRoster(state.runId)
    const card = state.cards["T-00"]!
    expect(card.owner).toBeTruthy()
    expect(after.agents[card.owner!]).toBeDefined()
    expect(after.agents[card.owner!]!.currentCard).toBe("T-00")
  })
})

describe("Spawn de subagentes", () => {
  it("usa session.prompt con una parte subtask", async () => {
    const calls: unknown[] = []
    const officeWithClient = new Office({
      cwd: tmp,
      limits: DEFAULT_LIMITS,
      client: {
        session: {
          prompt: async (args) => {
            calls.push(args)
            return {}
          },
        },
      },
    })
    await officeWithClient.init()

    const ok = await officeWithClient.spawnAgent("ses-1", "oficina-frontend-developer", "PROMPT", "T-00")

    expect(ok).toBe(true)
    expect(calls).toHaveLength(1)
    const call = calls[0] as {
      path: { id: string }
      body: { parts: Array<{ type: string; prompt: string; agent: string; description: string }> }
    }
    expect(call.path.id).toBe("ses-1")
    expect(call.body.parts[0]!.type).toBe("subtask")
    expect(call.body.parts[0]!.prompt).toBe("PROMPT")
    expect(call.body.parts[0]!.agent).toBe("general")
  })

  it("devuelve false sin cliente, sin romper", async () => {
    const plain = new Office({ cwd: tmp, limits: DEFAULT_LIMITS })
    await plain.init()
    expect(await plain.spawnAgent("ses-1", "a", "p", "d")).toBe(false)
  })

  it("no tira si el spawn falla", async () => {
    const officeWithClient = new Office({
      cwd: tmp,
      limits: DEFAULT_LIMITS,
      client: {
        session: {
          prompt: async () => {
            throw new Error("boom")
          },
        },
      },
    })
    await officeWithClient.init()
    expect(await officeWithClient.spawnAgent("ses-1", "a", "p", "d")).toBe(false)
  })
})

describe("DISP-001: IDs de agente no colisionan entre tarjetas del mismo rol", () => {
  it("dos tarjetas con el mismo rol obtienen agentIds distintos", async () => {
    const state = await office.loadState("Test DISP-001")
    await office.savePlan(state, [
      {
        title: "Card A",
        type: "implementation",
        requiredCapabilities: ["react"],
        scope: { mayTouch: ["src/**"], forbidden: [] },
        acceptance: ["A done"],
        gate: "npm test",
      },
      {
        title: "Card B",
        type: "implementation",
        requiredCapabilities: ["react"],
        scope: { mayTouch: ["src/**"], forbidden: [] },
        acceptance: ["B done"],
        gate: "npm test",
      },
    ])

    const roster = await office.loadRoster(state.runId)

    const result = await dispatchOffice(office, state, {
      projectRoot: tmp,
      catalog,
      objective: state.objective,
      maxAgents: 10,
      maxComplements: 2,
      minCoverage: 0.3,
      existing: Object.values(roster.agents),
    })

    const owners = result.dispatched.filter((a) => !a.isPeer)
    expect(owners.length).toBe(2)
    
    // Verificar que los agentIds son distintos
    const agentIds = owners.map(a => a.agentId)
    expect(new Set(agentIds).size).toBe(2)
    
    // Verificar que ambos IDs contienen el sufijo hash de la card
    expect(agentIds[0]!).toMatch(/e-frontend-developer-[a-f0-9]{8}$/)
    expect(agentIds[1]!).toMatch(/e-frontend-developer-[a-f0-9]{8}$/)
    expect(agentIds[0]).not.toBe(agentIds[1])
    
    // Verificar que en el roster ambos agentes existen
    const after = await office.loadRoster(state.runId)
    expect(after.agents[agentIds[0]!]).toBeDefined()
    expect(after.agents[agentIds[1]!]).toBeDefined()
  })

  it("tres o más tarjetas del mismo rol no colisionan", async () => {
    const state = await office.loadState("Test DISP-001 three cards")
    await office.savePlan(state, [
      { title: "Card 1", type: "implementation", requiredCapabilities: ["react"], scope: { mayTouch: ["src/**"], forbidden: [] }, acceptance: ["1"], gate: "npm test" },
      { title: "Card 2", type: "implementation", requiredCapabilities: ["react"], scope: { mayTouch: ["src/**"], forbidden: [] }, acceptance: ["2"], gate: "npm test" },
      { title: "Card 3", type: "implementation", requiredCapabilities: ["react"], scope: { mayTouch: ["src/**"], forbidden: [] }, acceptance: ["3"], gate: "npm test" },
      { title: "Card 4", type: "implementation", requiredCapabilities: ["react"], scope: { mayTouch: ["src/**"], forbidden: [] }, acceptance: ["4"], gate: "npm test" },
    ])

    const roster = await office.loadRoster(state.runId)

    const result = await dispatchOffice(office, state, {
      projectRoot: tmp,
      catalog,
      objective: state.objective,
      maxAgents: 10,
      maxComplements: 2,
      minCoverage: 0.3,
      existing: Object.values(roster.agents),
    })

    const owners = result.dispatched.filter((a) => !a.isPeer)
    expect(owners.length).toBe(4)
    
    const agentIds = owners.map(a => a.agentId)
    expect(new Set(agentIds).size).toBe(4)
  })

  it("despacho repetido de la misma tarjeta NO crea un nuevo agente (la card ya tiene owner)", async () => {
    const state = await office.loadState("Test idempotencia")
    await office.savePlan(state, [
      { title: "Card única", type: "implementation", requiredCapabilities: ["react"], scope: { mayTouch: ["src/**"], forbidden: [] }, acceptance: ["done"], gate: "npm test" },
    ])

    const roster = await office.loadRoster(state.runId)

    // Primer despacho
    const result1 = await dispatchOffice(office, state, {
      projectRoot: tmp,
      catalog,
      objective: state.objective,
      maxAgents: 10,
      maxComplements: 2,
      minCoverage: 0.3,
      existing: Object.values(roster.agents),
    })

    const ownerId1 = result1.dispatched.find(a => !a.isPeer)!.agentId
    expect(state.cards["T-00"]!.owner).toBe(ownerId1)

    // Segundo despacho - la card ya tiene owner, no se debe despachar de nuevo
    const state2 = await office.loadState()
    const roster2 = await office.loadRoster(state2.runId)

    const result2 = await dispatchOffice(office, state2, {
      projectRoot: tmp,
      catalog,
      objective: state2.objective,
      maxAgents: 10,
      maxComplements: 2,
      minCoverage: 0.3,
      existing: Object.values(roster2.agents),
    })

    // No se debe despachar ningún agente nuevo porque la card ya tiene owner
    expect(result2.dispatched.length).toBe(0)
    expect(result2.unassigned.length).toBe(0)
    
    // El owner original se mantiene
    expect(state2.cards["T-00"]!.owner).toBe(ownerId1)
  })

  it("role slug largo + card id largo no truncan el sufijo hash", async () => {
    // Crear un catálogo SOLO con el rol largo para que el matcher lo elija
    const longRoleDir = path.join(tmp, "agency", "engineering")
    await fs.rm(path.join(tmp, "agency"), { recursive: true, force: true })
    await fs.mkdir(longRoleDir, { recursive: true })
    await fs.writeFile(
      path.join(longRoleDir, "this-is-a-very-long-role-name-that-exceeds-normal-length-limits.md"),
      [
        "---",
        "name: Very Long Role Name",
        "description: Test role with very long slug",
        "vibe: Test.",
        "---",
        "",
        "# Very Long Role",
        "",
        "## Your Core Mission",
        "",
        "### Implement Testing",
        "",
        "### Write Unit Tests",
        "",
        "## Critical Rules You Must Follow",
        "",
        "1. Always write tests first.",
        "",
        "## Technical Deliverables",
        "",
        "- Test suites",
        "- Coverage reports",
        "",
        "## Advanced Capabilities",
        "",
        "- testing",
        "- jest",
        "- vitest",
        "",
      ].join("\n"),
    )
    
    const longCatalog = await scanCatalog({ root: path.join(tmp, "agency") })
    const officeWithLongRole = new Office({ cwd: tmp, limits: DEFAULT_LIMITS, catalog: longCatalog })
    await officeWithLongRole.init()

    const state = await officeWithLongRole.loadState("Test long role")
    await officeWithLongRole.savePlan(state, [
      { title: "Card 1", type: "implementation", requiredCapabilities: ["testing"], scope: { mayTouch: ["src/**"], forbidden: [] }, acceptance: ["1"], gate: "npm test" },
      { title: "Card 2", type: "implementation", requiredCapabilities: ["testing"], scope: { mayTouch: ["src/**"], forbidden: [] }, acceptance: ["2"], gate: "npm test" },
    ])

    const roster = await officeWithLongRole.loadRoster(state.runId)

    const result = await dispatchOffice(officeWithLongRole, state, {
      projectRoot: tmp,
      catalog: longCatalog,
      objective: state.objective,
      maxAgents: 10,
      maxComplements: 2,
      minCoverage: 0.3,
      existing: Object.values(roster.agents),
    })

    const owners = result.dispatched.filter((a) => !a.isPeer)
    expect(owners.length).toBe(2)
    
    const agentIds = owners.map(a => a.agentId)
    expect(new Set(agentIds).size).toBe(2)
    
    // Verificar que el sufijo hash de 8 chars está presente y el ID no supera 40 chars
    for (const id of agentIds) {
      expect(id).toMatch(/^e-.+-[a-f0-9]{8}$/) // Formato: e-{role-truncado}-{hash8}
      expect(id.length).toBeLessThanOrEqual(40)
      // Verificar que termina con hash de 8 chars
      expect(id.slice(-8)).toMatch(/^[a-f0-9]{8}$/)
    }
    
    // Verificar que los hashes son diferentes (diferentes cards)
    expect(agentIds[0]!.slice(-8)).not.toBe(agentIds[1]!.slice(-8))
  })
})
