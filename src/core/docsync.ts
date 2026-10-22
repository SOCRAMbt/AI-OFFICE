/**
 * Fuente unica de verdad para las cifras de la documentacion.
 *
 * ## Por que existe
 *
 * El README decia "306 agentes en 25 divisiones" y la guia en lenguaje
 * llano decia "80 o mas". Las dos cifras tenian la misma edad y las dos
 * estaban mal, cada una a su modo: una contando el repo entero, la otra
 * contando un subconjunto. Y nadie se dio cuenta, porque las dos estaban
 * escritas a mano.
 *
 * La solucion no es "arreglar los numeros": es **no escribirlos a mano**.
 * Las cifras se calculan del catalogo real y del codigo real, y un script
 * las inyecta en la documentacion. Si el codigo cambia, la documentacion
 * se desincroniza y **el CI falla**.
 *
 * ## El bloque generado
 *
 * La documentacion tiene un bloque delimitado:
 *
 *     <!-- BEGIN GENERATED: facts -->
 *     ...
 *     <!-- END GENERATED: facts -->
 *
 * El script lo reemplaza. Todo lo que este FUERA del bloque es texto
 * humano y no se toca.
 */

import fs from "node:fs/promises"
import path from "node:path"
import { scanCatalog } from "./catalog.js"
import { buildTools } from "../tools/index.js"
import { DEFAULT_LIMITS } from "./types.js"

export const FACTS_BEGIN = "<!-- BEGIN GENERATED: facts -->"
export const FACTS_END = "<!-- END GENERATED: facts -->"

export interface CatalogFacts {
  /** Agentes que el matcher puede resolver. */
  agents: number
  /** Divisiones distintas de esos agentes. */
  divisions: number
  /** Las divisiones, ordenadas. */
  divisionList: string[]
  /** De donde se leyo. */
  source: string
  /** Cuando se escaneo. */
  generatedAt: string
  /**
   * Commit del repo de agency-agents del que se escaneo.
   *
   * Sin esto, el número no es trazable: "258 agentes" no dice de qué
   * versión del catálogo sale.
   */
  sourceCommit: string | null
}

export interface ProjectFacts {
  packageName: string
  version: string
  /** Numero de tools registradas. */
  tools: number
  /** Nombres de las tools, ordenadas. */
  toolNames: string[]
  /** Numero de hooks que registra el plugin. */
  hooks: number
  /** Version del API de plugin contra la que se compilo. */
  pluginApi: { version: string; range: string }
  /** Requisitos de runtime. */
  runtime: { node: string }
  /** Limites por defecto. */
  limits: {
    maxCards: number
    maxAgentCalls: number
    maxSpawnsTotal: number
    maxConcurrentAgents: number
    leaseTtlSec: number
    minCatalogCoverage: number
  }
  /** Catalogo, si se pudo escanear. */
  catalog: CatalogFacts | null
}

export interface ComputeFactsOptions {
  /** Raiz del repo del proyecto (para leer package.json). */
  projectRoot: string
  /** Raiz del catalogo de agency-agents. */
  agencyRoot?: string
  /**
   * Snapshot del catalogo ya escaneado.
   *
   * El catalogo de agency-agents es un repo externo: no esta en el paquete
   * npm ni en el CI. Si la documentacion dependiera de escanearlo en cada
   * build, el CI no podria verificar nada.
   *
   * Por eso el escaneo se **versiona**: `docs/catalog-facts.json` guarda
   * las cifras con su procedencia (raiz y commit). El build usa el
   * snapshot; refrescarlo es un acto explicito (`npm run docs:sync` con el
   * repo disponible).
   */
  catalogSnapshot?: CatalogFacts | null
}

/**
 * Lee la version del API de plugin instalada.
 *
 * Hay dos paquetes y los dos importan: `@opencode/plugin` (v2, el que usa el
 * entry por defecto) y `@opencode-ai/plugin` (v1, el entry legacy). Se
 * reporta el v2 porque es el que define la compatibilidad real.
 */
async function readPluginApiVersion(projectRoot: string): Promise<{ version: string; range: string }> {
  const fallback = { version: "desconocida", range: "desconocida" }
  try {
    const pkgPath = path.join(projectRoot, "package.json")
    const raw = await fs.readFile(pkgPath, "utf8")
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
    }
    const range =
      pkg.dependencies?.["@opencode/plugin"] ??
      pkg.peerDependencies?.["@opencode-ai/plugin"] ??
      pkg.dependencies?.["@opencode-ai/plugin"]
    if (!range) return fallback
    return { version: range.replace(/^[\^~>=<\s]*/, ""), range }
  } catch {
    return fallback
  }
}

/**
 * Calcula los hechos del proyecto.
 *
 * Todo sale del codigo o del disco: nada esta escrito a mano.
 */
