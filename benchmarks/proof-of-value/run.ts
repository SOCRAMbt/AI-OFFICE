/**
 * Proof-of-Value Benchmark
 *
 * Compares "agent alone" vs "agent + AI-OFFICE" on real tasks.
 *
 * Each task is a small code change with existing tests. We measure:
 * - Did the agent say "done"?
 * - Do the tests actually pass?
 * - Time taken
 * - Token cost (estimated)
 *
 * Usage: npx tsx benchmarks/proof-of-value/run.ts [--tasks <dir>] [--output <file>]
 *
 * Results are published as JSON + markdown report.
 */

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

interface Task {
  id: string
  description: string
  repo: string
  testCommand: string
  expectedFiles: string[]
}

interface TaskResult {
  taskId: string
  agentSaidDone: boolean
  testsPassed: boolean
  testsActuallyRan: boolean
  timeMs: number
  tokenEstimate: number
  mode: "alone" | "office"
}

interface BenchmarkReport {
  timestamp: string
  tasks: number
  results: {
    alone: TaskResult[]
    office: TaskResult[]
  }
  summary: {
    aloneDoneRate: number
    alonePassRate: number
    officeDoneRate: number
    officePassRate: boolean
    liesCaught: number
    tokenOverhead: number
  }
}

const TASKS_DIR = path.resolve(process.argv.includes("--tasks") ? process.argv[process.argv.indexOf("--tasks") + 1] : "benchmarks/proof-of-value/tasks")
const OUTPUT_FILE = process.argv.includes("--output") ? process.argv[process.argv.indexOf("--output") + 1] : "benchmarks/proof-of-value/results.json"

function loadTasks(): Task[] {
  if (!fs.existsSync(TASKS_DIR)) {
    console.log(`Tasks directory not found: ${TASKS_DIR}`)
    console.log("Creating sample tasks...")
    fs.mkdirSync(TASKS_DIR, { recursive: true })
    // Create a sample task
    const sampleTask: Task = {
      id: "sample-001",
      description: "Add input validation to signup form",
      repo: "examples/hello-office",
      testCommand: "npm test",
      expectedFiles: ["src/validate.ts"],
    }
    fs.writeFileSync(path.join(TASKS_DIR, "sample-001.json"), JSON.stringify(sampleTask, null, 2))
    return [sampleTask]
  }

  const files = fs.readdirSync(TASKS_DIR).filter((f) => f.endsWith(".json"))
  return files.map((f) => JSON.parse(fs.readFileSync(path.join(TASKS_DIR, f), "utf8")) as Task)
}

function runTask(task: Task, mode: "alone" | "office"): TaskResult {
  const start = Date.now()
  // In a real benchmark, this would:
  // 1. Clone the task repo
  // 2. Run the agent (alone or with AI-OFFICE)
  // 3. Check if tests pass
  // 4. Record results

  // For now, this is a framework placeholder
  const result: TaskResult = {
    taskId: task.id,
    agentSaidDone: false,
    testsPassed: false,
    testsActuallyRan: false,
    timeMs: Date.now() - start,
    tokenEstimate: mode === "office" ? 15000 : 5000,
    mode,
  }

  return result
}

function main() {
  console.log("Proof-of-Value Benchmark")
  console.log("========================")
  console.log(`Tasks dir: ${TASKS_DIR}`)
  console.log(`Output: ${OUTPUT_FILE}`)

  const tasks = loadTasks()
  console.log(`Loaded ${tasks.length} tasks`)

  const aloneResults: TaskResult[] = []
  const officeResults: TaskResult[] = []

  for (const task of tasks) {
    console.log(`\nRunning task: ${task.id} - ${task.description}`)
    aloneResults.push(runTask(task, "alone"))
    officeResults.push(runTask(task, "office"))
  }

  const aloneDone = aloneResults.filter((r) => r.agentSaidDone).length
  const alonePass = aloneResults.filter((r) => r.testsPassed).length
  const officeDone = officeResults.filter((r) => r.agentSaidDone).length
  const officePass = officeResults.filter((r) => r.testsPassed).length
  const liesCaught = aloneDone - alonePass

  const report: BenchmarkReport = {
    timestamp: new Date().toISOString(),
    tasks: tasks.length,
    results: { alone: aloneResults, office: officeResults },
    summary: {
      aloneDoneRate: tasks.length > 0 ? aloneDone / tasks.length : 0,
      alonePassRate: tasks.length > 0 ? alonePass / tasks.length : 0,
      officeDoneRate: tasks.length > 0 ? officeDone / tasks.length : 0,
      officePassRate: tasks.length > 0 ? officePass / tasks.length : 0,
      liesCaught,
      tokenOverhead: officeResults.reduce((s, r) => s + r.tokenEstimate, 0) - aloneResults.reduce((s, r) => s + r.tokenEstimate, 0),
    },
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2))
  console.log("\n=== Summary ===")
  console.log(`Tasks: ${tasks.length}`)
  console.log(`Agent alone: said done ${aloneDone}/${tasks.length}, tests passed ${alonePass}/${tasks.length}`)
  console.log(`AI-OFFICE:  said done ${officeDone}/${tasks.length}, tests passed ${officePass}/${tasks.length}`)
  console.log(`Lies caught: ${liesCaught}`)
  console.log(`Token overhead: ~${report.summary.tokenOverhead} tokens`)
  console.log(`\nResults saved to: ${OUTPUT_FILE}`)
}

main()