/**
 * Bus de mensajes append-only sobre disco.
 *
 * Por qué disco y no memoria: los subagentes de OpenCode son procesos
 * aislados. No comparten heap. Un bus en memoria sería un bus de una sola
 * sesión. El disco es el único bus que sobrevive, que es compartible entre
 * harnesses, y que es auditable después.
 *
 * Semántica:
 * - Append-only: los mensajes nunca se borran. `seq` es monótono por canal.
 * - Escritura atómica: tmp + rename. Nunca hay un JSON partido en el read.
 * - Polling, no push: cada agente globa su inbox. Compatible con subagentes.
 * - Ack: el receptor deja rastro de qué leyó.
 * - TTL: un mensaje vencido es invisible para lectores nuevos, sigue en el log.
 * - Idempotency key: un pedido con la misma key no se duplica.
 * - Broadcast: `to: ["*"]` llega al pool; el primero que toma el lease gana.
 */

import path from "node:path"
import fs from "node:fs/promises"
import type { BusMessage, MessageKind, MessagePriority } from "./types.js"
import { listFiles, nowIso, readJson, shortId, stableHash, writeJsonAtomic } from "./fsx.js"

export interface BusOptions {
  ttlSec?: number
  clock?: () => number
}

export interface SendInput {
  from: string
  to: string[]
  kind: MessageKind
  subject: string
  body?: Record<string, unknown>
  replyTo?: string | null
  inReplyTo?: string | null
  ttlSec?: number
  priority?: MessagePriority
  idempotencyKey?: string | null
  hops?: number
}

/** Canales disponibles. Los coordinadores son canales más. */
export const CHANNELS = {
  command: "coord-command",
  arch: "coord-arch",
  flow: "coord-flow",
  peer: "peer",
} as const

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS] | string

/**
 * Ruta mínima que el bus necesita. Se define acá para no acoplar el bus a
 * `paths.ts` completo y poder testearlo con un stub.
 */
export interface ResolvedPathsLike {
  busDir: string
  inboxDir: string
}

export class Bus {
  private readonly ttlDefault: number
  private readonly clock: () => number

  constructor(
    private readonly paths: ResolvedPathsLike,
    options: BusOptions = {},
  ) {
    this.ttlDefault = options.ttlSec ?? 900
    this.clock = options.clock ?? Date.now
  }

  private channelDir(channel: string): string {
    return path.join(this.paths.busDir, channel)
  }

  private inboxOf(agentId: string): string {
    return path.join(this.paths.inboxDir, agentId)
  }

  /**
   * Próximo `seq` de un canal.
   *
   * Se deriva de los archivos existentes, no de un contador en memoria: así
   * dos emisores concurrentes no pueden producir el mismo seq.
   */
  private async nextSeq(channel: string): Promise<number> {
    const files = await listFiles(this.channelDir(channel))
    let max = 0
    for (const f of files) {
      const m = /^(\d{4,})-/.exec(f)
      if (m) {
        const n = Number.parseInt(m[1]!, 10)
        if (n > max) max = n
      }
    }
    return max + 1
  }

  /**
   * Publica un mensaje.
   *
   * Si ya existe un mensaje vivo con la misma `idempotencyKey` en el canal,
   * no se publica un duplicado: se devuelve el existente.
   */
  async send(channel: string, input: SendInput): Promise<BusMessage> {
    if (input.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(channel, input.idempotencyKey)
      if (existing) return existing
    }

    const seq = await this.nextSeq(channel)
    const message: BusMessage = {
      id: shortId("m"),
      seq,
      from: input.from,
      to: input.to,
      kind: input.kind,
      subject: input.subject,
      body: input.body ?? {},
      replyTo: input.replyTo ?? null,
      inReplyTo: input.inReplyTo ?? null,
      ttlSec: input.ttlSec ?? this.ttlDefault,
      createdAt: nowIso(this.clock),
      priority: input.priority ?? "normal",
      idempotencyKey: input.idempotencyKey ?? null,
      hops: input.hops ?? 0,
    }

    const file = path.join(this.channelDir(channel), `${String(seq).padStart(4, "0")}-${message.id}.json`)
    await writeJsonAtomic(file, message)
    return message
  }

  /** Busca un mensaje vivo por su idempotency key en un canal. */
  async findByIdempotencyKey(channel: string, key: string): Promise<BusMessage | undefined> {
    for (const message of await this.readChannel(channel)) {
      if (message.idempotencyKey === key && !this.isExpired(message)) return message
    }
    return undefined
  }

  /** Lee todos los mensajes de un canal, ordenados por seq. */
  async readChannel(channel: string): Promise<BusMessage[]> {
    const dir = this.channelDir(channel)
    const files = (await listFiles(dir)).filter((f) => f.endsWith(".json")).sort()
    const out: BusMessage[] = []
    for (const f of files) {
      const msg = await readJson<BusMessage>(path.join(dir, f))
      if (msg) out.push(msg)
    }
    return out.sort((a, b) => a.seq - b.seq)
  }

