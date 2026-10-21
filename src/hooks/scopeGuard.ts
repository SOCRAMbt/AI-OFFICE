/**
 * Hook: guard de scope.
 *
 * ESTE es el hook que convierte "no toques archivos fuera de tu scope" de
 * una instrucción en una restricción. Un prompt le pide al modelo que sea
 * cuidadoso; este hook le impide hacerlo.
 *
 * Cuando una sesión intenta escribir un archivo que no está en el scope de
 * su card, la operación se rechaza con un error que explica qué hacer.
 *
 * El guard tiene una salida: si el archivo es claramente correcto y el
 * modelo insiste, el scope de la card se puede ampliar. Pero el default es
 * denegar.
 */

import path from "node:path"
import type { Office } from "../core/office.js"
import { logger } from "../core/log.js"

const log = logger("oficina:scope-guard")

/** Tools que escriben en disco. */
const WRITE_TOOLS = new Set(["edit", "write", "patch", "multiedit", "apply_patch"])

export interface ScopeGuardOptions {
  /** Si es false, el guard solo avisa y no bloquea. */
  enforce: boolean
}

/**
 * Glob mínimo a regex. Soporta `*`, `**` y `?`.
 *
 * El orden de los reemplazos importa: el `?` se convierte ANTES de insertar
 * los patrones de `**`, porque el grupo insertado contiene un `?` literal
 * que, si se convierte después, se rompe y deja de matchear.
 */
export function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    // `?` primero: los patrones insertados después contienen `?` literal.
    .replace(/\?/g, ".")
    .replace(/\*\*\//g, "\u0000")
    .replace(/\*\*/g, "\u0001")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, "(?:.*/)?")
    .replace(/\u0001/g, ".*")
  return new RegExp(`^${escaped}$`)
}

/** ¿El path cae dentro de alguno de los globs? */
export function matchesScope(relativePath: string, globs: string[]): boolean {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "")
  return globs.some((glob) => {
    if (glob === "**") return true
    return globToRegex(glob).test(normalized)
  })
}

/** Extrae el path del argumento de una tool de escritura. */
export function extractPath(tool: string, args: Record<string, unknown>): string | undefined {
  const candidates = ["filePath", "path", "file", "target", "notebook_path"]
  for (const key of candidates) {
    const value = args[key]
    if (typeof value === "string" && value.length > 0) return value
  }
  // El tool `patch` puede traer los paths dentro de un patch estructurado.
  if (tool === "patch" || tool === "apply_patch") {
    const patch = args.patch ?? args.diff
    if (typeof patch === "string") {
      const m = /^---+\s+(.+)$/m.exec(patch)
      if (m?.[1]) return m[1].trim()
    }
  }
  return undefined
}

export function createScopeGuardHook(office: Office, options: ScopeGuardOptions = { enforce: true }) {
  return async function onToolExecuteBefore(
    input: { tool: string; sessionID: string; callID: string },
    output: { args: Record<string, unknown> },
  ): Promise<void> {
    if (!output?.args) return
    if (!WRITE_TOOLS.has(input.tool)) return

    try {
      const state = await office.loadState()
      const card = office.sessionCard(state, input.sessionID)
      // Sin card activa no hay scope que aplicar: el agente está en
      // exploración libre o en una operación que no es de la oficina.
      if (!card) return

      const rawPath = extractPath(input.tool, output.args)
      if (!rawPath) return

      const absolute = path.isAbsolute(rawPath)
        ? rawPath
        : path.join(office.paths.projectRoot, rawPath)
      const relative = path.relative(office.paths.projectRoot, absolute).replace(/\\/g, "/")

      // Los artefactos de la oficina siempre están permitidos: son el canal.
      if (relative.startsWith(".oficina/")) return

      const mayTouch = card.scope.mayTouch
      const forbidden = card.scope.forbidden

      if (matchesScope(relative, forbidden)) {
        throw new Error(
          `[OFICINA] Scope violado: \`${relative}\` está en el scope forbidden de la card ${card.id}. ` +
            `Forbidden: ${forbidden.join(", ")}. No lo toques. Si realmente hace falta, pedí que se amplíe el scope.`,
        )
      }

      if (!matchesScope(relative, mayTouch)) {
        throw new Error(
          `[OFICINA] Scope violado: \`${relative}\` está fuera del scope de la card ${card.id}. ` +
            `Podés tocar: ${mayTouch.join(", ")}. ` +
            `Si el archivo es necesario, pedí por el bus que se amplíe el scope, o pedí ayuda a un peer que lo cubra.`,
        )
      }

      log.debug("scope ok", { card: card.id, file: relative })
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("[OFICINA]")) {
        if (options.enforce) throw err
        log.warn("scope violado (sin bloquear)", { error: err.message })
        return
      }
      log.error("fallo en el guard de scope", { error: String(err) })
    }
  }
}
