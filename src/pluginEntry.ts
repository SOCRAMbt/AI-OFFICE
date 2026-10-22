/**
 * Entry point del plugin OFICINA para OpenCode v2.
 *
 * Este archivo se copia a `~/.config/opencode/plugins/oficina.js` por
 * `oficina install`.
 *
 * ## Por que no puede ser un `export { default } from "oficina-opencode"`
 *
 * El loader de plugins de OpenCode v2 **no resuelve bare specifiers** desde
 * `~/.config/opencode/plugins/`. Un import de `"oficina-opencode"` falla con:
 *
 *     Cannot find package 'oficina-opencode' imported from
 *     C:\Users\...\ .config\opencode\plugins\oficina.js
 *
 * Node si lo resolveria (subiendo por los node_modules). Bun, que es el
 * runtime de OpenCode, no.
 *
 * ## Que hace este archivo entonces
 *
 * Busca el paquete donde realmente esta y lo importa por ruta absoluta. Las
 * ubicaciones se prueban en orden:
 *
 * 1. `<config>/node_modules/oficina-opencode` — instalacion normal.
 * 2. La cache de npm de OpenCode (`~/.cache/opencode/npm/...`), que es
 *    donde OpenCode deja los plugins que instala el.
 * 3. Subiendo desde la carpeta del propio archivo.
 *
 * Se prueba en runtime y no al instalar, asi que reinstalar el paquete en
 * otro lugar no rompe el entry.
 */

import { existsSync, readdirSync, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const PKG = "oficina-opencode"

/** El paquete en un directorio de node_modules. */
function fromNodeModules(base: string): string | undefined {
  const entry = path.join(base, "node_modules", PKG, "dist", "v2.js")
  if (existsSync(entry)) return entry
  return undefined
}

/** La cache de npm de OpenCode. */
function fromOpencodeCache(): string | undefined {
  const cache = path.join(os.homedir(), ".cache", "opencode", "npm")
  if (!existsSync(cache)) return undefined

  const found = []
  for (const name of readdirSync(cache)) {
    if (!name.startsWith(`${PKG}@`)) continue
    const versions = path.join(cache, name)
    try {
      if (!statSync(versions).isDirectory()) continue
    } catch {
      continue
    }
    for (const version of readdirSync(versions)) {
      const entry = path.join(versions, version, "node_modules", PKG, "dist", "v2.js")
      if (existsSync(entry)) found.push(entry)
    }
  }
  if (found.length === 0) return undefined
  // El mas reciente: el que se acaba de instalar.
  found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  return found[0]
}

/** Sube desde un directorio buscando node_modules. */
function fromAncestors(startDir: string): string | undefined {
  let dir = startDir
  for (let depth = 0; depth < 8; depth += 1) {
    const found = fromNodeModules(dir)
    if (found) return found
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

/** Resuelve el entry del motor. */
function resolveEngine() {
  const configDir = process.env.OPENCODE_CONFIG_DIR ?? path.join(os.homedir(), ".config", "opencode")
  const here = path.dirname(fileURLToPath(import.meta.url))

  const candidates = [
    fromNodeModules(configDir),
    fromOpencodeCache(),
    fromAncestors(here),
    fromAncestors(process.cwd()),
  ].filter((c) => Boolean(c))

  const found = candidates[0]
  if (!found) {
    throw new Error(
      `[oficina] no se encontro el paquete "${PKG}". ` +
        `Instalalo con \`npm install -g ${PKG}\` o \`npm install ${PKG}\` en ${configDir}.`,
    )
  }
  return found
}

const engine = resolveEngine()
const modulo = await import(pathToFileURL(engine).href)
export default modulo.default
