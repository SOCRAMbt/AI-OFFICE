/**
 * Tripwire: deteccion de escrituras que se colaron del guard.
 *
 * ## Por que hace falta
 *
 * El guard de scope prevents que el modelo escriba fuera de su scope. Pero
 * un comando de shell puede escribir en cualquier lado, y no hay forma de
 * saberlo antes de correrlo: `python -c "open('/etc/x','w')"` con el path
 * escondeo entre comillas, o un heredoc, o un `eval`. Un parser de shell
 * siempre tiene huecos.
 *
 * Por eso hay dos capas:
 *
 * - **Prevencion** (el guard): se analiza el comando y se bloquea lo que se
 *   puede entender.
 * - **Deteccion** (el tripwire): se foto el estado del arbol antes del
 *   comando y se compara despues. Lo que cambio y esta fuera del scope se
 *   reporta.
 *
 * ## Lo que promete y lo que no
 *
 * Detecta escrituras **dentro del proyecto**. No detecta escrituras fuera
 * de el: para eso habria que vigilar el filesystem entero, que no es viable
 * desde un plugin. Y reporta, no revierte: revertir una escritura ya
 * hecha requiere backups y puede pisar trabajo legitimo.
 *
 * Por eso el README de las garantias dice exactamente esto, en vez de
 * prometer un aislamiento que no existe.
 */

import fs from "node:fs/promises"
import type { Dirent } from "node:fs"
import path from "node:path"
import { isSensitive, matchesScope } from "./sandbox.js"

export interface TripwireSnapshot {
  /** Path relativo -> "mtime:size". */
  files: Map<string, string>
  /** Cuantos archivos se miraron (para detectar que el limite corto). */
  scanned: number
  /** true si se supero el tope y la foto esta incompleta. */
  truncated: boolean
  /** Errores ocurridos durante la captura (permisos, E/S, etc.). */
  errors: string[]
}

export interface TripwireChange {
  path: string
  kind: "modified" | "created" | "deleted"
  /** El path estaba fuera del scope de la card. */
  outsideScope: boolean
}

export interface TripwireOptions {
  /** Tope de archivos por foto. */
  maxFiles?: number
  /** Directorios que no se recorren. */
  skipDirs?: string[]
}

/** Directorios que nunca se recorren: ruido puro. */
const DEFAULT_SKIP = [
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
  "target",
  ".svelte-kit",
]

/**
 * Toma una foto del arbol.
 *
 * Solo mira los archivos que NO estan en el scope: los del scope pueden
 * cambiar todo el tiempo (es lo que hace el agente) y no son una senal.
 */
export async function snapshotTree(
  root: string,
  scope: string[],
  options: TripwireOptions = {},
): Promise<TripwireSnapshot> {
  const maxFiles = options.maxFiles ?? 4000
  const skip = new Set(options.skipDirs ?? DEFAULT_SKIP)
  const files = new Map<string, string>()
  let scanned = 0
  let truncated = false
  const errors: string[] = []

  const walk = async (dir: string): Promise<void> => {
    if (scanned >= maxFiles) {
      truncated = true
      return
    }
    let entries: Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch (err) {
      errors.push(`Error reading directory ${dir}: ${String(err)}`)
      return
    }
    for (const entry of entries) {
      if (scanned >= maxFiles) {
        truncated = true
        return
      }
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue
        if (entry.name.startsWith(".") && entry.name !== ".opencode") continue
        await walk(path.join(dir, entry.name))
        if (scanned >= maxFiles) {
          truncated = true
          return
        }
        continue
      }
      if (!entry.isFile()) continue

      const full = path.join(dir, entry.name)
      const relative = path.relative(root, full).replace(/\\/g, "/")

      // Los sensibles se miran SIEMPRE, aunque esten en el scope: son los
      // que nunca se pueden tocar, y el tripwire tiene que verlos.
      //
      // (El orden importa: si el chequeo de scope fuera primero, un `.env`
      // que estuviera en el scope nunca se fotografiaría, que es
      // justamente el archivo que más importa vigilar.)
      if (isSensitive(relative)) {
        let stat: Awaited<ReturnType<typeof fs.stat>>
        try {
          stat = await fs.stat(full)
        } catch (err) {
          errors.push(`Error stat sensitive file ${relative}: ${String(err)}`)
          continue
        }
        files.set(relative, `${stat.mtimeMs}:${stat.size}`)
        scanned += 1
        if (scanned >= maxFiles) {
          truncated = true
          return
        }
        continue
      }

      // Los archivos del scope pueden cambiar: no son senal.
      if (matchesScope(relative, scope)) continue

      let stat: Awaited<ReturnType<typeof fs.stat>>
      try {
        stat = await fs.stat(full)
      } catch (err) {
        errors.push(`Error stat file ${relative}: ${String(err)}`)
        continue
      }
      files.set(relative, `${stat.mtimeMs}:${stat.size}`)
      scanned += 1
      if (scanned >= maxFiles) {
        truncated = true
        return
      }
    }
  }

  await walk(root)
  return { files, scanned, truncated, errors }
}

