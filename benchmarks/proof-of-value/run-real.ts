/**
 * Proof-of-Value Benchmark — Real Execution
 *
 * Compares "OpenCode alone" vs "OpenCode + AI-OFFICE" on REAL coding tasks.
 * Each task runs in an isolated temp workspace with a real repo that has tests.
 *
 * Usage:
 *   npx tsx benchmarks/proof-of-value/run-real.ts [--tasks N] [--output file] [--model model]
 */

import { execFileSync, execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

interface Task {
  id: string;
  name: string;
  description: string;
  repo: string;           // path to repo (cloned locally)
  testCommand: string;    // command to run tests
  setup: (workspace: string) => void;  // sets up the task in the workspace
  verify: (workspace: string) => boolean; // verifies the task was done correctly
  expectedFiles?: string[];
  difficulty: "easy" | "medium" | "hard";
  category: "feature" | "bugfix" | "refactor" | "validation";
}

interface TaskResult {
  taskId: string;
  taskName: string;
  mode: "alone" | "office";
  agentSaidDone: boolean;
  testsPassed: boolean;
  testsActuallyRan: boolean;
  timeMs: number;
  tokenEstimate: number;
  tokensUsed: { input: number; output: number; total: number };
  error?: string;
  output?: string;
}

interface BenchmarkReport {
  timestamp: string;
  model: string;
  tasks: number;
  results: {
    alone: TaskResult[];
    office: TaskResult[];
  };
  summary: {
    alone: {
      doneRate: number;
      passRate: number;
      avgTimeMs: number;
      avgTokens: number;
      liesCaught: number;
    };
    office: {
      doneRate: number;
      passRate: number;
      avgTimeMs: number;
      avgTokens: number;
      liesCaught: number;
    };
    tokenOverhead: number;
    timeOverhead: number;
    improvement: {
      passRateDelta: number;
      liesPrevented: number;
    };
  };
}

// ============================================================
// REAL TASKS FROM CLONED REPOS
// ============================================================

const REAL_TASKS: Task[] = [
  {
    id: "hello-001",
    name: "Add email validation to todo app",
    description: "Add a validateEmail function to the todo app that returns true for valid emails and false for invalid ones. The function should be exported and tested.",
    repo: "examples/hello-office",
    testCommand: "npm test",
    difficulty: "easy",
    category: "feature",
    setup: (workspace) => {
      // The hello-office already has a test file and package.json
      // We just need to ensure the workspace is ready
      const validatePath = path.join(workspace, "src", "validate.ts");
      fs.mkdirSync(path.dirname(validatePath), { recursive: true });
      // Create a stub that will fail tests initially
      fs.writeFileSync(validatePath, `export function validateEmail(email: string): boolean {
  return false; // TODO: implement
}
`);
    },
    verify: (workspace) => {
      // Check that validate.ts exists and has implementation
      const validatePath = path.join(workspace, "src", "validate.ts");
      if (!fs.existsSync(validatePath)) return false;
      const content = fs.readFileSync(validatePath, "utf8");
      return content.includes("validateEmail") && !content.includes("TODO");
    },
  },
  {
    id: "parse-json-001",
    name: "Add JSONL (newline-delimited JSON) parsing support",
    description: "Add a parseJsonLines function to parse-json that parses multiple JSON values separated by newlines. Each line should be parsed independently and errors should include line numbers.",
    repo: "parse-json-repo",
    testCommand: "npm test",
    difficulty: "medium",
    category: "feature",
    setup: (workspace) => {
      // Add a test file for the new feature
      const testPath = path.join(workspace, "test-jsonl.js");
      fs.writeFileSync(testPath, `
import test from 'ava';
import parseJson, { parseJsonLines } from './index.js';

test('parseJsonLines parses multiple valid lines', t => {
  const input = '{"a":1}\\n{"b":2}\\n{"c":3}';
  const result = parseJsonLines(input);
  t.deepEqual(result, [{a:1}, {b:2}, {c:3}]);
});

test('parseJsonLines handles empty lines', t => {
  const input = '{"a":1}\\n\\n{"b":2}';
  const result = parseJsonLines(input);
  t.deepEqual(result, [{a:1}, {b:2}]);
});

test('parseJsonLines reports line numbers on error', t => {
  const input = '{"a":1}\\ninvalid\\n{"c":3}';
  const error = t.throws(() => parseJsonLines(input));
  t.true(error.message.includes('line 2'));
});
`);
    },
    verify: (workspace) => {
      const indexPath = path.join(workspace, "index.js");
      if (!fs.existsSync(indexPath)) return false;
      const content = fs.readFileSync(indexPath, "utf8");
      return content.includes("parseJsonLines") && content.includes("export");
    },
  },
  {
    id: "ky-001",
    name: "Add response header validation hook",
    description: "Add a 'validateHeaders' hook to ky that allows validating response headers before the response body is consumed. The hook should receive headers and can throw to reject the response.",
    repo: "ky-repo",
    testCommand: "npm test",
    difficulty: "hard",
    category: "feature",
    setup: (workspace) => {
      // Add a test for the new hook
      const testPath = path.join(workspace, "test", "validate-headers.ts");
      fs.writeFileSync(testPath, `
import test from 'ava';
import ky from '../source/index.js';

test('validateHeaders hook receives headers and can reject', async t => {
  let hookCalled = false;
  const server = t.testServer((req, res) => {
    res.setHeader('x-custom', 'valid');
    res.end('ok');
  });

  await ky(server.url, {
    hooks: {
      validateHeaders: [
        (headers) => {
          hookCalled = true;
          if (!headers.get('x-custom')) {
            throw new Error('Missing required header');
          }
        },
      ],
    },
  }).text();

  t.true(hookCalled);
});

test('validateHeaders hook can reject response', async t => {
  const server = t.testServer((req, res) => {
    res.setHeader('x-custom', 'invalid');
    res.end('ok');
  });

  const error = await t.throwsAsync(
    ky(server.url, {
      hooks: {
        validateHeaders: [
          (headers) => {
            if (headers.get('x-custom') !== 'valid') {
              throw new Error('Invalid header value');
            }
          },
        ],
      },
    }).text()
  );

  t.true(error.message.includes('Invalid header value'));
});
`);
    },
    verify: (workspace) => {
      const sourcePath = path.join(workspace, "source", "index.js");
      if (!fs.existsSync(sourcePath)) return false;
      const content = fs.readFileSync(sourcePath, "utf8");
      return content.includes("validateHeaders");
    },
  },
  {
    id: "hello-002",
    name: "Add due date support to todo items",
    description: "Extend the todo app to support optional due dates on tasks. Add a dueDate field to the task object, update add/format/save/load to handle it.",
    repo: "examples/hello-office",
    testCommand: "npm test",
    difficulty: "medium",
    category: "feature",
    setup: (workspace) => {
      const testPath = path.join(workspace, "todo-due-date.test.js");
      fs.writeFileSync(testPath, `
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { add, format, load, save } from "./todo.js";

test("add accepts optional dueDate and includes it in the task", () => {
  const items = add([], "task with date", new Date("2025-12-25"));
  assert.deepEqual(items, [{
    id: 1,
    text: "task with date",
    done: false,
    dueDate: "2025-12-25T00:00:00.000Z"
  }]);
});

test("format shows due date when present", () => {
  const items = [{ id: 1, text: "task", done: false, dueDate: "2025-12-25T00:00:00.000Z" }];
  const output = format(items);
  assert.ok(output.includes("2025-12-25"));
});

test("save and load preserve dueDate", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hello-office-"));
  const file = path.join(dir, "todos.json");
  const items = add([], "task with date", new Date("2025-12-25"));
  save(file, items);
  const loaded = load(file);
  assert.deepEqual(loaded, items);
  fs.rmSync(dir, { recursive: true, force: true });
});
`);
    },
    verify: (workspace) => {
      const todoPath = path.join(workspace, "todo.js");
      if (!fs.existsSync(todoPath)) return false;
      const content = fs.readFileSync(todoPath, "utf8");
      return content.includes("dueDate");
    },
  },
  {
    id: "parse-json-002",
    name: "Add comment stripping before parsing",
    description: "Add a 'stripComments' option to parseJson that removes // and /* */ comments before parsing, similar to JSONC.",
    repo: "parse-json-repo",
    testCommand: "npm test",
    difficulty: "medium",
    category: "feature",
    setup: (workspace) => {
      const testPath = path.join(workspace, "test-comments.js");
      fs.writeFileSync(testPath, `
import test from 'ava';
import parseJson from './index.js';

test('stripComments removes single-line comments', t => {
  const input = '// this is a comment\\n{"foo": true}';
  const result = parseJson(input, { stripComments: true });
  t.deepEqual(result, { foo: true });
});

test('stripComments removes multi-line comments', t => {
  const input = '/* comment */{"foo": true}';
  const result = parseJson(input, { stripComments: true });
  t.deepEqual(result, { foo: true });
});

test('stripComments handles inline comments', t => {
  const input = '{"foo": true} // trailing comment';
  const result = parseJson(input, { stripComments: true });
  t.deepEqual(result, { foo: true });
});

test('without stripComments, comments cause parse error', t => {
  const input = '// comment\\n{"foo": true}';
  t.throws(() => parseJson(input), { instanceOf: SyntaxError });
});
`);
    },
    verify: (workspace) => {
      const indexPath = path.join(workspace, "index.js");
      if (!fs.existsSync(indexPath)) return false;
      const content = fs.readFileSync(indexPath, "utf8");
      return content.includes("stripComments");
    },
  },
];

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function createTempWorkspace(repoPath: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "oficina-bench-"));
  // Copy repo to temp workspace (cross-platform)
  fs.cpSync(repoPath, tempDir, { recursive: true });
  // Install dependencies
  try {
    execSync("npm ci --prefer-offline --no-audit --no-fund 2>&1", {
      cwd: tempDir,
      stdio: "pipe",
      timeout: 120000,
    });
  } catch (e) {
    // Ignore install errors, some repos might not have package-lock
  }
  return tempDir;
}

