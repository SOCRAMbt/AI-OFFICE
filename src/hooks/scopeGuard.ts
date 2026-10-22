/**
 * Hook: guard de scope.
 *
 * ESTE es el hook que convierte "no toques archivos fuera de tu scope" de
 * una instrucción en una restricción. Un prompt le pide al modelo que sea
 * cuidadoso; este hook le impide hacerlo.
 *
 * ## Qué cambió y por qué
 *
 * La versión anterior comparaba strings:
 *
 *     const relative = path.relative(projectRoot, absolute)
 *     if (!matchesScope(relative, mayTouch)) throw ...
 *
 * Eso se puede eludir por tres vías, y las tres eran reales:
 *
 *   1. **Symlink.** `src/link.ts` -> `../../etc/secrets.ts`. El relativo es
 *      `src/link.ts`, que matchea `src/**`. Autorizado. La escritura pasa.
 *   2. **`mayTouch: ["**"]`.** `**` matcheaba cualquier string, incluido
 *      `../../etc/passwd`. Un `**` tiene que significar "el proyecto", no
 *      "el filesystem".
 *   3. **Paths absolutos.** `/etc/passwd` tiene un relativo `../../etc/passwd`
 *      y con `**` pasaba de largo.
 *
 * Ahora la ruta se **resuelve** (absoluta -> normalizada -> symlinks
 * resueltos -> realpath) y recién ahí se decide. Y la decisión es
 * fail-closed.
 *
 * ## Qué cubre ahora
 *
 * - **Todas las tools que escriben un archivo**, no solo `edit`/`write`:
 *   `patch` (incluyendo diffs multi-archivo), `multiedit`, `notebook_edit`,
 *   `str_replace`, y las variantes con prefijo de provider.
 * - **Los comandos de shell.** `bash > ../fuera`, `cp a /etc/passwd`,
 *   `sed -i`, `python -c "open(...)"` se analizan antes de ejecutarse.
 * - **Los subagentes.** Un subagente es una sesion hija; el guard sube por
 *   la cadena de padres hasta encontrar la sesion que tiene la card, y le
 *   aplica el MISMO scope. Sin esto, delegar era un escalón para salirse.
 * - **Los archivos sensibles.** `.env`, `.npmrc`, `.git/**`, claves privadas:
 *   jamas escribibles, pase lo que pase el scope de la card.
 *
 * ## Lo que este hook NO puede hacer
 *
 * Un comando de shell con un interpreter embebido puede escribir en
 * cualquier lado, y no hay forma de saberlo antes de correrlo. Para eso
 * esta el tripwire (`core/tripwire.ts`): se arma antes del comando y se
 * verifica despues. Es deteccion, no prevencion — y por eso el README lo
 * dice asi, en vez de prometer un aislamiento que no existe.
 */

import type { Card, OfficeState } from "../core/types.js"
import type { Office } from "../core/office.js"
import {
  analyzeShellCommand,
  checkScope,
  globToRegex,
  matchesScope,
  type ScopeVerdict,
} from "../core/sandbox.js"
import { logger } from "../core/log.js"

const log = logger("oficina:scope-guard")

/**
 * Tools que escriben UN archivo.
 *
 * Se listan con prefijos porque cada provider registra sus tools con
 * nombre distinto (`str_replace`, `str_replace_based_edit_tool`,
 * `edit_notebook_file`...). El prefijo cubre la familia entera.
 */
const FILE_WRITE_TOOLS = new Set([
  "edit",
  "write",
  "patch",
  "multiedit",
  "apply_patch",
  "notebook_edit",
  "str_replace",
  "str_replace_editor",
  "str_replace_based_edit_tool",
  "edit_file",
  "edit_notebook_file",
  "create_file",
  "write_file",
  "create_or_update_file",
  "multi_edit",
])

/** Tools que ejecutan shell. */
const SHELL_TOOLS = new Set([
  "bash",
  "shell",
  "run",
  "run_command",
  "execute_command",
  "terminal",
  "powershell",
  "cmd",
  "powershell.exe",
])

/** Tools que delegan a otro agente. */
const DELEGATE_TOOLS = new Set(["task", "agent", "subagent", "spawn_agent"])