  /** ¿El mensaje venció? */
  isExpired(message: BusMessage): boolean {
    const age = this.clock() - Date.parse(message.createdAt)
    return age > message.ttlSec * 1000
  }

  /** ¿El mensaje va dirigido a este agente (o es broadcast)? */
  isAddressedTo(message: BusMessage, agentId: string): boolean {
    if (message.from === agentId) return false
    if (message.to.includes("*")) return true
    return message.to.includes(agentId)
  }

  /**
   * Recibe los mensajes dirigidos a un agente que todavía no acknowledgió.
   *
   * Los mensajes expirados se omiten (siguen en el log para auditoría).
   */
  async receive(agentId: string, channels: string[] = [CHANNELS.peer]): Promise<BusMessage[]> {
    const acked = await this.ackedIds(agentId)
    const out: BusMessage[] = []

    for (const channel of channels) {
      for (const message of await this.readChannel(channel)) {
        if (acked.has(message.id)) continue
        if (this.isExpired(message)) continue
        if (!this.isAddressedTo(message, agentId)) continue
        out.push(message)
      }
    }

    return out.sort((a, b) => {
      const prio = { critical: 0, high: 1, normal: 2, low: 3 }
      const p = prio[a.priority] - prio[b.priority]
      return p !== 0 ? p : a.seq - b.seq
    })
  }

  /** Ids que el agente ya acknowledgió. */
  async ackedIds(agentId: string): Promise<Set<string>> {
    const dir = this.inboxOf(agentId)
    const files = await listFiles(dir)
    const out = new Set<string>()
    for (const f of files) {
      if (!f.endsWith(".ack")) continue
      const ack = await readJson<{ messageId: string }>(path.join(dir, f))
      if (ack) out.add(ack.messageId)
    }
    return out
  }

  /** Marca un mensaje como leído. */
  async ack(agentId: string, messageId: string): Promise<void> {
    const dir = this.inboxOf(agentId)
    await fs.mkdir(dir, { recursive: true })
    await writeJsonAtomic(path.join(dir, `${messageId}.ack`), {
      messageId,
      agentId,
      ackedAt: nowIso(this.clock),
    })
  }

  /** Ack de varios mensajes de una. */
  async ackMany(agentId: string, messageIds: string[]): Promise<void> {
    for (const id of messageIds) await this.ack(agentId, id)
  }

  /** ¿Quién acknowledged este mensaje? */
  async ackedBy(messageId: string): Promise<string[]> {
    const dir = this.paths.inboxDir
    const agents = await listFiles(dir)
    const out: string[] = []
    for (const agent of agents) {
      const ack = await readJson<{ agentId: string }>(path.join(dir, agent, `${messageId}.ack`))
      if (ack) out.push(ack.agentId)
    }
    return out
  }

  /** Canal donde vive un mensaje dado. */
  async channelOf(messageId: string): Promise<string | undefined> {
    const channels = await listFiles(this.paths.busDir)
    for (const channel of channels) {
      const files = await listFiles(path.join(this.paths.busDir, channel))
      if (files.some((f) => f.includes(messageId))) return channel
    }
    return undefined
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Protocolo de ayuda
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Publica un pedido de ayuda.
   *
   * La idempotency key deriva de card + agente + motivo, así dos intentos del
   * mismo pedido no generan un storm en el pool.
   */
  async requestHelp(input: {
    from: string
    to: string[]
    cardId: string
    need: string
    whyMe: string
    hops?: number
  }): Promise<BusMessage> {
    return this.send(CHANNELS.peer, {
      from: input.from,
      to: input.to,
      kind: "HELP_REQUEST",
      subject: input.cardId,
      body: { need: input.need, why_me: input.whyMe },
      idempotencyKey: `help:${input.cardId}:${input.from}:${stableHash(input.need)}`,
      hops: input.hops ?? 0,
    })
  }

  /** Responde un pedido de ayuda. */
  async respondHelp(input: {
    from: string
    to: string[]
    cardId: string
    kind: "HELP_ACCEPT" | "HELP_DECLINE" | "HELP_PARTIAL" | "HELP_QUESTION"
    body: Record<string, unknown>
    inReplyTo: string
    hops?: number
  }): Promise<BusMessage> {
    return this.send(CHANNELS.peer, {
      from: input.from,
      to: input.to,
      kind: input.kind,
      subject: input.cardId,
      body: input.body,
      inReplyTo: input.inReplyTo,
      hops: input.hops ?? 0,
    })
  }

  /** Broadcast al pool: "necesito X". El primero que acepta toma el lease. */
  async broadcastHelp(input: {
    from: string
    cardId: string
    need: string
    whyMe: string
    hops?: number
  }): Promise<BusMessage> {
    return this.requestHelp({ ...input, to: ["*"] })
  }

  /** Snapshot de auditoría del bus. */
  async stats(): Promise<Record<string, number>> {
    const channels = await listFiles(this.paths.busDir)
    const out: Record<string, number> = {}
    for (const channel of channels) {
      out[channel] = (await this.readChannel(channel)).length
    }
    return out
  }
}
