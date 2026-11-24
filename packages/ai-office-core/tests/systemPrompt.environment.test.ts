/**
 * Tests de la hoja de entorno en el prompt de sistema.
 *
 * Lección de la corrida con errores de PowerShell/Code Mode: el Commander
 * también cometía los mismos errores de sintaxis que los despachados, porque
 * nadie le decía qué runtime tenía enfrente.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { Office } from "../src/core/office.js"
import { buildSystemPrompt } from "../src/core/systemPrompt.js"

let tmp: string
let office: Office

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-env-"))
  await fs.writeFile(
    path.join(tmp, "package.json"),
    JSON.stringify({ name: "demo", scripts: { test: "true" } }),
  )
  office = new Office({ cwd: tmp })
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe("Hoja de entorno en el prompt de sistema", () => {
  it("sin corrida activa el prompt queda vacío (no ensucia el sistema)", async () => {
    const state = await office.loadState("nada")
    // Sin plan: no hay objective guardado todavía.
    const prompt = await buildSystemPrompt(office, state)
    expect(prompt).toBe("")
  })

  it("con plan activo incluye la hoja de entorno con las reglas del runtime", async () => {
    const state = await office.loadState("Implementar login")
    await office.savePlan(state, [
      {
        title: "Login",
        type: "implementation",
        requiredCapabilities: ["react"],
        scope: { mayTouch: ["src/**"], forbidden: [] },
        acceptance: ["funciona"],
        gate: "npm test",
      },
    ])

    const prompt = await buildSystemPrompt(office, state)

    // El Commander ejecuta comandos y `execute`: necesita las mismas reglas
    // que los despachados.
    expect(prompt).toContain("Tu entorno de ejecución")
    expect(prompt).toContain("PowerShell")
    expect(prompt).toContain("NO hay `import`, `export` ni `require`")
    expect(prompt).toContain("NO reintentés lo mismo")
    // Y sigue teniendo el estado de la corrida.
    expect(prompt).toContain("OFICINA — estado de la corrida")
  })
})
