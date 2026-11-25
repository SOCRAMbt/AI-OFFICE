#!/usr/bin/env node
/* ============================================================
   seed-demo.mjs — genera .oficina-demo/ con una corrida SINTÉTICA rica
   equivalente a la referencia visual v3.3.0 (RUN-2025-05-18-0017):
   5 agentes, 17 cards en 5 columnas, bus, gates, decisiones y memoria.
   Uso: node dashboard/scripts/seed-demo.mjs [destino]   (default ../.oficina-demo)
   ============================================================ */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASH = path.resolve(__dirname, "..");
const DEST = path.resolve(process.argv[2] || path.join(DASH, "..", ".oficina-demo"));
const RUN_ID = "RUN-2025-05-18-0017";

const now = Date.now();
const iso = (minsAgo = 0) => new Date(now - minsAgo * 60_000).toISOString();

const AGENTS = [
  { id: "e-commander", role: "commander", displayName: "Commander", state: "working", currentCard: "T-12" },
  { id: "e-architect", role: "architect", displayName: "Architect", state: "working", currentCard: "T-13" },
  { id: "e-implementer", role: "implementer", displayName: "Implementer", state: "working", currentCard: "T-14" },
  { id: "e-reviewer", role: "reviewer", displayName: "Reviewer", state: "working", currentCard: "T-11" },
  { id: "e-integrator", role: "integrator", displayName: "Integrator", state: "idle_available", currentCard: null },
];

const agents = {};
for (const a of AGENTS) {
  agents[a.id] = {
    ...a,
    version: 1,
    canAccept: true,
    peers: AGENTS.filter((x) => x.id !== a.id).map((x) => x.id),
    lastHeartbeat: iso(0),
    createdAt: iso(90),
    updatedAt: iso(0),
    source: { kind: "seed", note: "demo fixture v3.3.0" },
  };
}

const card = (id, title, state, owner, extra = {}) => ({
  id,
  title,
  type: state === "review" ? "review" : "implementation",
  state,
  owner,
  reviewer: state === "review" ? "e-reviewer" : null,
  requiredCapabilities: ["TypeScript"],
  scope: { mayTouch: ["src/**", "tests/**"], forbidden: ["**/.env"] },
  acceptance: ["Compila limpio (tsc)", "Tests en verde", "Evidence registrada"],
  gate: "npm run typecheck && npm test",
  dependsOn: [],
  attempts: state === "todo" ? 0 : 1,
  rejections: 0,
  artifacts: `.oficina/artifacts/${id}`,
  result: state === "done" ? "done" : null,
  helpRequests: [],
  helpHops: 0,
  updatedAt: iso(2),
  ...extra,
});

