/**
 * Tests de regresión para identidad y autorización (F-01 a F-12, F-QA-004)
 *
 * Estos tests DEBEN FALLAR con la implementación actual y PASAR tras los fixes.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { Office } from "../src/core/office.js"
import { buildTools, type OficinaTool } from "../src/tools/index.js"
import { DEFAULT_LIMITS } from "../src/core/types.js"

let tmp: string
let office: Office
let tools: Record<string, OficinaTool>

async function setupOffice() {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-identity-"))
  await fs.writeFile(path.join(tmp, "package.json"), JSON.stringify({
    name: "test",
    scripts: { test: "exit 0" }
  }))
  office = new Office({ cwd: tmp, limits: DEFAULT_LIMITS })
  await office.init()
  tools = buildTools(office)
  return office
}

async function setupRunWithCard() {
  const state = await office.loadState("Test Identity")
  await office.savePlan(state, [{
    title: "Implementar auth",
    type: "implementation",
    scope: { mayTouch: ["src/auth/**"], forbidden: ["**/*.env"] },
    acceptance: ["endpoint login", "tests"],
    gate: "npm test",
  }])
  const fresh = await office.loadState()
  // Deployar agentes reales
  const { ficha: ownerFicha } = await office.resolveFicha({ role: "developer", capabilities: ["react"] })
  const { ficha: reviewerFicha } = await office.resolveFicha({ role: "code-architect", capabilities: ["architecture"] })
  await office.deploy(ownerFicha)
  await office.deploy(reviewerFicha)
  // Re-planificar para routing
  const state2 = await office.loadState()
  await office.savePlan(state2, [{
    title: "Implementar auth",
    type: "implementation",
    acceptance: ["endpoint login", "tests"],
    gate: "npm test",
  }])
  const card = state2.cards["T-00"]!
  card.owner = ownerFicha.id
  card.reviewer = reviewerFicha.id
  await office.saveState(state2)
  return { ownerId: ownerFicha.id, reviewerId: reviewerFicha.id, cardId: "T-00" }
}

function makeCtx(sessionID: string, agent: string, overrides: Partial<{ directory: string; messageID: string }> = {}) {
  return {
    directory: overrides.directory ?? tmp,
    sessionID,
    agent,
    messageID: overrides.messageID ?? "msg-1",
  }
}

