import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { LeaseStore } from "../src/core/leases.js"
import { DEFAULT_LIMITS } from "../src/core/types.js"

let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-leases-"))
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe("Leases", () => {
  it("un agente toma el lease de una task libre", async () => {
    const leases = new LeaseStore(path.join(tmp, "leases"), DEFAULT_LIMITS)
    const lease = await leases.acquire("T-00", "e-a")
    expect(lease).toBeDefined()
    expect(lease!.agentId).toBe("e-a")
    expect(await leases.holder("T-00")).toBe("e-a")
  })

  it("un segundo agente NO puede tomar una task ya tomada", async () => {
    const leases = new LeaseStore(path.join(tmp, "leases"), DEFAULT_LIMITS)
    await leases.acquire("T-00", "e-a")
    const second = await leases.acquire("T-00", "e-b")
    expect(second).toBeUndefined()
    expect(await leases.holder("T-00")).toBe("e-a")
  })

  it("el mismo agente puede re-tomar su propia task", async () => {
    const leases = new LeaseStore(path.join(tmp, "leases"), DEFAULT_LIMITS)
    await leases.acquire("T-00", "e-a")
    const again = await leases.acquire("T-00", "e-a")
    expect(again).toBeDefined()
  })

  it("el heartbeat extiende el lease", async () => {
    let now = 1_000_000
    const leases = new LeaseStore(path.join(tmp, "leases"), DEFAULT_LIMITS, () => now)
    const lease = await leases.acquire("T-00", "e-a")
    const firstExpiry = lease!.expiresAt

    now += 60_000
    const renewed = await leases.heartbeat("T-00", "e-a")
    expect(renewed).toBeDefined()
    expect(renewed!.renewals).toBe(1)
    expect(Date.parse(renewed!.expiresAt)).toBeGreaterThan(Date.parse(firstExpiry))
  })

  it("otro agente no puede hacer heartbeat de un lease ajeno", async () => {
    const leases = new LeaseStore(path.join(tmp, "leases"), DEFAULT_LIMITS)
    await leases.acquire("T-00", "e-a")
    expect(await leases.heartbeat("T-00", "e-b")).toBeUndefined()
  })

  it("un lease expirado se puede reasignar", async () => {
    let now = 1_000_000
    const leases = new LeaseStore(path.join(tmp, "leases"), DEFAULT_LIMITS, () => now)
    await leases.acquire("T-00", "e-a")

    now += DEFAULT_LIMITS.leaseTtlSec * 1000 + 1000
    expect(await leases.holder("T-00")).toBeUndefined()
    expect(await leases.isLocked("T-00")).toBe(false)

    const reassigned = await leases.acquire("T-00", "e-b")
    expect(reassigned).toBeDefined()
    expect(reassigned!.agentId).toBe("e-b")
  })

  it("liberar el lease lo deja disponible", async () => {
    const leases = new LeaseStore(path.join(tmp, "leases"), DEFAULT_LIMITS)
    await leases.acquire("T-00", "e-a")
    expect(await leases.release("T-00", "e-a")).toBe(true)
    expect(await leases.holder("T-00")).toBeUndefined()
  })

  it("liberar un lease ajeno falla", async () => {
    const leases = new LeaseStore(path.join(tmp, "leases"), DEFAULT_LIMITS)
    await leases.acquire("T-00", "e-a")
    expect(await leases.release("T-00", "e-b")).toBe(false)
    expect(await leases.holder("T-00")).toBe("e-a")
  })

  it("un agente muerto libera su task por expiración", async () => {
    let now = 1_000_000
    const leases = new LeaseStore(path.join(tmp, "leases"), DEFAULT_LIMITS, () => now)
    await leases.acquire("T-00", "e-dead")

    // Sin heartbeat, el lease expira y otro agente puede tomarla.
    now += DEFAULT_LIMITS.leaseTtlSec * 1000 + 1
    const recovered = await leases.acquire("T-00", "e-new")
    expect(recovered?.agentId).toBe("e-new")
  })
})
