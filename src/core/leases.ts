/**
 * Leases con TTL y heartbeat.
 *
 * Del patrón "lease-based polling" de los workflow engines: un worker toma
 * una tarea con un lease que expira; el heartbeat lo extiende; si el worker
 * muere, el lease expira y la tarea se puede reasignar. Es lo que impide que
 * una card quede trabada por un subagente que murió en silencio.
 */

import path from "node:path"
import type { Limits } from "./types.js"
import { nowIso, readJson, writeJsonAtomic } from "./fsx.js"

export interface Lease {
  taskId: string
  agentId: string
  acquiredAt: string
  expiresAt: string
  /** Timestamp del último heartbeat. */
  heartbeatAt: string
  /** Cantidad de renovaciones. */
  renewals: number
}

export class LeaseStore {
  constructor(
    private readonly dir: string,
    private readonly limits: Limits,
    private readonly clock: () => number = Date.now,
  ) {}

  private file(taskId: string): string {
    return path.join(this.dir, `${taskId}.json`)
  }

  /**
   * Intenta tomar el lease de una tarea.
   *
   * Devuelve `undefined` si ya hay un lease vivo de otro agente: el
   * double-claim es exactamente el bug que el lease previene.
   */
  async acquire(taskId: string, agentId: string): Promise<Lease | undefined> {
    const current = await this.get(taskId)
    if (current && !this.isExpired(current) && current.agentId !== agentId) {
      return undefined
    }

    const now = this.clock()
    const lease: Lease = {
      taskId,
      agentId,
      acquiredAt: current?.acquiredAt ?? nowIso(() => now),
      expiresAt: new Date(now + this.limits.leaseTtlSec * 1000).toISOString(),
      heartbeatAt: nowIso(() => now),
      renewals: current?.renewals ?? 0,
    }
    await writeJsonAtomic(this.file(taskId), lease)
    return lease
  }

  /** Renueva el lease. Devuelve `undefined` si ya no lo tenés. */
  async heartbeat(taskId: string, agentId: string): Promise<Lease | undefined> {
    const current = await this.get(taskId)
    if (!current || current.agentId !== agentId) return undefined
    const now = this.clock()
    const next: Lease = {
      ...current,
      expiresAt: new Date(now + this.limits.leaseTtlSec * 1000).toISOString(),
      heartbeatAt: nowIso(() => now),
      renewals: current.renewals + 1,
    }
    await writeJsonAtomic(this.file(taskId), next)
    return next
  }

  /** Libera el lease. */
  async release(taskId: string, agentId: string): Promise<boolean> {
    const current = await this.get(taskId)
    if (!current) return false
    if (current.agentId !== agentId) return false
    await writeJsonAtomic(this.file(taskId), {
      ...current,
      expiresAt: nowIso(() => this.clock() - 1),
    })
    return true
  }

  /** Lee un lease. */
  async get(taskId: string): Promise<Lease | undefined> {
    return readJson<Lease>(this.file(taskId))
  }

  /** ¿El lease venció? */
  isExpired(lease: Lease): boolean {
    return Date.parse(lease.expiresAt) <= this.clock()
  }

  /** ¿Quién tiene el lease de esta tarea? `undefined` si está libre. */
  async holder(taskId: string): Promise<string | undefined> {
    const lease = await this.get(taskId)
    if (!lease || this.isExpired(lease)) return undefined
    return lease.agentId
  }

  /** ¿Está la tarea tomada? */
  async isLocked(taskId: string): Promise<boolean> {
    return (await this.holder(taskId)) !== undefined
  }
}