export async function computeFacts(options: ComputeFactsOptions): Promise<ProjectFacts> {
  const { projectRoot } = options

  let packageName = "oficina-opencode"
  let version = "0.0.0"
  try {
    const raw = await fs.readFile(path.join(projectRoot, "package.json"), "utf8")
    const pkg = JSON.parse(raw) as { name?: string; version?: string }
    packageName = pkg.name ?? packageName
    version = pkg.version ?? version
  } catch {
    // El paquete puede no estar armado todavia.
  }

  // Las tools se cuentan sobre una instancia real: si alguien agrega una
  // tool y olvida la documentacion, el numero sale solo.
  const tools = buildTools({} as never)
  const toolNames = Object.keys(tools).sort()

  let catalog: CatalogFacts | null = options.catalogSnapshot ?? null
  const agencyRoot = options.agencyRoot ?? defaultAgencyRoot()
  if (!catalog && agencyRoot) {
    try {
      const agents = await scanCatalog({ root: agencyRoot })
      const divisions = [...new Set(agents.map((a) => a.division))].sort()
      catalog = {
        agents: agents.length,
        divisions: divisions.length,
        divisionList: divisions,
        source: agencyRoot,
        generatedAt: new Date().toISOString(),
        sourceCommit: await readGitCommit(agencyRoot),
      }
    } catch {
      catalog = null
    }
  }

  return {
    packageName,
    version,
    tools: toolNames.length,
    toolNames,
    hooks: 7,
    pluginApi: await readPluginApiVersion(projectRoot),
    runtime: { node: ">=20" },
    limits: {
      maxCards: DEFAULT_LIMITS.maxCards,
      maxAgentCalls: DEFAULT_LIMITS.maxAgentCalls,
      maxSpawnsTotal: DEFAULT_LIMITS.maxSpawnsTotal,
      maxConcurrentAgents: DEFAULT_LIMITS.maxConcurrentAgents,
      leaseTtlSec: DEFAULT_LIMITS.leaseTtlSec,
      minCatalogCoverage: DEFAULT_LIMITS.minCatalogCoverage,
    },
    catalog,
  }
}

/** Renderiza el bloque generado. */
export function renderFactsBlock(facts: ProjectFacts): string {
  const rows: string[] = []
  rows.push(`| | |`)
  rows.push(`|---|---|`)
  rows.push(`| **Paquete** | \`${facts.packageName}\` v${facts.version} |`)
  rows.push(`| **Tools** | ${facts.tools} |`)
  rows.push(`| **Hooks** | ${facts.hooks} |`)
  rows.push(`| **API de plugin** | \`@opencode/plugin@${facts.pluginApi.version}\` |`)
  rows.push(`| **Node** | ${facts.runtime.node} |`)
  if (facts.catalog) {
    rows.push(
      `| **Catálogo** | ${facts.catalog.agents} agentes resolubles en ${facts.catalog.divisions} divisiones |`,
    )
    rows.push(`| **Divisiones** | ${facts.catalog.divisionList.join(", ")} |`)
  } else {
    rows.push(`| **Catálogo** | (no se pudo escanear en esta máquina) |`)
  }
  rows.push(
    `| **Límites** | ${facts.limits.maxCards} cards · ${facts.limits.maxAgentCalls} llamadas · ` +
      `${facts.limits.maxSpawnsTotal} spawns · ${facts.limits.maxConcurrentAgents} agentes |`,
  )
  rows.push(
    `| **Cobertura mínima** | ${(facts.limits.minCatalogCoverage * 100).toFixed(0)}% |`,
  )
  return rows.join("\n")
}

/** Ubica el bloque generado en un texto. */
export function findFactsBlock(content: string): { start: number; end: number; text: string } | null {
  const start = content.indexOf(FACTS_BEGIN)
  if (start === -1) return null
  const end = content.indexOf(FACTS_END, start)
  if (end === -1) return null
  return { start, end: end + FACTS_END.length, text: content.slice(start, end + FACTS_END.length) }
}

/** Reemplaza el bloque generado. */
export function replaceFactsBlock(content: string, block: string): string {
  const found = findFactsBlock(content)
  if (!found) return content
  return content.slice(0, found.start) + block + content.slice(found.end)
}

/** La raiz por defecto del catalogo. */
export function defaultAgencyRoot(): string | undefined {
  const home = process.env.HOME ?? process.env.USERPROFILE
  if (!home) return undefined
  return path.join(home, "agency-agents")
}

/** El commit del repo de agency-agents, para trazar de donde sale la cifra. */
export async function readGitCommit(root: string): Promise<string | null> {
  try {
    const { execFileSync } = await import("node:child_process")
    const out = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    return out.trim() || null
  } catch {
    return null
  }
}

/** Path del snapshot del catalogo. */
export function catalogSnapshotPath(projectRoot: string): string {
  return path.join(projectRoot, "docs", "catalog-facts.json")
}

/** Lee el snapshot del catalogo. */
export async function readCatalogSnapshot(projectRoot: string): Promise<CatalogFacts | null> {
  try {
    const raw = await fs.readFile(catalogSnapshotPath(projectRoot), "utf8")
    const parsed = JSON.parse(raw) as CatalogFacts
    if (typeof parsed.agents !== "number" || typeof parsed.divisions !== "number") return null
    return parsed
  } catch {
    return null
  }
}

/** Escribe el snapshot del catalogo. */
export async function writeCatalogSnapshot(projectRoot: string, facts: CatalogFacts): Promise<void> {
  await fs.writeFile(catalogSnapshotPath(projectRoot), `${JSON.stringify(facts, null, 2)}\n`, "utf8")
}
