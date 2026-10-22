import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import {
  scanCatalog,
  matchCapabilities,
  resolveRole,
  extractCapabilities,
  parseFrontmatter,
  parseSections,
  normalizeHeading,
  findSection,
  extractSubheadings,
  extractListItems,
  capabilityTokens,
  missionTags,
  rankCandidates,
  buildPanel,
  canonicalConcepts,
  titleize,
} from "../src/core/catalog.js"
import { createFicha } from "../src/core/factory.js"

let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-catalog-"))
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

/** Escribe un agente con la estructura real de agency-agents. */
async function writeAgent(
  division: string,
  slug: string,
  name: string,
  description: string,
  extra: { vibe?: string; missions?: string[]; deliverables?: string[]; advanced?: string[] } = {},
) {
  const dir = path.join(tmp, division)
  await fs.mkdir(dir, { recursive: true })

  const missions = (extra.missions ?? ["Do The Main Thing", "Handle The Edge Case"])
    .map((m) => `### ${m}`)
    .join("\n\n")
  const deliverables = (extra.deliverables ?? ["A Working Framework"])
    .map((m) => `### ${m}`)
    .join("\n\n")
  const advanced = (extra.advanced ?? ["Deep Expertise"]).map((m) => `### ${m}`).join("\n\n")

  await fs.writeFile(
    path.join(dir, `${slug}.md`),
    [
      "---",
      `name: ${name}`,
      `description: ${description}`,
      'color: "#00FFFF"',
      `vibe: ${extra.vibe ?? "Straight to the point."}`,
      "---",
      "",
      `# ${name} Agent Personality`,
      "",
      `You are **${name}**, ${description}.`,
      "",
      "## Your Identity & Memory",
      "- **Role**: Something specific",
      "",
      "## Your Core Mission",
      "",
      missions,
      "",
      "## Critical Rules You Must Follow",
      "",
      "1. Rule one that matters a lot.",
      "2. Rule two that also matters.",
      "",
      "## Your Technical Deliverables",
      "",
      deliverables,
      "",
      "## Your Workflow Process",
      "",
      "### Step 1: Do it",
      "",
      "## Your Communication Style",
      "",
      "- Direct.",
      "",
      "## Learning & Memory",
      "",
      "## Your Success Metrics",
      "",
      "## Advanced Capabilities",
      "",
      advanced,
      "",
    ].join("\n"),
  )
}

describe("Parsing de frontmatter y secciones", () => {
  it("parsea el frontmatter con name, description, vibe", () => {
    const { data, body } = parseFrontmatter(
      '---\nname: "Test Agent"\ndescription: "Does things"\nvibe: "Sharp."\n---\n\nBody here',
    )
    expect(data.name).toBe("Test Agent")
    expect(data.description).toBe("Does things")
    expect(data.vibe).toBe("Sharp.")
    expect(body.trim()).toBe("Body here")
  })

  it("no rompe con frontmatter ausente", () => {
    const { data } = parseFrontmatter("# Just a heading\n\nSome text")
    expect(data).toEqual({})
  })

  it("normaliza encabezados con emoji", () => {
    expect(normalizeHeading("## 🎯 Your Identity & Memory")).toBe("Your Identity & Memory")
    expect(normalizeHeading("### Pressure-Test Claims")).toBe("Pressure-Test Claims")
  })

  it("parsea las secciones H2 del cuerpo", () => {
    const body = "## First Section\n\ncontent one\n\n## Second Section\n\ncontent two"
    const sections = parseSections(body)
    expect(Object.keys(sections)).toHaveLength(2)
    expect(sections["First Section"]).toContain("content one")
  })

  it("encuentra una sección por palabra clave, con o sin 'Your'", () => {
    const body = "## Your Core Mission\n\nmission body\n\n## Critical Rules\n\nrules body"
    const sections = parseSections(body)
    expect(findSection(sections, "Core Mission")).toContain("mission body")
    expect(findSection(sections, "Critical Rules")).toContain("rules body")
    expect(findSection(sections, "Nope")).toBeUndefined()
  })

  it("extrae subtítulos H3 e items de lista", () => {
    const block = "### Alpha One\n\ntext\n\n### Beta Two\n\nmore"
    expect(extractSubheadings(block)).toEqual(["Alpha One", "Beta Two"])

    const list = "1. First item\n2. Second item\n- Third item\nnot an item"
    expect(extractListItems(list)).toEqual(["First item", "Second item", "Third item"])
  })
})