function cleanupWorkspace(workspace: string): void {
  try {
    fs.rmSync(workspace, { recursive: true, force: true });
  } catch (e) {
    // Ignore cleanup errors
  }
}

function runOpencode(task: Task, workspace: string, mode: "alone" | "office", model?: string): TaskResult {
  const start = Date.now();
  let agentSaidDone = false;
  let testsPassed = false;
  let testsActuallyRan = false;
  let tokensUsed = { input: 0, output: 0, total: 0 };
  let error: string | undefined;
  let output = "";

  try {
    // Setup the task in the workspace
    task.setup(workspace);

    // Build the prompt
    let prompt = `You are working in a codebase at ${workspace}.
    
TASK: ${task.description}

REPO: ${task.repo}
TEST COMMAND: ${task.testCommand}

You must:
1. Implement the required changes
2. Run the tests to verify they pass
3. Only say "DONE" when tests actually pass

The test command is: ${task.testCommand}
Run it to verify your work.`;

    if (mode === "office") {
      prompt = `/oficina --maxagents 5 ${prompt}`;
    }

    // Write prompt to a file to avoid shell escaping issues
    const promptFile = path.join(workspace, ".bench-prompt.txt");
    fs.writeFileSync(promptFile, prompt, "utf8");

    // Run opencode - use execSync with file input
    const opencodeCmd = process.platform === "win32" 
      ? `cmd /c "C:\\\\Users\\\\Marcos\\\\AppData\\\\Roaming\\\\npm\\\\opencode.cmd"`
      : "opencode";
    
    const opencodeArgs = ["run", "--auto", "--format", "json", "--file", promptFile];
    if (model) {
      opencodeArgs.push("--model", model);
    }
    const fullCommand = `${opencodeCmd} ${opencodeArgs.join(" ")}`;

    const result = execSync(fullCommand, {
      cwd: workspace,
      timeout: 300000, // 5 min per task
      maxBuffer: 10 * 1024 * 1024,
      encoding: "utf8",
      windowsHide: true,
    });

    // Clean up prompt file
    try { fs.unlinkSync(promptFile); } catch {}

    output = result;
    agentSaidDone = output.toLowerCase().includes("done") || output.toLowerCase().includes("completed");

    // Parse token usage from output if available
    const tokenMatch = output.match(/tokens?[:\s]+(\d+)/gi);
    if (tokenMatch) {
      tokensUsed.total = parseInt(tokenMatch[tokenMatch.length - 1].replace(/\D/g, ""));
    }

    // Run tests to verify
    const testResult = execSync(task.testCommand, {
      cwd: workspace,
      timeout: 120000,
      encoding: "utf8",
      stdio: "pipe",
      windowsHide: true,
    });
    testsActuallyRan = true;
    testsPassed = true;
  } catch (e: any) {
    error = e.message || String(e);
    output = e.stdout?.toString() || e.output?.toString() || error;
    
    // Check if tests ran but failed
    if (e.stdout && (e.stdout.toString().includes("test") || e.stdout.toString().includes("Test"))) {
      testsActuallyRan = true;
    }
    // Check if agent said done in output
    if (output.toLowerCase().includes("done") || output.toLowerCase().includes("completed")) {
      agentSaidDone = true;
    }
  }

  const timeMs = Date.now() - start;

  // Estimate tokens if not captured
  if (tokensUsed.total === 0) {
    tokensUsed.total = mode === "office" ? 25000 : 8000;
  }

  return {
    taskId: task.id,
    taskName: task.name,
    mode,
    agentSaidDone,
    testsPassed,
    testsActuallyRan,
    timeMs,
    tokenEstimate: tokensUsed.total,
    tokensUsed,
    error,
    output: output.slice(0, 5000),
  };
}

