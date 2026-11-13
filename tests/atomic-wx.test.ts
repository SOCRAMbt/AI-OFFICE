import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { withWxLock, allocateSeq } from "../src/core/atomic.js"
import { LeaseStore } from "../src/core/leases.js"

let tmp: string
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-wx-lock-"))
})
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe("withWxLock: exclusividad O_EXCL con TTL", () => {
  it("serializa operaciones: dos concurrentes no se solapan", async () => {
    const lock = path.join(tmp, "test.lock")
    let active = 0
    let maxActive = 0
    await Promise.all(
      Array.from({ length: 6 }, () =>
        withWxLock(lock, async () => {
          active += 1
          maxActive = Math.max(maxActive, active)
          await new Promise((r) => setTimeout(r, 30))
          active -= 1
        }),
      ),
    )
    expect(maxActive).toBe(1)
  })

  it("un lock vencido (> staleMs) se rompe", async () => {
    const lock = path.join(tmp, "stale.lock")
    await fs.writeFile(lock, JSON.stringify({ pid: 999999, startedAt: new Date(0).toISOString() }), "utf8")
    // Envejecer el lock más allá del staleMs
    const past = new Date(Date.now() - 10_000)
    await fs.utimes(lock, past, past)
    let ran = false
    await withWxLock(lock, async () => {
      ran = true
    }, { staleMs: 1_000 })
    expect(ran).toBe(true)
  })

  it("un lock vivo (no vencido) bloquea hasta timeout y lanza", async () => {
    const lock = path.join(tmp, "live.lock")
    await fs.writeFile(lock, JSON.stringify({ pid: process.pid }), "utf8")
    await expect(
      withWxLock(lock, async () => {}, { timeoutMs: 250, staleMs: 30_000 }),
    ).rejects.toThrow(/wx-lock/)
  })

  it("allocateSeq bajo wx-lock produce secuencias únicas", async () => {
    const dir = path.join(tmp, "chan")
    await fs.mkdir(dir, { recursive: true })
    const seqs = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        allocateSeq(dir, async (seq) => {
          await fs.writeFile(path.join(dir, `${String(seq).padStart(4, "0")}-m-${i}.json`), "{}")
        }),
      ),
    )
    expect(new Set(seqs).size).toBe(seqs.length)
  })
})

describe("LeaseStore con wx-lock: acquire sigue serializando", () => {
  it("acquire concurrente entrega la lease a un solo dueño", async () => {
    const leasesDir = path.join(tmp, "leases")
    const store = new LeaseStore(leasesDir, { leaseTtlSec: 60_000 } as never)
    const [a, b] = await Promise.all([
      store.acquire("T-00", "e-a"),
      store.acquire("T-00", "e-b"),
    ])
    const won = [a, b].filter(Boolean)
    expect(won).toHaveLength(1)
  })
})