describe("Tokens de capability", () => {
  it("filtra stopwords y tokens cortos", () => {
    const tokens = capabilityTokens("The design and the implementation of a React component")
    expect(tokens.has("the")).toBe(false)
    expect(tokens.has("and")).toBe(false)
    expect(tokens.has("design")).toBe(true)
    expect(tokens.has("react")).toBe(true)
  })

  it("convierte misiones en tags comparables", () => {
    expect(missionTags(["Pressure-Test Quantitative Claims"])).toEqual([
      "pressure-test-quantitative-claims",
    ])
  })
})

describe("Extracción de capabilities desde el cuerpo", () => {
  it("extrae las capacidades de las misiones, no del nombre", () => {
    const caps = extractCapabilities({
      displayName: "Statistician",
      description: "Expert in quantitative research",
      missions: ["Pressure-Test Quantitative Claims", "Design Sound Studies"],
      deliverables: ["Effect Size + Uncertainty Report"],
      advanced: ["Causal Inference"],
    })

    expect(caps).toContain("pressure-test")
    expect(caps).toContain("quantitative")
    expect(caps).toContain("causal")
    expect(caps).toContain("inference")
    expect(caps).toContain("effect")
  })

  it("incluye los tokens de la descripción como respaldo", () => {
    const caps = extractCapabilities({
      displayName: "X",
      description: "Expert in kubernetes operators",
      missions: [],
      deliverables: [],
      advanced: [],
    })
    expect(caps).toContain("kubernetes")
  })
})

describe("Escaneo del catálogo", () => {
  it("encuentra los agentes y extrae su estructura", async () => {
    await writeAgent("engineering", "frontend-developer", "Frontend Developer", "React and CSS", {
      vibe: "Pixel obsessive.",
      missions: ["Build Accessible Components", "Design Token Systems"],
      deliverables: ["Component Library"],
      advanced: ["Motion Design"],
    })

    const catalog = await scanCatalog({ root: tmp })
    expect(catalog).toHaveLength(1)

    const agent = catalog[0]!
    expect(agent.division).toBe("engineering")
    expect(agent.displayName).toBe("Frontend Developer")
    expect(agent.vibe).toBe("Pixel obsessive.")
    expect(agent.missions).toEqual(["Build Accessible Components", "Design Token Systems"])
    expect(agent.deliverables).toEqual(["Component Library"])
    expect(agent.advanced).toEqual(["Motion Design"])
    expect(agent.rules).toHaveLength(2)
    expect(agent.capabilities).toContain("accessible")
    expect(agent.sourcePrompt).toContain("Agent Personality")
  })

  it("ignora README y CHANGELOG", async () => {
    await writeAgent("engineering", "real-agent", "Real", "Something")
    await fs.writeFile(path.join(tmp, "engineering", "README.md"), "# Nope")
    await fs.writeFile(path.join(tmp, "engineering", "CHANGELOG.md"), "# Nope")
    expect(await scanCatalog({ root: tmp })).toHaveLength(1)
  })

  it("filtra por divisiones pedidas", async () => {
    await writeAgent("engineering", "a", "A", "x")
    await writeAgent("security", "b", "B", "y")
    const catalog = await scanCatalog({ root: tmp, divisions: ["security"] })
    expect(catalog).toHaveLength(1)
    expect(catalog[0]!.division).toBe("security")
  })
})

