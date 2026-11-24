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
  guardEmptyTestPhase,
  renderGate,
  defaultRunner,
  EMPTY_TEST_GATE_REASON,
  type CommandRunner,
  type Tooling,
} from "../src/core/gates.js"
import { Office } from "../src/core/office.js"
import { DEFAULT_LIMITS } from "../src/core/types.js"

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
    const results = await runTechnicalGates(
      tmp,
      tooling,
      // El test tiene que mostrar un conteo legible: desde el guard
      // anti-gate-verde-vacío, exit 0 sin tests no es PASS.
      fakeRunner({ "run test": { code: 0, stdout: "# tests 3\n# pass 3" } }, calls),
    )
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

// Los secretos del fixture se arman por concatenación de fragmentos cortos.
// El scanner del gate de esta oficina escanea este mismo archivo: si los
// valores quedaran enteros como literales en el fuente, el gate marcaría sus
// propios tests. La partición garantiza que en el CÓDIGO FUENTE ningún trozo
// matchee los patrones de SECRET_PATTERNS (src/core/gates.ts), mientras que
// el valor EN RUNTIME que se escribe en el tmp es idéntico al anterior, de
// modo que el comportamiento probado no cambia. Cada fragmento tiene < 8
// caracteres y los prefijos sensibles van aislados.
const FAKE_SK_LIVE = "sk_" + "live_" + "abcdef" + "123456"
// "AKIA" queda aislado: en el fuente nunca va seguido de 16 chars [0-9A-Z].
const FAKE_AKIA = "AKIA" + "IOSFODNN7" + "EXAMPLE"

