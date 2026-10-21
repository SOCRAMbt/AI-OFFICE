import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { Bus, CHANNELS } from "../src/core/bus.js"

let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-bus-"))
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

function makeBus(clock?: () => number) {
  return new Bus({ busDir: path.join(tmp, "bus"), inboxDir: path.join(tmp, "inbox") }, { clock })
}

describe("Bus", () => {
  it("publica y lee mensajes de un canal", async () => {
    const bus = makeBus()
    const msg = await bus.send(CHANNELS.peer, {
      from: "e-a",
      to: ["e-b"],
      kind: "NOTICE",
      subject: "T-00",
      body: { hola: "mundo" },
    })

    expect(msg.seq).toBe(1)
    expect(msg.id).toMatch(/^m-/)

    const received = await bus.receive("e-b", [CHANNELS.peer])
    expect(received).toHaveLength(1)
    expect(received[0]!.id).toBe(msg.id)
    expect(received[0]!.body).toEqual({ hola: "mundo" })
  })

  it("no entrega a quien no es destinatario", async () => {
    const bus = makeBus()
    await bus.send(CHANNELS.peer, { from: "e-a", to: ["e-b"], kind: "NOTICE", subject: "x" })
    expect(await bus.receive("e-c", [CHANNELS.peer])).toHaveLength(0)
  })

  it("no entrega al emisor su propio mensaje", async () => {
    const bus = makeBus()
    await bus.send(CHANNELS.peer, { from: "e-a", to: ["e-a"], kind: "NOTICE", subject: "x" })
    expect(await bus.receive("e-a", [CHANNELS.peer])).toHaveLength(0)
  })

  it("hace broadcast a todos con to: ['*']", async () => {
    const bus = makeBus()
    await bus.send(CHANNELS.peer, { from: "e-a", to: ["*"], kind: "HELP_REQUEST", subject: "T-01" })
    expect(await bus.receive("e-b", [CHANNELS.peer])).toHaveLength(1)
    expect(await bus.receive("e-c", [CHANNELS.peer])).toHaveLength(1)
  })

  it("el seq es monótono por canal", async () => {
    const bus = makeBus()
    const a = await bus.send(CHANNELS.peer, { from: "e-a", to: ["e-b"], kind: "NOTICE", subject: "1" })
    const b = await bus.send(CHANNELS.peer, { from: "e-a", to: ["e-b"], kind: "NOTICE", subject: "2" })
    const c = await bus.send(CHANNELS.peer, { from: "e-a", to: ["e-b"], kind: "NOTICE", subject: "3" })
    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3])
  })

  it("canales separados tienen secuencias independientes", async () => {
    const bus = makeBus()
    await bus.send(CHANNELS.peer, { from: "e-a", to: ["e-b"], kind: "NOTICE", subject: "1" })
    const other = await bus.send(CHANNELS.flow, { from: "e-a", to: ["e-b"], kind: "NOTICE", subject: "2" })
    expect(other.seq).toBe(1)
  })

  it("el ack evita la reentrega", async () => {
    const bus = makeBus()
    const msg = await bus.send(CHANNELS.peer, { from: "e-a", to: ["e-b"], kind: "NOTICE", subject: "x" })
    expect(await bus.receive("e-b", [CHANNELS.peer])).toHaveLength(1)

    await bus.ack("e-b", msg.id)
    expect(await bus.receive("e-b", [CHANNELS.peer])).toHaveLength(0)
  })

  it("reporta quién Gas acknowledges un mensaje", async () => {
    const bus = makeBus()
    const msg = await bus.send(CHANNELS.peer, { from: "e-a", to: ["*"], kind: "NOTICE", subject: "x" })
    await bus.ack("e-b", msg.id)
    await bus.ack("e-c", msg.id)
    const acked = await bus.ackedBy(msg.id)
    expect(acked.sort()).toEqual(["e-b", "e-c"])
  })

  it("respeta el TTL: un mensaje vencido no se entrega", async () => {
    let now = 1_000_000
    const bus = makeBus(() => now)
    const msg = await bus.send(CHANNELS.peer, {
      from: "e-a",
      to: ["e-b"],
      kind: "HELP_REQUEST",
      subject: "x",
      ttlSec: 10,
    })

    expect(await bus.receive("e-b", [CHANNELS.peer])).toHaveLength(1)

    now += 11_000
    expect(await bus.receive("e-b", [CHANNELS.peer])).toHaveLength(0)
    // Pero sigue en el log para auditoría.
    expect(await bus.readChannel(CHANNELS.peer)).toHaveLength(1)
    expect(msg.ttlSec).toBe(10)
  })

  it("la idempotency key evita duplicados", async () => {
    const bus = makeBus()
    const key = "help:T-01:e-a:abc"
    const first = await bus.send(CHANNELS.peer, {
      from: "e-a",
      to: ["e-b"],
      kind: "HELP_REQUEST",
      subject: "T-01",
      idempotencyKey: key,
    })
    const second = await bus.send(CHANNELS.peer, {
      from: "e-a",
      to: ["e-b"],
      kind: "HELP_REQUEST",
      subject: "T-01",
      idempotencyKey: key,
    })

    expect(second.id).toBe(first.id)
    expect(await bus.readChannel(CHANNELS.peer)).toHaveLength(1)
  })

  it("requestHelp genera una idempotency key estable", async () => {
    const bus = makeBus()
    const a = await bus.requestHelp({ from: "e-a", to: ["e-b"], cardId: "T-01", need: "ayuda", whyMe: "x" })
    const b = await bus.requestHelp({ from: "e-a", to: ["e-b"], cardId: "T-01", need: "ayuda", whyMe: "x" })
    expect(b.id).toBe(a.id)
    expect(a.kind).toBe("HELP_REQUEST")
    expect(a.body).toEqual({ need: "ayuda", why_me: "x" })
  })

  it("ordena la entrega por prioridad", async () => {
    const bus = makeBus()
    await bus.send(CHANNELS.peer, { from: "e-a", to: ["e-b"], kind: "NOTICE", subject: "low", priority: "low" })
    await bus.send(CHANNELS.peer, { from: "e-a", to: ["e-b"], kind: "NOTICE", subject: "critical", priority: "critical" })
    await bus.send(CHANNELS.peer, { from: "e-a", to: ["e-b"], kind: "NOTICE", subject: "normal", priority: "normal" })

    const received = await bus.receive("e-b", [CHANNELS.peer])
    expect(received.map((m) => m.subject)).toEqual(["critical", "normal", "low"])
  })

  it("el mensaje escrito en disco es JSON válido y parseable", async () => {
    const bus = makeBus()
    const msg = await bus.send(CHANNELS.peer, {
      from: "e-a",
      to: ["e-b"],
      kind: "NOTICE",
      subject: "T-00",
      body: { unicode: "acentuación ✓", anidado: { a: [1, 2, 3] } },
    })

    const dir = path.join(tmp, "bus", CHANNELS.peer)
    const files = await fs.readdir(dir)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^0001-m-/)

    const parsed = JSON.parse(await fs.readFile(path.join(dir, files[0]!), "utf8"))
    expect(parsed.id).toBe(msg.id)
    expect(parsed.body.unicode).toBe("acentuación ✓")
  })

  it("no deja archivos .tmp sueltos tras escribir", async () => {
    const bus = makeBus()
    for (let i = 0; i < 5; i++) {
      await bus.send(CHANNELS.peer, { from: "e-a", to: ["e-b"], kind: "NOTICE", subject: `${i}` })
    }
    const files = await fs.readdir(path.join(tmp, "bus", CHANNELS.peer))
    expect(files.filter((f) => f.includes(".tmp"))).toHaveLength(0)
  })

  it("respondeHelp enlaza la respuesta con el pedido original", async () => {
    const bus = makeBus()
    const request = await bus.requestHelp({ from: "e-a", to: ["e-b"], cardId: "T-01", need: "x", whyMe: "y" })
    const response = await bus.respondHelp({
      from: "e-b",
      to: ["e-a"],
      cardId: "T-01",
      kind: "HELP_ACCEPT",
      body: { scope: "src/x.ts" },
      inReplyTo: request.id,
    })
    expect(response.inReplyTo).toBe(request.id)
    expect(response.kind).toBe("HELP_ACCEPT")
  })
})