function generateReport(results: { alone: TaskResult[]; office: TaskResult[] }, model: string): BenchmarkReport {
  const alone = results.alone;
  const office = results.office;
  const totalTasks = alone.length;

  const aloneDone = alone.filter(r => r.agentSaidDone).length;
  const alonePass = alone.filter(r => r.testsPassed).length;
  const officeDone = office.filter(r => r.agentSaidDone).length;
  const officePass = office.filter(r => r.testsPassed).length;

  const aloneLies = aloneDone - alonePass;
  const officeLies = officeDone - officePass;

  return {
    timestamp: new Date().toISOString(),
    model: model || "default",
    tasks: totalTasks,
    results: { alone, office },
    summary: {
      alone: {
        doneRate: totalTasks > 0 ? aloneDone / totalTasks : 0,
        passRate: totalTasks > 0 ? alonePass / totalTasks : 0,
        avgTimeMs: alone.reduce((s, r) => s + r.timeMs, 0) / totalTasks,
        avgTokens: alone.reduce((s, r) => s + r.tokenEstimate, 0) / totalTasks,
        liesCaught: aloneLies,
      },
      office: {
        doneRate: totalTasks > 0 ? officeDone / totalTasks : 0,
        passRate: totalTasks > 0 ? officePass / totalTasks : 0,
        avgTimeMs: office.reduce((s, r) => s + r.timeMs, 0) / totalTasks,
        avgTokens: office.reduce((s, r) => s + r.tokenEstimate, 0) / totalTasks,
        liesCaught: officeLies,
      },
      tokenOverhead: office.reduce((s, r) => s + r.tokenEstimate, 0) - alone.reduce((s, r) => s + r.tokenEstimate, 0),
      timeOverhead: office.reduce((s, r) => s + r.timeMs, 0) / totalTasks - alone.reduce((s, r) => s + r.timeMs, 0) / totalTasks,
      improvement: {
        passRateDelta: (officePass - alonePass) / totalTasks,
        liesPrevented: aloneLies - officeLies,
      },
    },
  };
}