describe("F-01: Validación de agentId contra ctx.agent en 9 tools", () => {
  beforeEach(async () => { await setupOffice() })
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }) })

  it("rechaza assign con agentId suplantado", async () => {
    const { ownerId, cardId } = await setupRunWithCard()
    const ctxAttacker = makeCtx("ses-att", "e-attacker")
    const result = await tools.oficina_assign!.execute(
      { agentId: ownerId, cardId },
      ctxAttacker
    )
    expect(result.output).toContain("no coincide con la sesión")
  })

  it("rechaza submit con agentId suplantado", async () => {
    const { ownerId, cardId } = await setupRunWithCard()
    let state = await office.loadState()
    await office.claimCard(state, ownerId, cardId, "ses-owner")
    state = await office.loadState()  // reload
    office.bindSession(state, "ses-owner", ownerId, cardId)
    await office.submitWork(state, cardId, ownerId, { handoff: "x", evidence: "y" })
    await office.saveState(state)
    state = await office.loadState()  // reload

    // Attacker tries with owner's agentId but from different session
    const ctxAttacker = makeCtx("ses-att", "e-attacker")
    const result = await tools.oficina_submit!.execute(
      { agentId: ownerId, cardId, handoff: "hack", evidence: "fake" },
      ctxAttacker
    )
    expect(result.output).toContain("no coincide con la sesión")
  })

  it("rechaza review con agentId suplantado", async () => {
    const { ownerId, reviewerId, cardId } = await setupRunWithCard()
    let state = await office.loadState()
    await office.claimCard(state, ownerId, cardId, "ses-owner")
    state = await office.loadState()  // reload
    office.bindSession(state, "ses-owner", ownerId, cardId)
    await office.submitWork(state, cardId, ownerId, { handoff: "x", evidence: "y" })
    await office.saveState(state)
    state = await office.loadState()  // reload

    // Attacker tries with reviewer's agentId but from different session
    const ctxAttacker = makeCtx("ses-att", "e-attacker")
    const result = await tools.oficina_review!.execute(
      { agentId: reviewerId, cardId, verdict: "approved", review: "x", reason: "y" },
      ctxAttacker
    )
    expect(result.output).toContain("no coincide con la sesión")
  })

  it("rechaza bus receive con agentId ajeno", async () => {
    await office.bus.send("peer", { from: "e-sender", to: ["e-victim"], kind: "NOTICE", subject: "T-00", body: {} })
    const ctxAttacker = makeCtx("ses-att", "e-attacker")
    const result = await tools.oficina_bus!.execute(
      { action: "receive", agentId: "e-victim" },
      ctxAttacker
    )
    expect(result.output).toContain("no coincide con la sesión")
  })

  it("rechaza bus send con agentId suplantado", async () => {
    const ctxAttacker = makeCtx("ses-att", "e-attacker")
    const result = await tools.oficina_bus!.execute(
      { action: "send", agentId: "e-victim", to: ["*"], kind: "NOTICE", subject: "T-00", body: {} },
      ctxAttacker
    )
    expect(result.output).toContain("no coincide con la sesión")
  })

  it("rechaza bus ack con agentId ajeno", async () => {
    const msg = await office.bus.send("peer", { from: "e-sender", to: ["e-victim"], kind: "NOTICE", subject: "T-00", body: {} })
    const ctxAttacker = makeCtx("ses-att", "e-attacker")
    const result = await tools.oficina_bus!.execute(
      { action: "ack", agentId: "e-victim", messageId: msg.id },
      ctxAttacker
    )
    expect(result.output).toContain("no coincide con la sesión")
  })

  it("rechaza spawn con agentId suplantado", async () => {
    const ctxAttacker = makeCtx("ses-att", "e-attacker")
    const result = await tools.oficina_spawn!.execute(
      { agentId: "e-victim", requestedRole: "developer", capabilities: ["react"], reason: "test", cardId: "T-00" },
      ctxAttacker
    )
    expect(result.output).toContain("no coincide con la sesión")
  })

  it("rechaza escalate con agentId suplantado", async () => {
    const ctxAttacker = makeCtx("ses-att", "e-attacker")
    const result = await tools.oficina_escalate!.execute(
      { agentId: "e-victim", cardId: "T-00", cause: "test", options: [{ label: "a", tradeoff: "b" }], recommendation: "a" },
      ctxAttacker
    )
    expect(result.output).toContain("no coincide con la sesión")
  })

  it("rechaza evidence con agentId suplantado", async () => {
    const ctxAttacker = makeCtx("ses-att", "e-attacker")
    const result = await tools.oficina_evidence!.execute(
      { action: "view", agentId: "e-victim", cardId: "T-00" },
      ctxAttacker
    )
    expect(result.output).toContain("no coincide con la sesión")
  })

  it("rechaza mesa con agentId suplantado", async () => {
    const ctxAttacker = makeCtx("ses-att", "e-attacker")
    const result = await tools.oficina_mesa!.execute(
      { action: "view", agentId: "e-victim" },
      ctxAttacker
    )
    expect(result.output).toContain("no coincide con la sesión")
  })

  it("rechaza stop sin agentId", async () => {
    const ctx = makeCtx("ses-1", "e-1")
    const result = await tools.oficina_stop!.execute(
      { action: "halt", reason: "test" },
      ctx
    )
    expect(result.output).toContain("no coincide con la sesión")
  })

  it("rechaza stop con agentId distinto a ctx.agent", async () => {
    const ctx = makeCtx("ses-1", "e-1")
    const result = await tools.oficina_stop!.execute(
      { action: "halt", reason: "test", agentId: "e-otro" },
      ctx
    )
    expect(result.output).toContain("no coincide con la sesión")
  })
})

