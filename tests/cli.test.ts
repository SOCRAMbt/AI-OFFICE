import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const run = promisify(execFile)
const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..")
const cliEntry = path.join(repoRoot, "dist", "cli.js")

let tmp: string

/**
 * El CLI se prueba como proceso real, así que necesita el build.
 *
 * `npm test` lo garantiza con el hook `pretest`. Este fallback cubre el caso
 * de correr `npx vitest run` directo sobre un clone recién hecho, donde
 * `dist/` todavía no existe.
 */
beforeAll(async () => {
  try {
    await fs.access(cliEntry)
  } catch {
    const tsc = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc")
    await run(process.execPath, [tsc, "-p", "tsconfig.build.json"], {
      cwd: repoRoot,
      timeout: 300_000,
    })
  }
}, 300_000)

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-cli-"))
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

/** Corre el CLI compilado. */
async function cli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [cliEntry, ...args], { cwd: repoRoot })
    return { stdout, stderr, code: 0 }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number }
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.code ?? 1 }
  }
}

describe("CLI", () => {
  it("muestra el help sin argumentos", async () => {
    const { stdout, code } = await cli([])
    expect(code).toBe(0)
    expect(stdout).toContain("OFICINA — CLI")
  })

  it("init crea la estructura .oficina/", async () => {
    const { stdout, code } = await cli(["init", "objetivo de prueba", "--directory", tmp, "--json"])
    expect(code).toBe(0)
    const payload = JSON.parse(stdout)
    expect(payload.ok).toBe(true)
    expect(payload.officeDir).toBe(path.join(tmp, ".oficina"))
    expect(await fs.stat(path.join(tmp, ".oficina", "state.json"))).toBeTruthy()
  })

  it("status muestra el estado de la corrida", async () => {
    await cli(["init", "objetivo", "--directory", tmp, "--json"])
    const { stdout, code } = await cli(["status", "--directory", tmp])
    expect(code).toBe(0)
    expect(stdout).toContain("OFICINA")
    expect(stdout).toContain("Presupuesto")
  })

  it("board muestra el tablero", async () => {
    await cli(["init", "objetivo", "--directory", tmp, "--json"])
    const { stdout, code } = await cli(["board", "--directory", tmp])
    expect(code).toBe(0)
    expect(stdout).toContain("Tablero")
  })

  it("install copia skill, agentes y comando", async () => {
    const target = path.join(tmp, "opencode")
    const { stdout, code } = await cli(["install", "--target", target, "--json"])
    expect(code).toBe(0)
    const payload = JSON.parse(stdout)
    expect(payload.ok).toBe(true)
    expect(payload.skipped).toHaveLength(0)

    expect(await fs.stat(path.join(target, "skills", "oficina", "SKILL.md"))).toBeTruthy()
    expect(await fs.stat(path.join(target, "commands", "oficina.md"))).toBeTruthy()
    expect(await fs.stat(path.join(target, "plugins", "oficina.js"))).toBeTruthy()

    const agents = await fs.readdir(path.join(target, "agents"))
    expect(agents.filter((a) => a.startsWith("oficina-")).length).toBeGreaterThanOrEqual(6)
  })

  it("install es idempotente", async () => {
    const target = path.join(tmp, "opencode")
    await cli(["install", "--target", target, "--json"])
    const second = await cli(["install", "--target", target, "--json"])
    expect(second.code).toBe(0)
    expect(JSON.parse(second.stdout).ok).toBe(true)
  })

  it("reset pide confirmación sin --force", async () => {
    await cli(["init", "objetivo", "--directory", tmp, "--json"])
    const { stdout, code } = await cli(["reset", "--directory", tmp])
    expect(code).toBe(1)
    expect(stdout).toContain("--force")
  })

  it("audit falla si la card no existe", async () => {
    await cli(["init", "objetivo", "--directory", tmp, "--json"])
    const { stderr, code } = await cli(["audit", "T-99", "--directory", tmp])
    expect(code).toBe(1)
    expect(stderr).toContain("No existe la card")
  })

  it("un comando desconocido muestra el help", async () => {
    const { stdout, stderr, code } = await cli(["comando-inexistente"])
    expect(code).toBe(1)
    expect(stderr).toContain("Comando desconocido")
    expect(stdout).toContain("OFICINA — CLI")
  })
})
