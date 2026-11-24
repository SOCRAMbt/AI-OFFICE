/**
 * Gates: verificaci├│n ejecutable, no opinada.
 *
 * Un gate que dice "deber├¡a compilar" no es un gate. Ac├í se corren comandos
 * de verdad, se captura la salida real y se decide por exit code. La salida
 * se pega en el artefacto para que un humano pueda auditarla.
 *
 * Las 6 fases vienen de la skill `verification-loop`:
 * build ÔåÆ typecheck ÔåÆ lint ÔåÆ test ÔåÆ security grep ÔåÆ diff review.
 *
 * Reglas de honestidad (no negociables):
 * - Nunca PASS en una fase que no se corri├│.
 * - Nunca output inventado.
 * - N/A siempre con motivo expl├¡cito.
 * - Una fase aplicable en FAIL = gate FAIL. No se promedia.
 */

import path from "node:path"
import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import type { Card, GateOutcome, GatePhase, GatePhaseResult, GateResult } from "./types.js"
import { nowIso } from "./fsx.js"

/** Configuraci├│n de un gate. */
export interface Tooling {
  packageManager: "npm" | "pnpm" | "yarn" | "bun" | null
  hasBuild: boolean
  hasTypecheck: boolean
  hasLint: boolean
  hasTest: boolean
  isPython: boolean
  isGo: boolean
  isRust: boolean
  hasGit: boolean
  /** Descripci├│n de qu├® se detect´┐¢´┐¢, para el informe. */
  detected: string[]
}

export interface CommandRunner {
  (command: string, args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }>
}

/** Runner real por defecto. */
export const defaultRunner: CommandRunner = (command, args, cwd) =>
  new Promise((resolve) => {
    const isWinBatch = process.platform === "win32" && /^(npm|pnpm|yarn|npx)(\.cmd)?$/i.test(command)
    const file = isWinBatch ? (command.toLowerCase().endsWith(".cmd") ? command : `${command}.cmd`) : command
    execFile(
      file,
      args,
      { cwd, timeout: 10 * 60_000, maxBuffer: 8 * 1024 * 1024, shell: isWinBatch },
      (err, stdout, stderr) => {
        const code = err && typeof (err as NodeJS.ErrnoException & { code?: number }).code === "number"
          ? (err as unknown as { code: number }).code
          : err
            ? 1
            : 0
        resolve({ code, stdout: stdout ?? "", stderr: stderr ?? "" })
      },
    )
  })

/** Detecta el tooling del proyecto leyendo sus manifiestos. */
export async function detectTooling(projectRoot: string): Promise<Tooling> {
  const detected: string[] = []
  let packageManager: Tooling["packageManager"] = null
  let hasBuild = false
  let hasTypecheck = false
  let hasLint = false
  let hasTest = false

  const pkgRaw = await readIfExists(path.join(projectRoot, "package.json"))
  if (pkgRaw) {
    detected.push("package.json")
    const pkg = safeParse(pkgRaw) as { scripts?: Record<string, string>; packageManager?: string } | undefined
    const scripts = pkg?.scripts ?? {}
    hasBuild = "build" in scripts
    hasTypecheck = "typecheck" in scripts || "type-check" in scripts || "tsc" in scripts
    hasLint = "lint" in scripts
    hasTest = "test" in scripts
    const pmField = pkg?.packageManager ?? ""
    if (pmField.startsWith("pnpm")) packageManager = "pnpm"
    else if (pmField.startsWith("yarn")) packageManager = "yarn"
    else if (pmField.startsWith("bun")) packageManager = "bun"
    else if (pmField) packageManager = "npm"
    else packageManager = null

    // PRIORIDAD 2: lockfile SOLO si NO hay packageManager en package.json
    if (!pmField) {
      if (await existsFile(path.join(projectRoot, "pnpm-lock.yaml"))) {
        packageManager = "pnpm"
        detected.push("pnpm-lock.yaml")
      } else if (await existsFile(path.join(projectRoot, "yarn.lock"))) {
        packageManager = "yarn"
        detected.push("yarn.lock")
      } else if (await existsFile(path.join(projectRoot, "bun.lockb"))) {
        packageManager = "bun"
        detected.push("bun.lockb")
      } else {
        packageManager = "npm"
      }
    }
  } else {
    // Sin package.json, inferir de lockfile
    if (await existsFile(path.join(projectRoot, "pnpm-lock.yaml"))) {
      packageManager = "pnpm"
      detected.push("pnpm-lock.yaml")
    } else if (await existsFile(path.join(projectRoot, "yarn.lock"))) {
      packageManager = "yarn"
      detected.push("yarn.lock")
    } else if (await existsFile(path.join(projectRoot, "bun.lockb"))) {
      packageManager = "bun"
      detected.push("bun.lockb")
    } else {
      packageManager = "npm"
    }
  }

  const isPython =
    (await existsFile(path.join(projectRoot, "pyproject.toml"))) ||
    (await existsFile(path.join(projectRoot, "requirements.txt"))) ||
    (await existsFile(path.join(projectRoot, "setup.py")))
  if (isPython) detected.push("python")

  const isGo = await existsFile(path.join(projectRoot, "go.mod"))
  if (isGo) detected.push("go.mod")

  const isRust = await existsFile(path.join(projectRoot, "Cargo.toml"))
  if (isRust) detected.push("Cargo.toml")

  const hasGit = await existsFile(path.join(projectRoot, ".git"))
  if (hasGit) detected.push(".git")

  return {
    packageManager,
    hasBuild,
    hasTypecheck,
    hasLint,
    hasTest,
    isPython,
    isGo,
    isRust,
    hasGit,
    detected,
  }
}

