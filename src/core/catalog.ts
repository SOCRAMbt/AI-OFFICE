/**
 * Catálogo: resolución de roles desde agency-agents.
 *
 * ## Por qué esto no es un `grep` de descripciones
 *
 * El repo de agency-agents tiene 306 agentes en 25 divisiones. Cada uno trae
 * un *briefing* de 10 secciones, y la especialidad real NO está en el
 * `description` del frontmatter: está en el cuerpo.
 *
 * Un agente de statistics, por ejemplo, declara:
 * - description: "Expert in quantitative research methodology..."
 * - Core Mission → "Pressure-Test Quantitative Claims", "Design Sound Studies"
 * - Technical Deliverables → "Claim Interrogation Framework", "Effect Size Report"
 * - Advanced Capabilities → "Causal Inference", "Experimental Design"
 *
 * La `description` dice "de qué se ocupa". El cuerpo dice **en qué es
 * exactamente bueno**. Un matcher que solo mira la description no puede
 * distinguir a un metodólogo de un analista de datos, aunque uno de los dos
 * sea exactamente lo que la card necesita.
 *
 * Por eso el parser extrae las secciones del cuerpo y el matching pondera
 * cada campo por lo que aporta.
 */

import path from "node:path"
import fs from "node:fs/promises"
import type { CatalogAgent, CatalogMatch } from "./types.js"
import { listDirs, listFiles, readText } from "./fsx.js"

// ─────────────────────────────────────────────────────────────────────────────
// Parser de frontmatter y de secciones
// ─────────────────────────────────────────────────────────────────────────────

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