const cards = {
  // Done (7)
  "T-01": card("T-01", "Project structure and lint/CI configuration", "done", "e-architect"),
  "T-02": card("T-02", "Design data model and entity conventions", "done", "e-architect"),
  "T-03": card("T-03", "Auth module (backend): register & login", "done", "e-implementer"),
  "T-04": card("T-04", "Rate limiting on public endpoints", "done", "e-implementer"),
  "T-05": card("T-05", "Migration tooling and seed scripts", "done", "e-architect"),
  "T-07": card("T-07", "User model + password hashing", "done", "e-implementer"),
  "T-10": card("T-10", "Environment validation at boot (zod)", "done", "e-implementer"),
  // Blocked (1) — circuit breaker tipo typecheck
  "T-06": card("T-06", "Fix type errors in user service", "blocked_escalated", "e-implementer", {
    rejections: 3,
    failureHistory: [
      { fingerprint: "a1b2c3d4e5f6a7b8", message: "src/services/user.service.ts(142,11): error TS2345: Type 'string' is not assignable to type 'UserId'", at: iso(6) },
      { fingerprint: "a1b2c3d4e5f6a7b8", message: "src/services/user.service.ts(142,11): error TS2345: Type 'string' is not assignable to type 'UserId'", at: iso(4) },
      { fingerprint: "a1b2c3d4e5f6a7b8", message: "src/services/user.service.ts(142,11): error TS2345: Type 'string' is not assignable to type 'UserId'", at: iso(2) },
    ],
    result: "mismo error de typecheck 3 veces seguidas (fingerprint a1b2c3d4e5f6a7b8) — BLOCKED_ESCALATED",
  }),
  // Review (2)
  "T-11": card("T-11", "PR: Add OAuth support (Google)", "review", "e-reviewer", { attempts: 1 }),
  "T-16": card("T-16", "PR: Fix payment webhook signature validation", "review", "e-reviewer", { attempts: 1 }),
  // In Progress (4)
  "T-12": card("T-12", "User service CRUD: list, get, update, delete", "in_progress", "e-implementer", { branch: "feat/user-crud" }),
  "T-13": card("T-13", "Database schema and migrations for user_profiles", "in_progress", "e-architect", { branch: "feat/user-profiles" }),
  "T-14": card("T-14", "Integrate billing provider (Stripe)", "in_progress", "e-implementer", { branch: "feat/billing" }),
  "T-15": card("T-15", "User settings API endpoints", "in_progress", "e-architect", { branch: "feat/user-settings" }),
  // Backlog (3)
  "T-21": card("T-21", "Add error boundary in the API layer", "todo", "e-implementer"),
  "T-22": card("T-22", "Improve logging context: tenant + traceId", "todo", "e-architect"),
  "T-23": card("T-23", "Refactor auth middleware: early returns", "todo", "e-implementer"),
};

const state = {
  version: 2,
  runId: RUN_ID,
  objective: "Harden the user service: OAuth, schema, billing integration — 17 cards with gates",
  createdAt: iso(18),
  updatedAt: iso(0),
  status: "running",
  mode: "full",
  cards,
  order: Object.keys(cards),
  decisions: [
    { at: iso(0), cardId: "T-11", decision: "approved", reason: "Test passed on #11", actor: "e-integrator" },
    { at: iso(2), cardId: "T-13", decision: "gate-fail", reason: "Gate failed: typecheck on #13", actor: "e-architect" },
    { at: iso(5), cardId: "T-11", decision: "approved", reason: "Reviewer approved #11", actor: "e-reviewer" },
    { at: iso(8), cardId: "T-12", decision: "resume", reason: "Implementer updated #12", actor: "e-implementer" },
    { at: iso(10), cardId: "T-12", decision: "assign", reason: "Commander assigned #12", actor: "e-commander" },
  ],
  escalations: [],
  context: {},
  iteration: 3,
  pendingGates: [],
  sessions: [],
  halt: null,
};

const busMessages = [
  { from: "e-commander", to: ["e-implementer"], kind: "ASSIGN", subject: "Card #12 assigned", body: { text: "Card #12 assigned. Scope: user service CRUD." }, priority: "normal", seq: 1, minutesAgo: 12 },
  { from: "e-implementer", to: ["e-reviewer"], kind: "PR_READY", subject: "PR ready", body: { text: "PR ready for review on #11." }, priority: "normal", seq: 2, minutesAgo: 8 },
  { from: "e-reviewer", to: ["e-commander"], kind: "APPROVAL", subject: "#11 approved with notes", body: { text: "Approved #11 with minor notes: - add error handling - improve logging" }, priority: "normal", seq: 3, minutesAgo: 5 },
  { from: "e-architect", to: ["e-implementer"], kind: "NOTICE", subject: "Schema change for #13", body: { text: "Schema change needed for #13. Use new table `user_profiles`." }, priority: "high", seq: 4, minutesAgo: 2 },
  { from: "e-implementer", to: ["e-integrator"], kind: "STATUS", subject: "Build passed on #11", body: { text: "Build passed. Ready for merge on #11." }, priority: "normal", seq: 5, minutesAgo: 0 },
];

