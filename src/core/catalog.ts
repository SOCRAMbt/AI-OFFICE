/**
 * Catálogo: resolución de roles desde agency-agents.
 *
 * La idea: no hardcodear 10 agentes. El sistema busca en el catálogo real
 * (agency-agents clonado localmente) el agente que mejor matchea las
 * capabilities que la card necesita, y solo si el match es bueno (cobertura
 * ≥ 60%) lo usa. Si no, la factory crea el rol.
 *
 * Esto es lo que mata el "subagente monotono": el roster se arma según el
 * objetivo, no según una lista fija.
 */

import path from "node:path"
import fs from "node:fs/promises"
import type { CatalogAgent, CatalogMatch } from "./types.js"
import { listDirs, listFiles, readText } from "./fsx.js"

/**
 * Mapa de tokens a capabilities. Un agente de agency-agents no declara
 * capabilities estructuradas, así que se infieren de su nombre y
 * descripción. El mapa es el dominio conocido; un token desconocido no
 * matchea nada, pero las palabras del nombre y la descripción también
 * cuentan como capabilities literales.
 */
export const CAPABILITY_TAXONOMY: Record<string, string[]> = {
  react: ["react", "component", "jsx", "hooks", "frontend"],
  css: ["css", "styling", "layout", "tailwind", "design-system", "animation"],
  accessibility: ["accessibility", "a11y", "aria", "wcag", "screen-reader", "keyboard"],
  typescript: ["typescript", "ts", "type-safety", "typecheck"],
  backend: ["backend", "server", "api", "endpoint", "service", "rest", "graphql"],
  database: ["database", "sql", "postgres", "prisma", "orm", "schema", "migration"],
  security: ["security", "auth", "authentication", "authorization", "vulnerability", "owasp", "encryption"],
  testing: ["test", "testing", "qa", "e2e", "unit-test", "coverage", "playwright", "vitest"],
  performance: ["performance", "optimization", "profiling", "caching", "latency", "benchmark"],
  architecture: ["architecture", "design", "pattern", "scalability", "system-design", "refactor"],
  devops: ["devops", "ci", "cd", "deployment", "docker", "kubernetes", "infrastructure", "pipeline"],
  documentation: ["documentation", "docs", "readme", "changelog", "api-docs", "technical-writing"],
  data: ["data", "analytics", "etl", "pipeline", "dataset", "machine-learning", "ai"],
  game: ["game", "gamedev", "unity", "godot", "gameplay", "physics"],
  finance: ["finance", "financial", "billing", "accounting", "trading", "payment"],
  gis: ["gis", "geospatial", "mapping", "spatial", "geography"],
  academic: ["academic", "research", "paper", "citation", "literature", "thesis"],
  mobile: ["mobile", "ios", "android", "flutter", "react-native", "swift", "kotlin"],
  backend_ops: ["orchestration", "coordination", "workflow", "pipeline", "scheduler"],
  agent: ["agent", "subagent", "orchestrat", "delegation", "squad", "roster"],
}

/** Tokens que describen el frontend de un agente. */
const FRONTEND_HINTS = [
  "react", "vue", "svelte", "angular", "component", "css", "tailwind", "jsx",
  "html", "frontend", "ui", "design",
]

export interface CatalogScanOptions {
  /** Raíz del repo agency-agents. */
  root: string
  /** Divisiones a considerar. Vacío = todas. */
  divisions?: string[]
}

