/**
 * El matcher no puede elegir cualquier cosa.
 *
 * ## El bug que motivo este archivo
 *
 * El dispatch tomaba `ranked[0]` sin mirar la cobertura. Cuando el
 * objetivo no lo cubria nadie, TODOS los agentes daban 3% y ganaba el
 * primero de la lista.
 *
 * Caso real, de una corrida de verdad:
 *
 *     card: "Implementar sum(a, b) en src/sum.js"
 *     caps: ["javascript", "code-generation"]
 *     elegido: engineering-servicenow-developer-mentor
 *
 * Un mentor de ServiceNow para sumar dos numeros. Y el agente lo creia:
 * su briefing decia que su especialidad era ServiceNow.
 *
 * ## Las dos bandas
 *
 * - **Banda 1** (cobertura >= minimo): match solido.
 * - **Banda 2** (cubre >= 1 capability y cobertura >= minimo/2): el mejor
 *   disponible. Se acepta y se marca `fallback`, porque un especialista del
 *   dominio le gana a un rol fabricado — pero hay que decirlo.
 * - **Ninguna**: no hay match. Se **fabrica** el rol.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { Office } from "../src/core/office.js"
import { buildPanel } from "../src/core/catalog.js"
import { dispatchOffice } from "../src/core/dispatch.js"
import { DEFAULT_LIMITS } from "../src/core/types.js"

let tmp: string
let office: Office

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-factory-"))
  await fs.writeFile(path.join(tmp, "package.json"), JSON.stringify({ name: "demo", scripts: { test: "true" } }))
  await fs.mkdir(path.join(tmp, "src"), { recursive: true })
  await fs.writeFile(path.join(tmp, "src", "app.js"), "export const x = 1\n")
  office = new Office({ cwd: tmp, limits: DEFAULT_LIMITS })
  await office.init()
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe("buildPanel: el minimo de cobertura es un filtro", () => {
  it("no devuelve primario cuando nadie cubre el objetivo", () => {
    // Catalogo vacio: no hay nada que matchear.
    const panel = buildPanel([], ["javascript"], { minCoverage: 0.6 })
    expect(panel.primary).toBeNull()
    expect(panel.uncovered).toEqual(["javascript"])
  })

  it("el fallback se marca cuando el match entra por la segunda banda", () => {
    const catalog = [
      {
        slug: "algo-especifico",
        displayName: "Algo Especifico",
        description: "Menciona javascript en otra parte",
        vibe: "vibe",
        division: "engineering",
        path: "engineering/algo.md",
        capabilities: ["javascript"],
        missions: ["mision sobre javascript"],
        deliverables: [],
        advanced: [],
        rules: [],
        sections: {},
        sourcePrompt: "",
        searchText: "javascript",
      },
    ]
    const panel = buildPanel(catalog, ["javascript", "code-generation"], { minCoverage: 0.6 })
    // Con un solo token de un objetivo de dos, la cobertura nunca llega a
    // 0.6: entra por la banda de segundo.
    expect(panel.primary).not.toBeNull()
    expect(panel.fallback).toBe(true)
  })
})

describe("Dispatch: fabricar el rol cuando el catalogo no cubre", () => {
  it("una card con capabilities que nadie cubre se resuelve con un rol fabricado", async () => {
    const state = await office.loadState("Objetivo")
    await office.savePlan(state, [
      {
        title: "Implementar sum(a, b) en src/sum.js",
        type: "implementation",
        // Capabilities que NO estan en el catalogo.
        requiredCapabilities: ["zzzz-inexistente", "qqqq-otra-cosa"],
        scope: { mayTouch: ["src/sum.js"], forbidden: [] },
        acceptance: ["sum(2,3) === 5"],
        gate: "npm test",
      },
    ])

    const fresh = await office.loadState("Objetivo")
    const roster = await office.loadRoster(fresh.runId)
    const result = await dispatchOffice(office, fresh, {
      projectRoot: tmp,
      catalog: [],
      objective: fresh.objective,
      maxAgents: 4,
      maxComplements: 0,
      minCoverage: DEFAULT_LIMITS.minCatalogCoverage,
      existing: Object.values(roster.agents),
    })

    expect(result.dispatched.length).toBe(1)
    const agente = result.dispatched[0]!
    expect(agente.source).toBe("factory")
    expect(agente.cardId).toBe("T-00")
    // Y el prompt lleva el contexto de la card, no un briefing generico.
    expect(agente.prompt).toContain("sum(a, b)")
    expect(agente.prompt).toContain("src/sum.js")
    // Se reporta que se fabrico.
    expect(result.notes.join(" ")).toMatch(/fabric/i)
  })

  it("el rol fabricado se materializa y queda en el roster", async () => {
    const state = await office.loadState("Objetivo")
    await office.savePlan(state, [
      {
        title: "Trabajo raro",
        type: "implementation",
        requiredCapabilities: ["zzzz-inexistente"],
        scope: { mayTouch: ["src/**"], forbidden: [] },
        acceptance: ["funciona"],
        gate: "npm test",
      },
    ])

    const fresh = await office.loadState("Objetivo")
    const roster = await office.loadRoster(fresh.runId)
    await dispatchOffice(office, fresh, {
      projectRoot: tmp,
      catalog: [],
      objective: fresh.objective,
      maxAgents: 4,
      maxComplements: 0,
      minCoverage: DEFAULT_LIMITS.minCatalogCoverage,
      existing: Object.values(roster.agents),
    })

    const despues = await office.loadRoster(fresh.runId)
    const agentes = Object.values(despues.agents)
    expect(agentes.length).toBe(1)
    expect(agentes[0]!.source.kind).toBe("factory")
    expect(agentes[0]!.currentCard).toBe("T-00")

    const archivo = agentes[0]!.fichaPath
    expect(archivo).toContain(".opencode")
    const contenido = await fs.readFile(archivo, "utf8")
    expect(contenido).toContain("mode: subagent")
  })
})