const channelName = (kind) => kind.toLowerCase().replace(/[^a-z0-9_-]/g, "");
const writeBus = () => {
  const base = path.join(DEST, "bus");
  fs.mkdirSync(base, { recursive: true });
  let n = 0;
  for (const m of busMessages) {
    const dir = path.join(base, channelName(m.kind));
    fs.mkdirSync(dir, { recursive: true });
    const msg = {
      id: `demo-${String(++n).padStart(4, "0")}`,
      from: m.from,
      to: m.to,
      kind: m.kind,
      subject: m.subject,
      body: m.body,
      priority: m.priority,
      inReplyTo: null,
      createdAt: iso(m.minutesAgo),
      seq: m.seq,
    };
    fs.writeFileSync(path.join(dir, `${msg.id}.json`), JSON.stringify(msg, null, 2));
  }
};

const writeGates = (cardId, phases, mtimeMinutesAgo) => {
  const dir = path.join(DEST, "artifacts", cardId);
  fs.mkdirSync(dir, { recursive: true });
  const rows = phases.map(([name, result], i) => {
    const cmd = name === "typecheck" ? "npm run typecheck" : name === "test" ? "npm test" : name === "lint" ? "npm run lint" : "npm run build";
    return `| ${i + 1} | ${name} | ${cmd} | ${result} | ${result === "FAIL" ? "error TS2345 (1)" : "ok"} |`;
  });
  const md = `# Gates — ${cardId}\n\n| # | Fase | Comando | Resultado | Detalle |\n|---|------|---------|-----------|---------|\n${rows.join("\n")}\n`;
  const file = path.join(dir, "gates.md");
  fs.writeFileSync(file, md);
  const when = (now - mtimeMinutesAgo * 60_000) / 1000;
  fs.utimesSync(file, when, when);
  fs.writeFileSync(path.join(dir, "evidence.md"), `# Evidence — ${cardId}\n\nEjecutado y verificado: ${cardId}.\n`);
  fs.writeFileSync(path.join(dir, "handoff.md"), `# Handoff — ${cardId}\n\n## What was done\nVer commits de la card.\n\n## Next\nVerificación cruzada por el reviewer.\n`);
  const when2 = when;
  for (const f of ["evidence.md", "handoff.md"]) fs.utimesSync(path.join(dir, f), when2, when2);
};

const memoryMd = `# Memoria episódica — ${RUN_ID}

- [${iso(30)}] gate PASS build (T-14)
- [${iso(18)}] gate PASS test (T-11)
- [${iso(12)}] gate PASS lint (T-11)
- [${iso(6)}] gate FAIL typecheck (T-13) fingerprint a1b2c3d4e5f6a7b8
- [${iso(2)}] gate FAIL typecheck (T-06) fingerprint a1b2c3d4e5f6a7b8 → BLOCKED_ESCALATED
- [${iso(0)}] review approved (T-11)
`;

function main() {
  if (fs.existsSync(DEST)) fs.rmSync(DEST, { recursive: true, force: true });
  fs.mkdirSync(DEST, { recursive: true });
  fs.writeFileSync(path.join(DEST, "state.json"), JSON.stringify(state, null, 2));
  fs.writeFileSync(path.join(DEST, "roster.json"), JSON.stringify({ version: 2, runId: RUN_ID, updatedAt: iso(0), agents }, null, 2));
  fs.writeFileSync(path.join(DEST, "memory.md"), memoryMd);
  writeBus();
  // gates por card (staggered para "2m ago", "3m ago"...)
  writeGates("T-14", [["build", "PASS"]], 2);
  writeGates("T-13", [["typecheck", "FAIL"]], 3);
  writeGates("T-11", [["lint", "PASS"]], 4);
  writeGates("T-10", [["test", "PASS"]], 5);
  writeGates("T-06", [["typecheck", "FAIL"]], 6);
  writeGates("T-01", [["build", "PASS"], ["test", "PASS"]], 80);
  writeGates("T-02", [["build", "PASS"]], 75);
  writeGates("T-03", [["build", "PASS"]], 60);
  writeGates("T-12", [["build", "PASS"]], 9);
  writeGates("T-15", [["build", "PASS"]], 11);
  writeGates("T-16", [["lint", "PASS"]], 20);
  console.log(`demo fixture listo en ${DEST} (${Object.keys(cards).length} cards, ${AGENTS.length} agentes)`);
}
main();