async function readIfExists(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, "utf8")
  } catch {
    return undefined
  }
}

async function existsFile(file: string): Promise<boolean> {
  try {
    await fs.stat(file)
    return true
  } catch {
    return false
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/** Resultado de una fase que no aplica. */
function na(phase: GatePhase, reason: string): GatePhaseResult {
  return { phase, command: null, outcome: "na", exitCode: null, output: "", detail: reason, reason }
}

/** Ejecuta una fase y clasifica el resultado. */
export async function runPhase(
  phase: GatePhase,
  command: string,
  args: string[],
  cwd: string,
  runner: CommandRunner = defaultRunner,
  timeoutNote?: string,
): Promise<GatePhaseResult> {
  // PRE-CHECK: validar que comando existe en PATH.
  // Solo cuando el runner es el real: un runner inyectado (tests) define su
  // propio mundo y no debe depender de que el binario exista en la m├íquina.
  if (runner === defaultRunner) {
    const checkCmd = process.platform === "win32" ? "where.exe" : "which"
    const notFound: GatePhaseResult = {
      phase,
      command: `${command} ${args.join(" ")}`.trim(),
      outcome: "fail",
      exitCode: 127,
      output: `Command not found: ${command}. Is it installed and in PATH?`,
      detail: `Command not found: ${command}`,
      reason: `El comando "${command}" no se encuentra en PATH. Verifica que est├í instalado.`,
    }
    const found = await new Promise<boolean>((resolve) => {
      execFile(checkCmd, [command], { cwd, timeout: 5000 }, (err) => resolve(!err))
    })
    if (!found) return notFound
  }

  const started = Date.now()
  const { code, stdout, stderr } = await runner(command, args, cwd)
  const duration = Date.now() - started
  const output = truncate(`${stdout}\n${stderr}`.trim(), 12_000)
  const outcome: GateOutcome = code === 0 ? "pass" : "fail"
  return {
    phase,
    command: `${command} ${args.join(" ")}`.trim(),
    outcome,
    exitCode: code,
    output,
    detail: `${outcome === "pass" ? "exit 0" : `exit ${code}`} en ${duration}ms${timeoutNote ? ` ÔÇö ${timeoutNote}` : ""}`,
    ...(outcome === "fail" ? { reason: `La fase ${phase} fall├│ con exit code ${code}` } : {}),
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\nÔÇª [salida truncada: ${text.length - max} caracteres m├ís]`
}

/** Ejecuta las 6 fases t├®cnicas. */
export async function runTechnicalGates(
  projectRoot: string,
  tooling: Tooling,
  runner: CommandRunner = defaultRunner,
  scope: string[] = [],
): Promise<GatePhaseResult[]> {
  const results: GatePhaseResult[] = []
  const pm = tooling.packageManager

  // 1. Build
  if (tooling.hasBuild && pm) {
    results.push(await runPhase("build", pm, ["run", "build"], projectRoot, runner))
  } else {
    results.push(na("build", "el proyecto no define script `build`"))
  }

  // 2. Type check
  if (tooling.hasTypecheck && pm) {
    results.push(await runPhase("typecheck", pm, ["run", "typecheck"], projectRoot, runner))
  } else if (tooling.isPython) {
    results.push(await runPhase("typecheck", "python", ["-m", "mypy", "."], projectRoot, runner))
  } else if (tooling.isGo) {
    results.push(await runPhase("typecheck", "go", ["vet", "./..."], projectRoot, runner))
  } else if (tooling.isRust) {
    results.push(await runPhase("typecheck", "cargo", ["check"], projectRoot, runner))
  } else {
    results.push(na("typecheck", "el proyecto no tiene type checker configurado"))
  }

  // 3. Lint
  if (tooling.hasLint && pm) {
    results.push(await runPhase("lint", pm, ["run", "lint"], projectRoot, runner))
  } else if (tooling.isPython) {
    results.push(await runPhase("lint", "python", ["-m", "ruff", "check", "."], projectRoot, runner))
  } else if (tooling.isRust) {
    results.push(await runPhase("lint", "cargo", ["clippy"], projectRoot, runner))
  } else {
    results.push(na("lint", "el proyecto no define script `lint`"))
  }

  // 4. Tests
  //
  // Esta fase pasa por el guard anti-gate-verde-vacio: exit 0 no alcanza si
  // el runner no ejecuto un solo test (script vacio, vitest sin archivos,
  // `go test` sin tests). Un verde sin tests no demuestra nada.
  if (tooling.hasTest && pm) {
    results.push(await runTestPhase(pm, ["run", "test"], projectRoot, runner))
  } else if (tooling.isPython) {
    results.push(await runTestPhase("python", ["-m", "pytest", "-q"], projectRoot, runner))
  } else if (tooling.isGo) {
    results.push(await runTestPhase("go", ["test", "./..."], projectRoot, runner))
  } else if (tooling.isRust) {
    results.push(await runTestPhase("cargo", ["test"], projectRoot, runner))
  } else {
    results.push(na("test", "el proyecto no define script `test`"))
  }

  // 5. Security grep ÔÇö escaneo en c├│digo, portable a cualquier SO.
  const hits = await scanForSecrets(projectRoot, scope)
  if (hits.length > 0) {
    results.push({
      phase: "secrecy",
      command: "scan:secretos",
      outcome: "fail",
      exitCode: 1,
      output: hits.map((h) => `${h.file}:${h.line}  ${h.label}  ${h.redacted}`).join("\n"),
      detail: `${hits.length} secreto(s) detectado(s)`,
      reason: "Se detectaron secretos en el scope de la card",
    })
  } else {
    results.push({
      phase: "secrecy",
      command: "scan:secretos",
      outcome: "pass",
      exitCode: 0,
      output: "0 hallazgos",
      detail: "sin secretos en el scope",
    })
  }

  // 6. Diff review
  if (tooling.hasGit) {
    results.push(await runPhase("diff", "git", ["diff", "--stat", "HEAD"], projectRoot, runner))
  } else {
    results.push(na("diff", "el proyecto no est├í bajo control de versiones (no hay .git)"))
  }

  return results
}

/**
 * Patrones de detecci├│n de secretos.
 *
 * Se aplican EN C├ôDIGO, no shelling out a `grep`.
 *
 * Raz├│n: `grep` no existe en Windows (viene con Git Bash, no con el sistema),
 * y un gate de seguridad que depende de una tool opcional del SO es un gate
 * que falla en Windows por razones equivocadas. Adem├ís, escanear en c├│digo
 * permite manejar rutas con espacios, filtrar binarios y controlar el ruido.
 */
export const SECRET_PATTERNS: { label: string; pattern: RegExp }[] = [
  {
    label: "credenciales asignadas",
    pattern: /(api[_-]?key|secret|password|passwd|token|access[_-]?key)\s*[:=]\s*["'][^"'\s]{8,}["']/gi,
  },
  {
    label: "claves de cloud",
    pattern: /AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  },
  {
    label: "tokens de provider",
    pattern: /\b(sk|pk|rk)_[a-z]{1,8}_[A-Za-z0-9]{16,}\b/g,
  },
  {
    label: "GitHub tokens",
    pattern: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g,
  },
  {
    label: "GitLab tokens",
    pattern: /\bglpat-[A-Za-z0-9_\-]{20,}\b/g,
  },
  {
    label: "npm tokens",
    pattern: /\bnpm_[A-Za-z0-9]{36,}\b/g,
  },
  {
    label: "AWS access keys",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
  },
]

/** Extensiones que se escanean. El c├│digo compilado no aporta. */
const SCANNABLE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".go", ".rs",
  ".java", ".kt", ".php", ".cs", ".json", ".yaml", ".yml", ".toml", ".env",
  ".sh", ".bash", ".zsh", ".ps1", ".md", ".txt", ".sql", ".graphql",
])

/** Archivos que nunca se escanean (ruido o falsos positivos conocidos). */
const SCAN_EXCLUDES = new Set([
  "node_modules", ".git", "dist", "build", ".next", "coverage", ".oficina",
  "vendor", "__pycache__", ".venv", "venv", "target", ".cache",
])

export interface SecretHit {
  file: string
  line: number
  label: string
  match: string
  /** El valor, redactado. Los secretos no se imprimen completos. */
  redacted: string
}

/** Redacta un valor: solo se ven los primeros y ├║ltimos 4 caracteres. */
export function redact(value: string): string {
  if (value.length <= 10) return "[REDACTED]"
  return `${value.slice(0, 4)}${"*".repeat(Math.min(value.length - 8, 20))}${value.slice(-4)}`
}

/**
 * Escanea un directorio en busca de secretos.
 *
 * Devuelve los hits con el valor redactado. El valor crudo no sale de ac├í:
 * un log de gate que imprime la credencial completa la acaba de filtrar.
 */
export async function scanForSecrets(root: string, scope: string[]): Promise<SecretHit[]> {
  const hits: SecretHit[] = []
  const roots = scope.length > 0 ? scope : ["."]

  for (const scopePath of roots) {
    const target = path.isAbsolute(scopePath) ? scopePath : path.join(root, scopePath)
    const stat = await fs.stat(target).catch(() => undefined)
    if (!stat) continue

    const files = stat.isDirectory() ? await collectFiles(target) : [target]

    for (const file of files) {
      if (!SCANNABLE_EXTENSIONS.has(path.extname(file).toLowerCase())) continue
      const content = await fs.readFile(file, "utf8").catch(() => undefined)
      if (!content) continue

      const lines = content.split("\n")
      for (const [index, line] of lines.entries()) {
        // PROTECCI├ôN: saltar l├¡neas > 10k chars (probablemente minificado)
        if (line.length > 10_000) {
          continue
        }
        for (const { label, pattern } of SECRET_PATTERNS) {
          pattern.lastIndex = 0
          let match: RegExpExecArray | null
          while ((match = pattern.exec(line)) !== null) {
            hits.push({
              file: path.relative(root, file).replace(/\\/g, "/"),
              line: index + 1,
              label,
              match: match[0].slice(0, 60),
              redacted: redact(match[0]),
            })
            if (match.index === pattern.lastIndex) pattern.lastIndex++
          }
        }
      }
    }
  }

  return hits
}

/** Recorre un directorio devolviendo los archivos escaneables. */
async function collectFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".env") continue
    if (SCAN_EXCLUDES.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await collectFiles(full)))
    } else {
      out.push(full)
    }
  }
  return out
}

/**
 * Corre el gate de seguridad.
 *
 * Distinto del gate t├®cnico: audita trust boundaries y secretos. Un FAIL ac├í
 * bloquea la card aunque el t├®cnico est├® verde.
 */
export async function runSecurityGate(
  projectRoot: string,
  scope: string[],
  _runner: CommandRunner = defaultRunner,
): Promise<GatePhaseResult[]> {
  const results: GatePhaseResult[] = []
  const hits = await scanForSecrets(projectRoot, scope)

  for (const { label } of SECRET_PATTERNS) {
    const relevant = hits.filter((h) => h.label === label)

    if (relevant.length > 0) {
      const detail = relevant
        .map((h) => `${h.file}:${h.line}  ${h.label}  ${h.redacted}`)
        .join("\n")
      results.push({
        phase: "secrecy",
        command: `scan:${label}`,
        outcome: "fail",
        exitCode: 1,
        output: detail,
        detail: `${label} ÔÇö ${relevant.length} hallazgo(s)`,
        reason: `Se detectaron ${relevant.length} secretos (${label}). El valor est├í redactado a prop├│sito.`,
      })
    } else {
      results.push({
        phase: "secrecy",
        command: `scan:${label}`,
        outcome: "pass",
        exitCode: 0,
        output: "0 hallazgos",
        detail: `${label} ÔÇö limpio`,
      })
    }
  }

  if (scope.length === 0) {
    results.push(na("diff", "sin scope definido: no hay archivos que auditar"))
  }

  return results
}

/**
 * Consolida los resultados en un veredicto.
 *
 * `requirements` es la tercera dimension: los otros cinco fases dicen "el
 * codigo esta sano", esta dice "el objetivo esta cumplido". Si falta
 * evidencia de un requisito obligatorio, el veredicto global es FAIL aunque
 * build, typecheck, lint, test y seguridad esten en verde.
 */
export function consolidate(
  cardId: string,
  technical: GatePhaseResult[],
  security: GatePhaseResult[],
  requirements: GatePhaseResult[] = [],
): GateResult {
  const worst = (results: GatePhaseResult[]): GateOutcome => {
    if (results.some((r) => r.outcome === "fail")) return "fail"
    if (results.some((r) => r.outcome === "not_run")) return "not_run"
    if (results.length === 0) return "na"
    if (results.every((r) => r.outcome === "na")) return "na"
    return "pass"
  }

  const technicalOutcome = worst(technical)
  const securityOutcome = worst(security)
  const requirementsOutcome = worst(requirements)

  // Un `na` no promedia a `fail`: si la dimension de requisitos no se
  // evaluo (no aplica a esta card), no invalida lo que si paso. Lo que si
  // la invalida es que FALTE evidencia, y de eso se encarga el invariante
  // `evidence-required-before-done`, que es fail-closed: si la evidencia
  // no se evaluo, no se cierra.
  const requirementsOk = requirementsOutcome === "pass" || requirementsOutcome === "na"

  return {
    cardId,
    technical,
    security,
    requirements,
    technicalOutcome,
    securityOutcome,
    requirementsOutcome,
    passed: technicalOutcome === "pass" && securityOutcome === "pass" && requirementsOk,
    ranAt: nowIso(),
  }
}

/** Motivo can├│nico de un gate de tests verde pero vac├¡o. */
export const EMPTY_TEST_GATE_REASON =
  "Gate verde vac├¡o: la fase test sali├│ con exit 0 pero no ejecut├│ ning├║n test (no hay conteo legible en la salida)."

/**
 * Degrada una fase de test `pass` a `not_run` si no corri├│ ning├║n test.
 *
 * Por qu├® `not_run` y no `fail`: no fall├│ nada, pero tampoco se prob├│ nada.
 * Decir PASS ser├¡a mentir y decir FAIL inventar├¡a un rojo. `not_run` es la
 * ├║nica etiqueta honesta, y `consolidate` la propaga como veredicto no verde.
 *
 * Se conserva el `exitCode` real (0) y la `output` real: la evidencia de lo
 * que pas├│ no se reescribe, solo se corrige la clasificaci├│n.
 */
export function guardEmptyTestPhase(result: GatePhaseResult): GatePhaseResult {
  if (result.phase !== "test") return result
  if (result.outcome !== "pass") return result
  if (testsActuallyRan([result])) return result

  return {
    ...result,
    outcome: "not_run",
    detail: `exit 0 sin tests ejecutados ÔÇö ${EMPTY_TEST_GATE_REASON}`,
    reason: EMPTY_TEST_GATE_REASON,
  }
}

/**
 * Corre una fase de tests aplicando el guard anti-gate-verde-vac├¡o.
 *
 * ├Ünico punto de entrada para ejecutar tests en los gates t├®cnicos: la
 * oficina (`Office.runGates`) hereda el guard sin duplicar l├│gica.
 */
export async function runTestPhase(
  command: string,
  args: string[],
  cwd: string,
  runner: CommandRunner = defaultRunner,
): Promise<GatePhaseResult> {
  return guardEmptyTestPhase(await runPhase("test", command, args, cwd, runner))
}

/**
 * Reconocimiento Go: ┬┐la salida de `go test` muestra que corrieron tests?
 *
 * `go test ./...` nunca imprime un conteo "N tests/passed": imprime una l├¡nea
 * `ok <paquete> <duraci├│n>` por cada paquete cuya suite corri├│ y pas├│. La
 * distinci├│n que importa:
 *
 *   ok  m/pkg 0.084s            ÔåÆ corrieron tests del paquete y pasaron ÔåÆ ran
 *   ok  m/pkg [no test files]   ÔåÆ el paquete no tiene tests: corri├│ CERO
 *                                 tests ÔåÆ sigue siendo "no ran"
 *
 * Cualquier otra l├¡nea `ok` sin el marcador `[no test files]` cuenta como
 * evidencia de tests ejecutados.
 */
function goTestsActuallyRan(output: string): boolean {
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim().startsWith("ok")) continue
    if (line.includes("[no test files]")) continue
    return true
  }
  return false
}

/**
 * ┬┐La fase de tests corri├│ y pas├│ con al menos un test?
 *
 * Un gate que pasa con cero tests es un gate verde vac├¡o. Los runners
 * imprimen el conteo en formatos distintos ("# tests 5", "5 passed",
 * "Tests: 5"), as├¡ que se buscan ambos ├│rdenes. Para `go test` se reconoce
 * el formato por ecosistema (l├¡neas `ok <paquete>`), porque no hay conteo
 * num├®rico: ver `goTestsActuallyRan`.
 */
export function testsActuallyRan(technical: GatePhaseResult[]): boolean {
  const test = technical.find((r) => r.phase === "test")
  if (!test || test.outcome !== "pass") return false

  // Ecosistema Go: el reconocimiento propio de `go test` es el ├írbitro.
  if (test.command?.startsWith("go test")) return goTestsActuallyRan(test.output)

  // "5 tests" / "5 passed" / "5 test"
  const before = /\b(\d+)\s+(?:tests?|passed|pass)\b/i.exec(test.output)
  if (before) return Number.parseInt(before[1]!, 10) > 0

  // "tests 5" / "passed 5" / "Tests: 5"
  const after = /\b(?:tests?|passed|pass)\b\D{0,3}(\d+)/i.exec(test.output)
  if (after) return Number.parseInt(after[1]!, 10) > 0

  // Sin conteo legible: no se puede afirmar que corrieron tests.
  return false
}

/** Escapa una celda de tabla markdown: el `|` romper├¡a la fila. */
function escapeCell(text: string): string {
  return text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim() || "ÔÇö"
}

/** Renderiza el gate como markdown para el artefacto. */
export function renderGate(result: GateResult): string {
  const lines: string[] = []
  lines.push(`# Gates ÔÇö ${result.cardId}`)
  lines.push("")
  lines.push(`**Corredor:** ${result.ranAt}`)
  lines.push("")

  const table = (title: string, rows: GatePhaseResult[]) => {
    lines.push(`## ${title}`)
    lines.push("")
    lines.push("| # | Fase | Comando | Resultado | Detalle | Motivo |")
    lines.push("|---|------|---------|-----------|---------|--------|")
    rows.forEach((r, i) => {
      // El motivo no puede quedar escondido: un `not_run` por gate verde
      // vac├¡o tiene que leerse en el artefacto, no solo en el exit code.
      const reason = escapeCell(r.reason ?? "ÔÇö")
      lines.push(
        `| ${i + 1} | ${r.phase} | \`${r.command ?? "ÔÇö"}\` | ${r.outcome.toUpperCase()} | ${escapeCell(r.detail)} | ${reason} |`,
      )
    })
    lines.push("")
  }

  table("T├®cnico", result.technical)
  table("Seguridad", result.security)

  lines.push("## Salida de los comandos")
  lines.push("")
  for (const r of [...result.technical, ...result.security]) {
    if (r.outcome === "na" || !r.command) continue
    lines.push(`### ${r.phase} ÔÇö \`${r.command}\``)
    lines.push("")
    lines.push("```")
    lines.push(r.output || "(sin salida)")
    lines.push("```")
    lines.push("")
  }

  lines.push(`**Gate t├®cnico:** ${result.technicalOutcome.toUpperCase()}`)
  lines.push("")
  lines.push(`**Gate seguridad:** ${result.securityOutcome.toUpperCase()}`)
  lines.push("")
  lines.push(`**Veredicto:** ${result.passed ? "PASS" : "FAIL"}`)
  lines.push("")

  return lines.join("\n")
}
