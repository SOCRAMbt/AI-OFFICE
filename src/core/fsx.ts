/**
 * IO atómico.
 *
 * El bus es append-only y varios agentes leen y escriben a la vez. Un rename
 * POSIX/Windows sobre un archivo temporal es atómico: un lector ve el archivo
 * viejo completo o el nuevo completo, nunca un JSON partido. Ese detalle es la
 * diferencia entre "el bus anda" y "el bus anda y de vez en cuando traga un
 * error de parse que nadie entiende".
 */

import { createHash, randomBytes } from "node:crypto"
import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

/** Escribe un archivo de forma atómica: tmp + rename. */
export async function writeAtomic(filePath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${randomBytes(6).toString("hex")}.tmp`
  try {
    await fs.writeFile(tmp, contents, "utf8")
    await fs.rename(tmp, filePath)
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

/** Escribe JSON de forma atómica, con newline final. */
export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writeAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

/**
 * Lee JSON. Devuelve `undefined` si el archivo no existe o está corrupto.
 *
 * Un archivo corrupto no debe tumbar la corrida: se loguea y se sigue con lo
 * que hubiera. Perder un artefacto es malo; perder la oficina entera es peor.
 */
export async function readJson<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8")
    return JSON.parse(raw) as T
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === "ENOENT") return undefined
    if (err instanceof SyntaxError) {
      // Archivo corrupto o escritura a medio hacer. Se aparta y se sigue.
      const quarantine = `${filePath}.corrupt-${Date.now()}`
      await fs.rename(filePath, quarantine).catch(() => {})
      return undefined
    }
    throw err
  }
}

/** Lee texto. Devuelve `undefined` si no existe. */
export async function readText(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8")
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw err
  }
}

/** Existe sin lanzar. */
export function exists(filePath: string): boolean {
  return existsSync(filePath)
}

/** Crea un directorio recursivamente (idempotente). */
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}

/** Lista archivos de un directorio. Devuelve `[]` si no existe. */
export async function listFiles(dirPath: string): Promise<string[]> {
  try {
    return await fs.readdir(dirPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return []
    throw err
  }
}

/** Lista subdirectorios de un directorio. Devuelve `[]` si no existe. */
export async function listDirs(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return []
    throw err
  }
}

/** Elimina un archivo si existe. */
export async function removeIfExists(filePath: string): Promise<void> {
  await fs.rm(filePath, { force: true, recursive: true })
}

/** Id corto y único, con prefijo. */
export function shortId(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}`
}

/** Hash estable de un string, para claves de idempotencia. */
export function stableHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16)
}

/** Timestamp ISO. Inyectable para tests. */
export function nowIso(clock: () => number = Date.now): string {
  return new Date(clock()).toISOString()
}