/**
 * Compara dos fotos y devuelve los cambios.
 *
 * `scope` se usa para clasificar: lo que cambio y esta en el scope es
 * esperado; lo que cambio y esta afuera es una violacion.
 */
export function diffSnapshots(
  before: TripwireSnapshot,
  after: TripwireSnapshot,
  scope: string[],
): { changes: TripwireChange[]; incomplete: boolean; errors: string[] } {
  const changes: TripwireChange[] = []

  for (const [file, signature] of after.files) {
    const previous = before.files.get(file)
    if (previous === undefined) {
      changes.push({ path: file, kind: "created", outsideScope: !matchesScope(file, scope) })
    } else if (previous !== signature) {
      changes.push({ path: file, kind: "modified", outsideScope: !matchesScope(file, scope) })
    }
  }

  for (const file of before.files.keys()) {
    if (!after.files.has(file)) {
      changes.push({ path: file, kind: "deleted", outsideScope: !matchesScope(file, scope) })
    }
  }

  const incomplete = before.truncated || after.truncated
  const allErrors = [...before.errors, ...after.errors]

  return { changes: changes.sort((a, b) => a.path.localeCompare(b.path)), incomplete, errors: allErrors }
}

/**
   * Tripwire: guarda las fotos entre el "antes" y el "después" de una tool.
   *
   * Se indexa por `callID` porque el hook `tool.execute.before` y el
   * `tool.execute.after` reciben el mismo identificador de llamada.
   */
export class Tripwire {
  private readonly snapshots = new Map<string, { snapshot: TripwireSnapshot; armedAt: number }>()
  private readonly armErrors = new Map<string, string>()

  constructor(
    private readonly root: string,
    private readonly options: TripwireOptions = {},
  ) {}

  /** Toma la foto "antes" de una llamada. */
  async arm(callID: string, scope: string[]): Promise<void> {
    try {
      const snapshot = await snapshotTree(this.root, scope, this.options)
      this.snapshots.set(callID, { snapshot, armedAt: Date.now() })
      this.armErrors.delete(callID)
    } catch (err) {
      // Registrar el error pero no impedir la operacion: el tripwire
      // es deteccion, no control.
      this.armErrors.set(callID, String(err))
    }
  }

  /**
   * Compara con la foto "después".
   *
   * Devuelve los cambios que estan FUERA del scope: los que estan adentro
   * son el trabajo esperado del agente.
   *
   * El resultado incluye metadatos sobre completitud, errores y si el arm fallo.
   */
  async check(callID: string, scope: string[]): Promise<{
    changes: TripwireChange[]
    incomplete: boolean
    errors: string[]
    armFailed: boolean
  }> {
    const entry = this.snapshots.get(callID)
    const armError = this.armErrors.get(callID)
    this.snapshots.delete(callID)
    this.armErrors.delete(callID)

    if (!entry && !armError) return { changes: [], incomplete: false, errors: [], armFailed: false }

    if (armError) {
      // El arm fallo: no hay linea base valida
      return { changes: [], incomplete: true, errors: [armError], armFailed: true }
    }

    if (!entry) return { changes: [], incomplete: false, errors: [], armFailed: false }

    try {
      const after = await snapshotTree(this.root, scope, this.options)
      const { changes, incomplete, errors } = diffSnapshots(entry.snapshot, after, scope)
      return { changes: changes.filter((c) => c.outsideScope), incomplete, errors, armFailed: false }
    } catch (err) {
      return { changes: [], incomplete: true, errors: [String(err)], armFailed: false }
    }
  }

  /** Libera las fotos que nunca se compararon, usando maxAge para antigüedad. */
  prune(maxAge = 60_000): void {
    if (!Number.isFinite(maxAge) || maxAge <= 0) return
    const now = Date.now()
    for (const [callID, entry] of this.snapshots.entries()) {
      if (now - entry.armedAt > maxAge) {
        this.snapshots.delete(callID)
        this.armErrors.delete(callID)
      }
    }
    // Protección adicional: límite duro por cantidad para evitar crecimiento ilimitado
    const HARD_LIMIT = 500
    if (this.snapshots.size > HARD_LIMIT) {
      const toDelete = this.snapshots.size - HARD_LIMIT
      const keys = [...this.snapshots.keys()].slice(0, toDelete)
      for (const key of keys) {
        this.snapshots.delete(key)
        this.armErrors.delete(key)
      }
    }
  }
}