describe("Gate de seguridad", () => {
  // El gate de seguridad corre grep REAL sobre archivos reales: un runner
  // falso no probaría nada.
  it("detecta un secreto hardcodeado", async () => {
    await fs.mkdir(path.join(tmp, "src"), { recursive: true })
    await fs.writeFile(path.join(tmp, "src", "a.js"), 'const API_KEY = "' + FAKE_SK_LIVE + '";\n')

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
    await fs.writeFile(path.join(tmp, "src", "b.js"), 'const k = "' + FAKE_AKIA + '";\n')
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

// ─────────────────────────────────────────────────────────────────────────────
// Guard anti-gate-verde-vacío
//
// El bug que se cierra acá: `npm test` puede salir 0 sin haber ejecutado un
// solo test (script vacío, vitest sin archivos, `go test` sin tests). Ese
// verde no demuestra nada y no puede contarse como PASS.
// ─────────────────────────────────────────────────────────────────────────────
describe("Guard anti-gate-verde-vacío", () => {
  const tooling: Tooling = {
    packageManager: "npm",
    hasBuild: false,
    hasTypecheck: false,
    hasLint: false,
    hasTest: true,
    isPython: false,
    isGo: false,
    isRust: false,
    hasGit: false,
    detected: [],
  }

  const testPhase = (output: string, outcome: "pass" | "fail" = "pass") => ({
    phase: "test" as const,
    command: "npm run test",
    outcome,
    exitCode: outcome === "pass" ? 0 : 1,
    output,
    detail: outcome === "pass" ? "exit 0" : "exit 1",
  })

  it("degrada a not_run la fase test que sale 0 sin tests", async () => {
    const results = await runTechnicalGates(
      tmp,
      tooling,
      fakeRunner({ "run test": { code: 0, stdout: "No test files found, exiting with code 0" } }),
    )
    const test = results.find((r) => r.phase === "test")!
    expect(test.outcome).toBe("not_run")
    expect(test.reason).toBe(EMPTY_TEST_GATE_REASON)
    expect(test.reason).toContain("verde vacío")
    // La evidencia real no se reescribe: el exit code sigue siendo el del runner.
    expect(test.exitCode).toBe(0)
    expect(test.output).toContain("No test files found")
  })

  it("no degrada cuando el conteo es legible: '5 passed'", async () => {
    const results = await runTechnicalGates(
      tmp,
      tooling,
      fakeRunner({ "run test": { code: 0, stdout: "5 passed (0 failed)" } }),
    )
    expect(results.find((r) => r.phase === "test")!.outcome).toBe("pass")
  })

  it("no degrada cuando el conteo es legible: 'Tests: 5'", async () => {
    const results = await runTechnicalGates(
      tmp,
      tooling,
      fakeRunner({ "run test": { code: 0, stdout: "Test Suites: 1 passed\nTests: 5 passed" } }),
    )
    expect(results.find((r) => r.phase === "test")!.outcome).toBe("pass")
  })

  it("respeta un FAIL real: el guard solo toca verdes", () => {
    const failed = guardEmptyTestPhase(testPhase("0 tests", "fail"))
    expect(failed.outcome).toBe("fail")
    expect(failed.reason).toBeUndefined()

    const empty = guardEmptyTestPhase(testPhase("0 tests"))
    expect(empty.outcome).toBe("not_run")

    const withTests = guardEmptyTestPhase(testPhase("Tests: 5"))
    expect(withTests.outcome).toBe("pass")
  })

  it("consolidate propaga not_run y el gate no pasa", async () => {
    const technical = await runTechnicalGates(
      tmp,
      tooling,
      fakeRunner({ "run test": { code: 0, stdout: "no tests to run" } }),
    )
    const security = [
      { phase: "secrecy" as const, command: "scan", outcome: "pass" as const, exitCode: 0, output: "0 hallazgos", detail: "limpio" },
    ]
    const result = consolidate("T-00", technical, security)
    expect(result.technicalOutcome).toBe("not_run")
    expect(result.passed).toBe(false)
    expect(result.technical.find((r) => r.phase === "test")!.reason).toBe(EMPTY_TEST_GATE_REASON)
  })

  it("renderGate muestra el motivo del gate verde vacío de forma legible", async () => {
    const technical = await runTechnicalGates(
      tmp,
      tooling,
      fakeRunner({ "run test": { code: 0, stdout: "0 tests" } }),
    )
    const security = [
      { phase: "secrecy" as const, command: "scan", outcome: "pass" as const, exitCode: 0, output: "0 hallazgos", detail: "limpio" },
    ]
    const md = renderGate(consolidate("T-00", technical, security))
    expect(md).toContain("| Motivo |")
    expect(md).toContain("NOT_RUN")
    expect(md).toContain("Gate verde vacío")
    expect(md).toContain("**Gate técnico:** NOT_RUN")
    expect(md).toContain("**Veredicto:** FAIL")
  })

  it("Office.runGates hereda el guard vía runTechnicalGates", async () => {
    await fs.writeFile(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "demo", scripts: { build: "true", lint: "true", test: "true", typecheck: "true" } }),
    )
    // Runner que sale 0 en todo pero no ejecuta un solo test.
    const silentRunner: CommandRunner = async (command, args) => {
      if (args.includes("test")) return { code: 0, stdout: "No test files found", stderr: "" }
      return { code: 0, stdout: "", stderr: "" }
    }
    const office = new Office({ cwd: tmp, limits: DEFAULT_LIMITS, runner: silentRunner, clock: () => 1_700_000_000_000 })
    await office.init()
    const state = await office.loadState("Guard")
    await office.savePlan(state, [
      { title: "T", type: "implementation", acceptance: ["a"], gate: "g" },
    ])

    const gates = await office.runGates(state, "T-00")
    const test = gates.technical.find((r) => r.phase === "test")!
    expect(test.outcome).toBe("not_run")
    expect(test.reason).toBe(EMPTY_TEST_GATE_REASON)
    expect(gates.technicalOutcome).toBe("not_run")
    expect(gates.passed).toBe(false)

    // El artefacto en disco también lo muestra.
    const artifact = await fs.readFile(path.join(tmp, ".oficina", "artifacts", "T-00", "gates.md"), "utf8")
    expect(artifact).toContain("Gate verde vacío")
  })

  it("Office.runGates no degrada cuando el runner reporta tests", async () => {
    await fs.writeFile(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "demo", scripts: { build: "true", lint: "true", test: "true", typecheck: "true" } }),
    )
    const office = new Office({
      cwd: tmp,
      limits: DEFAULT_LIMITS,
      runner: async () => ({ code: 0, stdout: "# tests 3\n# pass 3", stderr: "" }),
      clock: () => 1_700_000_000_000,
    })
    await office.init()
    const state = await office.loadState("Guard ok")
    await office.savePlan(state, [
      { title: "T", type: "implementation", acceptance: ["a"], gate: "g" },
    ])

    const gates = await office.runGates(state, "T-00")
    expect(gates.technical.find((r) => r.phase === "test")!.outcome).toBe("pass")
  })

  // C-001: `go test ./...` verde imprime `ok <paquete> 0.084s` por paquete,
  // sin NINGÚN conteo "N passed". Con las solo-regex genéricas el guard
  // degradaba ese verde real a not_run (falso not_run) y ninguna card de un
  // proyecto Go podía cerrarse. Acá debe reconocerse el formato Go.
  it("no degrada un `go test` verde real: 'ok <pkg> 0.084s' cuenta como tests corridos", async () => {
    const goTooling: Tooling = {
      ...tooling,
      packageManager: null,
      hasTest: false,
      isGo: true,
    }
    const results = await runTechnicalGates(
      tmp,
      goTooling,
      fakeRunner({ "go test": { code: 0, stdout: "ok\tsome/pkg 0.084s\n" } }),
    )
    const test = results.find((r) => r.phase === "test")!
    expect(test.outcome).toBe("pass")
    expect(testsActuallyRan(results)).toBe(true)
    // La fase es el único punto donde `testsActuallyRan` mira la salida del
    // gate (no del runner crudo): la coherencia se verifica en el mismo objeto.
    expect(testsActuallyRan([test])).toBe(true)
  })

  it("degrada `go test` con 'ok <pkg> [no test files]' a not_run: cero tests", async () => {
    const goTooling: Tooling = {
      ...tooling,
      packageManager: null,
      hasTest: false,
      isGo: true,
    }
    const results = await runTechnicalGates(
      tmp,
      goTooling,
      fakeRunner({ "go test": { code: 0, stdout: "ok\tsome/pkg [no test files]\n" } }),
    )
    const test = results.find((r) => r.phase === "test")!
    expect(test.outcome).toBe("not_run")
    expect(test.reason).toBe(EMPTY_TEST_GATE_REASON)
    expect(testsActuallyRan([test])).toBe(false)
  })
})
