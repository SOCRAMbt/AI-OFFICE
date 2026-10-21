import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import {
  detectTooling,
  runTechnicalGates,
  runSecurityGate,
  consolidate,
  testsActuallyRan,
  renderGate,
  defaultRunner,
  type CommandRunner,
  type Tooling,
} from "../src/core/gates.js"

let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-gates-"))
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

/** Runner falso: decide por comando y registra qué se corrió. */
function fakeRunner(
  responses: Record<string, { code: number; stdout?: string; stderr?: string }>,
  calls: string[] = [],
): CommandRunner {
  return async (command, args) => {
    const key = `${command} ${args.join(" ")}`
    calls.push(key)
    for (const [pattern, response] of Object.entries(responses)) {
      if (key.includes(pattern)) {
        return {
          code: response.code,
          stdout: response.stdout ?? "",
          stderr: response.stderr ?? "",
        }
      }
    }
    return { code: 0, stdout: "", stderr: "" }
  }
}

describe("Detección de tooling", () => {
  it("detecta un proyecto Node con scripts", async () => {
    await fs.writeFile(
      path.join(tmp, "package.json"),
      JSON.stringify({ scripts: { build: "tsc", lint: "eslint .", test: "vitest", typecheck: "tsc --noEmit" } }),
    )
    const tooling = await detectTooling(tmp)
    expect(tooling.hasBuild).toBe(true)
    expect(tooling.hasLint).toBe(true)
    expect(tooling.hasTest).toBe(true)
    expect(tooling.hasTypecheck).toBe(true)
    expect(tooling.packageManager).toBe("npm")
  })

  it("detecta Python", async () => {
    await fs.writeFile(path.join(tmp, "pyproject.toml"), "[project]\nname='x'\n")
    const tooling = await detectTooling(tmp)
    expect(tooling.isPython).toBe(true)
  })

  it("detecta Go y Rust", async () => {
    await fs.writeFile(path.join(tmp, "go.mod"), "module x\n")
    await fs.writeFile(path.join(tmp, "Cargo.toml"), "[package]\nname='x'\n")
    const tooling = await detectTooling(tmp)
    expect(tooling.isGo).toBe(true)
    expect(tooling.isRust).toBe(true)
  })

  it("detecta pnpm por el lockfile", async () => {
    await fs.writeFile(path.join(tmp, "package.json"), JSON.stringify({ scripts: { test: "x" } }))
    await fs.writeFile(path.join(tmp, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n")
    const tooling = await detectTooling(tmp)
    expect(tooling.packageManager).toBe("pnpm")
  })
})

describe("Gates técnicos", () => {
  const tooling: Tooling = {
    packageManager: "npm",
    hasBuild: true,
    hasTypecheck: true,
    hasLint: true,
    hasTest: true,
    isPython: false,
    isGo: false,
    isRust: false,
    hasGit: true,
    detected: [],
  }

  it("marca PASS cuando todos los comandos salen con 0", async () => {
    const calls: string[] = []
    const results = await runTechnicalGates(tmp, tooling, fakeRunner({}, calls))
    expect(results).toHaveLength(6)
    expect(results.every((r) => r.outcome === "pass")).toBe(true)
  })

  it("marca FAIL cuando un comando falla", async () => {
    const results = await runTechnicalGates(
      tmp,
      tooling,
      fakeRunner({ "run lint": { code: 1, stderr: "3 errores nuevos" } }),
    )
    const lint = results.find((r) => r.phase === "lint")!
    expect(lint.outcome).toBe("fail")
    expect(lint.exitCode).toBe(1)
    expect(lint.output).toContain("3 errores nuevos")
    expect(lint.reason).toContain("lint")
  })

  it("marca N/A con motivo cuando no hay script", async () => {
    const noScripts: Tooling = { ...tooling, hasBuild: false, hasLint: false, hasTest: false, hasTypecheck: false }
    const results = await runTechnicalGates(tmp, noScripts, fakeRunner({}))
    const build = results.find((r) => r.phase === "build")!
    expect(build.outcome).toBe("na")
    expect(build.reason).toContain("build")
  })

  it("captura la salida real del comando", async () => {
    const results = await runTechnicalGates(
      tmp,
      tooling,
      fakeRunner({ "run test": { code: 0, stdout: "# tests 5\n# pass 5\n# fail 0" } }),
    )
    const test = results.find((r) => r.phase === "test")!
    expect(test.output).toContain("# tests 5")
    expect(test.output).toContain("# pass 5")
  })

  it("N/A el diff review cuando no hay git", async () => {
    const noGit: Tooling = { ...tooling, hasGit: false }
    const results = await runTechnicalGates(tmp, noGit, fakeRunner({}))
    const diff = results.find((r) => r.phase === "diff")!
    expect(diff.outcome).toBe("na")
    expect(diff.reason).toContain("git")
  })

  it("detecta que los tests corrieron de verdad", () => {
    const withTests = [
      { phase: "test" as const, command: "npm test", outcome: "pass" as const, exitCode: 0, output: "# tests 5\n# pass 5", detail: "" },
    ]
    expect(testsActuallyRan(withTests)).toBe(true)

    const noTests = [
      { phase: "test" as const, command: "npm test", outcome: "pass" as const, exitCode: 0, output: "# tests 0", detail: "" },
    ]
    expect(testsActuallyRan(noTests)).toBe(false)
  })
})

describe("Gate de seguridad", () => {
  // El gate de seguridad corre grep REAL sobre archivos reales: un runner
  // falso no probaría nada.
  it("detecta un secreto hardcodeado", async () => {
    await fs.mkdir(path.join(tmp, "src"), { recursive: true })
    await fs.writeFile(path.join(tmp, "src", "a.js"), 'const API_KEY = "sk_live_abcdef123456";\n')

    const results = await runSecurityGate(tmp, ["src"], defaultRunner)
    const secret = results.find((r) => r.detail.includes("credenciales"))!
    expect(secret.outcome).toBe("fail")
    // El valor aparece REDACTADO a propósito: un log de gate que imprime la
    // credencial completa la acaba de filtrar.
    expect(secret.output).toContain("src/a.js:1")
    expect(secret.output).not.toContain("sk_live_abcdef123456")
    expect(secret.output).toContain("*")
  })

  it("pasa si no hay secretos", async () => {
    await fs.mkdir(path.join(tmp, "src"), { recursive: true })
    await fs.writeFile(path.join(tmp, "src", "a.js"), "export const x = 1\n")
    const results = await runSecurityGate(tmp, ["src"], defaultRunner)
    expect(results.every((r) => r.outcome === "pass")).toBe(true)
  })

  it("detecta una clave de cloud", async () => {
    await fs.mkdir(path.join(tmp, "src"), { recursive: true })
    await fs.writeFile(path.join(tmp, "src", "b.js"), 'const k = "AKIAIOSFODNN7EXAMPLE";\n')
    const results = await runSecurityGate(tmp, ["src"], defaultRunner)
    const cloud = results.find((r) => r.detail.includes("claves de cloud"))!
    expect(cloud.outcome).toBe("fail")
  })

  it("marca N/A el scope vacío", async () => {
    const results = await runSecurityGate(tmp, [], defaultRunner)
    const diff = results.find((r) => r.phase === "diff")!
    expect(diff.outcome).toBe("na")
  })
})

describe("Consolidación", () => {
  it("el gate overall falla si una fase técnica falla", () => {
    const technical = [
      { phase: "build" as const, command: "npm run build", outcome: "pass" as const, exitCode: 0, output: "", detail: "" },
      { phase: "lint" as const, command: "npm run lint", outcome: "fail" as const, exitCode: 1, output: "", detail: "" },
    ]
    const security = [
      { phase: "secrecy" as const, command: "grep", outcome: "pass" as const, exitCode: 0, output: "", detail: "" },
    ]
    const result = consolidate("T-00", technical, security)
    expect(result.passed).toBe(false)
    expect(result.technicalOutcome).toBe("fail")
    expect(result.securityOutcome).toBe("pass")
  })

  it("el gate overall falla si falla seguridad aunque la técnica pase", () => {
    const technical = [
      { phase: "build" as const, command: "x", outcome: "pass" as const, exitCode: 0, output: "", detail: "" },
    ]
    const security = [
      { phase: "secrecy" as const, command: "grep", outcome: "fail" as const, exitCode: 1, output: "", detail: "" },
    ]
    const result = consolidate("T-00", technical, security)
    expect(result.passed).toBe(false)
  })

  it("no promedia: una fase NA y el resto PASS da PASS", () => {
    const technical = [
      { phase: "build" as const, command: "x", outcome: "pass" as const, exitCode: 0, output: "", detail: "" },
      { phase: "diff" as const, command: null, outcome: "na" as const, exitCode: null, output: "", detail: "sin git" },
    ]
    const security = [
      { phase: "secrecy" as const, command: "grep", outcome: "pass" as const, exitCode: 0, output: "", detail: "" },
    ]
    expect(consolidate("T-00", technical, security).passed).toBe(true)
  })

  it("una fase NOT_RUN hace fallar el gate", () => {
    const technical = [
      { phase: "build" as const, command: "x", outcome: "not_run" as const, exitCode: null, output: "", detail: "" },
    ]
    const security = [
      { phase: "secrecy" as const, command: "grep", outcome: "pass" as const, exitCode: 0, output: "", detail: "" },
    ]
    const result = consolidate("T-00", technical, security)
    expect(result.passed).toBe(false)
    expect(result.technicalOutcome).toBe("not_run")
  })
})

describe("Render del gate", () => {
  it("produce markdown con las 6 fases y la salida real", () => {
    const result = consolidate(
      "T-00",
      [
        { phase: "build", command: "npm run build", outcome: "pass", exitCode: 0, output: "build ok", detail: "exit 0" },
        { phase: "lint", command: "npm run lint", outcome: "fail", exitCode: 1, output: "error: x", detail: "exit 1" },
      ],
      [
        { phase: "secrecy", command: "grep ...", outcome: "pass", exitCode: 0, output: "0 hits", detail: "limpio" },
      ],
    )
    const md = renderGate(result)
    expect(md).toContain("# Gates — T-00")
    expect(md).toContain("| build |")
    expect(md).toContain("| lint |")
    expect(md).toContain("**Gate técnico:** FAIL")
    expect(md).toContain("**Gate seguridad:** PASS")
    expect(md).toContain("**Veredicto:** FAIL")
    expect(md).toContain("error: x")
  })
})