describe("Matching ponderado", () => {
  it("elige el agente cuya misión matchea literalmente", async () => {
    await writeAgent("engineering", "frontend-developer", "Frontend Developer", "UI work", {
      missions: ["Build React Components", "Design CSS Systems"],
    })
    await writeAgent("engineering", "backend-developer", "Backend Developer", "Server work", {
      missions: ["Design REST APIs", "Model Database Schemas"],
    })

    const catalog = await scanCatalog({ root: tmp })
    const match = matchCapabilities(catalog, ["react components", "css systems"])!
    expect(match.agent.slug).toBe("frontend-developer")
    expect(match.coverage).toBeGreaterThan(0.5)
  })

  it("la cobertura es la fracción cubierta", async () => {
    await writeAgent("engineering", "frontend-developer", "Frontend Developer", "UI work", {
      missions: ["Build React Components"],
    })
    const catalog = await scanCatalog({ root: tmp })
    const match = matchCapabilities(catalog, ["react", "kubernetes", "pdf"])!
    expect(match.coverage).toBeLessThan(1)
    expect(match.matched).toContain("react")
    expect(match.missing.length).toBeGreaterThan(0)
  })

  it("devuelve undefined si la cobertura está bajo el umbral", async () => {
    await writeAgent("engineering", "backend-developer", "Backend Developer", "Server work", {
      missions: ["Design REST APIs"],
    })
    const catalog = await scanCatalog({ root: tmp })
    const match = matchCapabilities(catalog, ["react", "css", "accessibility"], {
      minCoverage: 0.6,
    })
    expect(match).toBeUndefined()
  })

  it("rankCandidates devuelve las mejores alternativas ordenadas", async () => {
    await writeAgent("engineering", "a-react", "A", "x", { missions: ["Build React Components"] })
    await writeAgent("engineering", "b-react", "B", "y", { missions: ["React Component Library"] })
    await writeAgent("engineering", "c-unrelated", "C", "z", { missions: ["Financial Modeling"] })

    const catalog = await scanCatalog({ root: tmp })
    const ranked = rankCandidates(catalog, ["react components"], 3)
    expect(ranked).toHaveLength(3)
    expect(ranked[0]!.coverage).toBeGreaterThanOrEqual(ranked[1]!.coverage)
    expect(ranked[2]!.agent.slug).toBe("c-unrelated")
  })
})

describe("Panel de roles", () => {
  it("elige un primario y complementos que cubren lo que falta", async () => {
    await writeAgent("engineering", "frontend-developer", "Frontend Developer", "UI", {
      missions: ["Build React Components", "Style CSS Systems"],
    })
    await writeAgent("engineering", "a11y-specialist", "Accessibility Specialist", "A11y", {
      missions: ["Audit ARIA Semantics", "Test Keyboard Operability"],
    })

    const catalog = await scanCatalog({ root: tmp })
    const panel = buildPanel(catalog, ["react", "accessibility"])

    expect(panel.primary).toBeDefined()
    expect(panel.complements.length).toBe(1)
    const primaryCovers = panel.primary!.matched
    const aporta = panel.complements[0]!.matched.filter((m) => !primaryCovers.includes(m))
    expect(aporta.length).toBeGreaterThan(0)
  })

  it("no elige complementos que no aportan nada", async () => {
    await writeAgent("engineering", "a", "A", "x", { missions: ["Build React Components"] })
    await writeAgent("engineering", "b", "B", "y", { missions: ["Build React Components"] })
    await writeAgent("engineering", "c", "C", "z", { missions: ["Build React Components"] })

    const catalog = await scanCatalog({ root: tmp })
    const panel = buildPanel(catalog, ["react"])
    expect(panel.complements.length).toBe(0)
  })

  it("reporta las capabilities que nadie cubre", async () => {
    await writeAgent("engineering", "a", "A", "x", { missions: ["Build React Components"] })
    const catalog = await scanCatalog({ root: tmp })
    const panel = buildPanel(catalog, ["react", "kubernetes", "quantum"])
    expect(panel.uncovered).toContain("kubernetes")
    expect(panel.uncovered).toContain("quantum")
  })

  it("sin catálogo devuelve un panel vacío", () => {
    const panel = buildPanel([], ["react"])
    expect(panel.primary).toBeNull()
    expect(panel.complements).toHaveLength(0)
    expect(panel.uncovered).toEqual(["react"])
  })

  it("la resolución usa la cobertura del panel, no la del primario solo", async () => {
    await writeAgent("engineering", "a", "A", "x", { missions: ["Build React Components"] })
    await writeAgent("engineering", "b", "B", "y", { missions: ["Audit Kubernetes Clusters"] })

    const catalog = await scanCatalog({ root: tmp })
    const { needsFactory, panel } = resolveRole(catalog, ["react", "kubernetes"], 0.9)
    expect(needsFactory).toBe(false)
    expect(panel?.complements.length).toBeGreaterThan(0)
  })
})