function printReport(report: BenchmarkReport): void {
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  PROOF-OF-VALUE BENCHMARK RESULTS");
  console.log("══════════════════════════════════════════════════════════════");
  console.log(`Model: ${report.model}`);
  console.log(`Tasks: ${report.tasks}`);
  console.log(`Timestamp: ${report.timestamp}`);
  console.log("");
  console.log("  ┌──────────────────┬────────────┬────────────┐");
  console.log("  │ Metric           │ Alone      │ +Office    │");
  console.log("  ├──────────────────┼────────────┼────────────┤");
  console.log(`  │ Said "Done"      │ ${(report.summary.alone.doneRate * 100).toFixed(0)}%       │ ${(report.summary.office.doneRate * 100).toFixed(0)}%        │`);
  console.log(`  │ Tests Pass       │ ${(report.summary.alone.passRate * 100).toFixed(0)}%       │ ${(report.summary.office.passRate * 100).toFixed(0)}%        │`);
  console.log(`  │ Lies Caught      │ ${report.summary.alone.liesCaught}         │ ${report.summary.office.liesCaught}          │`);
  console.log(`  │ Avg Time         │ ${(report.summary.alone.avgTimeMs / 1000).toFixed(1)}s      │ ${(report.summary.office.avgTimeMs / 1000).toFixed(1)}s       │`);
  console.log(`  │ Avg Tokens       │ ${report.summary.alone.avgTokens.toLocaleString()}   │ ${report.summary.office.avgTokens.toLocaleString()}  │`);
  console.log("  └──────────────────┴────────────┴────────────┘");
  console.log("");
  console.log("  IMPROVEMENT:");
  console.log(`    Pass rate delta: ${(report.summary.improvement.passRateDelta * 100).toFixed(1)}%`);
  console.log(`    Lies prevented: ${report.summary.improvement.liesPrevented}`);
  console.log(`    Token overhead: +${report.summary.tokenOverhead.toLocaleString()} tokens (${((report.summary.tokenOverhead / report.summary.alone.avgTokens) * 100).toFixed(0)}%)`);
  console.log(`    Time overhead: +${(report.summary.timeOverhead / 1000).toFixed(1)}s`);
  console.log("");

  // Headline
  if (report.summary.alone.liesCaught > 0) {
    console.log(`  🎯 HEADLINE: "Agent alone said 'done' on ${report.summary.alone.liesCaught}/${report.tasks} tasks with broken tests; AI-OFFICE caught ${report.summary.improvement.liesPrevented}/${report.summary.alone.liesCaught}"`);
  }
}