/** Parsea frontmatter YAML simple (clave: valor, sin anidación). */
export function parseFrontmatter(content: string): { data: Record<string, string>; body: string } {
  if (!content.startsWith("---")) return { data: {}, body: content }
  const end = content.indexOf("\n---", 3)
  if (end === -1) return { data: {}, body: content }
  const block = content.slice(3, end)
  const body = content.slice(end + 4)
  const data: Record<string, string> = {}
  for (const line of block.split("\n")) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (m) data[m[1]!.toLowerCase()] = m[2]!.trim().replace(/^["']|["']$/g, "")
  }
  return { data, body }
}

/** Infiere capabilities de un agente a partir de su texto. */
export function inferCapabilities(name: string, description: string): string[] {
  const haystack = `${name} ${description}`.toLowerCase()
  const found = new Set<string>()

  for (const [capability, tokens] of Object.entries(CAPABILITY_TAXONOMY)) {
    if (tokens.some((t) => haystack.includes(t))) found.add(capability)
  }

  // Tokens literales del nombre: "frontend-developer" → "frontend".
  for (const token of name.toLowerCase().split(/[^a-z0-9]+/)) {
    if (token.length > 3) found.add(token)
  }

  return [...found].sort()
}

/**
 * Escanea el repo de agency-agents y devuelve el catálogo.
 *
 * Cada división es un directorio. Cada `.md` es un agente. Los archivos de
 * índice (README, CHANGELOG) se ignoran.
 */
export async function scanCatalog(options: CatalogScanOptions): Promise<CatalogAgent[]> {
  const divisions = options.divisions?.length
    ? options.divisions
    : await listDirs(options.root)

  const out: CatalogAgent[] = []

  for (const division of divisions) {
    const dir = path.join(options.root, division)
    const files = await listFiles(dir)
    for (const file of files) {
      if (!file.endsWith(".md")) continue
      if (/^(readme|changelog|contributing|license)/i.test(file)) continue

      const full = path.join(dir, file)
      const content = await readText(full)
      if (!content) continue

      const { data, body } = parseFrontmatter(content)
      const slug = file.replace(/\.md$/, "")
      const displayName = data.name || slug
      const description = data.description || firstParagraph(body)

      out.push({
        slug,
        displayName,
        description,
        division,
        path: path.join(division, file),
        capabilities: inferCapabilities(displayName, description),
        sourcePrompt: body.trim(),
      })
    }
  }

  return out
}

/** Primer párrafo no vacío del body, como descripción de respaldo. */
function firstParagraph(body: string): string {
  for (const para of body.split(/\n\s*\n/)) {
    const trimmed = para.trim()
    if (trimmed.length > 20 && !trimmed.startsWith("#")) return trimmed.replace(/\s+/g, " ").slice(0, 400)
  }
  return ""
}

/**
 * Matchea un objetivo de capabilities contra el catálogo.
 *
 * La cobertura es la fracción de capabilities objetivo que el agente cubre
 * (directamente o vía token compartido). Un match por debajo del umbral es
 * peor que no tener match: un rol medio-tonto en el equipo arruina más de lo
 * que aporta.
 */
export function matchCapabilities(
  catalog: CatalogAgent[],
  target: string[],
  options: { division?: string; minCoverage?: number } = {},
): CatalogMatch | undefined {
  if (target.length === 0) return undefined
  const pool = options.division
    ? catalog.filter((a) => a.division === options.division)
    : catalog

  let best: CatalogMatch | undefined

  for (const agent of pool) {
    const agentTokens = new Set<string>()
    for (const cap of agent.capabilities) {
      agentTokens.add(cap)
      for (const alias of CAPABILITY_TAXONOMY[cap] ?? []) agentTokens.add(alias)
    }

    const matched: string[] = []
    const missing: string[] = []

    for (const want of target) {
      const wantLower = want.toLowerCase()
      if (agentTokens.has(wantLower)) {
        matched.push(want)
        continue
      }
      // Match por token: "react-testing" cubre "testing" y "react".
      const wantTokens = wantLower.split(/[^a-z0-9]+/).filter((t) => t.length > 3)
      const hit = wantTokens.some((t) => agentTokens.has(t))
      if (hit) matched.push(want)
      else missing.push(want)
    }

    const coverage = matched.length / target.length
    if (!best || coverage > best.coverage) {
      best = { agent, coverage, matched, missing }
    }
  }

  if (!best) return undefined
  if (options.minCoverage !== undefined && best.coverage < options.minCoverage) return undefined
  return best
}

/**
 * Resuelve un rol: catálogo primero, factory si la cobertura es baja.
 *
 * Devuelve el match con su cobertura para que el llamador pueda registrar
 * el agente como `agency-agents` o `factory`.
 */
export function resolveRole(
  catalog: CatalogAgent[],
  target: string[],
  minCoverage: number,
): { match: CatalogMatch | undefined; needsFactory: boolean } {
  const best = matchCapabilities(catalog, target)
  if (!best) return { match: undefined, needsFactory: true }
  if (best.coverage < minCoverage) return { match: best, needsFactory: true }
  return { match: best, needsFactory: false }
}

/** Detecta el slug del archivo de un path de catálogo. */
export function slugOf(agent: CatalogAgent): string {
  return agent.slug
}
