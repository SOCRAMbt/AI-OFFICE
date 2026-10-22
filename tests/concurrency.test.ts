/**
 * Pruebas de concurrencia.
 *
 * Verifican que las invariantes que el sistema declara (un lease, un seq,
 * una clave de idempotencia) se sostienen **bajo concurrencia real**, no
 * solo en secuencia.
 *
 * Los tests anteriores del lease eran secuenciales: dos llamadas una
 * detras de otra. Eso no encuentra un TOCTOU. Estos lanzan las operaciones
 * a la vez.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { Office } from "../src/core/office.js"
import { Bus, CHANNELS } from "../src/core/bus.js"
import { LeaseStore } from "../src/core/leases.js"
import { withLock, writeExclusive } from "../src/core/atomic.js"
import { safeId } from "../src/core/ids.js"
import { DEFAULT_LIMITS } from "../src/core/types.js"

let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-concurrency-"))
  await fs.writeFile(path.join(tmp, "package.json"), JSON.stringify({ name: "x" }))
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe("Lease: doble claim simultaneo", () => {
  it("de dos agentes que piden la misma card a la vez, solo uno la obtiene", async () => {
    const dir = path.join(tmp, "leases")
    await fs.mkdir(dir, { recursive: true })
    const leases = new LeaseStore(dir, DEFAULT_LIMITS)

    const [a, b] = await Promise.all([
      leases.acquire("T-00", "agente-a"),
      leases.acquire("T-00", "agente-b"),
    ])

    const obtenidos = [a, b].filter((x) => x !== undefined)
    expect(obtenidos.length).toBe(1)
    // Y el que no lo obtuvo no es el dueño.
    const holder = await leases.holder("T-00")
    expect(holder).toBeTruthy()
    expect([a?.agentId, b?.agentId]).toContain(holder)
  })

  it("con muchos agentes a la vez, gana exactamente uno", async () => {
    const dir = path.join(tmp, "leases")
    await fs.mkdir(dir, { recursive: true })
    const leases = new LeaseStore(dir, DEFAULT_LIMITS)

    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => leases.acquire("T-00", `agente-${i}`)),
    )
    expect(results.filter((r) => r !== undefined).length).toBe(1)
  })

  it("el mismo agente puede re-adquirir su propio lease", async () => {
    const dir = path.join(tmp, "leases")
    await fs.mkdir(dir, { recursive: true })
    const leases = new LeaseStore(dir, DEFAULT_LIMITS)

    const first = await leases.acquire("T-00", "agente-a")
    const second = await leases.acquire("T-00", "agente-a")
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(second!.agentId).toBe("agente-a")
  })

  it("un lease vencido puede ser tomado, y solo por uno", async () => {
    const dir = path.join(tmp, "leases")
    await fs.mkdir(dir, { recursive: true })
    let now = Date.now()
    const leases = new LeaseStore(dir, DEFAULT_LIMITS, () => now)

    await leases.acquire("T-00", "agente-muerto")
    // El TTL vence.
    now += DEFAULT_LIMITS.leaseTtlSec * 1000 + 1000

    const [a, b] = await Promise.all([
      leases.acquire("T-00", "agente-nuevo-a"),
      leases.acquire("T-00", "agente-nuevo-b"),
    ])
    expect([a, b].filter((x) => x !== undefined).length).toBe(1)
    expect(await leases.holder("T-00")).toMatch(/agente-nuevo-/)
  })

  it("un taskId con traversal se rechaza en vez de escribir fuera", async () => {
    const dir = path.join(tmp, "leases")
    await fs.mkdir(dir, { recursive: true })
    const leases = new LeaseStore(dir, DEFAULT_LIMITS)

    await expect(leases.acquire("../../evil", "agente")).rejects.toThrow(/no seguro/)
  })
})

describe("Bus: seq unico bajo concurrencia", () => {
  it("dos emisores concurrentes no producen el mismo seq", async () => {
    const bus = new Bus({ busDir: path.join(tmp, "bus"), inboxDir: path.join(tmp, "inbox") })

    const enviados = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        bus.send(CHANNELS.peer, {
          from: `agente-${i}`,
          to: ["*"],
          kind: "NOTICE",
          subject: `mensaje ${i}`,
          body: { i },
        }),
      ),
    )

    const seqs = enviados.map((m) => m.seq)
    expect(new Set(seqs).size).toBe(seqs.length)
  })

  it("muchos emisores concurrentes siguen con seqs unicos", async () => {
    const bus = new Bus({ busDir: path.join(tmp, "bus"), inboxDir: path.join(tmp, "inbox") })

    const enviados = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        bus.send(CHANNELS.peer, {
          from: `agente-${i % 5}`,
          to: ["*"],
          kind: "NOTICE",
          subject: `m${i}`,
          body: {},
        }),
      ),
    )

    const seqs = enviados.map((m) => m.seq)
    expect(new Set(seqs).size).toBe(seqs.length)
    expect(Math.max(...seqs)).toBe(seqs.length)
  })

  it("la idempotencia resiste envios concurrentes con la misma clave", async () => {
    const bus = new Bus({ busDir: path.join(tmp, "bus"), inboxDir: path.join(tmp, "inbox") })

    const enviados = await Promise.all(
      Array.from({ length: 8 }, () =>
        bus.send(CHANNELS.peer, {
          from: "agente-a",
          to: ["*"],
          kind: "NOTICE",
          subject: "una vez",
          body: {},
          idempotencyKey: "clave-fija",
        }),
      ),
    )

    // Todos devuelven el mismo mensaje.
    const ids = new Set(enviados.map((m) => m.id))
    expect(ids.size).toBe(1)

    // Y en el canal hay UN solo mensaje.
    const enElCanal = await bus.readChannel(CHANNELS.peer)
    expect(enElCanal.length).toBe(1)
  })

  it("un messageId con traversal no escapa del inbox", async () => {
    const bus = new Bus({ busDir: path.join(tmp, "bus"), inboxDir: path.join(tmp, "inbox") })
    await bus.ack("agente-a", "../../evil")
    // No debe existir nada fuera del inbox.
    const fuera = path.join(tmp, "evil.ack")
    expect(await fs.access(fuera).then(() => true, () => false)).toBe(false)
  })
})

describe("Primitivas atomicas", () => {
  it("writeExclusive: un solo creador", async () => {
    const file = path.join(tmp, "recurso.txt")
    const resultados = await Promise.all(
      Array.from({ length: 10 }, (_, i) => writeExclusive(file, `ganador-${i}`)),
    )
    const creadores = resultados.filter((r) => r.created)
    expect(creadores.length).toBe(1)
    const contenido = await fs.readFile(file, "utf8")
    expect(contenido).toBe(creadores[0]!.contents)
  })

  it("withLock serializa las secciones criticas", async () => {
    const lock = path.join(tmp, "lock")
    const orden: string[] = []

    const tarea = async (nombre: string) =>
      withLock(lock, async () => {
        orden.push(`${nombre}:entra`)
        await new Promise((r) => setTimeout(r, 10))
        orden.push(`${nombre}:sale`)
      })

    await Promise.all([tarea("a"), tarea("b"), tarea("c")])

    // Nunca hay dos "entra" sin un "sale" en el medio.
    let dentro = 0
    for (const paso of orden) {
      if (paso.endsWith(":entra")) dentro += 1
      else dentro -= 1
      expect(dentro).toBeLessThanOrEqual(1)
    }
    expect(orden.length).toBe(6)
  })

  it("withLock rompe un lock vencido en vez de colgarse", async () => {
    const lock = path.join(tmp, "lock-vencido")
    await fs.mkdir(lock)
    // Un lock de hace mas de staleMs.
    const viejo = new Date(Date.now() - 120_000)
    await fs.utimes(lock, viejo, viejo)

    const resultado = await withLock(
      lock,
      async () => "tomado",
      { timeoutMs: 3000, staleMs: 1000 },
    )
    expect(resultado).toBe("tomado")
  })

  it("withLock tira si no puede tomar el lock y no se vence", async () => {
    const lock = path.join(tmp, "lock-vivo")
    await fs.mkdir(lock)
    const ahora = new Date()
    await fs.utimes(lock, ahora, ahora)

    await expect(
      withLock(lock, async () => "nunca", { timeoutMs: 300, staleMs: 60_000 }),
    ).rejects.toThrow(/no se pudo tomar el lock/)
  })
})

describe("Ids seguros", () => {
  it("rechaza traversal, separadores y punto inicial", () => {
    expect(safeId("../../evil")).toBeUndefined()
    expect(safeId("a/b")).toBeUndefined()
    expect(safeId("a\\b")).toBeUndefined()
    expect(safeId("..")).toBeUndefined()
    expect(safeId(".hidden")).toBeUndefined()
    expect(safeId("")).toBeUndefined()
  })

  it("acepta ids legitimos con guiones", () => {
    expect(safeId("e-frontend-developer")).toBe("e-frontend-developer")
    expect(safeId("T-00")).toBe("T-00")
    expect(safeId("m-3f2a1b9c")).toBe("m-3f2a1b9c")
  })

  it("rechaza caracteres de control", () => {
    expect(safeId("a\u0000b")).toBeUndefined()
    expect(safeId("a\u001fb")).toBeUndefined()
  })
})

describe("Claim de card concurrente a traves de la oficina", () => {
  it("dos agentes no reclaman la misma card a la vez", async () => {
    const office = new Office({ cwd: tmp, limits: DEFAULT_LIMITS })
    await office.init()
    const state = await office.loadState("Objetivo")
    await office.savePlan(state, [
      {
        title: "Una card",
        type: "implementation",
        requiredCapabilities: ["react"],
        scope: { mayTouch: ["src/**"], forbidden: [] },
        acceptance: ["funciona"],
        gate: "npm test",
      },
    ])
    const fresh = await office.loadState("Objetivo")

    const [a, b] = await Promise.all([
      office.claimCard(fresh, "agente-a", "T-00"),
      office.claimCard(fresh, "agente-b", "T-00"),
    ])

    const exitos = [a, b].filter((r) => r.ok)
    const fracasos = [a, b].filter((r) => !r.ok)
    expect(exitos.length).toBe(1)
    expect(fracasos.length).toBe(1)
    // El que perdio dice por que: el lease lo tiene el otro.
    expect(fracasos[0]!.reason).toMatch(/tomada por otro/)
  })
})
