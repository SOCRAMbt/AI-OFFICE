/**
 * Tests de regresión para los huecos encontrados en una corrida real (v3.1.3).
 *
 * 1. **Reviewer null para siempre.** El routing de savePlan corre con el
 *    roster vacío: deja reviewer=null. Sin `assignReviewers`, el review era
 *    estructuralmente imposible en TODAS las cards despachadas.
 * 2. **Peers sin protocolo de respuesta.** Un par libre spawneado sin la
 *    sección de triage del bus no contesta HELP_REQUEST: el pedido se muere
 *    en el canal aunque el bus funcione y el pool esté lleno.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { Office } from "../src/core/office.js"
import { buildAgentPrompt } from "../src/core/dispatch.js"

let tmp: string
let office: Office

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-protocol-fixes-"))
  await fs.writeFile(
    path.join(tmp, "package.json"),
    JSON.stringify({ name: "demo", scripts: { build: "true", lint: "true", test: "true", typecheck: "true" } }),
  )
  office = new Office({ cwd: tmp })
  await office.init()
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe("assignReviewers: el routing de reviewers corre cuando el roster ya existe", () => {
  it("asigna reviewer a cards con owner y reviewer=null", async () => {
    let state = await office.loadState("Objetivo de prueba")
    await office.savePlan(state, [
      { title: "T", type: "implementation", acceptance: ["a"], gate: "g" },
    ])

    // El plan corrió con el roster vacío: el routing deja owner y reviewer
    // en null. Esto es exactamente el estado que tenía la corrida real.
    expect(state.cards["T-00"]!.reviewer).toBeNull()

    // El dispatch materializa agentes y asigna owners (simulado acá).
    const { ficha: ownerFicha } = await office.resolveFicha({ role: "developer", capabilities: ["react"] })
    await office.deploy(ownerFicha)
    const { ficha: otroFicha } = await office.resolveFicha({ role: "code-architect", capabilities: ["architecture"] })
    await office.deploy(otroFicha)

    state = await office.loadState()
    state.cards["T-00"]!.owner = ownerFicha.id
    await office.saveState(state)

    // La segunda mitad del routing: con el roster completo, el reviewer
    // existe y es distinto del owner.
    const assigned = await office.assignReviewers(state)
    state = await office.loadState()

    expect(state.cards["T-00"]!.reviewer).not.toBeNull()
    expect(state.cards["T-00"]!.reviewer).not.toBe(ownerFicha.id)
    expect(assigned.some((a) => a.startsWith("T-00 →"))).toBe(true)
  })

  it("no toca cards que ya tienen reviewer", async () => {
    let state = await office.loadState("Objetivo")
    await office.savePlan(state, [
      { title: "T", type: "implementation", acceptance: ["a"], gate: "g" },
    ])

    const { ficha: ownerFicha } = await office.resolveFicha({ role: "developer", capabilities: ["react"] })
    await office.deploy(ownerFicha)
    const { ficha: revisorFicha } = await office.resolveFicha({ role: "code-architect", capabilities: ["architecture"] })
    await office.deploy(revisorFicha)

    state = await office.loadState()
    state.cards["T-00"]!.owner = ownerFicha.id
    state.cards["T-00"]!.reviewer = revisorFicha.id
    await office.saveState(state)

    const assigned = await office.assignReviewers(state)
    expect(assigned).toHaveLength(0)
  })

  it("con roster vacío no asigna nada ni falla", async () => {
    const state = await office.loadState("Objetivo")
    await office.savePlan(state, [
      { title: "T", type: "implementation", acceptance: ["a"], gate: "g" },
    ])
    const assigned = await office.assignReviewers(state)
    expect(assigned).toHaveLength(0)
  })
})

describe("buildAgentPrompt: los pares libres llevan protocolo de triage del bus", () => {
  it("el prompt de un par incluye la sección de responder HELP_REQUEST", async () => {
    const state = await office.loadState("Objetivo")
    await office.savePlan(state, [
      { title: "T", type: "implementation", acceptance: ["a"], gate: "g" },
    ])
    const { ficha } = await office.resolveFicha({ role: "developer", capabilities: ["react"] })
    const roster = await office.loadRoster(state.runId)
    const briefing = office.buildBriefing(ficha, state.cards["T-00"]!, roster)

    const peerPrompt = buildAgentPrompt(ficha, briefing, true)
    expect(peerPrompt.toLowerCase()).toContain("par libre")
    expect(peerPrompt).toContain("HELP_RESPOND")
    expect(peerPrompt).toContain("oficina_next")

    // El prompt de un owner NO lleva la sección: su trabajo es la card.
    const ownerPrompt = buildAgentPrompt(ficha, briefing)
    expect(ownerPrompt.toLowerCase()).not.toContain("par libre")
  })
})
