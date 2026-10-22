import { describe, it, expect, beforeAll } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { scanCatalog, matchCapabilities, rankCandidates } from "../src/core/catalog.js"
import type { CatalogAgent } from "../src/core/types.js"

/**
 * Tests contra el repo real de agency-agents.
 *
 * Si el repo no está clonado, se saltan: son tests de integración con un
 * repositorio externo, no un requisito del paquete.
 */
const AGENCY_ROOT = path.join(
  process.env.HOME ?? process.env.USERPROFILE ?? "",
  "agency-agents",
)

let catalog: CatalogAgent[] = []
let available = false

beforeAll(async () => {
  try {
    await fs.access(path.join(AGENCY_ROOT, "engineering"))
    catalog = await scanCatalog({ root: AGENCY_ROOT })
    available = catalog.length > 0
  } catch {
    available = false
  }
}, 120_000)

describe("Catálogo real de agency-agents", () => {
  it("encuentra los agentes del repo real", () => {
    if (!available) return
    expect(catalog.length).toBeGreaterThan(200)
  })

  it("extrae la estructura de la mayoría de los agentes", () => {
    if (!available) return
    const conMisiones = catalog.filter((a) => a.missions.length > 0)
    expect(conMisiones.length / catalog.length).toBeGreaterThan(0.7)
  })

  it("extrae el vibe del frontmatter", () => {
    if (!available) return
    const conVibe = catalog.filter((a) => a.vibe.length > 0)
    expect(conVibe.length / catalog.length).toBeGreaterThan(0.7)
  })

  it("las capabilities vienen del cuerpo, no del nombre", () => {
    if (!available) return
    const statistician = catalog.find((a) => a.slug.includes("statistician"))
    if (!statistician) return
    // El nombre dice "statistician"; las capacidades reales son las de su
    // Core Mission: pressure-test, experimental design, inference.
    expect(statistician.capabilities).toContain("pressure-test")
    expect(statistician.capabilities.some((c) => c.includes("inference"))).toBe(true)
  })

  it("el matching distingue agentes del mismo dominio", () => {
    if (!available) return
    const match = matchCapabilities(catalog, ["react component accessibility"])
    if (!match) return
    // Debe elegir algo de frontend/design, no un agente de finanzas.
    expect(["engineering", "design", "specialized"]).toContain(match.agent.division)
  })

  it("la afinidad de división empuja hacia la división correcta", () => {
    if (!available) return
    const gis = matchCapabilities(catalog, ["gis geospatial mapping cartography"])
    if (!gis) return
    expect(["gis", "spatial-computing"]).toContain(gis.agent.division)
  })

  it("rankCandidates devuelve alternativas reales y ordenadas", () => {
    if (!available) return
    const ranked = rankCandidates(catalog, ["react testing accessibility"], 5)
    expect(ranked.length).toBe(5)
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1]!.coverage).toBeGreaterThanOrEqual(ranked[i]!.coverage)
    }
    // Ningún candidato con 0 cobertura es un match útil.
    expect(ranked[0]!.coverage).toBeGreaterThan(0.1)
  })

  it("ningún agente del catálogo se resuelve con cobertura cero si pide una capability real", () => {
    if (!available) return
    for (const target of ["kubernetes operator", "postgres migration", "wcag accessibility audit"]) {
      const match = matchCapabilities(catalog, [target])
      if (match) {
        expect(match.coverage).toBeGreaterThan(0)
      }
    }
  })
})