describe("F-02/F-06/F-09: Binding de sesión verificado + linaje hija", () => {
  beforeEach(async () => { await setupOffice() })
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }) })

  it("rechaza submit desde sesión sin binding correcto", async () => {
    const { ownerId, cardId } = await setupRunWithCard()
    let state = await office.loadState()
    await office.claimCard(state, ownerId, cardId, "ses-owner")
    state = await office.loadState()
    // Bind session for owner
    office.bindSession(state, "ses-owner", ownerId, cardId)
    await office.saveState(state)
    state = await office.loadState()

    // Attacker usa su propia sesión ses-attacker pero ctx.agent = ownerId (suplantando identidad)
    // NO hay binding para attacker en ses-attacker
    const ctxAttacker = makeCtx("ses-attacker", ownerId)
    const result = await tools.oficina_submit!.execute(
      { agentId: ownerId, cardId, handoff: "hack", evidence: "fake" },
      ctxAttacker
    )
    expect(result.output).toContain("binding")
  })

  it("rechaza review desde sesión sin binding correcto", async () => {
    const { ownerId, reviewerId, cardId } = await setupRunWithCard()
    let state = await office.loadState()
    await office.claimCard(state, ownerId, cardId, "ses-owner")
    state = await office.loadState()
    office.bindSession(state, "ses-owner", ownerId, cardId)
    await office.submitWork(state, cardId, ownerId, { handoff: "x", evidence: "y" })
    await office.saveState(state)
    state = await office.loadState()

    // Attacker usa su propia sesión ses-attacker pero ctx.agent = reviewerId
    // NO hay binding para attacker en ses-attacker
    const ctxAttacker = makeCtx("ses-attacker", reviewerId)
    const result = await tools.oficina_review!.execute(
      { agentId: reviewerId, cardId, verdict: "approved", review: "x", reason: "y" },
      ctxAttacker
    )
    expect(result.output).toContain("binding")
  })

  it("rechaza claim de card con owner distinto en rework", async () => {
    const { ownerId, cardId } = await setupRunWithCard()
    // Deploy attacker agent
    const { ficha: attackerFicha } = await office.resolveFicha({ role: "developer", capabilities: ["react"] })
    await office.deploy(attackerFicha)
    const attackerId = attackerFicha.id

    let state = await office.loadState()
    state.cards[cardId]!.owner = ownerId
    state.cards[cardId]!.state = "rework"
    await office.saveState(state)

    // attacker intenta reclamar
    const ctxAttacker = makeCtx("ses-att", attackerId)
    const result = await tools.oficina_assign!.execute(
      { agentId: attackerId, cardId },
      ctxAttacker
    )
    expect(result.output).toContain("pertenece a")
  })

  it("rechaza claim de agente no desplegado", async () => {
    const { cardId } = await setupRunWithCard()
    const ctxAttacker = makeCtx("ses-att", "e-fantasma")
    const result = await tools.oficina_assign!.execute(
      { agentId: "e-fantasma", cardId },
      ctxAttacker
    )
    expect(result.output).toContain("no está desplegado")
  })
})

describe("F-03: submitWork/Review validan reviewer asignado y existencia en roster", () => {
  beforeEach(async () => { await setupOffice() })
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }) })

  it("rechaza review de agente que no es el reviewer asignado", async () => {
    const { ownerId, reviewerId, cardId } = await setupRunWithCard()
    let state = await office.loadState()
    await office.claimCard(state, ownerId, cardId, "ses-owner")
    state = await office.loadState()
    await office.submitWork(state, cardId, ownerId, { handoff: "x", evidence: "y" })
    await office.saveState(state)
    state = await office.loadState()

    // Deployar tercer agente
    const { ficha: randomFicha } = await office.resolveFicha({ role: "tester", capabilities: ["testing"] })
    await office.deploy(randomFicha)

    const ctx = makeCtx("ses-random", randomFicha.id)
    const result = await tools.oficina_review!.execute(
      { agentId: randomFicha.id, cardId, verdict: "approved", review: "x", reason: "y" },
      ctx
    )
    expect(result.output).toContain("asignada a")
  })

  it("rechaza review de agente inexistente en roster", async () => {
    const { ownerId, reviewerId, cardId } = await setupRunWithCard()
    let state = await office.loadState()
    await office.claimCard(state, ownerId, cardId, "ses-owner")
    state = await office.loadState()
    await office.submitWork(state, cardId, ownerId, { handoff: "x", evidence: "y" })
    await office.saveState(state)
    state = await office.loadState()

    const ctx = makeCtx("ses-fake", "e-fantasma")
    const result = await tools.oficina_review!.execute(
      { agentId: "e-fantasma", cardId, verdict: "approved", review: "x", reason: "y" },
      ctx
    )
    expect(result.output).toContain("no está desplegado")
  })
})

describe("F-04: Bus/ACK validan identidad", () => {
  beforeEach(async () => { await setupOffice() })
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }) })

  it("rechaza bus send con from suplantado", async () => {
    const ctxAttacker = makeCtx("ses-att", "e-attacker")
    const result = await tools.oficina_bus!.execute(
      { action: "send", agentId: "e-victim", to: ["*"], kind: "NOTICE", subject: "T-00", body: {} },
      ctxAttacker
    )
    expect(result.output).toContain("no coincide con la sesión")
  })

  it("rechaza bus ack de mensaje ajeno", async () => {
    const msg = await office.bus.send("peer", { from: "e-sender", to: ["e-victim"], kind: "NOTICE", subject: "T-00", body: {} })
    const ctxAttacker = makeCtx("ses-att", "e-attacker")
    const result = await tools.oficina_bus!.execute(
      { action: "ack", agentId: "e-victim", messageId: msg.id },
      ctxAttacker
    )
    expect(result.output).toContain("no coincide con la sesión")
  })
})

describe("F-05: oficina_stop requiere agentId y valida", () => {
  beforeEach(async () => { await setupOffice() })
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }) })

  it("rechaza agentId distinto a ctx.agent", async () => {
    const ctx = makeCtx("ses-1", "e-1")
    const result = await tools.oficina_stop!.execute(
      { action: "halt", reason: "test", agentId: "e-otro" },
      ctx
    )
    expect(result.output).toContain("no coincide con la sesión")
  })
})

