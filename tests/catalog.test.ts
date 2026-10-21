import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { scanCatalog, matchCapabilities, resolveRole, inferCapabilities, parseFrontmatter } from "../src/core/catalog.js"
import { createFicha, titleize } from "../src/core/factory.js"

let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-catalog-"))
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

async function writeAgent(division: string, slug: string, name: string, description: string) {
  const dir = path.join(tmp, division)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    path.join(dir, `${slug}.md`),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nYou are ${name}. ${description}\n`,
  )
}

describe("Escaneo del catálogo", () => {
  it("encuentra los agentes por división", async () => {
    await writeAgent("engineering", "frontend-developer", "Frontend Developer", "Expert in React and CSS architecture")
    await writeAgent("security", "security-auditor", "Security Auditor", "Finds OWASP vulnerabilities and secrets")

    const catalog = await scanCatalog({ root: tmp })
    expect(catalog).toHaveLength(2)

    const fe = catalog.find((a) => a.slug === "frontend-developer")!
    expect(fe.division).toBe("engineering")
    expect(fe.displayName).toBe("Frontend Developer")
    expect(fe.sourcePrompt).toContain("You are Frontend Developer")
  })

  it("ignora README y CHANGELOG", async () => {
    await writeAgent("engineering", "real-agent", "Real", "Something")
    await fs.writeFile(path.join(tmp, "engineering", "README.md"), "# Nope")
    await fs.writeFile(path.join(tmp, "engineering", "CHANGELOG.md"), "# Nope")

    const catalog = await scanCatalog({ root: tmp })
    expect(catalog).toHaveLength(1)
  })

  it("filtra por divisiones pedidas", async () => {
    await writeAgent("engineering", "a", "A", "x")
    await writeAgent("security", "b", "B", "y")
    const catalog = await scanCatalog({ root: tmp, divisions: ["security"] })
    expect(catalog).toHaveLength(1)
    expect(catalog[0]!.division).toBe("security")
  })

  it("usa la descripción del frontmatter", () => {
    const { data, body } = parseFrontmatter(
      '---\nname: "Test Agent"\ndescription: "Does things well"\n---\n\nBody here',
    )
    expect(data.name).toBe("Test Agent")
    expect(data.description).toBe("Does things well")
    expect(body.trim()).toBe("Body here")
  })

  it("no rompe con frontmatter ausente", () => {
    const { data } = parseFrontmatter("# Just a heading\n\nSome text")
    expect(data).toEqual({})
  })
})

describe("Inferencia de capabilities", () => {
  it("detecta react y accessibility", () => {
    const caps = inferCapabilities("Frontend Developer", "Builds accessible React components with WCAG compliance")
    expect(caps).toContain("react")
    expect(caps).toContain("accessibility")
  })

  it("detecta security", () => {
    const caps = inferCapabilities("Security Auditor", "Finds OWASP vulnerabilities and hardcoded secrets")
    expect(caps).toContain("security")
  })

  it("incluye tokens literales del nombre", () => {
    const caps = inferCapabilities("motion-designer", "Something else entirely")
    expect(caps).toContain("motion")
  })
})

describe("Matching de capabilities", () => {
  it("elige el agente con mayor overlap", async () => {
    await writeAgent("engineering", "frontend-developer", "Frontend Developer", "React components and CSS")
    await writeAgent("engineering", "backend-developer", "Backend Developer", "API endpoints and database")

    const catalog = await scanCatalog({ root: tmp })
    const match = matchCapabilities(catalog, ["react", "css"])!
    expect(match.agent.slug).toBe("frontend-developer")
    expect(match.coverage).toBe(1)
  })

  it("la cobertura es la fracción de capabilities cubiertas", async () => {
    // Este agente cubre react pero ni security ni kubernetes.
    await writeAgent("engineering", "frontend-developer", "Frontend Developer", "React components and CSS")
    const catalog = await scanCatalog({ root: tmp })
    const match = matchCapabilities(catalog, ["react", "security", "kubernetes"])!
    expect(match.coverage).toBeCloseTo(1 / 3)
    expect(match.matched).toContain("react")
    expect(match.missing).toContain("security")
    expect(match.missing).toContain("kubernetes")
  })

  it("devuelve undefined si la cobertura está bajo el umbral", async () => {
    await writeAgent("engineering", "backend-developer", "Backend Developer", "API and database")
    const catalog = await scanCatalog({ root: tmp })
    const match = matchCapabilities(catalog, ["react", "css", "accessibility"], { minCoverage: 0.6 })
    expect(match).toBeUndefined()
  })
})

describe("Resolución de roles", () => {
  it("usa el catálogo cuando la cobertura es suficiente", async () => {
    await writeAgent("engineering", "frontend-developer", "Frontend Developer", "React components and CSS architecture")
    const catalog = await scanCatalog({ root: tmp })
    const { match, needsFactory } = resolveRole(catalog, ["react", "css"], 0.6)
    expect(needsFactory).toBe(false)
    expect(match?.agent.slug).toBe("frontend-developer")
  })

  it("pide factory cuando la cobertura es baja", async () => {
    await writeAgent("engineering", "backend-developer", "Backend Developer", "API and database")
    const catalog = await scanCatalog({ root: tmp })
    const { match, needsFactory } = resolveRole(catalog, ["motion-design", "3d"], 0.6)
    expect(needsFactory).toBe(true)
    expect(match).toBeDefined()
  })

  it("pide factory cuando el catálogo está vacío", async () => {
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

  it("el prompt generado no es genérico: incluye capabilities y objetivo", () => {
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