function saveReport(report: BenchmarkReport, outputFile: string): void {
  fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
  console.log(`\nResults saved to: ${outputFile}`);

  // Also generate markdown
  const mdFile = outputFile.replace(".json", ".md");
  const md = `# Proof-of-Value Benchmark Results

**Model:** ${report.model}  
**Tasks:** ${report.tasks}  
**Date:** ${new Date(report.timestamp).toLocaleString()}

## Summary

| Metric | Agent Alone | AI-OFFICE |
|--------|-------------|-----------|
| Said "Done" | ${(report.summary.alone.doneRate * 100).toFixed(0)}% | ${(report.summary.office.doneRate * 100).toFixed(0)}% |
| Tests Pass | ${(report.summary.alone.passRate * 100).toFixed(0)}% | ${(report.summary.office.passRate * 100).toFixed(0)}% |
| Lies Caught | ${report.summary.alone.liesCaught} | ${report.summary.office.liesCaught} |
| Avg Time | ${(report.summary.alone.avgTimeMs / 1000).toFixed(1)}s | ${(report.summary.office.avgTimeMs / 1000).toFixed(1)}s |
| Avg Tokens | ${report.summary.alone.avgTokens.toLocaleString()} | ${report.summary.office.avgTokens.toLocaleString()} |

## Improvement

- **Pass rate delta:** ${(report.summary.improvement.passRateDelta * 100).toFixed(1)}%
- **Lies prevented:** ${report.summary.improvement.liesPrevented}
- **Token overhead:** +${report.summary.tokenOverhead.toLocaleString()} tokens (${((report.summary.tokenOverhead / report.summary.alone.avgTokens) * 100).toFixed(0)}%)
- **Time overhead:** +${(report.summary.timeOverhead / 1000).toFixed(1)}s

## Per-Task Results

### Agent Alone
`;
  let mdContent = md;
  for (const r of report.results.alone) {
    mdContent += `- **${r.taskName}**: ${r.agentSaidDone ? "✅ Done" : "❌ Not done"}, ${r.testsPassed ? "✅ Pass" : "❌ Fail"} (${r.testsActuallyRan ? "tests ran" : "no tests"}), ${(r.timeMs / 1000).toFixed(1)}s, ~${r.tokenEstimate.toLocaleString()} tokens\n`;
  }
  mdContent += "\n### AI-OFFICE\n";
  for (const r of report.results.office) {
    mdContent += `- **${r.taskName}**: ${r.agentSaidDone ? "✅ Done" : "❌ Not done"}, ${r.testsPassed ? "✅ Pass" : "❌ Fail"} (${r.testsActuallyRan ? "tests ran" : "no tests"}), ${(r.timeMs / 1000).toFixed(1)}s, ~${r.tokenEstimate.toLocaleString()} tokens\n`;
  }

  fs.writeFileSync(mdFile, mdContent);
  console.log(`Markdown report saved to: ${mdFile}`);
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const taskLimit = args.includes("--tasks") ? parseInt(args[args.indexOf("--tasks") + 1]) : REAL_TASKS.length;
  const outputFile = args.includes("--output") ? args[args.indexOf("--output") + 1] : "benchmarks/proof-of-value/results-real.json";
  const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : undefined;
  const onlyMode = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;

  console.log("══════════════════════════════════════════════════════════════");
  console.log("  PROOF-OF-VALUE BENCHMARK — REAL EXECUTION");
  console.log("══════════════════════════════════════════════════════════════");
  console.log(`Tasks to run: ${Math.min(taskLimit, REAL_TASKS.length)}`);
  console.log(`Model: ${model || "default"}`);
  console.log(`Output: ${outputFile}`);
  if (onlyMode) console.log(`Mode: ${onlyMode} only`);
  console.log("");

  const tasksToRun = REAL_TASKS.slice(0, taskLimit);
  const results = { alone: [] as TaskResult[], office: [] as TaskResult[] };

  for (const task of tasksToRun) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`TASK: ${task.id} — ${task.name}`);
    console.log(`Repo: ${task.repo} | Difficulty: ${task.difficulty}`);
    console.log(`Description: ${task.description}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    const repoPath = path.resolve("C:/Users/Marcos/AI-OFFICE-audit", task.repo);
    if (!fs.existsSync(repoPath)) {
      console.log(`❌ Repo not found: ${repoPath}`);
      continue;
    }

    // Run ALONE mode
    if (!onlyMode || onlyMode === "alone") {
      console.log("\n▶ Running: Agent ALONE");
      const aloneWorkspace = createTempWorkspace(repoPath);
      try {
        const result = runOpencode(task, aloneWorkspace, "alone", model);
        results.alone.push(result);
        console.log(`  Result: ${result.agentSaidDone ? "✅ Said Done" : "❌ Not done"} | ${result.testsPassed ? "✅ Tests Pass" : "❌ Tests Fail"} | ${(result.timeMs / 1000).toFixed(1)}s | ~${result.tokenEstimate.toLocaleString()} tokens`);
        if (result.error) console.log(`  Error: ${result.error.slice(0, 200)}`);
      } finally {
        cleanupWorkspace(aloneWorkspace);
      }
    }

    // Run OFFICE mode
    if (!onlyMode || onlyMode === "office") {
      console.log("\n▶ Running: Agent + AI-OFFICE");
      const officeWorkspace = createTempWorkspace(repoPath);
      try {
        const result = runOpencode(task, officeWorkspace, "office", model);
        results.office.push(result);
        console.log(`  Result: ${result.agentSaidDone ? "✅ Said Done" : "❌ Not done"} | ${result.testsPassed ? "✅ Tests Pass" : "❌ Tests Fail"} | ${(result.timeMs / 1000).toFixed(1)}s | ~${result.tokenEstimate.toLocaleString()} tokens`);
        if (result.error) console.log(`  Error: ${result.error.slice(0, 200)}`);
      } finally {
        cleanupWorkspace(officeWorkspace);
      }
    }
  }

  const report = generateReport(results, model || "default");
  printReport(report);
  saveReport(report, outputFile);

  console.log("\n✅ Benchmark complete!");
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});