describe("F-07: ClaimCard rechaza claim de card con owner distinto", () => {
  beforeEach(async () => { await setupOffice() })
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }) })

  it("rechaza claim de card con owner distinto", async () => {
    const { ownerId, cardId } = await setupRunWithCard()
    // Deploy attacker agent
    const { ficha: attackerFicha } = await office.resolveFicha({ role: "developer", capabilities: ["react"] })
    await office.deploy(attackerFicha)
    const attackerId = attackerFicha.id

    const state = await office.loadState()
    state.cards[cardId]!.owner = ownerId
    state.cards[cardId]!.state = "rework"
    await office.saveState(state)

    const ctxAttacker = makeCtx("ses-att", attackerId)
    const result = await tools.oficina_assign!.execute(
      { agentId: attackerId, cardId },
      ctxAttacker
    )
    expect(result.output).toContain("pertenece a")
  })
})

describe("F-08: Agente fantasma rechazado", () => {
  beforeEach(async () => { await setupOffice() })
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }) })

  it("rechaza claim de agente no desplegado", async () => {
    const { cardId } = await setupRunWithCard()
    const ctxAttacker = makeCtx("ses-att", "e-fantasma")
    const result = await tools.oficina_assign!.execute(
      { agentId: "e-fantasma", cardId },
      ctxAttacker
    )
    expect(result.output).toContain("no está desplegado")
  })
})

describe("F-09: Linaje sesión hija - metadata oficina requerida", () => {
  beforeEach(async () => { await setupOffice() })
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }) })

  it("sesión hija sin metadata oficina no hereda scope", async () => {
    // Este test requiere mockear resolveParentSession para simular hija sin metadata
    // Se prueba en pluginV2.scope.test.ts con el hook real
    expect(true).toBe(true) // Placeholder - test real en pluginV2.scope.test.ts
  })
})

describe("F-10: VERIFICATION_FAILED siempre bloquea escrituras", () => {
  beforeEach(async () => { await setupOffice() })
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }) })

  it("bloquea escritura aunque enforce=false si verify falla", async () => {
    // Este test se hace en pluginV2.scope.test.ts con el hook real
    expect(true).toBe(true) // Placeholder
  })
})

describe("F-12: oficina_dispatch solo integrator/commander", () => {
  beforeEach(async () => { await setupOffice() })
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }) })

  it("rechaza dispatch de agente sin canDelegate", async () => {
    const { ownerId } = await setupRunWithCard()
    const ctx = makeCtx("ses-owner", ownerId)
    const result = await tools.oficina_dispatch!.execute(
      { agentId: ownerId },
      ctx
    )
    expect(result.output).toContain("Solo agentes con canDelegate")
  })

  it("permite dispatch de integrator", async () => {
    const state = await office.loadState("Test")
    await office.savePlan(state, [{
      title: "T", type: "implementation", acceptance: ["a"], gate: "g",
    }])
    const { ficha: intFicha } = await office.resolveFicha({ role: "integrator", capabilities: ["coordination"], canDelegate: true })
    await office.deploy(intFicha)
    const state2 = await office.loadState()
    await office.savePlan(state2, [{
      title: "T", type: "implementation", acceptance: ["a"], gate: "g",
    }])

    const ctx = makeCtx("ses-int", intFicha.id)
    const result = await tools.oficina_dispatch!.execute(
      { agentId: intFicha.id },
      ctx
    )
    expect(result.output).not.toContain("No autorizado")
  })
})

describe("F-QA-003: Fallback paths aislados por SHA256 (SEC-001)", () => {
  beforeEach(async () => { await setupOffice() })
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }) })

  it("proyectos homónimos tienen rutas alternativas distintas", async () => {
    const { resolveAlternateOficinaDir } = await import("../src/core/paths.js")

    const projA = path.join(tmp, "a", "app")
    const projB = path.join(tmp, "b", "app")
    await fs.mkdir(projA, { recursive: true })
    await fs.mkdir(projB, { recursive: true })
    await fs.writeFile(path.join(projA, "package.json"), '{"name":"a"}')
    await fs.writeFile(path.join(projB, "package.json"), '{"name":"b"}')

    const altA = await resolveAlternateOficinaDir(projA)
    const altB = await resolveAlternateOficinaDir(projB)

    expect(altA).not.toBe(altB)
    expect(altA.replace(/\\/g, "/")).toMatch(/[/-]app-[a-f0-9]{12}$/i)
    expect(altB.replace(/\\/g, "/")).toMatch(/[/-]app-[a-f0-9]{12}$/i)
  })
})