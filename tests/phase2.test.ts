import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { Office } from "../src/core/office.js"
import { DEFAULT_LIMITS, type OfficeState } from "../src/core/types.js"
import { reconcile } from "../src/core/recovery.js"
import type { CommandRunner } from "../src/core/gates.js"

let tmp: string
let clock: number

const passingRunner: CommandRunner = async () => ({
  code: 0,
  stdout: "# tests 3\n# pass 3",
  stderr: "",
})

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-phase2-"))
  clock = 1_700_000_000_000
  await fs.writeFile(
    path.join(tmp, "package.json"),
    JSON.stringify({ name: "demo-phase2", scripts: { build: "true", lint: "true", test: "true", typecheck: "true" } }),
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

describe("Phase 2: Core State Machine, Concurrency Locks, Leases & Escalations", () => {
  it("1. claimNext does not starve when another agent has a card in progress", async () => {
    const office = await makeOffice()
    const state = await office.loadState("Multi-agent test")

    const { ficha: fichaA } = await office.resolveFicha({ role: "developer", capabilities: ["react"] })
    await office.deploy(fichaA)
    const { ficha: fichaB } = await office.resolveFicha({ role: "code-architect", capabilities: ["architecture"] })
    await office.deploy(fichaB)

    await office.savePlan(state, [
      { id: "T-00", title: "Task 0", type: "implementation", acceptance: ["a"], gate: "g" },
      { id: "T-01", title: "Task 1", type: "implementation", acceptance: ["b"], gate: "g" },
    ])

    // Agent A claims T-00 -> T-00 is in_progress by Agent A
    const claimA = await office.claimNext(state, fichaA.id)
    expect(claimA.card?.id).toBe("T-00")
    expect(claimA.card?.owner).toBe(fichaA.id)
    expect(claimA.card?.state).toBe("in_progress")

    // Agent B calls claimNext -> must NOT starve on T-00, must claim T-01
    const claimB = await office.claimNext(state, fichaB.id)
    expect(claimB.card).not.toBeNull()
    expect(claimB.card?.id).toBe("T-01")
    expect(claimB.card?.owner).toBe(fichaB.id)
    expect(claimB.card?.state).toBe("in_progress")
  })

  it("2. Resuming an in_progress card does not throw InvalidTransitionError", async () => {
    const office = await makeOffice()
    const state = await office.loadState("Resume test")

    const { ficha: fichaA } = await office.resolveFicha({ role: "developer", capabilities: ["react"] })
    await office.deploy(fichaA)

    await office.savePlan(state, [
      { id: "T-00", title: "Task 0", type: "implementation", acceptance: ["a"], gate: "g" },
    ])

    // Claim T-00 so it is in_progress
    const claim1 = await office.claimNext(state, fichaA.id)
    expect(claim1.card?.state).toBe("in_progress")
    expect(claim1.card?.owner).toBe(fichaA.id)

    // Agent A calls claimNext again on their own in_progress card to resume
    // Should NOT throw InvalidTransitionError
    const resumed = await office.claimNext(state, fichaA.id)
    expect(resumed?.card?.id).toBe("T-00")
    expect(resumed?.card?.state).toBe("in_progress")
    expect(resumed?.card?.owner).toBe(fichaA.id)
    expect(resumed?.card?.updatedAt).toBeDefined()
  })

  it("3. 3 review rejections transition card to escalated and release lease", async () => {
    const office = await makeOffice()
    const state = await office.loadState("Escalation test")

    const { ficha: fichaA } = await office.resolveFicha({ role: "developer", capabilities: ["react"] })
    await office.deploy(fichaA)
    const { ficha: fichaB } = await office.resolveFicha({ role: "code-architect", capabilities: ["architecture"] })
    await office.deploy(fichaB)

    await office.savePlan(state, [
      { id: "T-00", title: "Task 0", type: "implementation", acceptance: ["a"], gate: "g" },
    ])

    state.cards["T-00"]!.owner = fichaA.id
    state.cards["T-00"]!.reviewer = fichaB.id
    await office.saveState(state)

    // Attempt 1: Rejection 1 -> rework (owner kept)
    await office.claimCard(state, fichaA.id, "T-00")
    await office.submitWork(state, "T-00", fichaA.id, { handoff: "H1", evidence: "E1" })
    const r1 = await office.submitReview(state, "T-00", fichaB.id, "rejected", { review: "bad 1", reason: "fix 1" })
    expect(r1.action).toBe("rework")
    expect(state.cards["T-00"]!.state).toBe("rework")
    expect(state.cards["T-00"]!.owner).toBe(fichaA.id)

    // Attempt 2: Rejection 2 -> replan (owner rotated, lease released)
    await office.claimCard(state, fichaA.id, "T-00")
    await office.submitWork(state, "T-00", fichaA.id, { handoff: "H2", evidence: "E2" })
    const r2 = await office.submitReview(state, "T-00", fichaB.id, "rejected", { review: "bad 2", reason: "fix 2" })
    expect(r2.action).toBe("replan")
    expect(state.cards["T-00"]!.state).toBe("rework")
    expect(state.cards["T-00"]!.owner).toBeNull()

    // Attempt 3: Rejection 3 -> escalate (card escalated, owner null, lease released)
    await office.claimCard(state, fichaA.id, "T-00")
    await office.submitWork(state, "T-00", fichaA.id, { handoff: "H3", evidence: "E3" })
    const r3 = await office.submitReview(state, "T-00", fichaB.id, "rejected", { review: "bad 3", reason: "fix 3" })
    expect(r3.action).toBe("escalate")
    expect(state.cards["T-00"]!.state).toBe("escalated")
    expect(state.cards["T-00"]!.owner).toBeNull()
    expect(state.cards["T-00"]!.rejections).toBe(3)
    expect(state.escalations.length).toBeGreaterThan(0)
    expect(state.escalations.some((e) => e.cardId === "T-00")).toBe(true)

    // Lease must be released
    const holder = await office.leases.holder("T-00")
    expect(holder).toBeUndefined()
  })

  it("4. reconcile() deletes orphan leases via forceRelease", async () => {
    const office = await makeOffice()
    await office.loadState("Reconcile test")

    // Create an orphan lease for a non-existent card "T-orphan"
    await office.leases.acquire("T-orphan", "agent-orphan")
    const leaseFile = path.join(office.paths.leasesDir, "T-orphan.json")
    const existsBefore = await fs.access(leaseFile).then(() => true).catch(() => false)
    expect(existsBefore).toBe(true)

    // Run reconcile with autoRepair: true
    const report = await reconcile(office, { autoRepair: true, dryRun: false })
    expect(report.issues.some((i) => i.cardId === "T-orphan" && i.kind === "stale-lease")).toBe(true)

    // Verify orphan lease file was deleted from disk via forceRelease
    const existsAfter = await fs.access(leaseFile).then(() => true).catch(() => false)
    expect(existsAfter).toBe(false)
    expect(await office.leases.get("T-orphan")).toBeUndefined()
  })

  it("5. closeCard gate failures move card to rework", async () => {
    const office = await makeOffice()
    const state = await office.loadState("CloseCard test")

    const { ficha: fichaA } = await office.resolveFicha({ role: "developer", capabilities: ["react"] })
    await office.deploy(fichaA)
    const { ficha: fichaB } = await office.resolveFicha({ role: "code-architect", capabilities: ["architecture"] })
    await office.deploy(fichaB)

    await office.savePlan(state, [
      { id: "T-00", title: "Task 0", type: "implementation", acceptance: ["a"], gate: "g" },
    ])
    state.cards["T-00"]!.owner = fichaA.id
    state.cards["T-00"]!.reviewer = fichaB.id
    await office.saveState(state)

    // Progress card to "review"
    await office.claimCard(state, fichaA.id, "T-00")
    await office.submitWork(state, "T-00", fichaA.id, { handoff: "Handoff", evidence: "Evidence" })
    expect(state.cards["T-00"]!.state).toBe("review")

    const failingGates = {
      cardId: "T-00",
      technical: [
        { phase: "build" as const, command: "npm run build", outcome: "fail" as const, exitCode: 1, output: "Error", detail: "exit 1" },
      ],
      security: [],
      requirements: [],
      technicalOutcome: "fail" as const,
      securityOutcome: "na" as const,
      requirementsOutcome: "na" as const,
      passed: false,
      ranAt: new Date().toISOString(),
    }

    const closed = await office.closeCard(state, "T-00", failingGates)
    expect(closed.ok).toBe(false)

    // Verify card moved from "review" to "rework"
    expect(state.cards["T-00"]!.state).toBe("rework")

    // Verify persisted state on disk also shows "rework"
    const diskState = await office.loadState()
    expect(diskState.cards["T-00"]!.state).toBe("rework")
  })

  it("6. savePlan deduplicates order array", async () => {
    const office = await makeOffice()
    const state = await office.loadState("Deduplication test")

    await office.savePlan(state, [
      { id: "T-00", title: "Task 0", type: "implementation", acceptance: ["a"], gate: "g" },
    ])
    expect(state.order).toEqual(["T-00"])

    // Call savePlan again with the same card
    await office.savePlan(state, [
      { id: "T-00", title: "Task 0 updated", type: "implementation", acceptance: ["a"], gate: "g" },
    ])
    expect(state.order).toEqual(["T-00"])
  })

  it("7. closeCard on final card transitions run status to delivered", async () => {
    const office = await makeOffice()
    const state = await office.loadState("Run delivered test")

    const { ficha: fichaA } = await office.resolveFicha({ role: "developer", capabilities: ["react"] })
    await office.deploy(fichaA)
    const { ficha: fichaB } = await office.resolveFicha({ role: "code-architect", capabilities: ["architecture"] })
    await office.deploy(fichaB)

    await office.savePlan(state, [
      { id: "T-00", title: "Task 0", type: "implementation", acceptance: ["a"], gate: "g" },
    ])
    state.cards["T-00"]!.owner = fichaA.id
    state.cards["T-00"]!.reviewer = fichaB.id
    await office.saveState(state)

    await office.claimCard(state, fichaA.id, "T-00")
    await office.submitWork(state, "T-00", fichaA.id, { handoff: "Handoff", evidence: "Evidence" })

    // Provide evidence for requirement "a"
    await office.evidence.add("T-00", {
      id: "ev-1",
      cardId: "T-00",
      requirement: "a",
      requirementIndex: 0,
      mandatory: true,
      kind: "test",
      level: 2,
      ref: "test pass",
      note: "verified",
      recordedAt: new Date().toISOString(),
      recordedBy: fichaA.id,
      passed: true,
    })

    const passingGates = {
      cardId: "T-00",
      technical: [],
      security: [],
      requirements: [],
      technicalOutcome: "pass" as const,
      securityOutcome: "pass" as const,
      requirementsOutcome: "pass" as const,
      passed: true,
      ranAt: new Date().toISOString(),
    }

    expect(state.status).toBe("running")
    const closed = await office.closeCard(state, "T-00", passingGates)
    expect(closed.ok).toBe(true)
    expect(state.cards["T-00"]!.state).toBe("done")
    expect(state.status).toBe("delivered")

    const diskState = await office.loadState()
    expect(diskState.status).toBe("delivered")
  })
})