describe("Normalización conceptual", () => {
  it("conserva los tokens crudos y agrega el concepto", () => {
    const concepts = canonicalConcepts("web frontend")
    expect(concepts.has("web")).toBe(true)
    expect(concepts.has("frontend")).toBe(true)
    expect(concepts.has("react")).toBe(true)
  })

  it("no colapsa los aliases: un token de un grupo no trae el resto", () => {
    const concepts = canonicalConcepts("testing")
    expect(concepts.size).toBe(1)
    expect(concepts.has("playwright")).toBe(false)
  })

  it("un token fuera de todo grupo queda como está", () => {
    const concepts = canonicalConcepts("partitioning")
    expect(concepts.has("partitioning")).toBe(true)
  })
})

describe("Resolución de roles", () => {
  it("usa el catálogo cuando la cobertura es suficiente", async () => {
    await writeAgent("engineering", "frontend-developer", "Frontend Developer", "React and CSS", {
      missions: ["Build React Components", "Design CSS Systems"],
    })
    const catalog = await scanCatalog({ root: tmp })
    const { match, needsFactory } = resolveRole(catalog, ["react components", "css systems"], 0.6)
    expect(needsFactory).toBe(false)
    expect(match?.agent.slug).toBe("frontend-developer")
  })

  it("pide factory cuando la cobertura es baja", async () => {
    await writeAgent("engineering", "backend-developer", "Backend Developer", "API work", {
      missions: ["Design REST APIs"],
    })
    const catalog = await scanCatalog({ root: tmp })
    const { needsFactory } = resolveRole(catalog, ["motion-design", "3d-shader"], 0.6)
    expect(needsFactory).toBe(true)
  })

  it("pide factory cuando el catálogo está vacío", () => {
    const { match, needsFactory } = resolveRole([], ["react"], 0.6)
    expect(match).toBeUndefined()
    expect(needsFactory).toBe(true)
  })
})

describe("Factory", () => {
  it("crea una ficha con el schema normalizado", () => {
    const ficha = createFicha({
      role: "motion-designer",
      capabilities: ["animation", "motion-design"],
      objective: "Hacer la landing más fluida",
    })

    expect(ficha.role).toBe("motion-designer")
    expect(ficha.displayName).toBe("Motion Designer")
    expect(ficha.source.kind).toBe("factory")
    expect(ficha.capabilities).toContain("animation")
    expect(ficha.scope.forbidden.some((f) => f.includes(".env"))).toBe(true)
    expect(ficha.mustNot.length).toBeGreaterThan(0)
    expect(ficha.onFinish).toBe("idle-join")
  })

  it("emite un prompt con la MISMA estructura de 10 secciones que agency-agents", () => {
    const ficha = createFicha({
      role: "motion-designer",
      capabilities: ["animation", "motion-design"],
      objective: "Hacer la landing más fluida",
    })
    const prompt = ficha.source.sourcePrompt!

    for (const section of [
      "Your Identity & Memory",
      "Your Core Mission",
      "Critical Rules You Must Follow",
      "Your Technical Deliverables",
      "Your Workflow Process",
      "Your Communication Style",
      "Learning & Memory",
      "Your Success Metrics",
      "Advanced Capabilities",
    ]) {
      expect(prompt).toContain(section)
    }
  })

  it("el prompt no es genérico: incluye capabilities y objetivo", () => {
    const ficha = createFicha({
      role: "motion-designer",
      capabilities: ["animation", "motion-design"],
      objective: "Hacer la landing más fluida",
    })
    const prompt = ficha.source.sourcePrompt!
    expect(prompt).toContain("animation")
    expect(prompt).toContain("motion-design")
    expect(prompt).toContain("Hacer la landing más fluida")
    expect(prompt).not.toContain("{{")
  })

  it("el id de despliegue es único", () => {
    const a = createFicha({ role: "x", capabilities: [] })
    const b = createFicha({ role: "x", capabilities: [] })
    expect(a.id).not.toBe(b.id)
    expect(a.id).toMatch(/^e-/)
  })

  it("titleize capitaliza slugs", () => {
    expect(titleize("frontend-developer")).toBe("Frontend Developer")
    expect(titleize("qa_engineer")).toBe("Qa Engineer")
  })
})
