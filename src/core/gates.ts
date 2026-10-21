/**
 * Gates: verificación ejecutable, no opinada.
 *
 * Un gate que dice "debería compilar" no es un gate. Acá se corren comandos
 * de verdad, se captura la salida real y se decide por exit code. La salida
 * se pega en el artefacto para que un humano pueda auditarla.
 *
 * Las 6 fases vienen de la skill `verification-loop`:
 * build → typecheck → lint → test → security grep → diff review.
 *
 * Reglas de honestidad (no negociables):
 * - Nunca PASS en una fase que no se corrió.
 * - Nunca output inventado.
 * - N/A siempre con motivo explícito.
 * - Una fase aplicable en FAIL = gate FAIL. No se promedia.
 */

import path from "node:path"
import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import type { Card, GateOutcome, GatePhase, GatePhaseResult, GateResult } from "./types.js"
import { nowIso } from "./fsx.js"

/** Configuración de un gate. */
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
  /** Descripción de qué se detect��, para el informe. */
  detected: string[]
}

export interface CommandRunner {
  (command: string, args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }>
}

/** Runner real por defecto. */
export const defaultRunner: CommandRunner = (command, args, cwd) =>
  new Promise((resolve) => {
    execFile(
      command,
      args,
      { cwd, timeout: 10 * 60_000, maxBuffer: 8 * 1024 * 1024, shell: false },
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
    else packageManager = "npm"
  }

  if (await existsFile(path.join(projectRoot, "pnpm-lock.yaml"))) {
    packageManager = "pnpm"
    detected.push("pnpm-lock.yaml")
  } else if (await existsFile(path.join(projectRoot, "yarn.lock"))) {
    packageManager = "yarn"
    detected.push("yarn.lock")
  } else if (await existsFile(path.join(projectRoot, "bun.lockb"))) {
    packageManager = "bun"
    detected.push("bun.lockb")
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
    detail: `${outcome === "pass" ? "exit 0" : `exit ${code}`} en ${duration}ms${timeoutNote ? ` — ${timeoutNote}` : ""}`,
    ...(outcome === "fail" ? { reason: `La fase ${phase} falló con exit code ${code}` } : {}),
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n… [salida truncada: ${text.length - max} caracteres más]`
}

/** Ejecuta las 6 fases técnicas. */
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
  if (tooling.hasTest && pm) {
    results.push(await runPhase("test", pm, ["run", "test"], projectRoot, runner))
  } else if (tooling.isPython) {
    results.push(await runPhase("test", "python", ["-m", "pytest", "-q"], projectRoot, runner))
  } else if (tooling.isGo) {
    results.push(await runPhase("test", "go", ["test", "./..."], projectRoot, runner))
  } else if (tooling.isRust) {
    results.push(await runPhase("test", "cargo", ["test"], projectRoot, runner))
  } else {
    results.push(na("test", "el proyecto no define script `test`"))
  }

  // 5. Security grep — escaneo en código, portable a cualquier SO.
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
    results.push(na("diff", "el proyecto no está bajo control de versiones (no hay .git)"))
  }

  return results
}

/**
 * Patrones de detección de secretos.
 *
 * Se aplican EN CÓDIGO, no shelling out a `grep`.
 *
 * Razón: `grep` no existe en Windows (viene con Git Bash, no con el sistema),
 * y un gate de seguridad que depende de una tool opcional del SO es un gate
 * que falla en Windows por razones equivocadas. Además, escanear en código
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
]

/** Extensiones que se escanean. El código compilado no aporta. */
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

/** Redacta un valor: solo se ven los primeros y últimos 4 caracteres. */
export function redact(value: string): string {
  if (value.length <= 10) return "[REDACTED]"
  return `${value.slice(0, 4)}${"*".repeat(Math.min(value.length - 8, 20))}${value.slice(-4)}`
}

/**
 * Escanea un directorio en busca de secretos.
 *
 * Devuelve los hits con el valor redactado. El valor crudo no sale de acá:
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
 * Distinto del gate técnico: audita trust boundaries y secretos. Un FAIL acá
 * bloquea la card aunque el técnico esté verde.
 */
export async function runSecurityGate(
  projectRoot: string,
  scope: string[],
  _runner: CommandRunner = defaultRunner,
): Promise<GatePhaseResult[]> {
  const results: GatePhaseResult[] = []

  for (const { label, pattern } of SECRET_PATTERNS) {
    const hits = await scanForSecrets(projectRoot, scope)
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
        detail: `${label} — ${relevant.length} hallazgo(s)`,
        reason: `Se detectaron ${relevant.length} secretos (${label}). El valor está redactado a propósito.`,
      })
    } else {
      results.push({
        phase: "secrecy",
        command: `scan:${label}`,
        outcome: "pass",
        exitCode: 0,
        output: "0 hallazgos",
        detail: `${label} — limpio`,
      })
    }
  }

  if (scope.length === 0) {
    results.push(na("diff", "sin scope definido: no hay archivos que auditar"))
  }

  return results
}

/** Consolida los resultados en un veredicto. */
export function consolidate(cardId: string, technical: GatePhaseResult[], security: GatePhaseResult[]): GateResult {
  const worst = (results: GatePhaseResult[]): GateOutcome => {
    if (results.some((r) => r.outcome === "fail")) return "fail"
    if (results.some((r) => r.outcome === "not_run")) return "not_run"
    if (results.length === 0) return "na"
    if (results.every((r) => r.outcome === "na")) return "na"
    return "pass"
  }

  const technicalOutcome = worst(technical)
  const securityOutcome = worst(security)

  return {
    cardId,
    technical,
    security,
    technicalOutcome,
    securityOutcome,
    passed: technicalOutcome === "pass" && securityOutcome === "pass",
    ranAt: nowIso(),
  }
}

/**
 * ¿La fase de tests corrió y pasó con al menos un test?
 *
 * Un gate que pasa con cero tests es un gate verde vacío. Los runners
 * imprimen el conteo en formatos distintos ("# tests 5", "5 passed",
 * "Tests: 5"), así que se buscan ambos órdenes.
 */
export function testsActuallyRan(technical: GatePhaseResult[]): boolean {
  const test = technical.find((r) => r.phase === "test")
  if (!test || test.outcome !== "pass") return false

  // "5 tests" / "5 passed" / "5 test"
  const before = /\b(\d+)\s+(?:tests?|passed|pass)\b/i.exec(test.output)
  if (before) return Number.parseInt(before[1]!, 10) > 0

  // "tests 5" / "passed 5" / "Tests: 5"
  const after = /\b(?:tests?|passed|pass)\b\D{0,3}(\d+)/i.exec(test.output)
  if (after) return Number.parseInt(after[1]!, 10) > 0

  // Sin conteo legible: no se puede afirmar que corrieron tests.
  return false
}

/** Renderiza el gate como markdown para el artefacto. */
export function renderGate(result: GateResult): string {
  const lines: string[] = []
  lines.push(`# Gates — ${result.cardId}`)
  lines.push("")
  lines.push(`**Corredor:** ${result.ranAt}`)
  lines.push("")

  const table = (title: string, rows: GatePhaseResult[]) => {
    lines.push(`## ${title}`)
    lines.push("")
    lines.push("| # | Fase | Comando | Resultado | Detalle |")
    lines.push("|---|------|---------|-----------|---------|")
    rows.forEach((r, i) => {
      lines.push(
        `| ${i + 1} | ${r.phase} | \`${r.command ?? "—"}\` | ${r.outcome.toUpperCase()} | ${r.detail} |`,
      )
    })
    lines.push("")
  }

  table("Técnico", result.technical)
  table("Seguridad", result.security)

  lines.push("## Salida de los comandos")
  lines.push("")
  for (const r of [...result.technical, ...result.security]) {
    if (r.outcome === "na" || !r.command) continue
    lines.push(`### ${r.phase} — \`${r.command}\``)
    lines.push("")
    lines.push("```")
    lines.push(r.output || "(sin salida)")
    lines.push("```")
    lines.push("")
  }

  lines.push(`**Gate técnico:** ${result.technicalOutcome.toUpperCase()}`)
  lines.push("")
  lines.push(`**Gate seguridad:** ${result.securityOutcome.toUpperCase()}`)
  lines.push("")
  lines.push(`**Veredicto:** ${result.passed ? "PASS" : "FAIL"}`)
  lines.push("")

  return lines.join("\n")
}
