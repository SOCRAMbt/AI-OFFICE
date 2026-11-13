/**
 * Circuit Breaker: anti-bucle para cards que fallan por lo mismo.
 *
 * Estos tests de regresión prueban la matriz completa: fingerprint,
 * acumulación de intentos y la transición terminal BLOCKED_ESCALATED, con
 * liberación del lease y artefacto de bloqueo.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { Office } from "../src/core/office.js"
import { fingerprint, recordFailure, MAX_CONSECUTIVE_IDENTICAL, MAX_TOTAL_FAILURES } from "../src/core/circuitBreaker.js"
import { selectNextCard } from "../src/core/state.js"
import { DEFAULT_LIMITS, type Card } from "../src/core/types.js"

let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-circuit-breaker-"))
  await fs.writeFile(
    path.join(tmp, "package.json"),
    JSON.stringify({ name: "demo", scripts: { build: "true", lint: "true", test: "true", typecheck: "true" } }),
  )
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe("fingerprint(): el mismo error distinto de path es el mismo fingerprint", () => {
  it("normaliza paths absolutas", () => {
    const a = fingerprint("ENOENT C:\\Users\\Marcos\\proyecto\\src\\app.ts line 12")
    const b = fingerprint("ENOENT C:\\Users\\OtraPersona\\proyecto\\src\\app.ts line 12")
    expect(a).toBe(b)
  })

  it("normaliza strings literales", () => {
    const a = fingerprint('expected "a" to equal "b"')
    const b = fingerprint('expected "c" to equal "d"')
    expect(a).toBe(b)
  })

  it("mantiene números distintos como fingerprints distintos (no son el mismo error)", () => {
    const a = fingerprint("fix 1")
    const b = fingerprint("fix 2")
    expect(a).not.toBe(b)
  })

  it("distintos errores producen fingerprints distintos", () => {
    expect(fingerprint("tests 3 failed")).not.toBe(fingerprint("cannot find module 'react'"))
  })
})

describe("recordFailure(): 3 idénticos consecutivos o 5 totales bloquean", () => {
  const fakeCard = (): Card => ({
    id: "T-00",
    title: "Card",
    type: "implementation",
    state: "in_progress",
    owner: "e-1",
    reviewer: "e-2",
    requiredCapabilities: [],
    scope: { mayTouch: ["**"], forbidden: [] },
    acceptance: ["a"],
    gate: "npm test",
    dependsOn: [],
    attempts: 0,
    rejections: 0,
    artifacts: ".oficina/artifacts/T-00",
    result: null,
    helpRequests: [],
    helpHops: 0,
  })

  it("no bloquea al primer ni segundo fallo idéntico", () => {
    let card = fakeCard()
    let verdict
    for (let i = 0; i < MAX_CONSECUTIVE_IDENTICAL - 1; i++) {
      const r = recordFailure(card, "tests 3 failed")
      card = r.card
      verdict = r.verdict
    }
    expect(verdict!.blocked).toBe(false)
    expect(verdict!.consecutive).toBe(2)
  })

  it("bloquea al tercer fallo idéntico consecutivo", () => {
    let card = fakeCard()
    let verdict
    for (let i = 0; i < MAX_CONSECUTIVE_IDENTICAL; i++) {
      const r = recordFailure(card, "tests 3 failed")
      card = r.card
      verdict = r.verdict
    }
    expect(verdict!.blocked).toBe(true)
    expect(verdict!.consecutive).toBe(3)
  })

  it("bloquea al acumular 5 fallos aunque sean distintos", () => {
    let card = fakeCard()
    let verdict
    const errores = ["a", "b", "c", "d", "e"]
    for (const e of errores) {
      const r = recordFailure(card, e)
      card = r.card
      verdict = r.verdict
    }
    expect(verdict!.blocked).toBe(true)
    expect(verdict!.total).toBe(MAX_TOTAL_FAILURES)
  })
})

describe("Circuit breaker integrado: la card cae a BLOCKED_ESCALATED con lease liberado", () => {
  async function setupRun() {
    const office = new Office({ cwd: tmp, limits: DEFAULT_LIMITS })
    await office.init()
    let state = await office.loadState("Test circuit breaker")
    await office.savePlan(state, [
      { title: "T", type: "implementation", acceptance: ["a"], gate: "npm test" },
      { title: "U", type: "implementation", acceptance: ["b"], gate: "npm test" },
    ])
    const { ficha: ownerFicha } = await office.resolveFicha({ role: "developer", capabilities: ["react"] })
    await office.deploy(ownerFicha)
    const { ficha: reviewerFicha } = await office.resolveFicha({ role: "code-architect", capabilities: ["architecture"] })
    await office.deploy(reviewerFicha)
    state = await office.loadState()
    state.cards["T-00"]!.owner = ownerFicha.id
    state.cards["T-00"]!.reviewer = reviewerFicha.id
    state.cards["T-01"]!.owner = ownerFicha.id
    state.cards["T-01"]!.reviewer = reviewerFicha.id
    await office.saveState(state)
    return { office, state, ownerId: ownerFicha.id, reviewerId: reviewerFicha.id }
  }

  it("3 rechazos idénticos seguidos → blocked_escalated, lease liberado, artefacto escrito", async () => {
    const { office, ownerId, reviewerId } = await setupRun()
    let state = await office.loadState()

    // El mismo motivo 3 veces: el fingerprint no cambia aunque el reviewer
    // reformule con números distintos (los números se normalizan).
    for (let i = 0; i < 3; i++) {
      await office.claimCard(state, ownerId, "T-00")
      state = await office.loadState()
      await office.submitWork(state, "T-00", ownerId, { handoff: "# H", evidence: "# E" })
      state = await office.loadState()
      const r = await office.submitReview(state, "T-00", reviewerId, "rejected", {
        review: "un test falla",
        reason: "test 3 failed",
      })
      state = await office.loadState()
      if (i === 0) expect(r.action).toBe("rework")
      else if (i === 1) expect(r.action).toBe("replan")
      else expect(r.action).toBe("blocked_escalated")
    }

    state = await office.loadState()
    expect(state.cards["T-00"]!.state).toBe("blocked_escalated")
    // Lease liberado: la card bloqueada no retiene la exclusividad.
    const lease = await office.leases.get("T-00")
    expect(lease).toBeUndefined()
    // Artefacto de bloqueo escrito.
    const blocked = await fs.readFile(path.join(tmp, ".oficina", "artifacts", "T-00", "blocked.md"), "utf8")
    expect(blocked).toContain("BLOCKED_ESCALATED")
    expect(blocked).toContain("3 fallos idénticos")
  })

  it("el DAG sigue: selectNextCard no elige la bloqueada pero sí la otra", async () => {
    const { office, ownerId, reviewerId } = await setupRun()
    let state = await office.loadState()

    for (let i = 0; i < 3; i++) {
      await office.claimCard(state, ownerId, "T-00")
      state = await office.loadState()
      await office.submitWork(state, "T-00", ownerId, { handoff: "# H", evidence: "# E" })
      state = await office.loadState()
      await office.submitReview(state, "T-00", reviewerId, "rejected", {
        review: "x",
        reason: "test 3 failed",
      })
      state = await office.loadState()
    }

    const next = selectNextCard(state)
    expect(next.card?.id).toBe("T-01")
  })
})
