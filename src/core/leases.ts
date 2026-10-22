/**
 * Leases con TTL y heartbeat.
 *
 * Del patrón "lease-based polling" de los workflow engines: un worker toma
 * una tarea con un lease que expira; el heartbeat lo extiende; si el worker
 * muere, el lease expira y la tarea se puede reasignar. Es lo que impide que
 * una card quede trabada por un subagente que murió en silencio.
 *
 * ## La carrera que este modulo tuviera
 *
 * `acquire` era un TOCTOU clasico:
 *
 *     const current = await this.get(taskId)     // READ
 *     if (current && !expired && otro) return    // CHECK
 *     await writeJsonAtomic(this.file(taskId), …) // WRITE
 *
 * Dos agentes llamaban `acquire` al mismo tiempo: ambos leian "no hay
 * lease", ambos pasaban el chequeo, ambos escribian. El ultimo gano, y el
 * primero **creia que tenia la card** mientras working en una card que ya
 * era de otro. El trabajo se hacia dos veces.
 *
 * ## Como se cierra
 *
 * - **Creacion**: `O_EXCL`. Si el archivo no existe, se crea con
 *   `wx` y solo un proceso puede ganar. Si existe, es que ya hay lease.
 * - **Takeover de un lease vencido**: bajo un lock de directorio, con
 *   re-lectura y escritura atomica. El lock evita que dos tomadores
 *   simultaneos del mismo lease vencido se pisen.
 */

import path from "node:path"
import type { Limits } from "./types.js"
import { nowIso, readJson, writeJsonAtomic } from "./fsx.js"
import { withLock, writeExclusive } from "./atomic.js"
import { safeId } from "./ids.js"

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

/** Error de un id de tarea no seguro. */
export class UnsafeTaskIdError extends Error {
  constructor(taskId: string) {
    super(
      `[oficina] taskId no seguro: "${taskId}". Un id de tarea no puede contener separadores de ruta, "..", ni empezar con punto.`,
    )
    this.name = "UnsafeTaskIdError"
  }
}

export class LeaseStore {
  constructor(
    private readonly dir: string,
    private readonly limits: Limits,
    private readonly clock: () => number = Date.now,
  ) {}

  /**
   * Path del archivo de lease.
   *
   * El `taskId` se sanitiza: venia del modelo y se usaba crudo como nombre
   * de archivo, con lo que un `taskId = "../../evil"` escribia fuera de
   * `.oficina/leases/`.
   */
  private file(taskId: string): string {
    const safe = safeId(taskId)
    if (!safe) throw new UnsafeTaskIdError(taskId)
    return path.join(this.dir, `${safe}.json`)
  }

  /** Path del lock de una tarea. Vive aparte para no ensuciar el dir. */
  private lockPath(taskId: string): string {
    const safe = safeId(taskId)
    if (!safe) throw new UnsafeTaskIdError(taskId)
    return path.join(this.dir, ".locks", `${safe}.lock`)
  }

  /**
   * Intenta tomar el lease de una tarea.
   *
   * Devuelve `undefined` si ya hay un lease vivo de otro agente: el
   * double-claim es exactamente el bug que el lease previene.
   *
   * ## Por qué un lock y no `O_EXCL`
   *
   * La primera version de este metodo creaba el archivo con `wx` y
   * escribia el contenido despues. Eso deja una ventana: entre el `open`
   * y el `write`, el archivo existe pero esta **vacio**. El otro claimant
   * lo leia, no encontraba un lease valido, y se lo quedaba tambien.
   *
   * Con el lock, el ciclo leer-evaluar-escribir es atomico: el archivo se
   * escribe con `writeJsonAtomic` (tmp + rename), asi que un lector nunca
   * ve un archivo a medio escribir.
   */
  async acquire(taskId: string, agentId: string): Promise<Lease | undefined> {
    const file = this.file(taskId)

    return withLock(this.lockPath(taskId), async () => {
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
      await writeJsonAtomic(file, lease)
      return lease
    })
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
    try {
      return await readJson<Lease>(this.file(taskId))
    } catch (err) {
      if (err instanceof UnsafeTaskIdError) return undefined
      throw err
    }
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