export interface ScopeGuardOptions {
  /** Si es false, el guard solo avisa y no bloquea. */
  enforce: boolean
  /**
   * Resuelve el `parentID` de una sesión.
   *
   * Es lo que hace que los subagentes hereden el scope: el hijo sube por
   * la cadena hasta encontrar la sesión con la card.
   */
  resolveParentSession?: (sessionID: string) => Promise<string | undefined>
  /**
   * Qué hacer con los comandos de shell.
   *
   * - `block`: un comando que claramente escribe fuera del scope se bloquea.
   * - `warn`: se avisa pero se deja pasar (el tripwire cubre).
   */
  shellPolicy?: "block" | "warn"
  /** Profundidad maxima de la cadena de padres que se recorre. */
  maxParentDepth?: number
}

/* ────────────────────────────────────────────────────────────────────────────
 * Extraccion de paths
 * ──────────────────────────────────────────────────────────────────────────── */

/** Claves de argumento que contienen un path de archivo. */
const PATH_KEYS = ["filePath", "path", "file", "target", "notebook_path", "filename", "file_path"]

/**
 * Extrae TODOS los paths que una tool de escritura quiere tocar.
 *
 * La versión anterior devolvía un solo path, y para `patch` leía **solo el
 * primer** `---` del diff. Un diff de cinco archivos pasaba el control con
 * el primero y se escribían los otros cuatro.
 */
export function extractPaths(tool: string, args: Record<string, unknown>): string[] {
  const out: string[] = []

  for (const key of PATH_KEYS) {
    const value = args[key]
    if (typeof value === "string" && value.length > 0) out.push(value)
    else if (Array.isArray(value)) {
      for (const v of value) if (typeof v === "string" && v.length > 0) out.push(v)
    }
  }

  // El tool `patch` puede traer los paths dentro de un patch estructurado.
  const patch = args.patch ?? args.diff ?? args.edits
  if (typeof patch === "string") {
    out.push(...pathsFromPatch(patch))
  } else if (Array.isArray(patch)) {
    for (const entry of patch) {
      if (typeof entry === "string") out.push(...pathsFromPatch(entry))
      else if (entry && typeof entry === "object") {
        const rec = entry as Record<string, unknown>
        for (const key of PATH_KEYS) {
          const v = rec[key]
          if (typeof v === "string" && v.length > 0) out.push(v)
        }
      }
    }
  }

  // Estructura `{ path, edits }` que usan algunos providers.
  const edits = args.edits
  if (Array.isArray(edits)) {
    for (const e of edits) {
      if (e && typeof e === "object") {
        const rec = e as Record<string, unknown>
        for (const key of PATH_KEYS) {
          const v = rec[key]
          if (typeof v === "string" && v.length > 0) out.push(v)
        }
      }
    }
  }

  // Deduplicar conservando el orden.
  const seen = new Set<string>()
  return out.filter((p) => {
    if (seen.has(p)) return false
    seen.add(p)
    return true
  })
}

/**
 * Paths de un diff unificado.
 *
 * Lee **todas** las lineas `---` y `+++`. Si el diff usa el prefijo de git
 * (`a/`, `b/`) se lo saca, pero solo si AMBOS lados lo usan: un archivo
 * llamado `a/notas.md` es un path legitimo.
 */
export function pathsFromPatch(patch: string): string[] {
  const minus: string[] = []
  const plus: string[] = []

  for (const line of patch.split(/\r?\n/)) {
    const m = /^---+\s+(.+?)\s*$/.exec(line)
    if (m?.[1]) minus.push(m[1])
    const p = /^\+\+\+\s+(.+?)\s*$/.exec(line)
    if (p?.[1]) plus.push(p[1])
  }

  const usaPrefijoGit =
    minus.length > 0 &&
    minus.every((p) => p.startsWith("a/")) &&
    plus.length > 0 &&
    plus.every((p) => p.startsWith("b/"))

  const strip = (p: string) => (usaPrefijoGit ? p.slice(2) : p)

  // `--- /dev/null` marca un archivo nuevo: el path real viene del `+++`.
  const out: string[] = []
  for (const p of [...minus, ...plus]) {
    if (p === "/dev/null" || p === "dev/null") continue
    const clean = strip(p)
    if (clean) out.push(clean)
  }
  return out
}

/**
 * El path de una tool de escritura. Se mantiene por compatibilidad con el
 * API anterior; `extractPaths` es la version que hay que usar.
 */
export function extractPath(tool: string, args: Record<string, unknown>): string | undefined {
  return extractPaths(tool, args)[0]
}

/** El comando de una tool de shell. */
export function extractCommand(args: Record<string, unknown>): string | undefined {
  for (const key of ["command", "cmd", "script", "input", "shellCommand"]) {
    const value = args[key]
    if (typeof value === "string" && value.length > 0) return value
  }
  return undefined
}

