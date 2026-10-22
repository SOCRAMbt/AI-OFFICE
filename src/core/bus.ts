import fs from "node:fs/promises"
import path from "node:path"
import { withLock } from "./atomic.js"
import { safeId } from "./ids.js"
import { nowIso, readJson, shortId, stableHash, writeJsonAtomic } from "./fsx.js"
import { logger } from "./log.js"

const log = logger("oficina:bus")

export const CHANNELS = {
  /** Del comando al flujo. */
  command: "coord-command",
  /** Del arquitecto a los coordinadores. */
  arch: "coord-arch",
  /** Del flujo al comando. */
  flow: "coord-flow",
  /** Entre pares. */
  peer: "peer",
} as const

export type ChannelId = (typeof CHANNELS)[keyof typeof CHANNELS]

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

export interface BusOptions {
  ttlSec?: number
  clock?: () => number
}

export type MessageKind =
  | "HELP_REQUEST"
  | "HELP_ACCEPT"
  | "HELP_DECLINE"
  | "HELP_PARTIAL"
  | "HELP_QUESTION"
  | "QUESTION"
  | "ANSWER"
  | "SPAWN_REQUEST"
  | "SPAWN_APPROVED"
  | "SPAWN_REJECTED"
  | "CLAIM"
  | "RELEASE"
  | "STATUS"
  | "NOTICE"

export type MessagePriority = "low" | "normal" | "high" | "critical"

export interface BusMessage {
  id: string
  seq: number
  from: string
  to: string[]
  kind: MessageKind
  subject: string
  body: Record<string, unknown>
  replyTo: string | null
  inReplyTo: string | null
  ttlSec: number
  createdAt: string
  priority: MessagePriority
  idempotencyKey: string | null
  hops: number
}

export interface BusAck {
  messageId: string
  agentId: string
  ackedAt: string
}

const PRIORITY_ORDER: Record<MessagePriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
}

export class Bus {
  private readonly ttlDefault: number
  private readonly clock: () => number

  constructor(
    private readonly paths: {
      busDir: string
      inboxDir: string
    },
    options: BusOptions = {},
  ) {
    this.ttlDefault = options.ttlSec ?? 900
    this.clock = options.clock ?? Date.now
  }

  private channelDir(channel: string): string {
    return path.join(this.paths.busDir, channel)
  }

  private ackDir(agentId: string): string {
    return path.join(this.paths.inboxDir, agentId)
  }

