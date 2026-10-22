/**
 * Primitivas atómicas sobre disco.
 *
 * ## Por qué existe
 *
 * `writeAtomic` (tmp + rename) garantiza que un lector nunca vea un JSON a
 * medio escribir. No garantiza que **dos escritores no se pisen**. El
 * patron "leo, evaluo, escribo" — un TOCTOU — es la raiz de las carreras
 * que existian:
 *
 * - El lease: dos agentes leian "no hay lease", los dos pasaban el chequeo,
 *   los dos escribian, y el segundo gano. El primero creia que tenia la
 *   card y el trabajo se hacia dos veces.
 * - El `seq` del bus: dos emisores concurrentes calculaban el mismo
 *   `max + 1` y dejaban dos mensajes con el mismo seq.
 * - La idempotencia: el "existe ya?" se hacia antes de escribir, asi que
 *   dos envios concurrentes con la misma clave creaban dos mensajes.
 *
 * ## Las tres primitivas
 *
 * - `writeExclusive`: crea el archivo con `O_EXCL`. Si ya existe, **no**
 *   lo pisa: devuelve el contenido que hay. Es la primitiva de "reclamar".
 * - `withLock`: mutex por directorio. `mkdir` es atomico en POSIX y en
 *   Windows, asi que solo un proceso puede tomar el lock. Tiene un
 *   breaker de locks vencidos, porque un proceso muerto no suelta el lock.
 * - `allocateSeq`: numero de secuencia unico, con la asignacion y la
 *   escritura del mensaje bajo el mismo lock.
 *
 * ## Lo que NO resuelve
 *
 * Nada de esto es un sistema de transacciones. No hay rollback, ni
 * commit en dos fases, ni journal. Es lo que hace falta para que las
 * invariantes que el sistema ya declara (un lease, un seq, una clave de
 * idempotencia) sean verdad en vez de una intencion.
 */

import fs from "node:fs/promises"
import path from "node:path"

export interface ExclusiveWriteResult {
  /** true si este proceso creo el archivo. */
  created: boolean
  /** Contenido final del archivo (el propio, o el que ya estaba). */
  contents: string
}

/**
 * Escribe un archivo de forma exclusiva.
 *
 * Con `O_EXCL`, el kernel garantiza que solo un proceso puede crearlo:
 * los demas reciben `EEXIST` en vez de pisar. Es la primitiva atomica de
 * "reclamar un recurso con nombre".
 */
export async function writeExclusive(filePath: string, contents: string): Promise<ExclusiveWriteResult> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined
  try {
    handle = await fs.open(filePath, "wx")
    await handle.writeFile(contents, "utf8")
    return { created: true, contents }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err
    const existing = await fs.readFile(filePath, "utf8").catch(() => "")
    return { created: false, contents: existing }
  } finally {
    await handle?.close().catch(() => {})
  }
}

/** ¿Existe un archivo? */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export interface LockOptions {
  /** Cuanto esperar por el lock antes de rendirse. */
  timeoutMs?: number
  /** A partir de cuando un lock se considera muerto y se puede romper. */
  staleMs?: number
}

/** Espera un poco. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Mutex por directorio.
 *
 * `mkdir` es atomico: de miles de procesos, uno solo recibe exito. Los
 * demas ven `EEXIST` y esperan.
 *
 * ## Locks vencidos
 *
 * Si el proceso que tomo el lock muere, el directorio queda ahi para
 * siempre. Por eso un lock mas viejo que `staleMs` se rompe: se asume que
 * su dueno murio. Sin eso, un crash deja la oficina trabada para siempre,
 * que es peor que el riesgo de romper un lock de otro proceso vivo (y ese
 * proceso, si sigue vivo, esta haciendo su trabajo y no necesita el lock
 * para otra cosa).
 */
export async function withLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 10_000
  const staleMs = options.staleMs ?? 30_000
  const deadline = Date.now() + timeoutMs

  // El lock vive como directorio. Su padre puede no existir todavia (el
  // canal del bus se crea con el primer mensaje), y `mkdir` sin `recursive`
  // falla con ENOENT si el padre falta.
  await fs.mkdir(path.dirname(lockPath), { recursive: true })

  let acquired = false
  while (Date.now() < deadline) {
    try {
      await fs.mkdir(lockPath)
      acquired = true
      break
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err

      // ¿El lock esta vencido?
      try {
        const stat = await fs.stat(lockPath)
        if (Date.now() - stat.mtimeMs > staleMs) {
          await fs.rm(lockPath, { recursive: true, force: true }).catch(() => {})
          continue
        }
      } catch {
        // El lock desaparecio entre el mkdir y el stat: reintentar.
        continue
      }

      // Espera con jitter: evita que losProcesses se alineen en la carrera.
      await sleep(15 + Math.floor(Math.random() * 35))
    }
  }

  if (!acquired) {
    throw new Error(`[oficina] no se pudo tomar el lock ${lockPath} en ${timeoutMs}ms`)
  }

  try {
    return await fn()
  } finally {
    await fs.rm(lockPath, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Asigna un numero de secuencia unico dentro de un directorio.
 *
 * La asignacion y la escritura tienen que ocurrir **bajo el mismo lock**.
 * Si el numero se reservara y el lock se soltara antes de escribir, el
 * siguiente emisor no veria el archivo todavia no escrito y calcularia el
 * mismo numero.
 */
export async function allocateSeq(
  channelDir: string,
  write: (seq: number) => Promise<void>,
  options: LockOptions = {},
): Promise<number> {
  const lockPath = path.join(channelDir, ".seq.lock")
  return withLock(
    lockPath,
    async () => {
      const entries = await fs.readdir(channelDir).catch(() => [] as string[])
      let max = 0
      for (const entry of entries) {
        const m = /^(\d{4,})-/.exec(entry)
        if (!m) continue
        const n = Number.parseInt(m[1]!, 10)
        if (Number.isFinite(n) && n > max) max = n
      }
      const seq = max + 1
      await write(seq)
      return seq
    },
    options,
  )
}

/** Path del lock de un canal. */
export function seqLockPath(channelDir: string): string {
  return path.join(channelDir, ".seq.lock")
}
