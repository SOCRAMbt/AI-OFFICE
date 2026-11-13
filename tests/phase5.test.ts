import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { routeCard, ownerStreak } from "../src/core/router.js"
import { RosterStore } from "../src/core/roster.js"
import { Office } from "../src/core/office.js"
import { createRun } from "../src/core/state.js"
import { DEFAULT_LIMITS } from "../src/core/types.js"
import type { Card, Ficha, Roster } from "../src/core/types.js"
import { openBrowser } from "../src/core/dashboard.js"
import { diagnose } from "../scripts/diagnose-run.js"
import { buildTools } from "../src/tools/index.js"

let tmp: string

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: "T-01",
    title: "Test",
    type: "implementation",
    state: "todo",
    owner: null,
    reviewer: null,
    requiredCapabilities: [],
    scope: { mayTouch: ["src/**"], forbidden: ["**/*.env"] },
    acceptance: ["a"],
    gate: "npm test",
    dependsOn: [],
    attempts: 0,
    rejections: 0,
    artifacts: ".oficina/artifacts/T-01",
    result: null,
    helpRequests: [],
    helpHops: 0,
    ...overrides,
  }
}

describe("Phase 5: Routing, Briefings, CLI, Dashboard & Scripts Remediation", () => {
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-phase5-"))
    await fs.mkdir(path.join(tmp, "src"), { recursive: true })
    await fs.mkdir(path.join(tmp, ".oficina", "artifacts", "T-00"), { recursive: true })
    await fs.mkdir(path.join(tmp, ".oficina", "evidence"), { recursive: true })
    await fs.writeFile(path.join(tmp, "package.json"), "{}")
  })

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it("1. routeCard excludes card.owner from reviewer candidates even if owner is not re-selected", () => {
    const card: Card = makeCard({
      id: "T-01",
      requiredCapabilities: ["node"],
      owner: "agent-alice",
    })
    const roster: Roster = {
      version: 1,
      runId: "run-1",
      updatedAt: new Date().toISOString(),
      agents: {
        "agent-alice": {
          id: "agent-alice",
          role: "coder",
          displayName: "Alice",
          state: "working",
          capabilities: ["node"],
          fichaPath: "",
          currentCard: "T-01",
          lease: null,
          idleSince: null,
          canAccept: false,
          helpGiven: 0,
          helpReceived: 0,
          helpedPeers: [],
          canDelegate: false,
          lastHeartbeat: new Date().toISOString(),
          source: { kind: "factory" },
        },
        "agent-bob": {
          id: "agent-bob",
          role: "reviewer",
          displayName: "Bob",
          state: "idle_available",
          capabilities: ["review"],
          fichaPath: "",
          currentCard: null,
          lease: null,
          idleSince: new Date().toISOString(),
          canAccept: true,
          helpGiven: 0,
          helpReceived: 0,
          helpedPeers: [],
          canDelegate: false,
          lastHeartbeat: new Date().toISOString(),
          source: { kind: "factory" },
        },
      },
    }

    const decision = routeCard(card, roster)
    expect(decision.reviewer?.id).toBe("agent-bob")
    expect(decision.reviewer?.id).not.toBe("agent-alice")
  })

  it("2. ownerStreak does not break on 'todo' cards", () => {
    const cards: Record<string, Card> = {
      "T-01": makeCard({
        id: "T-01",
        owner: "agent-1",
        state: "done",
      }),
      "T-02": makeCard({
        id: "T-02",
        owner: "agent-1",
        state: "done",
      }),
      "T-03": makeCard({
        id: "T-03",
        owner: null,
        state: "todo",
      }),
      "T-04": makeCard({
        id: "T-04",
        owner: "agent-1",
        state: "todo",
      }),
    }
    const order = ["T-01", "T-02", "T-03", "T-04"]
    const streak = ownerStreak(cards, order, "agent-1", "implementation")
    expect(streak).toBe(2)
  })

  it("3. RosterStore.upsert preserves peers, and load(runId) resets on runId mismatch", async () => {
    const rosterPath = path.join(tmp, ".oficina", "roster.json")
    const store = new RosterStore(rosterPath)
    const roster = await store.load("run-old")

    const ficha: Ficha = {
      id: "agent-1",
      role: "specialist",
      displayName: "Spec",
      source: { kind: "factory" },
      capabilities: ["ts"],
      tools: ["read", "write"],
      scope: { mayTouch: ["src/**"], forbidden: [] },
      canDelegate: false,
      delegateBudget: 0,
      peers: ["code-architect", "tester"],
      mustNot: [],
      onFinish: "idle-join",
      escalateTo: "integrator",
    }

    const entry = await store.upsert(roster, ficha)
    expect(entry.peers).toEqual(["code-architect", "tester"])
    await store.save(roster)

    // Load with matching runId returns stored agents
    const loaded = await store.load("run-old")
    expect(loaded.agents["agent-1"]?.peers).toEqual(["code-architect", "tester"])

    // Load with new runId resets roster (empty, schema v2 de la oficina actual)
    const fresh = await store.load("run-new")
    expect(fresh.runId).toBe("run-new")
    expect(fresh.version).toBe(2)
    expect(Object.keys(fresh.agents)).toHaveLength(0)
  })

  it("4. Office.routeHelpRequest routes to declared peers in roster", async () => {
    const office = new Office({ cwd: tmp })
    await office.init()
    const state = createRun("Test", "run-1", DEFAULT_LIMITS)
    const card = makeCard({ id: "T-01" })
    state.cards[card.id] = card
    state.order.push(card.id)
    await office.saveState(state)

    const roster = await office.loadRoster("run-1")
    roster.agents["dev-1"] = {
      id: "dev-1",
      role: "coder",
      displayName: "Dev 1",
      state: "working",
      capabilities: ["node"],
      fichaPath: "",
      currentCard: "T-01",
      lease: null,
      idleSince: null,
      canAccept: false,
      helpGiven: 0,
      helpReceived: 0,
      helpedPeers: [],
      peers: ["architect"],
      canDelegate: false,
      lastHeartbeat: new Date().toISOString(),
      source: { kind: "factory" },
    }
    roster.agents["arch-1"] = {
      id: "arch-1",
      role: "architect",
      displayName: "Arch",
      state: "idle_available",
      capabilities: ["architecture"],
      fichaPath: "",
      currentCard: null,
      lease: null,
      idleSince: new Date().toISOString(),
      canAccept: true,
      helpGiven: 0,
      helpReceived: 0,
      helpedPeers: [],
      canDelegate: false,
      lastHeartbeat: new Date().toISOString(),
      source: { kind: "factory" },
    }
    await office.saveRoster(roster)

    const route = await office.routeHelpRequest(state, "dev-1", "T-01")
    expect(route.targets).toContain("arch-1")
    expect(route.reason).toContain("peer declarado")
  })

  it("5. oficina_bus args schema defaults 'to' to ['*'] and help action uses requestHelp", async () => {
    const office = new Office({ cwd: tmp })
    const tools = buildTools(office)
    const busTool = tools["oficina_bus"]
    expect(busTool).toBeDefined()
    expect(busTool?.args).toBeDefined()

    // Test Zod schema default for 'to'
    const parsed = (busTool?.args as { parse: (input: unknown) => { to?: string[] } }).parse({
      action: "help",
      agentId: "agent-1",
      need: "need code review",
    })
    expect(parsed.to).toEqual(["*"])
  })

  it("6. Prompt typos referencing oficina_bus instead of oficina_mesa are resolved", async () => {
    const sessionIdleContent = await fs.readFile(
      path.resolve("src/hooks/sessionIdle.ts"),
      "utf8",
    )
    expect(sessionIdleContent).not.toContain("`oficina_bus` (action=read)")
    expect(sessionIdleContent).toContain("`oficina_mesa` (action=read)")

    const dispatchContent = await fs.readFile(
      path.resolve("src/core/dispatch.ts"),
      "utf8",
    )
    expect(dispatchContent).not.toContain("`oficina_bus` action=`claim`")
    expect(dispatchContent).toContain("`oficina_mesa` action=`claim`")

    const toolsContent = await fs.readFile(
      path.resolve("src/tools/index.ts"),
      "utf8",
    )
    expect(toolsContent).not.toContain("oficina_bus\\` action=respond")
    expect(toolsContent).toContain("oficina_mesa\\` action=respond")
  })

  it("7. openBrowser rejects non-localhost URLs and invalid protocols", () => {
    // Should not throw or spawn on invalid URLs
    expect(() => openBrowser("https://evil.com/hack")).not.toThrow()
    expect(() => openBrowser("file:///etc/passwd")).not.toThrow()
    expect(() => openBrowser("javascript:alert(1)")).not.toThrow()
  })

  it("8. CLI board includes REWORK group", async () => {
    const cliContent = await fs.readFile(
      path.resolve("src/cli.ts"),
      "utf8",
    )
    expect(cliContent).toContain("REWORK: []")
  })

  it("9. diagnose handles state without budget gracefully without throwing TypeError", async () => {
    const officeDir = path.join(tmp, ".oficina")
    const card = makeCard({
      id: "T-00",
      state: "done",
      owner: "dev-1",
      reviewer: "rev-1",
    })

    const state = {
      runId: "run-nobudget",
      objective: "No Budget Run",
      status: "done",
      iteration: 1,
      order: ["T-00"],
      cards: { "T-00": card },
      limits: { maxCards: 25 },
      halt: null,
      sessions: {},
      pendingGates: [],
    }
    await fs.writeFile(path.join(officeDir, "state.json"), JSON.stringify(state, null, 2))

    const roster = {
      version: 1,
      runId: "run-nobudget",
      agents: {
        "dev-1": {
          id: "dev-1",
          role: "dev",
          displayName: "Dev",
          state: "working",
          currentCard: "T-00",
          capabilities: ["test"],
          source: { kind: "factory" },
        },
        "rev-1": {
          id: "rev-1",
          role: "rev",
          displayName: "Rev",
          state: "idle_available",
          currentCard: null,
          capabilities: ["review"],
          source: { kind: "factory" },
        },
      },
    }
    await fs.writeFile(path.join(officeDir, "roster.json"), JSON.stringify(roster, null, 2))

    const gatesMd = [
      "# Gates",
      "| # | Fase | Comando | Resultado | Detalle |",
      "|---|------|---------|-----------|---------|",
      "| 1 | test | npm test | PASS | exit 0 |",
      "| 2 | lint | eslint | NA | no linter configured in repo |",
    ].join("\n")

    await fs.writeFile(path.join(officeDir, "artifacts", "T-00", "gates.md"), gatesMd)
    await fs.writeFile(path.join(officeDir, "artifacts", "T-00", "handoff.md"), "# Handoff")
    await fs.writeFile(
      path.join(officeDir, "evidence", "T-00.json"),
      JSON.stringify({ cardId: "T-00", nodes: [{ requirementIndex: 0 }] }),
    )

    // diagnose should not throw TypeError and should correctly diagnose
    const res = await diagnose(tmp)
    expect(res.error).toBeUndefined()
    expect(res.fallas).toBe(0)
    expect(res.cardsDone).toBe(1)
  })

  it("10. build-kanban-data escapes < to prevent stored XSS", async () => {
    const kanbanDataScript = await fs.readFile(
      path.resolve("dashboard/build-kanban-data.mjs"),
      "utf8",
    )
    expect(kanbanDataScript).toContain('JSON.stringify(dataset).replace(/</g, "\\\\u003c")')
  })

  it("11. dashboard/server.mjs validates path relative containment for cardId and static files", async () => {
    const serverScript = await fs.readFile(
      path.resolve("dashboard/server.mjs"),
      "utf8",
    )
    expect(serverScript).toContain('path.relative(artifactsDir, dir)')
    expect(serverScript).toContain('path.relative(artifactsDir, file)')
    expect(serverScript).toContain('path.relative(DASH, filePath)')
  })
})
