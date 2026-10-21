import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { Office } from "../src/core/office.js"
import { DEFAULT_LIMITS, type OfficeState } from "../src/core/types.js"
import type { CommandRunner } from "../src/core/gates.js"

let tmp: string
let clock: number

/** Runner que pasa todo, para enfocar el test en el flujo de la oficina. */
const passingRunner: CommandRunner = async () => ({ code: 0, stdout: "# tests 3\n# pass 3", stderr: "" })

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-office-"))
  clock = 1_700_000_000_000
  // Proyecto mínimo: package.json con scripts.
  await fs.writeFile(
    path.join(tmp, "package.json"),
    JSON.stringify({ name: "demo", scripts: { build: "true", lint: "true", test: "true", typecheck: "true" } }),
  )
  await fs.mkdir(path.join(tmp, "src"), { recursive: true })
  await fs.writeFile(path.join(tmp, "src", "app.js"), "export const x = 1\n")
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

async function makeOffice(runner: CommandRunner = passingRunner) {
  const office = new Office({
    cwd: tmp,
    limits: DEFAULT_LIMITS,
    runner,
    clock: () => clock,
  })
  await office.init()
  return office
}

describe("Ciclo completo de la oficina", () => {
  it("resuelve la office dir dentro del proyecto", async () => {
    const office = await makeOffice()
    expect(office.paths.officeDir).toBe(path.join(tmp, ".oficina"))
    expect(office.paths.fallback).toBe(false)
    expect(await fs.stat(path.join(tmp, ".oficina", "bus"))).toBeTruthy()
  })

  it("guarda el plan, rutea owner y reviewer, y no se auto-aprueba", async () => {
    const office = await makeOffice()
    const state = await office.loadState("Implementar login")

    await office.savePlan(state, [
      {
        title: "Explorar el módulo de auth",
        type: "exploration",
        acceptance: ["mapa con file:line"],
        gate: "handoff con entry points",
      },
      {
        title: "Implementar login",
        type: "implementation",
        requiredCapabilities: ["react"],
        scope: { mayTouch: ["src/auth/**"], forbidden: ["src/server/**"] },
        acceptance: ["endpoint de login", "tests"],
        gate: "npm test en verde",
        dependsOn: ["T-00"],
      },
    ])

    expect(state.order).toEqual(["T-00", "T-01"])
    expect(state.budget.cardsUsed).toBe(2)
    expect(state.status).toBe("running")

    const card = state.cards["T-00"]!
    expect(card.state).toBe("todo")
    expect(card.scope.mayTouch).toEqual(["**"])
  })

  it("el ciclo completo lleva una card de todo a done", async () => {
    const office = await makeOffice()
    const state = await office.loadState("Implementar login")

    await office.savePlan(state, [
      {
        title: "Implementar login",
        type: "implementation",
        scope: { mayTouch: ["src/**"], forbidden: ["**/*.env"] },
        acceptance: ["endpoint de login"],
        gate: "npm test en verde",
      },
    ])

    // Desplegar dos agentes.
    const { ficha: ownerFicha } = await office.resolveFicha({ role: "developer", capabilities: ["react"] })
    const { ficha: reviewerFicha } = await office.resolveFicha({ role: "code-architect", capabilities: ["architecture"] })
    await office.deploy(ownerFicha)
    await office.deploy(reviewerFicha)

    // Re-planificar para que el routing vea el roster.
    const state2 = await office.loadState("Implementar login")
    await office.savePlan(state2, [
      {
        title: "Implementar login",
        type: "implementation",
        acceptance: ["endpoint de login"],
        gate: "npm test en verde",
      },
    ])
    const card = state2.cards["T-00"]!
    card.owner = ownerFicha.id
    card.reviewer = reviewerFicha.id
    await office.saveState(state2)

    // 1. Reclamar.
    const claimed = await office.claimNext(state2, ownerFicha.id)
    expect(claimed.card?.id).toBe("T-00")
    expect(state2.cards["T-00"]!.state).toBe("in_progress")

    // 2. Entregar trabajo.
    const submitted = await office.submitWork(state2, "T-00", ownerFicha.id, {
      handoff: "# Handoff\n\nImplementé el endpoint en `src/auth/login.ts`.",
      evidence: "# Evidencia\n\n```\n$ npm test\n# pass 3\n```",
    })
    expect(submitted.ok).toBe(true)
    expect(state2.cards["T-00"]!.state).toBe("review")

    // 3. Revisar.
    const reviewed = await office.submitReview(state2, "T-00", reviewerFicha.id, "approved", {
      review: "# Review\n\nLedger completo. Sin findings.",
      reason: "el código cumple los criterios",
    })
    expect(reviewed.ok).toBe(true)
    expect(reviewed.action).toBe("run_gates")

    // 4. Gates.
    const gates = await office.runGates(state2, "T-00")
    expect(gates.passed).toBe(true)

    // 5. Cerrar.
    const closed = await office.closeCard(state2, "T-00", gates)
    expect(closed.ok).toBe(true)
    expect(state2.cards["T-00"]!.state).toBe("done")
  })

  it("NO cierra una card sin gates en PASS", async () => {
    const office = await makeOffice()
    const state = await office.loadState("Test")
    await office.savePlan(state, [
      { title: "T", type: "implementation", acceptance: ["a"], gate: "g" },
    ])
    const card = state.cards["T-00"]!
    card.owner = "e-a"
    card.reviewer = "e-b"
    await office.saveState(state)

    const failingGates = {
      cardId: "T-00",
      technical: [
        { phase: "build" as const, command: "npm run build", outcome: "fail" as const, exitCode: 1, output: "boom", detail: "exit 1" },
      ],
      security: [],
      technicalOutcome: "fail" as const,
      securityOutcome: "na" as const,
      passed: false,
      ranAt: new Date().toISOString(),
    }

    const closed = await office.closeCard(state, "T-00", failingGates)
    expect(closed.ok).toBe(false)
    expect(state.cards["T-00"]!.state).not.toBe("done")
  })

  it("rechaza que el owner sea su propio revisor", async () => {
    const office = await makeOffice()
    const state = await office.loadState("Test")
    await office.savePlan(state, [
      { title: "T", type: "implementation", acceptance: ["a"], gate: "g" },
    ])
    state.cards["T-00"]!.owner = "e-same"
    state.cards["T-00"]!.reviewer = "e-same"
    await office.saveState(state)

    const reviewed = await office.submitReview(state, "T-00", "e-same", "approved", {
      review: "x",
      reason: "y",
    })
    expect(reviewed.ok).toBe(false)
    expect(reviewed.reason).toContain("no puede ser el owner")
  })

  it("un rechazo cambia la card a rework y cuenta el contador", async () => {
    const office = await makeOffice()
    const state = await office.loadState("Test")
    await office.savePlan(state, [
      { title: "T", type: "implementation", acceptance: ["a"], gate: "g" },
    ])
    state.cards["T-00"]!.owner = "e-a"
    state.cards["T-00"]!.reviewer = "e-b"
    await office.saveState(state)

    // Flujo realista: reclamar → entregar → rechazar.
    await office.claimCard(state, "e-a", "T-00")
    await office.submitWork(state, "T-00", "e-a", { handoff: "# H", evidence: "# E" })

    const reviewed = await office.submitReview(state, "T-00", "e-b", "rejected", {
      review: "finding: falta validación",
      reason: "falta validación de input",
    })
    expect(reviewed.action).toBe("rework")
    expect(state.cards["T-00"]!.state).toBe("rework")
    expect(state.cards["T-00"]!.rejections).toBe(1)
  })

  it("tres rechazos escalan", async () => {
    const office = await makeOffice()
    const state = await office.loadState("Test")
    await office.savePlan(state, [
      { title: "T", type: "implementation", acceptance: ["a"], gate: "g" },
    ])
    state.cards["T-00"]!.owner = "e-a"
    state.cards["T-00"]!.reviewer = "e-b"
    await office.saveState(state)

    let action = ""
    for (let i = 0; i < 3; i++) {
      // Reclamar y entregar de nuevo en cada intento.
      await office.claimCard(state, "e-a", "T-00")
      await office.submitWork(state, "T-00", "e-a", { handoff: "# H", evidence: "# E" })
      const r = await office.submitReview(state, "T-00", "e-b", "rejected", {
        review: "finding",
        reason: `falla ${i}`,
      })
      action = r.action
    }
    expect(action).toBe("escalate")
    expect(state.cards["T-00"]!.rejections).toBe(3)
  })

  it("el doble claim de una card se rechaza", async () => {
    const office = await makeOffice()
    const state = await office.loadState("Test")
    await office.savePlan(state, [
      { title: "T", type: "implementation", acceptance: ["a"], gate: "g" },
    ])
    await office.saveState(state)

    const first = await office.claimCard(state, "e-a", "T-00")
    expect(first.ok).toBe(true)

    const second = await office.claimCard(state, "e-b", "T-00")
    expect(second.ok).toBe(false)
    expect(second.reason).toContain("tomada")
  })

  it("el gate falla si un comando falla de verdad", async () => {
    const failingRunner: CommandRunner = async (command, args) => {
      if (args.includes("lint")) return { code: 1, stdout: "", stderr: "2 errores" }
      return { code: 0, stdout: "# tests 3\n# pass 3", stderr: "" }
    }
    const office = await makeOffice(failingRunner)
    const state = await office.loadState("Test")
    await office.savePlan(state, [
      { title: "T", type: "implementation", acceptance: ["a"], gate: "g" },
    ])

    const gates = await office.runGates(state, "T-00")
    expect(gates.passed).toBe(false)
    expect(gates.technicalOutcome).toBe("fail")
    const lint = gates.technical.find((r) => r.phase === "lint")!
    expect(lint.output).toContain("2 errores")
  })

  it("escribe los artefactos en disco", async () => {
    const office = await makeOffice()
    const state = await office.loadState("Test")
    await office.savePlan(state, [
      { title: "T", type: "implementation", acceptance: ["a"], gate: "g" },
    ])
    state.cards["T-00"]!.owner = "e-a"
    state.cards["T-00"]!.reviewer = "e-b"
    await office.saveState(state)

    await office.claimCard(state, "e-a", "T-00")
    await office.submitWork(state, "T-00", "e-a", { handoff: "# H", evidence: "# E" })
    await office.submitReview(state, "T-00", "e-b", "approved", { review: "# R", reason: "ok" })
    await office.runGates(state, "T-00")

    const dir = path.join(tmp, ".oficina", "artifacts", "T-00")
    const files = await fs.readdir(dir)
    expect(files).toContain("handoff.md")
    expect(files).toContain("evidence.md")
    expect(files).toContain("review.md")
    expect(files).toContain("gates.md")
  })

  it("el estado persiste y se puede retomar", async () => {
    const office = await makeOffice()
    const state = await office.loadState("Objetivo persistente")
    await office.savePlan(state, [
      { title: "T", type: "implementation", acceptance: ["a"], gate: "g" },
    ])

    const reloaded = await office.loadState()
    expect(reloaded.objective).toBe("Objetivo persistente")
    expect(reloaded.order).toEqual(["T-00"])
  })

  it("la escalación registra opciones y recomendación", async () => {
    const office = await makeOffice()
    const state = await office.loadState("Test")
    await office.savePlan(state, [
      { title: "T", type: "implementation", acceptance: ["a"], gate: "g" },
    ])
    await office.saveState(state)

    const state2 = await office.loadState()
    state2.escalations.push({
      id: "esc-1",
      cardId: "T-00",
      at: new Date().toISOString(),
      cause: "falta una credencial externa",
      attempts: [],
      options: [
        { id: "o1", label: "usar mock", tradeoff: "no prueba la integración real" },
        { id: "o2", label: "esperar la credencial", tradeoff: "bloquea la corrida" },
      ],
      recommendation: "usar mock y anotar la deuda",
      status: "open",
    })
    await office.saveState(state2)

    const reloaded = await office.loadState()
    expect(reloaded.escalations).toHaveLength(1)
    expect(reloaded.escalations[0]!.options).toHaveLength(2)
  })
})
