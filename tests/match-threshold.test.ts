/**
 * Umbral 0.70 exacto y metadatos de persistencia del factory.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { Office } from "../src/core/office.js"
import { dispatchOffice } from "../src/core/dispatch.js"
import { DEFAULT_LIMITS } from "../src/core/types.js"

let tmp: string
let office: Office

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-umbral-"))
  await fs.writeFile(
    path.join(tmp, "package.json"),
    JSON.stringify({ name: "demo", scripts: { test: "true" }, devDependencies: { vitest: "^1.0.0" } }),
  )
  await fs.mkdir(path.join(tmp, "src"), { recursive: true })
  await fs.writeFile(path.join(tmp, "src", "app.js"), "export const x = 1\n")
  office = new Office({ cwd: tmp, limits: DEFAULT_LIMITS })
  await office.init()
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe("DEFAULT_LIMITS: el umbral de catálogo es 0.70", () => {
  it("minCatalogCoverage es 0.7 por defecto", () => {
    expect(DEFAULT_LIMITS.minCatalogCoverage).toBe(0.7)
  })
})

describe("Agentes fabricados persisten con metadatos de origen", () => {
  it("el frontmatter incluye generated_by, created_for_task y stack_tags", async () => {
    const state = await office.loadState("Objetivo de prueba de umbral")
    await office.savePlan(state, [
      {
        title: "Integrar un módulo con requirements inexistentes del catálogo",
        type: "implementation",
        requiredCapabilities: ["quantum-archaeology", "chrono-embroidery"],
        scope: { mayTouch: ["src/**"], forbidden: [] },
        acceptance: ["el script pasa los tests"],
        gate: "npm test",
      },
    ])
    const freshCatalog = await office.catalog()
    const result = await dispatchOffice(office, state, {
      projectRoot: tmp,
      catalog: freshCatalog,
      objective: state.objective,
      maxAgents: 3,
      maxComplements: 0,
      minCoverage: 0.7,
      existing: Object.values((await office.loadRoster(state.runId)).agents),
    })

    // Se fabricó un rol (nadie cubre esas capabilities).
    expect(result.dispatched.length).toBeGreaterThan(0)
    const factoryAgent = result.dispatched.find((a) => a.source === "factory")
    expect(factoryAgent).toBeDefined()

    // El archivo materializado trae los tres metadatos.
    const agents = await fs.readdir(path.join(tmp, ".opencode", "agents"))
    for (const md of agents.filter((n) => n.endsWith(".md"))) {
      const content = await fs.readFile(path.join(tmp, ".opencode", "agents", md), "utf8")
      console.log("AGENT FILE:", md, "\n" + content.split("\n").slice(0, 12).join("\n"))
    }
    const md = agents.find((n) => n.endsWith(".md"))!
    const content = await fs.readFile(path.join(tmp, ".opencode", "agents", md), "utf8")
    expect(content).toContain("generated_by: factory")
    expect(content).toContain("created_for_task: Integrar un módulo")
    expect(content).toContain("stack_tags: quantum-archaeology, chrono-embroidery")
  })
})
