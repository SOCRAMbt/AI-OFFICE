import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { Office } from "../src/core/office.js"
import { buildTools, type OficinaTool } from "../src/tools/index.js"
import { DEFAULT_LIMITS } from "../src/core/types.js"
import v2Plugin from "../src/v2.js"

let tmp: string
let office: Office
let tools: Record<string, OficinaTool>

async function setupOffice() {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-phase1-"))
  await fs.writeFile(
    path.join(tmp, "package.json"),
    JSON.stringify({ name: "test-phase1", scripts: { test: "exit 0" } }),
  )
  office = new Office({ cwd: tmp, limits: DEFAULT_LIMITS })
  await office.init()
  tools = buildTools(office)
  return office
}

function makeCtx(sessionID: string, agent?: string) {
  return {
    directory: tmp,
    sessionID,
    agent,
    messageID: "msg-1",
  }
}

describe("Phase 1: OpenCode v1/v2 Plugin Adapters, Session Binding & Identity Contracts", () => {
  beforeEach(async () => {
    await setupOffice()
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it("1. v2 tool execution preserves Zod .default(...) values when input is empty or omitted", async () => {
    const editorTools = new Map<string, { description: string; input: unknown; execute: Function }>()
    const editor = {
      add: (def: { name: string; description: string; input: unknown; execute: Function }) => {
        editorTools.set(def.name, def)
      },
      update: () => {},
      remove: () => {},
      list: () => [],
      get: () => undefined,
      namespace: () => {},
    }

    const mockCtx = {
      app: { version: "2.1.2" },
      location: { directory: tmp, project: { id: "p", directory: tmp, canonical: tmp } },
      options: { dashboard: { enabled: false } },
      tool: {
        transform: async (cb: (e: unknown) => void) => {
          cb(editor)
          return { dispose: async () => {} }
        },
        reload: async () => {},
        hook: () => () => {},
      },
      permission: {
        hook: () => () => {},
      },
      session: {
        hook: () => () => {},
        create: async () => ({ id: "child-ses-1" }),
        prompt: async () => {},
      },
      event: {
        subscribe: () => (async function* () {})(),
      },
    }

    await v2Plugin.setup(mockCtx as never)

    expect(editorTools.has("oficina_board")).toBe(true)
    const boardTool = editorTools.get("oficina_board")!

    // Invocamos execute con {} (sin pasar campos que tienen .default())
    const res = await boardTool.execute({}, { sessionID: "ses-1", agent: "general", messageID: "m1" })
    expect(res).toBeDefined()
    expect(res.content).toBeDefined()

    // oficina_status con input {}
    const statusTool = editorTools.get("oficina_status")!
    const statusRes = await statusTool.execute({}, { sessionID: "ses-1", agent: "general", messageID: "m1" })
    expect(statusRes).toBeDefined()
  })

  it("2. validateAgentIdentity allows generic host agents, oficina- prefix, and legacy context", async () => {
    const state = await office.loadState("Test Identity")
    await office.savePlan(state, [
      {
        title: "Test Card",
        type: "implementation",
        scope: { mayTouch: ["src/**"], forbidden: [] },
        acceptance: ["funciona"],
        gate: "npm test",
      },
    ])

    const { ficha: devFicha } = await office.resolveFicha({ role: "developer", capabilities: ["react"] })
    await office.deploy(devFicha)

    // Legacy context (!ctx.agent) -> permitido
    const ctxNoAgent = makeCtx("ses-legacy", undefined)
    const resNoAgent = await tools.oficina_assign!.execute(
      { agentId: devFicha.id, cardId: "T-00" },
      ctxNoAgent,
    )
    expect(resNoAgent.title).not.toContain("Identidad inválida")

    // Generic host agent ("general") -> permitido
    const ctxGeneral = makeCtx("ses-gen", "general")
    const resGeneral = await tools.oficina_assign!.execute(
      { agentId: devFicha.id, cardId: "T-00" },
      ctxGeneral,
    )
    expect(resGeneral.title).not.toContain("Identidad inválida")

    // Materialized prefix ("oficina-frontend-developer") -> permitido
    const ctxOficina = makeCtx("ses-oficina", "oficina-frontend-developer")
    const resOficina = await tools.oficina_assign!.execute(
      { agentId: devFicha.id, cardId: "T-00" },
      ctxOficina,
    )
    expect(resOficina.title).not.toContain("Identidad inválida")
  })

  it("3. oficina_mesa claim and oficina_next CLAIM bind sessionID so submitWork succeeds", async () => {
    const state = await office.loadState("Test Mesa Claim")
    await office.savePlan(state, [
      {
        title: "Card Mesa",
        type: "implementation",
        scope: { mayTouch: ["src/**"], forbidden: [] },
        acceptance: ["ok"],
        gate: "npm test",
      },
      {
        title: "Card Next",
        type: "implementation",
        scope: { mayTouch: ["src/**"], forbidden: [] },
        acceptance: ["ok"],
        gate: "npm test",
      },
    ])

    const { ficha: devFicha } = await office.resolveFicha({ role: "developer", capabilities: ["react"] })
    await office.deploy(devFicha)

    // Reclamar vía oficina_mesa con sessionID
    const ctxMesa = makeCtx("ses-mesa-agent", devFicha.id)
    const mesaClaimRes = await tools.oficina_mesa!.execute(
      { action: "claim", agentId: devFicha.id, cardId: "T-00" },
      ctxMesa,
    )
    expect(mesaClaimRes.title).toContain("reclamada")

    // Verificar que la sesión quedó bindeada
    const stateAfterMesa = await office.loadState()
    expect(stateAfterMesa.sessions["ses-mesa-agent"]).toBeDefined()
    expect(stateAfterMesa.sessions["ses-mesa-agent"]?.agentId).toBe(devFicha.id)
    expect(stateAfterMesa.sessions["ses-mesa-agent"]?.cardId).toBe("T-00")

    // Entregar trabajo con esa sesión -> debe tener éxito
    const submitRes = await tools.oficina_submit!.execute(
      { agentId: devFicha.id, cardId: "T-00", handoff: "hizo x en src/app.js", evidence: "tests passed" },
      ctxMesa,
    )
    expect(submitRes.title).toContain("entregada")

    // Reclamar vía oficina_next con sessionID
    const ctxNext = makeCtx("ses-next-agent", devFicha.id)
    const nextClaimRes = await tools.oficina_next!.execute(
      { action: "CLAIM", agentId: devFicha.id, cardId: "T-01" },
      ctxNext,
    )
    expect(nextClaimRes.title).not.toContain("Identidad inválida")

    const stateAfterNext = await office.loadState()
    expect(stateAfterNext.sessions["ses-next-agent"]).toBeDefined()
    expect(stateAfterNext.sessions["ses-next-agent"]?.agentId).toBe(devFicha.id)
    expect(stateAfterNext.sessions["ses-next-agent"]?.cardId).toBe("T-01")
  })

  it("4. oficina_review succeeds with non-empty ctx.sessionID for assigned reviewer", async () => {
    const state = await office.loadState("Test Reviewer Session")
    await office.savePlan(state, [
      {
        title: "Card for Review",
        type: "implementation",
        scope: { mayTouch: ["src/**"], forbidden: [] },
        acceptance: ["ok"],
        gate: "npm test",
      },
    ])

    const { ficha: devFicha } = await office.resolveFicha({ role: "developer", capabilities: ["react"] })
    const { ficha: revFicha } = await office.resolveFicha({ role: "code-architect", capabilities: ["architecture"] })
    await office.deploy(devFicha)
    await office.deploy(revFicha)

    const state2 = await office.loadState()
    state2.cards["T-00"]!.owner = devFicha.id
    state2.cards["T-00"]!.reviewer = revFicha.id
    await office.saveState(state2)

    // Developer reclama y entrega
    await office.claimCard(state2, devFicha.id, "T-00", "ses-dev")
    await office.submitWork(state2, "T-00", devFicha.id, { handoff: "done", evidence: "ok" }, "ses-dev")

    // Reviewer tiene su propia sesión (por ej. bindeada a null o a otra card)
    const freshState = await office.loadState()
    office.bindSession(freshState, "ses-rev", revFicha.id, null)
    await office.saveState(freshState)

    // Reviewer ejecuta oficina_review desde su sesión
    const ctxRev = makeCtx("ses-rev", revFicha.id)
    const reviewRes = await tools.oficina_review!.execute(
      {
        agentId: revFicha.id,
        cardId: "T-00",
        verdict: "approved",
        reason: "código limpio",
        review: "# Ledger\n- src/app.js\nFindings: ninguno",
      },
      ctxRev,
    )
    expect(reviewRes.output).toContain("review APROBADO")
  })

  it("5. spawnAgent returns session id and binds session to agent and card lease", async () => {
    const plain = new Office({
      cwd: tmp,
      limits: DEFAULT_LIMITS,
      spawner: async ({ sessionID, agentName, prompt, description }) => {
        return "child-session-xyz"
      },
    })
    await plain.init()

    const state = await plain.loadState("Test Spawner Binding")
    await plain.savePlan(state, [
      {
        title: "Spawned Card",
        type: "implementation",
        scope: { mayTouch: ["src/**"], forbidden: [] },
        acceptance: ["ok"],
        gate: "npm test",
      },
    ])

    const res = await plain.spawnAgent(
      "parent-session",
      "oficina-react-developer",
      "prompt here",
      "T-00",
      { agentId: "e-dev-1", cardId: "T-00" },
    )

    expect(res).toBe("child-session-xyz")

    const updatedState = await plain.loadState()
    expect(updatedState.sessions["child-session-xyz"]).toBeDefined()
    expect(updatedState.sessions["child-session-xyz"]?.agentId).toBe("e-dev-1")
    expect(updatedState.sessions["child-session-xyz"]?.cardId).toBe("T-00")

    const lease = await plain.leases.get("T-00")
    expect(lease).toBeDefined()
    expect(lease?.agentId).toBe("e-dev-1")
  })
})