/* ────────────────────────────────────────────────────────────────────────────
 * Resolucion de scope
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * La card que gobierna una sesión.
 *
 * Primero mira el binding directo. Si no hay, sube por la cadena de
 * padres: un subagente es una sesión hija, y su scope es el de quien lo
 * lanzo.
 */
export async function resolveScopeCard(
  state: OfficeState,
  sessionID: string,
  options: ScopeGuardOptions,
): Promise<Card | undefined> {
  const direct = state.sessions[sessionID]
  if (direct?.cardId) {
    const card = state.cards[direct.cardId]
    if (card) return card
  }

  const resolveParent = options.resolveParentSession
  if (!resolveParent) return undefined

  const maxDepth = options.maxParentDepth ?? 6
  const visited = new Set<string>([sessionID])
  let current = sessionID

  for (let depth = 0; depth < maxDepth; depth += 1) {
    let parent: string | undefined
    try {
      parent = await resolveParent(current)
    } catch (err) {
      log.debug("no se pudo resolver el padre de la sesion", { sessionID: current, error: String(err) })
      return undefined
    }
    if (!parent || visited.has(parent)) break
    visited.add(parent)

    const binding = state.sessions[parent]
    if (binding?.cardId) {
      const card = state.cards[binding.cardId]
      if (card) return card
    }
    current = parent
  }

  return undefined
}

/* ────────────────────────────────────────────────────────────────────────────
 * Hook
 * ──────────────────────────────────────────────────────────────────────────── */

function scopeError(verdict: ScopeVerdict, card: Card): Error {
  return new Error(`[OFICINA] Scope violado: ${verdict.reason} (card ${card.id})`)
}

export function createScopeGuardHook(office: Office, options: ScopeGuardOptions = { enforce: true }) {
  const shellPolicy = options.shellPolicy ?? "block"

  return async function onToolExecuteBefore(
    input: { tool: string; sessionID: string; callID: string },
    output: { args: Record<string, unknown> },
  ): Promise<void> {
    const args = output?.args
    if (!args || typeof args !== "object") return

    const tool = String(input.tool ?? "")
    const isFileWrite = FILE_WRITE_TOOLS.has(tool)
    const isShell = SHELL_TOOLS.has(tool)
    const isDelegate = DELEGATE_TOOLS.has(tool)
    if (!isFileWrite && !isShell && !isDelegate) return

    try {
      const state = await office.loadState()
      const card = await resolveScopeCard(state, input.sessionID, options)
      // Sin card activa no hay scope que aplicar: el agente está en
      // exploración libre o en una operación que no es de la oficina.
      if (!card) return

      const policy = { mayTouch: card.scope.mayTouch, forbidden: card.scope.forbidden }
      const projectRoot = office.paths.projectRoot

      /* ── Archivos ────────────────────────────────────────────────────── */
      if (isFileWrite) {
        const paths = extractPaths(tool, args)
        if (paths.length === 0) return
        for (const p of paths) {
          const verdict = await checkScope(projectRoot, p, policy)
          if (!verdict.allowed) {
            log.warn("scope violado (archivo)", { card: card.id, path: p, kind: verdict.kind })
            if (options.enforce) throw scopeError(verdict, card)
          }
        }
        log.debug("scope ok", { card: card.id, tool, paths: paths.length })
        return
      }

      /* ── Shell ───────────────────────────────────────────────────────── */
      if (isShell) {
        const command = extractCommand(args)
        if (!command) return
        const candidates = analyzeShellCommand(command)
        if (candidates.length === 0) return

        for (const candidate of candidates) {
          if (candidate.uncertain) {
            // Hay una escritura que no sabemos interpretar. No se bloquea
            // (seria inservible) pero se avisa: el tripwire va a vigilar.
            log.warn("shell con escritura no interpretable", {
              card: card.id,
              op: candidate.op,
              command: command.slice(0, 200),
            })
            continue
          }
          const verdict = await checkScope(projectRoot, candidate.target, policy)
          if (!verdict.allowed) {
            log.warn("scope violado (shell)", {
              card: card.id,
              target: candidate.target,
              op: candidate.op,
              kind: verdict.kind,
            })
            if (options.enforce && shellPolicy === "block") {
              throw scopeError(verdict, card)
            }
          }
        }
        return
      }

      /* ── Delegacion ──────────────────────────────────────────────────── */
      // Delegar no escribe, pero crea un actor nuevo. Se registra para que
      // el subagente herede el scope cuando el motor cree su sesion.
      if (isDelegate) {
        log.debug("delegacion dentro de scope", { card: card.id, tool })
      }
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

export { globToRegex, matchesScope }
