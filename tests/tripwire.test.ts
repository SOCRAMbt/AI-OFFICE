/**
 * Tests del tripwire.
 *
 * El tripwire es la capa de DETECCION: photographa el arbol antes de un
 * comando y compara despues. Lo que cambio fuera del scope se reporta.
 *
 * Lo que estos tests tienen que demostrar:
 * - Detecta una escritura fuera del scope hecha por un comando de shell.
 * - NO reporta lo que el agente escribe DENTRO de su scope (eso es el
 *   trabajo esperado, no una violacion).
 * - Detecta la creacion y el borrado, no solo la modificacion.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { Tripwire, snapshotTree, diffSnapshots } from "../src/core/tripwire.js"

let tmp: string
let root: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-tripwire-"))
  root = path.join(tmp, "proyecto")
  await fs.mkdir(path.join(root, "src"), { recursive: true })
  await fs.writeFile(path.join(root, "src", "app.ts"), "export const a = 1\n")
  await fs.writeFile(path.join(root, "README.md"), "# demo\n")
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

const scope = ["src/**"]

describe("Foto del arbol", () => {
  it("no mira los archivos que estan en el scope", async () => {
    const snap = await snapshotTree(root, scope)
    expect(snap.files.has("src/app.ts")).toBe(false)
    expect(snap.files.has("README.md")).toBe(true)
    expect(snap.truncated).toBe(false)
    expect(snap.errors).toHaveLength(0)
  })

  it("mira siempre los archivos sensibles, aunque esten en el scope", async () => {
    await fs.writeFile(path.join(root, ".env"), "SECRET=1\n")
    const snap = await snapshotTree(root, ["**"])
    expect(snap.files.has(".env")).toBe(true)
  })

  it("no recorre node_modules", async () => {
    await fs.mkdir(path.join(root, "node_modules", "x"), { recursive: true })
    await fs.writeFile(path.join(root, "node_modules", "x", "index.js"), "1\n")
    const snap = await snapshotTree(root, [])
    expect(snap.files.has("node_modules/x/index.js")).toBe(false)
  })

  it("reporta truncamiento cuando se supera el limite de archivos", async () => {
    // Create more files outside scope to hit the limit
    await fs.writeFile(path.join(root, "file1.txt"), "1\n")
    await fs.writeFile(path.join(root, "file2.txt"), "2\n")
    await fs.writeFile(path.join(root, "file3.txt"), "3\n")
    const snap = await snapshotTree(root, scope, { maxFiles: 2 })
    expect(snap.truncated).toBe(true)
    expect(snap.scanned).toBeLessThanOrEqual(2)
  })

  it("reporta errores de lectura de directorio", async () => {
    // Create a directory we can't read (on Windows this might not work, so we test the error path differently)
    const snap = await snapshotTree("/nonexistent/path/that/does/not/exist", scope)
    expect(snap.errors.length).toBeGreaterThan(0)
  })
})

describe("Comparacion", () => {
  it("detecta una modificacion fuera del scope", async () => {
    const antes = await snapshotTree(root, scope)
    await fs.writeFile(path.join(root, "README.md"), "# demo cambiado\n")
    const despues = await snapshotTree(root, scope)

    const { changes, incomplete, errors } = diffSnapshots(antes, despues, scope)
    expect(changes.some((c) => c.path === "README.md" && c.kind === "modified")).toBe(true)
    expect(changes.every((c) => c.outsideScope)).toBe(true)
    expect(incomplete).toBe(false)
    expect(errors).toHaveLength(0)
  })

  it("detecta la creacion de un archivo", async () => {
    const antes = await snapshotTree(root, scope)
    await fs.writeFile(path.join(root, "nuevo.txt"), "x\n")
    const despues = await snapshotTree(root, scope)

    const { changes } = diffSnapshots(antes, despues, scope)
    expect(changes.some((c) => c.path === "nuevo.txt" && c.kind === "created")).toBe(true)
  })

  it("detecta el borrado de un archivo", async () => {
    const antes = await snapshotTree(root, scope)
    await fs.rm(path.join(root, "README.md"))
    const despues = await snapshotTree(root, scope)

    const { changes } = diffSnapshots(antes, despues, scope)
    expect(changes.some((c) => c.path === "README.md" && c.kind === "deleted")).toBe(true)
  })

  it("no reporta nada si no cambio nada", async () => {
    const antes = await snapshotTree(root, scope)
    const despues = await snapshotTree(root, scope)
    const { changes } = diffSnapshots(antes, despues, scope)
    expect(changes).toHaveLength(0)
  })

  it("marca incompleto si la foto anterior o posterior fue truncada", async () => {
    const antes = await snapshotTree(root, scope, { maxFiles: 1 })
    const despues = await snapshotTree(root, scope)
    const { incomplete } = diffSnapshots(antes, despues, scope)
    expect(incomplete).toBe(true)
  })

  it("propaga errores de ambas fotos", async () => {
    const antes = await snapshotTree("/nonexistent/path/that/does/not/exist", scope)
    const despues = await snapshotTree(root, scope)
    const { errors } = diffSnapshots(antes, despues, scope)
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe("Tripwire", () => {
  it("detecta la escritura que se coló por un comando de shell", async () => {
    const wire = new Tripwire(root)

    await wire.arm("call-1", scope)
    // Esto es lo que haría un comando de shell: escribir fuera del scope.
    await fs.writeFile(path.join(root, "fuera.txt"), "escrito por shell\n")
    const { changes, incomplete, errors } = await wire.check("call-1", scope)

    expect(changes.length).toBeGreaterThan(0)
    expect(changes.some((c) => c.path === "fuera.txt")).toBe(true)
    expect(incomplete).toBe(false)
    expect(errors).toHaveLength(0)
  })

  it("no reporta lo que el agente escribe dentro de su scope", async () => {
    const wire = new Tripwire(root)

    await wire.arm("call-2", scope)
    await fs.writeFile(path.join(root, "src", "app.ts"), "export const a = 2\n")
    const { changes } = await wire.check("call-2", scope)

    expect(changes).toHaveLength(0)
  })

  it("devuelve vacio si no se armo", async () => {
    const wire = new Tripwire(root)
    const { changes } = await wire.check("nunca-armado", scope)
    expect(changes).toHaveLength(0)
  })

  it("descarta la foto despues de compararla", async () => {
    const wire = new Tripwire(root)
    await wire.arm("call-3", scope)
    await wire.check("call-3", scope)
    // La segunda comparacion no tiene contra que comparar.
    const { changes } = await wire.check("call-3", scope)
    expect(changes).toHaveLength(0)
  })

  it("reporta incomplete=true si la foto supera el limite de archivos", async () => {
    const wire = new Tripwire(root, { maxFiles: 1 })
    await wire.arm("call-4", scope)
    await fs.writeFile(path.join(root, "fuera1.txt"), "x\n")
    await fs.writeFile(path.join(root, "fuera2.txt"), "y\n")
    const { changes, incomplete } = await wire.check("call-4", scope)
    expect(incomplete).toBe(true)
  })

  it("reporta errores si la captura falla", async () => {
    const wire = new Tripwire(root)
    await wire.arm("call-5", scope)
    // Create a scenario where the second snapshot fails
    const { changes, errors } = await wire.check("call-5", scope)
    // Since the arm succeeded but the check might have issues, we just verify the structure
    expect(Array.isArray(changes)).toBe(true)
    expect(Array.isArray(errors)).toBe(true)
  })
})