  /**
   * Próximo `seq` de un canal.
   *
   * Se deriva de los archivos existentes, no de un contador en memoria: así
   * el estado sobrevive a un reinicio.
   *
   * OJO: derivarlo NO lo hace atomico por sí solo. Dos emisores
   * concurrentes podian leer el mismo `max + 1` y dejar dos mensajes con el
   * mismo seq. La asignacion real esta en `send`, que hace la asignacion Y
   * la escritura bajo el mismo lock.
   */
  private async nextSeq(channel: string): Promise<number> {
    const files = await this.listChannelFiles(channel)
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

  private async listChannelFiles(channel: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.channelDir(channel))
      return entries.filter((e) => e.endsWith(".json"))
    } catch {
      return []
    }
  }

  /**
   * Publica un mensaje.
   *
   * Si ya existe un mensaje vivo con la misma `idempotencyKey` en el canal,
   * no se publica un duplicado: se devuelve el existente.
   *
   * ## Atomicidad
   *
   * Todo el critical path (chequeo de idempotencia, asignacion de seq y
   * escritura) ocurre **bajo un lock de canal**. Sin eso:
   *
   * - Dos emisores concurrentes con la misma `idempotencyKey` pasaban los
   *   dos el chequeo "existe?" y creaban dos mensajes. La idempotencia era
   *   decorativa.
   * - Dos emisores concurrentes calculaban el mismo `seq` y dejaban dos
   *   mensajes con el mismo numero, rompiendo el orden del canal.
   */
  async send(channel: string, input: SendInput): Promise<BusMessage> {
    return withChannelLock(this.channelDir(channel), async () => {
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

      const file = path.join(
        this.channelDir(channel),
        `${String(seq).padStart(4, "0")}-${message.id}.json`,
      )
      await writeJsonAtomic(file, message)
      return message
    })
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
    const files = (await this.listChannelFiles(channel)).sort()
    const out: BusMessage[] = []
    for (const f of files) {
      const message = await readJson<BusMessage>(path.join(this.channelDir(channel), f))
      if (message) out.push(message)
    }
    return out.sort((a, b) => a.seq - b.seq)
  }

  /** ¿El mensaje venció? */
  isExpired(message: BusMessage): boolean {
    return this.clock() - Date.parse(message.createdAt) > message.ttlSec * 1000
  }

  /** ¿El mensaje es para este agente? */
  isAddressedTo(message: BusMessage, agentId: string): boolean {
    if (message.from === agentId) return false
    if (message.to.includes("*")) return true
    return message.to.includes(agentId)
  }

  /**
   * Recibe mensajes dirigidos al agente.
   *
   * Los yaodrivenados por el agente se filtran: no puede auto-confirmarse.
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
      const pa = PRIORITY_ORDER[a.priority] ?? 2
      const pb = PRIORITY_ORDER[b.priority] ?? 2
      if (pa !== pb) return pa - pb
      return a.seq - b.seq
    })
  }

  /** Ids que este agente ya acknowledgeo. */
  async ackedIds(agentId: string): Promise<Set<string>> {
    const dir = this.ackDir(agentId)
    const out = new Set<string>()
    let files: string[]
    try {
      files = await fs.readdir(dir)
    } catch {
      return out
    }
    for (const f of files) {
      if (!f.endsWith(".ack")) continue
      out.add(f.slice(0, -".ack".length))
    }
    return out
  }

  /**
   * Confirma un mensaje.
   *
   * El `messageId` se sanitiza: venia del modelo y se usaba crudo como
   * nombre de archivo.
   */
  async ack(agentId: string, messageId: string): Promise<void> {
    const safe = safeId(messageId)
    if (!safe) {
      log.warn("ack con messageId no seguro, ignorado", { agentId, messageId })
      return
    }
    const dir = this.ackDir(agentId)
    await fs.mkdir(dir, { recursive: true })
    const ack: BusAck = { messageId: safe, agentId, ackedAt: nowIso(this.clock) }
    await writeJsonAtomic(path.join(dir, `${safe}.ack`), ack)
  }

  /** Confirma varios mensajes. */
  async ackMany(agentId: string, messageIds: string[]): Promise<void> {
    for (const id of messageIds) await this.ack(agentId, id)
  }

  /** ¿Quién confirmo este mensaje? */
  async ackedBy(messageId: string): Promise<string[]> {
    const out: string[] = []
    let agents: string[]
    try {
      agents = await fs.readdir(this.paths.inboxDir)
    } catch {
      return out
    }
    for (const agent of agents) {
      const acks = await this.ackedIds(agent)
      if (acks.has(messageId)) out.push(agent)
    }
    return out
  }

  /** ¿En qué canal está un mensaje? */
  async channelOf(messageId: string): Promise<string | undefined> {
    const channels = Object.values(CHANNELS)
    for (const channel of channels) {
      for (const message of await this.readChannel(channel)) {
        if (message.id === messageId) return channel
      }
    }
    return undefined
  }

  /** Pide ayuda a uno o varios agentes. */
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
      hops: input.hops ?? 0,
      idempotencyKey: `help:${input.cardId}:${input.from}:${stableHash(input.need)}`,
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

  /** Pide ayuda a todos los pares. */
  async broadcastHelp(input: {
    from: string
    cardId: string
    need: string
    whyMe: string
    hops?: number
  }): Promise<BusMessage> {
    return this.requestHelp({ ...input, to: ["*"] })
  }

  /** Estadísticas por canal. */
  async stats(): Promise<Record<string, number>> {
    const out: Record<string, number> = {}
    for (const channel of Object.values(CHANNELS)) {
      out[channel] = (await this.readChannel(channel)).length
    }
    return out
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Helpers locales
 * ──────────────────────────────────────────────────────────────────────────── */

/** Lock de canal: serializa las publicaciones de un canal. */
function withChannelLock<T>(channelDir: string, fn: () => Promise<T>): Promise<T> {
  return withLock(path.join(channelDir, ".channel.lock"), fn, {
    timeoutMs: 10_000,
    staleMs: 30_000,
  })
}
