/**
 * Tests de la sincronizacion de la documentacion.
 *
 * El problema que resuelven: las cifras de la documentacion estaban
 * escritas a mano, y dos documentos de同一个 proyecto daban numeros
 * distintos. Ahora se calculan del codigo y el CI verifica que coincidan.
 *
 * Estos tests son el respaldo del gate del CI: si `docs:check` dice que
 * todo esta bien, es porque la funcion que usa really funciona.
 */

import { describe, it, expect } from "vitest"
import path from "node:path"
import fs from "node:fs/promises"
import {
  computeFacts,
  renderFactsBlock,
  replaceFactsBlock,
  findFactsBlock,
  readCatalogSnapshot,
  FACTS_BEGIN,
  FACTS_END,
} from "../src/core/docsync.js"

const projectRoot = path.resolve(import.meta.dirname, "..")

describe("Bloque de hechos", () => {
  it("encuentra y reemplaza el bloque delimitado", () => {
    const contenido = `# Titulo\n\nAntes.\n\n${FACTS_BEGIN}\nviejo\n${FACTS_END}\n\nDespues.\n`
    const encontrado = findFactsBlock(contenido)
    expect(encontrado).not.toBeNull()

    const actualizado = replaceFactsBlock(contenido, `${FACTS_BEGIN}\nnuevo\n${FACTS_END}`)
    expect(actualizado).toContain("nuevo")
    expect(actualizado).not.toContain("viejo")
    // El texto humano se conserva.
    expect(actualizado).toContain("Antes.")
    expect(actualizado).toContain("Despues.")
  })

  it("no rompe nada si el bloque no existe", () => {
    const contenido = "# Titulo\n\nSin bloque.\n"
    expect(findFactsBlock(contenido)).toBeNull()
    expect(replaceFactsBlock(contenido, "nuevo")).toBe(contenido)
  })

  it("el reemplazo es idempotente", () => {
    const bloque = `${FACTS_BEGIN}\nX\n${FACTS_END}`
    const una = replaceFactsBlock(`a\n${bloque}\nb`, bloque)
    const dos = replaceFactsBlock(una, bloque)
    expect(dos).toBe(una)
  })
})

describe("Hechos del proyecto", () => {
  it("calcula las cifras desde el codigo real", async () => {
    const facts = await computeFacts({ projectRoot })

    // Las tools se cuentan sobre una instancia real del builder.
    expect(facts.tools).toBeGreaterThan(0)
    expect(facts.toolNames.every((n) => n.startsWith("oficina_"))).toBe(true)

    // La version sale del package.json.
    const pkg = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8"))
    expect(facts.version).toBe(pkg.version)
    expect(facts.packageName).toBe(pkg.name)

    // El API de plugin sale del package.json tambien.
    expect(facts.pluginApi.version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it("el bloque renderizado tiene las filas esperadas", async () => {
    const facts = await computeFacts({ projectRoot })
    const bloque = renderFactsBlock(facts)

    expect(bloque).toContain("**Paquete**")
    expect(bloque).toContain("**Tools**")
    expect(bloque).toContain("**Hooks**")
    expect(bloque).toContain("**API de plugin**")
    expect(bloque).toContain("**Límites**")
  })
})

describe("Snapshot del catalogo", () => {
  it("esta versionado y es coherente", async () => {
    const snapshot = await readCatalogSnapshot(projectRoot)
    expect(snapshot).not.toBeNull()
    expect(snapshot!.agents).toBeGreaterThan(0)
    expect(snapshot!.divisions).toBeGreaterThan(0)
    expect(snapshot!.divisionList.length).toBe(snapshot!.divisions)
    // La procedencia queda registrada: sin esto el numero no es trazable.
    expect(snapshot!.generatedAt).toBeTruthy()
  })

  it("las divisiones del snapshot son las del catalogo", async () => {
    const snapshot = await readCatalogSnapshot(projectRoot)
    const facts = await computeFacts({ projectRoot, catalogSnapshot: snapshot })
    expect(facts.catalog).not.toBeNull()
    expect(facts.catalog!.agents).toBe(snapshot!.agents)
    expect(facts.catalog!.divisions).toBe(snapshot!.divisions)
  })
})

describe("Los documentos del repo estan al dia", () => {
  it("README.md y docs/QUE-ES.md tienen el bloque generado", async () => {
    for (const relative of ["README.md", "docs/QUE-ES.md"]) {
      const contenido = await fs.readFile(path.join(projectRoot, relative), "utf8")
      expect(findFactsBlock(contenido), `${relative} no tiene el bloque generado`).not.toBeNull()
    }
  })

  it("el bloque del README coincide con los hechos actuales", async () => {
    const contenido = await fs.readFile(path.join(projectRoot, "README.md"), "utf8")
    const bloque = findFactsBlock(contenido)
    expect(bloque).not.toBeNull()

    const facts = await computeFacts({ projectRoot, catalogSnapshot: await readCatalogSnapshot(projectRoot) })
    const esperado = `${FACTS_BEGIN}\n${renderFactsBlock(facts)}\n${FACTS_END}`

    // Si esto falla, el gate del CI (`npm run docs:check`) tambien falla.
    expect(bloque!.text).toBe(esperado)
  })
})
