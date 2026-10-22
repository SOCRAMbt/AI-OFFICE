/**
 * Resolución de paths de la oficina.
 *
 * El problema que resuelve: los permisos y las rutas relativas de OpenCode
 * resuelven contra el directorio de trabajo de la sesión, que no siempre es el
 * proyecto. Si la oficina asumiera `cwd`, escribiría sus artefactos en el
 * lugar equivocado y los agentes no se encontrarían.
 *
 * La regla: `PROJECT_ROOT` se detecta por marcadores de proyecto y todos los
 * paths de la oficina son absolutos.
 */

import path from "node:path"
import fs from "node:fs/promises"
import { exists } from "./fsx.js"
import { safeId } from "./ids.js"

export const PROJECT_MARKERS = [
  "package.json",
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Makefile",
  "composer.json",
  "Gemfile",
  "deno.json",
  ".git",
]

export interface ResolvedPaths {
  /** Raíz del proyecto. */
  projectRoot: string
  /** Directorio de la oficina: `<projectRoot>/.oficina`. */
  officeDir: string
  /** `<officeDir>/bus`. */
  busDir: string
  /** `<officeDir>/inbox`. */
  inboxDir: string
  /** `<officeDir>/leases`. */
  leasesDir: string
  /** `<officeDir>/artifacts`. */
  artifactsDir: string
  /** `<officeDir>/fichas`. */
  fichasDir: string
  /** `<officeDir>/roster.json`. */
  rosterPath: string
  /** `<officeDir>/state.json`. */
  statePath: string
  /** `<officeDir>/context.md`. */
  contextPath: string
  /** `<officeDir>/board.md`. */
  boardPath: string
  /** `<officeDir>/config.json`. */
  configPath: string
  /** Si se usó el fallback global en vez del project-local. */
  fallback: boolean
}

/** ¿El directorio parece la raíz de un proyecto? */
export async function looksLikeProjectRoot(dir: string): Promise<boolean> {
  for (const marker of PROJECT_MARKERS) {
    if (exists(path.join(dir, marker))) return true
  }
  return false
}

/**
 * Resuelve el project root.
 *
 * 1. Si `cwd` es un project root → ese.
 * 2. Si no, busca subdirectorios de primer nivel que lo sean. Si hay
 *    exactamente uno → ese. Si hay varios → el de mayor cantidad de fuentes.
 * 3. Si no hay ninguno → `cwd`.
 */
export async function resolveProjectRoot(cwd: string): Promise<string> {
  const abs = path.resolve(cwd)
  if (await looksLikeProjectRoot(abs)) return abs

  let entries: string[] = []
  try {
    entries = (await fs.readdir(abs, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
      .map((e) => e.name)
  } catch {
    return abs
  }

  const candidates: { dir: string; weight: number }[] = []
  for (const name of entries) {
    const dir = path.join(abs, name)
    if (await looksLikeProjectRoot(dir)) {
      let weight = 0
      for (const sub of ["src", "lib", "app", "packages", "server", "client"]) {
        if (exists(path.join(dir, sub))) weight += 10
      }
      candidates.push({ dir, weight })
    }
  }

  if (candidates.length === 0) return abs
  if (candidates.length === 1) return candidates[0]!.dir
  candidates.sort((a, b) => b.weight - a.weight)
  return candidates[0]!.dir
}

/**
 * Resuelve todos los paths de la oficina.
 *
 * Intenta `<projectRoot>/.oficina`. Si no se puede crear (proyecto de solo
 * lectura, sandbox), cae a `~/.oficina/<slug>`.
 */
export async function resolvePaths(cwd: string): Promise<ResolvedPaths> {
  const projectRoot = await resolveProjectRoot(cwd)
  const localOffice = path.join(projectRoot, ".oficina")

  let officeDir = localOffice
  let fallback = false
  try {
    await fs.mkdir(localOffice, { recursive: true })
    const probe = path.join(localOffice, ".write-probe")
    await fs.writeFile(probe, "ok")
    await fs.rm(probe, { force: true })
  } catch {
    const slug = path.basename(projectRoot).replace(/[^a-zA-Z0-9._-]/g, "-") || "proyecto"
    officeDir = path.join(process.env.HOME ?? process.env.USERPROFILE ?? ".", ".oficina", slug)
    await fs.mkdir(officeDir, { recursive: true })
    fallback = true
  }

  return {
    projectRoot,
    officeDir,
    busDir: path.join(officeDir, "bus"),
    inboxDir: path.join(officeDir, "inbox"),
    leasesDir: path.join(officeDir, "leases"),
    artifactsDir: path.join(officeDir, "artifacts"),
    fichasDir: path.join(officeDir, "fichas"),
    rosterPath: path.join(officeDir, "roster.json"),
    statePath: path.join(officeDir, "state.json"),
    contextPath: path.join(officeDir, "context.md"),
    boardPath: path.join(officeDir, "board.md"),
    configPath: path.join(officeDir, "config.json"),
    fallback,
  }
}

/**
 * Path de una card.
 *
 * El `cardId` se sanitiza: viene del modelo y se usaba crudo como nombre
 * de directorio. Con `cardId = "../../evil"`, `writeAtomic` (que hace
 * `mkdir -p` del padre) escribia los artefactos fuera de `.oficina/`.
 */
export function cardDir(paths: ResolvedPaths, cardId: string): string {
  const safe = safeId(cardId)
  if (!safe) throw new UnsafeIdError(cardId, "cardId")
  return path.join(paths.artifactsDir, safe)
}

/** Path del inbox de un agente. */
export function inboxDirOf(paths: ResolvedPaths, agentId: string): string {
  const safe = safeId(agentId)
  if (!safe) throw new UnsafeIdError(agentId, "agentId")
  return path.join(paths.inboxDir, safe)
}

/** Path de un lease. */
export function leasePath(paths: ResolvedPaths, taskId: string): string {
  const safe = safeId(taskId)
  if (!safe) throw new UnsafeIdError(taskId, "taskId")
  return path.join(paths.leasesDir, `${safe}.json`)
}

/** Error de un id que no se puede usar como nombre de archivo. */
export class UnsafeIdError extends Error {
  constructor(raw: string, field: string) {
    super(
      `[oficina] ${field} no seguro: "${raw}". No puede contener separadores de ruta, "..", ` +
        `caracteres de control, ni empezar con punto.`,
    )
    this.name = "UnsafeIdError"
  }
}

/** Convierte un path absoluto a relativo al project root, para artefactos. */
export function relToProject(paths: ResolvedPaths, target: string): string {
  const rel = path.relative(paths.projectRoot, target)
  return rel.startsWith("..") ? target : rel
}