/** Limpia un encabezado de sección de los emoji y espacios que agency-agents usa. */
export function normalizeHeading(raw: string): string {
  return raw
    .replace(/^#+\s*/, "")
    .replace(/[^\p{L}\p{N}\s&-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Divide el cuerpo en secciones H2.
 *
 * Los encabezados de agency-agents vienen con emoji (`## 🎯 Your Identity &
 * Memory`) o lisos (`## Core Mission`). Se normalizan para que el matching
 * sea estable.
 */
export function parseSections(body: string): Record<string, string> {
  const sections: Record<string, string> = {}
  const lines = body.split("\n")

  let currentKey = ""
  let buffer: string[] = []

  const flush = () => {
    if (currentKey) sections[currentKey] = buffer.join("\n").trim()
  }

  for (const line of lines) {
    if (/^##\s/.test(line)) {
      flush()
      currentKey = normalizeHeading(line)
      buffer = []
    } else if (currentKey) {
      buffer.push(line)
    }
  }
  flush()
  return sections
}

/**
 * Busca una sección por cualquiera de sus nombres posibles.
 *
 * La estructura de agency-agents tiene variantes con y sin el "Your", y
 * con y sin emoji. En vez de hardcodear 20 nombres, se busca por coincidencia
 * de palabra clave.
 */
export function findSection(
  sections: Record<string, string>,
  ...keywords: string[]
): string | undefined {
  const keys = Object.keys(sections)
  for (const keyword of keywords) {
    const match = keys.find((k) => k.toLowerCase().includes(keyword.toLowerCase()))
    if (match) return sections[match]
  }
  return undefined
}

/** Extrae los subtítulos H3 de un bloque de texto. */
export function extractSubheadings(block: string | undefined): string[] {
  if (!block) return []
  return block
    .split("\n")
    .filter((line) => /^###\s/.test(line))
    .map((line) => normalizeHeading(line))
    .filter((s) => s.length > 2)
}

/**
 * Extrae las etiquetas de una sección "Core Mission".
 *
 * La sección viene en dos formatos y ambos son válidos en el repo real:
 *
 * 1. **Subtítulos H3** — `### Pressure-Test Quantitative Claims`
 * 2. **Lista de bullets** — `- **Subvert Default Biases**: Ensure generated...`
 *
 * Se intentan los H3 primero. Si no hay, se cae a los bullets, y de cada
 * bullet se extrae la etiqueta: la parte en negrita si la hay, o las
 * primeras palabras antes del primer `:`.
 *
 * Sin este fallback, la mitad del catálogo queda sin misión declarada y el
 * matching pierde la señal más fuerte que tiene.
 */
export function extractMissionLabels(block: string | undefined): string[] {
  const headings = extractSubheadings(block)
  if (headings.length > 0) return headings

  const items = extractListItems(block)
  if (items.length === 0) return []

  return items
    .map((item) => {
      // `**Label**: resto` → `Label`
      const bold = /^\*\*(.+?)\*\*/.exec(item)
      if (bold) return bold[1]!.trim()
      // `Label: resto` → `Label`
      const colon = item.split(":")[0]
      if (colon && colon.length <= 80 && colon.trim().length > 2) return colon.trim()
      // Si no, las primeras palabras.
      return item.split(/\s+/).slice(0, 6).join(" ")
    })
    .filter((label) => label.length > 2)
}

/** Extrae los items numerados o con guion de un bloque de texto. */
export function extractListItems(block: string | undefined): string[] {
  if (!block) return []
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^(\d+[.)]|[-*])\s+/.test(line))
    .map((line) => line.replace(/^(\d+[.)]|[-*])\s+/, "").trim())
    .filter((s) => s.length > 4)
}

// ─────────────────────────────────────────────────────────────────────────────
// Taxonomía
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mapa de tokens a dominios.
 *
 * Solo se usa para el fallback por tokens (cuando no hay match estructural).
 * El matching principal es por secciones.
 */
export const CAPABILITY_TAXONOMY: Record<string, string[]> = {
  react: ["react", "component", "jsx", "hooks", "frontend", "ui", "web", "spa", "dom", "view", "modern"],
  css: ["css", "styling", "layout", "tailwind", "design-system", "animation", "motion", "theme", "token"],
  accessibility: ["accessibility", "a11y", "aria", "wcag", "screen-reader", "keyboard", "semantic", "section-508", "conformance"],
  typescript: ["typescript", "ts", "type-safety", "typecheck", "generics", "type"],
  /**
   * Lenguajes y programacion en general.
   *
   * Sin estos conceptos, un objetivo razonable como "javascript,
   * code-generation" no matchea con NADA del catalogo: la palabra
   * "javascript" no aparece en la identidad curada de ningun agente, y
   * "code-generation" tampoco. El resultado era que todos los candidatos
   * daban 3% y ganaba el primero de la lista.
   */
  javascript: ["javascript", "js", "ecmascript", "vanilla-js", "nodejs", "node"],
  code: ["code", "coding", "code-generation", "programming", "implementation", "implement", "source"],
  backend: ["backend", "server", "api", "endpoint", "service", "rest", "graphql", "microservice", "gateway", "contract"],
  database: ["database", "sql", "postgres", "postgresql", "prisma", "orm", "schema", "migration", "index", "query", "reliability", "availability", "tuning", "partitioning"],
  security: ["security", "auth", "authentication", "authorization", "vulnerability", "owasp", "encryption", "threat", "vuln", "pentest", "xss", "csrf", "injection", "sanitize", "hardening", "audit", "compliance"],
  testing: ["test", "testing", "qa", "e2e", "end-to-end", "end2end", "unit-test", "coverage", "playwright", "vitest", "fixture", "assertion", "browser", "checkout", "integration-test", "acceptance-test", "smoke-test"],
  performance: ["performance", "optimization", "profiling", "caching", "latency", "benchmark", "throughput", "slowdown", "speed"],
  architecture: ["architecture", "design", "pattern", "scalability", "system-design", "refactor", "modular", "blueprint", "blueprints"],
  devops: ["devops", "ci", "cd", "deployment", "docker", "kubernetes", "infrastructure", "pipeline", "terraform", "automator", "release"],
  documentation: ["documentation", "docs", "readme", "changelog", "api-docs", "technical-writing", "writer"],
  data: ["data", "analytics", "etl", "dataset", "machine-learning", "ml", "model", "ingest", "aggregate", "warehouse", "stream"],
  game: ["game", "gamedev", "unity", "unreal", "godot", "gameplay", "roblox", "physics", "blender"],
  finance: ["finance", "financial", "billing", "accounting", "trading", "payment", "revenue", "pricing", "cost"],
  gis: ["gis", "geospatial", "mapping", "spatial", "geography", "cartography", "tile", "shapefile", "coordinate"],
  academic: ["academic", "research", "paper", "citation", "literature", "thesis", "peer-review", "statistic", "methodology", "experiment", "inference", "study"],
  mobile: ["mobile", "ios", "android", "flutter", "react-native", "swift", "kotlin", "desktop"],
  marketing: ["marketing", "seo", "campaign", "copywriting", "brand", "social", "email", "growth", "content", "copy", "viral"],
  sales: ["sales", "crm", "lead", "pipeline", "prospect", "negotiation", "outreach", "closing", "demo"],
  support: ["support", "helpdesk", "ticket", "customer", "faq", "troubleshoot", "onboarding"],
  product: ["product", "roadmap", "prd", "requirement", "backlog", "user-story", "feature", "discovery", "prioritiz"],
  strategy: ["strategy", "positioning", "market", "competitive", "portfolio", "moat"],
  project: ["project", "milestone", "timeline", "gantt", "sprint", "kanban", "resource", "estimation", "plan"],
  spatial: ["spatial", "3d", "vr", "ar", "webgl", "threejs", "unity", "shader", "rendering", "material", "mesh"],
  healthcare: ["health", "clinical", "patient", "medical", "hipaa", "ehr", "diagnosis"],
  research: ["research", "analyze", "synthesis", "review", "meta-analysis", "intelligence", "find-bugs"],
}

/**
 * Afinidad de división.
 *
 * Si la card pide capacidades de un dominio, la división homónima del
 * catálogo es una señal fuerte. "gis" → división `gis`. "game" →
 * `game-development`. Es una señal barata y muy precisa.
 */
export const DIVISION_AFFINITY: Record<string, string[]> = {
  gis: ["gis", "spatial", "geospatial", "map", "cartography", "tile"],
  "game-development": ["game", "unity", "unreal", "godot", "roblox", "gameplay", "physics"],
  "spatial-computing": ["spatial", "3d", "vr", "ar", "webgl", "shader", "blender", "rendering", "mesh"],
  security: ["security", "auth", "vulnerability", "owasp", "threat", "pentest", "audit", "compliance", "hardening"],
  testing: ["test", "qa", "e2e", "coverage", "fixture", "assertion", "browser"],
  marketing: ["marketing", "seo", "campaign", "copywriting", "brand", "growth", "content", "viral"],
  "paid-media": ["ads", "ppc", "campaign", "spend", "media"],
  sales: ["sales", "crm", "lead", "pipeline", "prospect", "outreach", "closing", "demo"],
  product: ["product", "roadmap", "prd", "requirement", "backlog", "user-story", "discovery", "prioritiz"],
  support: ["support", "helpdesk", "ticket", "customer", "faq", "troubleshoot", "onboarding"],
  strategy: ["strategy", "positioning", "market", "competitive", "portfolio", "pricing", "moat"],
  "project-management": ["project", "milestone", "timeline", "sprint", "kanban", "resource", "estimation", "plan"],
  academic: ["academic", "research", "paper", "citation", "thesis", "statistic", "methodology", "experiment", "inference"],
  research: ["research", "analyze", "synthesis", "review", "meta-analysis", "intelligence", "find-bugs"],
  healthcare: ["health", "clinical", "patient", "medical", "hipaa", "ehr", "diagnosis"],
  finance: ["finance", "billing", "accounting", "payment", "revenue", "cost", "pricing"],
  design: ["design", "ux", "ui", "visual", "brand", "typography", "layout", "motion", "css", "theme", "token", "copy"],
  engineering: ["code", "develop", "build", "implement", "refactor", "api", "service", "codebase", "backend", "frontend", "data", "type", "test", "architecture", "performance", "mobile", "security", "database", "devops", "deployment", "docker", "kubernetes", "cicd", "infrastructure", "pipeline", "release", "automation", "automator", "sre", "platform"],
  specialized: ["specialist", "optimizer", "remediation", "automation", "automator", "intelligence"],
}

// ─────────────────────────────────────────────────────────────────────────────
// Extracción de capacidades
// ─────────────────────────────────────────────────────────────────────────────

/** Stopwords que no aportan señal al matching. */
const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "your", "you",
  "are", "not", "but", "can", "will", "was", "has", "have", "its", "our",
  "using", "use", "used", "make", "make", "them", "then", "than", "when",
  "what", "which", "while", "who", "how", "all", "any", "one", "two", "new",
  "own", "same", "also", "more", "most", "other", "some", "such", "only",
])

