/**
 * Traits de entorno: detección de stack + inyección dinámica.
 *
 * La idea: un agente que sabe que el repo es "TypeScript estricto + Vitest
 * en Windows" escribe mejor que uno que recibe esas reglas en una card. El
 * dispatch inyecta ÚNICAMENTE los traits relevantes (stack detectado ∧ con
 * tags alineados a la card) en una sección propia.
 *
 * Detección (read-only, determinista):
 *
 *  1. package.json deps/devDeps → tags de stack (vitest, react, postgres…)
 *  2. tsconfig.json parser mínimo: strict true → `typescript`
 *  3. Lockfiles: pnpm-lock.yaml / package-lock.json / yarn.lock → package manager
 *  4. OS: process.platform → `windows` | `posix`
 *  5. Paths: docs/ + .md → `markdown`
 */
import path from "node:path"
import fs from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { readText } from "./fsx.js"

export interface TraitInfo {
  id: string
  title: string
  tags: string[]
  /** Cuerpo compacto del .md (sin frontmatter), listo para inyectar. */
  body: string
}

interface TraitMeta {
  id: string
  title: string
  tags: string[]
  file: string
}

const TRAITS: TraitMeta[] = [
  { id: "typescript-strict", title: "TypeScript (strict)", tags: ["typescript"], file: "typescript-strict.md" },
  { id: "vitest-testing", title: "Vitest (testing)", tags: ["vitest"], file: "vitest-testing.md" },
  { id: "windows-powershell", title: "Windows / PowerShell", tags: ["windows"], file: "windows-powershell.md" },
  { id: "postgres-migrations", title: "Postgres migraciones", tags: ["postgres"], file: "postgres-migrations.md" },
  { id: "markdown-docs", title: "Docs en Markdown", tags: ["markdown", "docs"], file: "markdown-docs.md" },
  { id: "react-hooks", title: "React (hooks)", tags: ["react"], file: "react-hooks.md" },
]

/** Directorio de traits del paquete — usado como fallback si el repo no trae `traits/`. */
function bundledTraitsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(here, "..", "..", "traits")
}

async function resolveTraitDir(projectRoot: string): Promise<string> {
  const local = path.join(projectRoot, "traits")
  try {
    await fs.access(local)
    return local
  } catch {
    return bundledTraitsDir()
  }
}

async function extractDeps(pkgPath: string): Promise<string[]> {
  const raw = await readText(pkgPath)
  if (!raw) return []
  try {
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    return [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]
  } catch {
    return []
  }
}

async function tsconfigHasStrict(root: string): Promise<boolean> {
  const raw = await readText(path.join(root, "tsconfig.json"))
  if (!raw) return false
  try {
    const cfg = JSON.parse(raw) as { compilerOptions?: { strict?: boolean } }
    return cfg.compilerOptions?.strict === true
  } catch {
    return false
  }
}

/** Tags de stack detectados en el repo. Detallado en la config de cada trait. */
export async function auditRepo(projectRoot: string): Promise<string[]> {
  const tags = new Set<string>()
  const deps = await extractDeps(path.join(projectRoot, "package.json"))
  const has = (name: string) => deps.includes(name)

  if (deps.length > 0) {
    if (await tsconfigHasStrict(projectRoot) || has("typescript")) tags.add("typescript")
    if (has("vitest")) tags.add("vitest")
    if (has("react") || has("react-dom")) tags.add("react")
    if (has("pg") || has("postgres") || has("drizzle-orm") || has("prisma") || has("@prisma/client")) tags.add("postgres")
  }

  // Documentos en Markdown (docs/ o *.md en raíz)
  const rootEntries = await fs.readdir(projectRoot).catch(() => [] as string[])
  if (rootEntries.includes("docs") || rootEntries.some((e) => e.toLowerCase().endsWith(".md"))) {
    tags.add("markdown")
  }

  tags.add(process.platform === "win32" ? "windows" : "posix")
  return [...tags]
}

/** Carga los traits del repo (o del paquete), filtrados por tags pedidos. */
export async function loadTraits(projectRoot: string, tags: string[]): Promise<TraitInfo[]> {
  const tagSet = new Set(tags)
  const out: TraitInfo[] = []
  const dir = await resolveTraitDir(projectRoot)
  for (const meta of TRAITS) {
    const hit = meta.tags.some((t) => tagSet.has(t)) || tagSet.has(meta.id)
    if (!hit) continue
    const raw = await readText(path.join(dir, meta.file))
    if (!raw) continue
    const body = raw.replace(/```/g, "` ` `").trim()
    out.push({ id: meta.id, title: meta.title, tags: meta.tags, body })
  }
  return out
}

/** Selecciona traits por tags del stack y capacidades de la card. */
export function selectTraitsForCard(stackTags: string[], cardTags: string[]): string[] {
  const wanted = new Set([...stackTags, ...cardTags.map((c) => c.toLowerCase())])
  const out = TRAITS.filter((t) => t.tags.some((tag) => wanted.has(tag))).map((t) => t.id)
  return [...new Set(out)]
}