/**
 * Convierte una frase en un conjunto de tokens con señal.
 *
 * Se filtran stopwords y tokens de menos de 3 caracteres. Los tokens de
 * más de 3 caracteres se consideran "concepts" para el matching.
 */
export function capabilityTokens(phrase: string): Set<string> {
  const tokens = new Set<string>()
  for (const raw of phrase.toLowerCase().split(/[^a-z0-9+#.-]+/)) {
    const token = raw.replace(/^[.-]+|[.-]+$/g, "")
    if (token.length < 3) continue
    if (STOPWORDS.has(token)) continue
    tokens.add(token)
  }
  return tokens
}

/**
 * Infiere capabilities de un agente.
 *
 * Tres fuentes, en orden de valor:
 * 1. Los subtítulos de "Core Mission" — **la** especialidad del agente.
 * 2. Los subtítulos de "Advanced Capabilities" — lo que maneja mejor.
 * 3. Los subtítulos de "Technical Deliverables" — lo que produce.
 *
 * Más los tokens de la descripción y del nombre, como respaldo.
 */
export function extractCapabilities(agent: {
  displayName: string
  description: string
  missions: string[]
  deliverables: string[]
  advanced: string[]
}): string[] {
  const found = new Set<string>()

  for (const phrase of [...agent.missions, ...agent.advanced, ...agent.deliverables]) {
    for (const token of capabilityTokens(phrase)) found.add(token)
  }
  for (const token of capabilityTokens(agent.description)) found.add(token)
  for (const token of capabilityTokens(agent.displayName)) found.add(token)

  return [...found].sort()
}

/**
 * Convierte los subtítulos de misión en etiquetas legibles.
 *
 * "Pressure-Test Quantitative Claims" → "pressure-test quantitative claims".
 * Se usan como capabilitiesdirectly comparables con lo que pide la card.
 */
export function missionTags(missions: string[]): string[] {
  return missions
    .map((m) => m.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").trim())
    .filter((m) => m.length > 2)
}

// ─────────────────────────────────────────────────────────────────────────────
// Escaneo
// ─────────────────────────────────────────────────────────────────────────────

export interface CatalogScanOptions {
  /** Raíz del repo agency-agents. */
  root: string
  /** Divisiones a considerar. Vacío = todas. */
  divisions?: string[]
  /** Si es true, ignora las divisiones sin agentes de código. */
  codeOnly?: boolean
}

/** Divisiones que no aportan agentes de código. */
const NON_CODE_DIVISIONS = new Set([
  "examples", "playbooks", "runbooks", "scripts", ".github", "integrations",
])

export async function scanCatalog(options: CatalogScanOptions): Promise<CatalogAgent[]> {
  const allDivisions = await listDirs(options.root)
  const divisions = options.divisions?.length
    ? options.divisions
    : allDivisions.filter((d) => !NON_CODE_DIVISIONS.has(d) && !d.startsWith("."))

  const out: CatalogAgent[] = []

  for (const division of divisions) {
    const dir = path.join(options.root, division)
    const files = await listFiles(dir)
    for (const file of files) {
      if (!file.endsWith(".md")) continue
      if (/^(readme|changelog|contributing|license|security|pull_request)/i.test(file)) continue

      const full = path.join(dir, file)
      const content = await readText(full)
      if (!content) continue

      const { data, body } = parseFrontmatter(content)
      const sections = parseSections(body)

      const slug = file.replace(/\.md$/, "")
      const displayName = data.name || titleize(slug)
      const description = data.description || firstParagraph(body)

      const missions = extractMissionLabels(findSection(sections, "Core Mission", "Mission"))
      const deliverables = extractMissionLabels(
        findSection(sections, "Technical Deliverables", "Deliverables"),
      )
      const advanced = extractMissionLabels(
        findSection(sections, "Advanced Capabilities", "Advanced"),
      )
      const rules = extractListItems(findSection(sections, "Critical Rules", "Rules"))

      const partial = { displayName, description, missions, deliverables, advanced }

      out.push({
        slug,
        displayName,
        description,
        vibe: data.vibe ?? "",
        division,
        path: path.join(division, file),
        capabilities: extractCapabilities(partial),
        missions,
        deliverables,
        advanced,
        rules,
        sections,
        sourcePrompt: body.trim(),
        searchText: `${displayName} ${description} ${body}`.toLowerCase(),
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

/** "frontend-developer" → "Frontend Developer". */
export function titleize(slug: string): string {
  return slug
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
}

// ─────────────────────────────────────────────────────────────────────────────
// Matching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pesos de cada señal en el score.
 *
 * El orden reflects dónde está la información real:
 *
 * 1. **El nombre del rol** (`engineering-frontend-developer`) es la etiqueta
 *    más literal de la especialidad que existe. ElCommander también pide
 *    roles por nombre, así que es la señal más alineada entre las dos
 *    listas.
 *
 * 2. **La misión declarada** ("Create Modern Web Applications") es lo que el
 *    agente dice que sabe hacer. El overlap literal es preciso; el
 *    conceptual (con taxonomía) bridgea sinónimos.
 *
 * 3. **El cuerpo completo** es un pajaro: 300 líneas donde cualquier
 *    palabra genérica ("review", "design", "audit") aparece en todos. Por
 *    eso casi no pesa. Con peso alto, un "Legal Document Review" ganaba el
 *    match de "revisar la seguridad de una API" por la palabra "review".
 */
export const MATCH_WEIGHTS = {
  /** El nombre del rol y su display name. */
  name: 0.35,
  /** La misión, overlap literal. */
  missionLiteral: 0.28,
  /** La misión, overlap conceptual (taxonomía + lematización). */
  missionConcept: 0.18,
  /** Capabilities inferidas del cuerpo. */
  capabilities: 0.05,
  /** Lo que el agente sabe producir. */
  deliverables: 0.03,
  /**
   * La división: contexto, no especialidad — pero señal fuerte. Una card de
   * e2e testing tiene que ir a la división `testing`, no a `engineering`.
   */
  division: 0.1,
  /** El texto completo: ruido puro. */
  text: 0.01,
} as const

/**
 * Convierte una frase en un conjunto de tokens **y conceptos**.
 *
 * ## Por qué se conservan los tokens crudos
 *
 * La primera versión de esta función reemplazaba cada token por su grupo
 * completo de alias. El efecto fue contraproducente: el objetivo
 * `{playwright, e2e, testing, checkout, browser}` colapsaba a un solo
 * concepto `testing`, y cualquier agente que mencionara "Testing" una vez
 * (un code reviewer, por ejemplo)得分 100% de cobertura conceptual.
 *
 * La granularidad se pierde al colapsar. Por eso los tokens crudos se
 * **conservan** y el concepto se **agrega**:
 *
 * - "web"    → {web, react}      (puentea con "frontend" y "react")
 * - "Testing"→ {testing}         (no colapsa a sus 13 alias)
 *
 * Ahora un agente tiene que coincidir en **varias** de las cosas pedidas,
 * no en una sola.
 */
export function canonicalConcepts(phrase: string): Set<string> {
  const tokens = capabilityTokens(phrase)
  const concepts = new Set<string>(tokens)

  for (const token of tokens) {
    for (const [concept, aliases] of Object.entries(CAPABILITY_TAXONOMY)) {
      if (aliases.includes(token)) {
        concepts.add(concept)
        break
      }
    }
  }

  return concepts
}

/** Conceptos canónicos de un conjunto de tokens. */
function canonicalizeTokens(tokens: Set<string>): Set<string> {
  const concepts = new Set<string>(tokens)
  for (const token of tokens) {
    for (const [concept, aliases] of Object.entries(CAPABILITY_TAXONOMY)) {
      if (aliases.includes(token)) {
        concepts.add(concept)
        break
      }
    }
  }
  return concepts
}

/**
 * Sinónimos **por capability**.
 *
 * ## Por qué no alcanza con la taxonomía
 *
 * La taxonomía agrupa por *concepto*: "e2e" y "testing" caen en el mismo
 * grupo. Con eso, un agente que dice "testing" matcheaba "e2e", y un PDF
 * engine que menciona "Playwright" le ganaba a un Test Automation Engineer
 * que decía "end-to-end" — que es la misma palabra escrita larga.
 *
 * Los sinónimos van **por capability**: "e2e" es "end-to-end", pero
 * "e2e" NO es "playwright". Esa distinción es la que separa a un
 * especialista de un generalista que menciona la tool de pasada.
 */
export const CAPABILITY_SYNONYMS: Record<string, string[]> = {
  e2e: ["e2e", "end-to-end", "end2end", "end to end", "integration test", "acceptance test", "browser test"],
  testing: ["test", "tests", "testing", "qa", "suite", "suites", "test suite", "spec", "specs"],
  playwright: ["playwright"],
  vitest: ["vitest"],
  jest: ["jest"],
  cypress: ["cypress"],
  react: ["react", "jsx", "component", "components", "hook", "hooks"],
  css: ["css", "style", "styles", "styling", "tailwind", "layout", "theme", "token", "tokens"],
  accessibility: ["accessibility", "a11y", "aria", "wcag", "section 508", "assistive", "screen reader", "keyboard"],
  security: ["security", "vulnerability", "vulnerabilities", "auth", "authentication", "authorization", "owasp", "threat", "injection", "xss", "csrf", "pentest", "hardening"],
  api: ["api", "endpoint", "endpoints", "rest", "graphql", "openapi", "contract"],
  database: ["database", "sql", "postgres", "postgresql", "mysql", "sqlite", "prisma", "orm", "schema", "migration", "query", "index", "partitioning"],
  backend: ["backend", "server", "service", "services", "microservice", "worker"],
  frontend: ["frontend", "ui", "web", "spa", "browser"],
  typescript: ["typescript", "ts", "type", "types", "generic", "generics", "typecheck"],
  javascript: ["javascript", "js", "ecmascript", "node", "nodejs"],
  code: ["code", "coding", "code-generation", "programming", "implementation", "implement"],
  performance: ["performance", "optimize", "optimization", "profiling", "caching", "latency", "benchmark", "throughput"],
  architecture: ["architecture", "pattern", "patterns", "design", "scalability", "system design", "refactor", "modular"],
  devops: ["devops", "ci", "cd", "deployment", "deploy", "docker", "kubernetes", "infrastructure", "pipeline", "terraform", "release", "operations", "sre", "automation"],
  documentation: ["documentation", "docs", "readme", "changelog", "api docs", "technical writing", "writer"],
  cicd: ["cicd", "ci", "cd", "continuous integration", "continuous delivery", "continuous deployment", "pipeline", "release"],
  data: ["data", "analytics", "etl", "dataset", "ingest", "aggregate", "warehouse", "pipeline", "stream", "streaming", "ml", "machine learning"],
  accessibility_audit: ["audit", "auditor", "auditing", "audit", "review", "reviewer", "conformance", "compliance"],
  gis: ["gis", "geospatial", "mapping", "map", "cartography", "tile", "shapefile", "coordinate", "spatial"],
  design: ["design", "designer", "visual", "brand", "typography", "mockup"],
  qa: ["qa", "quality assurance", "test", "testing", "review"],
}

/**
 * Sinónimos de una capability.
 *
 * Si la capability no está en la tabla, sus sinónimos son ella misma: el
 * match es literal o lematizado.
 */
export function synonymsOf(capability: string): Set<string> {
  const lower = capability.toLowerCase().trim()
  const explicit = CAPABILITY_SYNONYMS[lower]
  if (explicit) return new Set([lower, ...explicit])
  return new Set([lower])
}

/**
 * ¿El agente menciona esta capability, por sinonimia o lematización?
 *
 * La capability puede ser una **frase** ("react components"), no un token
 * suelto: se tokeniza y se busca cualquiera de sus partes. Un token solo
 * ("react") se busca como synonym group.
 */
export function mentionsCapability(agentTokens: Set<string>, capability: string): boolean {
  const tokens = capabilityTokens(capability)
  for (const token of tokens) {
    for (const alias of synonymsOf(token)) {
      for (const agentToken of agentTokens) {
        if (agentToken === alias) return true
        if (stem(agentToken) === stem(alias)) return true
      }
    }
  }
  return false
}

/**
 * Fracción de las capabilities objetivo que el agente menciona.
 *
 * Una capability puede ser una **frase** ("react component accessibility").
 * En ese caso cuenta como varias: cada palabra se evalúa por separado. Si no,
 * "react component accessibility" valdría lo mismo que "react", y un agente
 * que solo menciona accesibilidad ganaría una card de frontend.
 *
 * ## Cada palabra cuenta igual
 *
 * Una capability de dos palabras ("code review") aporta **dos** unidades y
 * una de una palabra ("design") aporta una. No es un detalle: una
 * capability específica tiene más derecho a pesar que una genérica.
 *
 * ## Lo que se probó y no se quedó
 *
 * Se implementó una ponderación por **IDF** (inverse document frequency):
 * los tokens raros pesan más, porque un token que aparece en 200 de 258
 * agentes no discrimina nada. Es la técnica clásica de recuperación de
 * información y la hipótesis era razonable.
 *
 * **Los datos no la respaldaron.** El benchmark de selección
 * (`benchmarks/selection/`) mide el hit@1 sobre 21 tareas con resultados de
 * referencia:
 *
 * | variante | hit@1 | MRR |
 * |---|---|---|
 * | ponderación plana (la que quedó) | **71%** | **0.778** |
 * | ponderación por IDF | 67% | 0.746 |
 * | keywords (los pesos de la v1) | 48% | 0.623 |
 * | solo el nombre del rol | 52% | 0.639 |
 *
 * IDF quedó afuera. La versión simple gana, y la complejidad que no se
 * justifica es una complejidad que hay que pagar en cada match.
 */
export function capabilityCoverage(agentTokens: Set<string>, target: string[]): number {
  if (target.length === 0) return 0
  let hits = 0
  let total = 0
  for (const capability of target) {
    const tokens = capabilityTokens(capability)
    if (tokens.size === 0) continue
    for (const token of tokens) {
      total += 1
      if (mentionsCapability(agentTokens, token)) hits += 1
    }
  }
  return total === 0 ? 0 : hits / total
}

/**
 * Lematiza un token: "testing" → "test", "validation" → "validat".
 *
 * ## Por qué hace falta
 *
 * El Commander pide capabilities en sus palabras ("testing", "validation") y
 * los agentes de agency-agents usan las suyas ("test", "validate"). Sin
 * lematizar, dos palabras que significan lo mismo no se ven nunca.
 *
 * Es la diferencia entre un matcher de palabras y uno de conceptos.
 */
export function stem(token: string): string {
  if (token.length <= 4) return token
  for (const suffix of ["ations", "ation", "ings", "ing", "ies", "ied", "ers", "er", "es", "ed", "s"]) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 3) {
      return token.slice(0, token.length - suffix.length)
    }
  }
  return token
}

/** Fracción de tokens de `want` que aparecen en `have`. */
function tokenOverlap(want: Set<string>, have: Set<string>): number {
  if (want.size === 0) return 0
  const haveStems = new Set([...have].map(stem))

  let hits = 0
  for (const token of want) {
    if (have.has(token)) {
      hits += 1
      continue
    }
    // Match por lematización: "testing" ~ "test".
    if (haveStems.has(stem(token))) {
      hits += 1
      continue
    }
    // Match parcial por prefijo: "streaming" ~ "stream".
    for (const candidate of have) {
      if (candidate.length > 3 && token.length > 3 && (candidate.startsWith(token) || token.startsWith(candidate))) {
        hits += 0.6
        break
      }
    }
  }
  return Math.min(1, hits / want.size)
}

/** Afinidad de la división con las capabilities pedidas. */
export function divisionAffinity(division: string, target: string[]): number {
  const aliases = DIVISION_AFFINITY[division]
  if (!aliases || aliases.length === 0) return 0

  // El objetivo se canónica y se lematiza.
  const targetConcepts = canonicalConcepts(target.join(" "))
  const targetStems = new Set([...targetConcepts].map(stem))

  // La división se expresa en conceptos, no en palabras sueltas.
  // El nombre de la división cuenta: una card de testing tiene que ir a la
  // división `testing`, y esa es la señal más obvia de todas.
  const divisionConcepts = new Set<string>()
  for (const alias of [...aliases, division]) {
    for (const concept of canonicalConcepts(alias)) divisionConcepts.add(concept)
  }
  const divisionStems = new Set([...divisionConcepts].map(stem))

  let hits = 0
  for (const concept of targetConcepts) {
    if (divisionConcepts.has(concept)) {
      hits += 1
      continue
    }
    if (divisionStems.has(stem(concept))) hits += 1
  }

  if (hits === 0) return 0
  // Normalizado contra el tamaño de la división, no del objetivo: una
  // división chica que matchea todo vale más que una grande que matchea poco.
  return Math.min(1, hits / Math.max(1, Math.min(divisionConcepts.size, targetConcepts.size)))
}

/**
 * Matchea un objetivo de capabilities contra el catálogo.
 *
 * El score es ponderado por campo, no una bolsa de tokens. Un agente cuyo
 * "Core Mission" menciona literalmente lo que la card necesita gana sobre
 * uno que menciona la palabra de pasada en el cuerpo.
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

  const targetRaw = capabilityTokens(target.join(" "))
  const targetTokens = canonicalConcepts(target.join(" "))

  // El IDF se calcula sobre el catalogo COMPLETO, no sobre el pool: la
  // frecuencia de un token no debe depender de que se haya filtrado por
  // división.
  let best: CatalogMatch | undefined

  for (const agent of pool) {
    // Tokens crudos de la misión: overlap literal, preciso.
    const agentMissionRaw = new Set<string>()
    for (const mission of agent.missions) {
      for (const token of capabilityTokens(mission)) agentMissionRaw.add(token)
    }

    // Tokens canónicos de la misión: bridgea sinónimos.
    const agentMissions = new Set<string>()
    for (const mission of agent.missions) {
      for (const token of canonicalConcepts(mission)) agentMissions.add(token)
    }

    const agentDeliverables = new Set<string>()
    for (const deliverable of agent.deliverables) {
      for (const token of canonicalConcepts(deliverable)) agentDeliverables.add(token)
    }

    // La identidad del agente: nombre, slug, **description** y **vibe**.
    //
    // Los dos últimos son la señal curada — líneas escritas a mano que dicen
    // exactamente de qué se ocupa el agente. El cuerpo son 300 líneas de
    // contexto donde cualquier palabra genérica aparece; la description y el
    // vibe, no. Excluirlos era dejar la mejor señal afuera.
    const agentName = capabilityTokens(
      `${agent.slug} ${agent.displayName} ${agent.description} ${agent.vibe}`,
    )

    const agentCapabilities = canonicalizeTokens(new Set(agent.capabilities))
    const agentText = canonicalizeTokens(capabilityTokens(agent.searchText))

    // La cobertura ponderada por IDF: las capabilities raras pesan mas.
    const nameScore = capabilityCoverage(agentName, target)
    const missionLiteral = capabilityCoverage(agentMissionRaw, target)
    const missionConcept = tokenOverlap(targetTokens, agentMissions)
    const capabilityScore = tokenOverlap(targetTokens, agentCapabilities)
    const deliverableScore = tokenOverlap(targetTokens, agentDeliverables)
    const divisionScore = divisionAffinity(agent.division, target)
    const textScore = tokenOverlap(targetTokens, agentText)

    const coverage =
      nameScore * MATCH_WEIGHTS.name +
      missionLiteral * MATCH_WEIGHTS.missionLiteral +
      missionConcept * MATCH_WEIGHTS.missionConcept +
      capabilityScore * MATCH_WEIGHTS.capabilities +
      deliverableScore * MATCH_WEIGHTS.deliverables +
      divisionScore * MATCH_WEIGHTS.division +
      textScore * MATCH_WEIGHTS.text

    // **Recall**: qué parte del objetivo cubre este agente, con las señales
    // confiables (identidad curada + misión declarada).
    //
    // El conteo es POR TOKEN, igual que la cobertura. Si `coverage` cuenta
    // tokens y `reliable` cuenta frases, el panel miente: un agente que
    // menciona "mapping" de pasada se contaba como si cubriera "gis
    // geospatial mapping cartography" entero.
    //
    // Y usa la misma lógica de IDF: lo que hace que una capability esté
    // realmente cubierta es que el agente mencione su token MÁS RARO. Si
    // el agente dice "review" pero no dice "code", no cubre "code review".
    const reliableFraction = (capability: string): number => {
      const tokens = [...capabilityTokens(capability)]
      if (tokens.length === 0) return 0

      let hits = 0
      for (const token of tokens) {
        if (mentionsCapability(agentName, token) || mentionsCapability(agentMissionRaw, token)) {
          hits += 1
        }
      }
      return hits / tokens.length
    }
    const reliableHits = target.filter((t) => reliableFraction(t) >= 0.5)
    const recall = target.length > 0 ? reliableHits.length / target.length : 0

    // **Focus de misión**: qué fracción de las misiones declaradas del agente
    // tienen que ver con el objetivo.
    //
    // Este es el discriminante entre un especialista y un generalista que
    // menciona la tool de pasada. Un Test Automation Engineer tiene las 5
    // misiones en el dominio del testing → focus ~1. Un PDF engine con UNA
    // misión sobre "Playwright Browser Context Pools" y las otras 7 sobre
    // PDF → focus ~0.12.
    const matchingMissions = agent.missions.filter((m) => {
      const raw = new Set(capabilityTokens(m))
      return target.some((t) => mentionsCapability(raw, t))
    })
    const focus = agent.missions.length > 0 ? matchingMissions.length / agent.missions.length : 0

    // **Precisión**: qué fracción de lo que el agente es realmente va en la
    // dirección del objetivo.
    const hits = [...targetTokens].filter((token) => agentMissions.has(token)).length
    const precision = agentMissions.size > 0 ? Math.min(1, hits / agentMissions.size) : 0
    const f1 = recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0

    // Score final: la señal de match, el alcance sobre el objetivo y la
    // especificidad. El recall mide alcance; el focus mide si el agente es
    // un especialista del dominio o un generalista que pasó por ahí.
    const score = coverage * 0.35 + recall * 0.3 + focus * 0.25 + f1 * 0.1

    if (!best || score > best.coverage) {
      // `matched` y `missing` se calculan SOLO con las señales confiables:
      // el nombre del rol y la misión declarada.
      //
      // Si se incluyera el cuerpo completo, casi todo agente "cubriría"
      // casi todo: un "Code Reviewer" emparejaría un objetivo de Playwright
      // porque su cuerpo de 300 líneas menciona testing, browser y checkout
      // de pasada. Un `matched` inflado rompe el panel: los complementos
      // dejan de ser complementos y se vuelven duplicados.
      best = {
        agent,
        coverage: score,
        matched: reliableHits,
        missing: target.filter((t) => !reliableHits.includes(t)),
      }
    }
  }

  if (!best) return undefined
  if (options.minCoverage !== undefined && best.coverage < options.minCoverage) return undefined
  return best
}

/**
 * Resuelve un rol: catálogo primero, factory si la cobertura es baja.
 *
 * ## La cobertura es sobre el PANEL, no sobre el primario
 *
 * Un objetivo casi nunca es de un solo dominio. Si el primario cubre la
 * mitad y un complemento cubre la otra mitad, el objetivo **está cubierto**
 * y no hace falta fabricar un rol.
 *
 * La cobertura se mide como:Concepts cubiertos por el panel / concepts
 * pedidos. El umbral de 0.6 significa "el equipo cubre el 60% de lo que
 * la card pide". Por debajo, se fabrica el rol.
 */
export function resolveRole(
  catalog: CatalogAgent[],
  target: string[],
  minCoverage: number,
): { match: CatalogMatch | undefined; needsFactory: boolean; panel?: RolePanel } {
  const panel = buildPanel(catalog, target)
  if (!panel.primary) return { match: undefined, needsFactory: true }

  const covered = new Set(panel.primary.matched)
  for (const complement of panel.complements) {
    for (const m of complement.matched) covered.add(m)
  }

  const coverageRatio = target.length > 0 ? covered.size / target.length : 0
  if (coverageRatio < minCoverage) {
    return { match: panel.primary, needsFactory: true, panel }
  }
  return { match: panel.primary, needsFactory: false, panel }
}

/**
 * Devuelve los mejores N agentes para un objetivo, ordenados por cobertura.
 *
 * Útil para que el Comandante vea alternativas: "este es el mejor, pero
 * estos dos también sirven y podrían repartir la carga".
 */
export function rankCandidates(
  catalog: CatalogAgent[],
  target: string[],
  limit = 5,
): CatalogMatch[] {
  return catalog
    .map((agent) => matchCapabilities([agent], target))
    .filter((m): m is CatalogMatch => !!m)
    .sort((a, b) => b.coverage - a.coverage)
    .slice(0, limit)
}

/**
 * Construye un **panel de roles**: un primario más los complementos.
 *
 * ## Por qué un panel y no un solo agente
 *
 * Un objetivo casi nunca es de un solo dominio. "Formulario de login en
 * React con validación y accesibilidad" necesita un frontend (que no sabe
 * de ARIA) y un especialista en accesibilidad (que no sabe de React).
 *
 * Si el sistema elige uno solo, deja huecos. Si elige varios sin criterio,
 * duplica capacidad.
 *
 * El panel resuelve las dos cosas:
 * - **Primario**: el mejor match global. Se lleva la card.
 * - **Complementos**: los agentes que cubren lo que el primario NO cubre.
 *   Cada uno entra con un rol distinto y sin pisar al primario.
 *
 * Es la misma lógica del equipo real: nadie hace de frontend y de
 * especialista en accesibilidad a la vez, pero los dos están en la oficina.
 */
export interface RolePanel {
  primary: CatalogMatch | null
  complements: CatalogMatch[]
  /** Capabilities que nadie del panel cubre. */
  uncovered: string[]
  /**
   * true cuando el primario entro por la banda de segundo.
   *
   * O sea: **nadie** del catalogo llega al minimo de cobertura, pero este
   * agente cubre al menos una capability y no es ruido. Se acepta y se
   * reporta, porque un especialista del dominio es mejor que un rol
   * fabricado — pero hay que decirlo, no venderlo como match solido.
   */
  fallback?: boolean
}

export function buildPanel(
  catalog: CatalogAgent[],
  target: string[],
  options: { maxComplements?: number; minComplementCoverage?: number; minCoverage?: number } = {},
): RolePanel {
  const maxComplements = options.maxComplements ?? 3
  const minComplementCoverage = options.minComplementCoverage ?? 0.15
  const minCoverage = options.minCoverage ?? 0.6
  /**
   * El minimo de cobertura es un filtro, no un dato.
   *
   * Sin esto, el "mejor" match de un objetivo que el catalogo no cubre es
   * casi cualquier agente: todos dan 3% y gana el primero de la lista. Un
   * caso real: pedir "javascript, code-generation" elegia un mentor de
   * ServiceNow, porque era el primero con la palabra "code".
   *
   * Y con un minimo fijo tampoco alcanza: con 2 capabilities, 1 de 2 da 0.5
   * y el minimo de 0.6 seria inalcanzable SIEMPRE. Por eso hay dos bandas:
   *
   * - **Banda 1** (cobertura >= minCoverage): match solido.
   * - **Banda 2** (cubre >= 1 capability y cobertura >= minCoverage/2): el
   *   mejor disponible, y se marca como `fallback` para que el despacho lo
   *   diga. Un especialista del dominio le gana a un rol fabricado.
   * - **Ninguna**: no hay match. Se fabrica el rol.
   */
  const ranked = catalog
    .map((agent) => matchCapabilities([agent], target))
    .filter((m): m is CatalogMatch => !!m)
    .sort((a, b) => b.coverage - a.coverage)

  const best = ranked[0] ?? null
  if (!best) {
    return { primary: null, complements: [], uncovered: [...target] }
  }

  let primary = best
  let fallback = false
  if (best.coverage < minCoverage) {
    const candidato = ranked.find(
      (m) => m.matched.length > 0 && m.coverage >= minCoverage / 2,
    )
    if (!candidato) {
      return { primary: null, complements: [], uncovered: [...target] }
    }
    primary = candidato
    fallback = true
  }

  const covered = new Set(primary.matched)
  const complements: CatalogMatch[] = []

  for (const candidate of ranked.slice(1)) {
    if (complements.length >= maxComplements) break
    if (candidate.coverage < minComplementCoverage) continue
    // Solo si aporta algo que el primario no cubre.
    const aporta = candidate.matched.filter((m) => !covered.has(m))
    if (aporta.length === 0) continue
    complements.push(candidate)
    for (const m of aporta) covered.add(m)
  }

  return {
    primary,
    complements,
    uncovered: target.filter((t) => !covered.has(t)),
    fallback,
  }
}
