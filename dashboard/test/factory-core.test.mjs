import test from "node:test"
import assert from "node:assert/strict"

// The core is a classic script (works from file://); importing it for its side
// effect publishes globalThis.FactoryCore.
import "../factory/factory-core.js"

const {
  COVERAGE_THRESHOLD,
  normalizeCapability,
  parseCards,
  parseAgents,
  computeCoverage,
  detectFactoryNeed,
  synthesizeAgent,
  registerAgent,
  projectMatch,
  renderFichaMarkdown,
  renderFichaLines,
} = globalThis.FactoryCore

test("el core publica su API en globalThis.FactoryCore", () => {
  assert.equal(typeof globalThis.FactoryCore, "object")
  assert.equal(typeof globalThis.FactoryCore.detectFactoryNeed, "function")
  assert.equal(COVERAGE_THRESHOLD, 0.6)
})

const roster = {
  version: 2,
  agents: {
    "e-a": {
      id: "e-a",
      role: "api-tester",
      displayName: "API Tester",
      state: "idle_available",
      capabilities: ["api", "testing", "node", "typescript"],
      fichaPath: ".opencode/agents/oficina-api-tester.md",
    },
  },
}

const state = {
  version: 3,
  order: ["T-01", "T-02", "T-03"],
  cards: {
    "T-01": {
      id: "T-01",
      title: "API endpoints",
      type: "implementation",
      state: "todo",
      owner: null,
      requiredCapabilities: ["api", "testing"],
    },
    "T-02": {
      id: "T-02",
      title: "Animar la factory",
      type: "implementation",
      state: "in_progress",
      owner: "e-a",
      requiredCapabilities: ["animation", "svg-canvas", "frontend"],
    },
    "T-03": {
      id: "T-03",
      title: "Kanban con drag-drop",
      type: "implementation",
      state: "todo",
      owner: null,
      requiredCapabilities: ["kanban", "drag-drop"],
    },
  },
}

test("normalizeCapability ignora acentos, mayúsculas y separadores", () => {
  assert.equal(normalizeCapability("SVG-Canvas"), "svgcanvas")
  assert.equal(normalizeCapability("frontend_architecture"), "frontendarchitecture")
  assert.equal(normalizeCapability("Animación"), "animacion")
  assert.equal(normalizeCapability(undefined), "")
})

test("parseCards acepta objeto indexado y respeta order", () => {
  const cards = parseCards(state)
  assert.deepEqual(
    cards.map((c) => c.id),
    ["T-01", "T-02", "T-03"],
  )
  assert.equal(cards[0].isOpen, true)
  assert.equal(cards[1].owner, "e-a")
})

test("parseCards acepta el formato array de snapshots viejos", () => {
  const cards = parseCards({ cards: [state.cards["T-02"]] })
  assert.equal(cards.length, 1)
  assert.equal(cards[0].id, "T-02")
})

test("parseAgents normaliza capabilities y fichaPath", () => {
  const agents = parseAgents(roster)
  assert.equal(agents.length, 1)
  assert.ok(agents[0].capabilityKeys.includes("api"))
  assert.match(agents[0].fichaPath, /oficina-api-tester\.md$/)
})

test("computeCoverage cuenta matches reales del catálogo", () => {
  const agents = parseAgents(roster)
  const card = parseCards(state)[1]
  const coverage = computeCoverage(card, agents)
  assert.equal(coverage.required.length, 3)
  assert.deepEqual(coverage.matched, [])
  assert.deepEqual(coverage.missing, ["animation", "svg-canvas", "frontend"])
  assert.equal(coverage.pct, 0)
  assert.equal(coverage.covered, false)
})

test("computeCoverage sin requisitos está cubierta por definición", () => {
  const coverage = computeCoverage({ requiredCapabilities: [] }, [])
  assert.equal(coverage.covered, true)
  assert.equal(coverage.pct, 100)
})

test("detectFactoryNeed marca las cards bajo el umbral 60%", () => {
  const need = detectFactoryNeed(state, roster)
  assert.equal(need.needs, true)
  assert.equal(need.threshold, COVERAGE_THRESHOLD)
  assert.deepEqual(
    need.gaps.map((g) => g.cardId).sort(),
    ["T-02", "T-03"],
  )
  const t02 = need.gaps.find((g) => g.cardId === "T-02")
  assert.equal(t02.pct, 0)
  assert.deepEqual(t02.missing, ["animation", "svg-canvas", "frontend"])
  // T-02 tiene owner, pero la ficha no respalda el requisito: sigue siendo gap
  assert.equal(t02.owner, "e-a")
  assert.equal(t02.ownerKnown, true)
})

test("detectFactoryNeed no dispara cuando la cobertura alcanza", () => {
  const wide = {
    version: 2,
    agents: {
      ...roster.agents,
      "e-b": {
        id: "e-b",
        role: "motion",
        displayName: "Motion",
        capabilities: ["animation", "svg-canvas", "frontend"],
      },
    },
  }
  const need = detectFactoryNeed(state, wide)
  assert.equal(need.needs, true) // T-03 sigue sin cobertura
  assert.deepEqual(need.gaps.map((g) => g.cardId), ["T-03"])
  assert.equal(
    need.gaps.some((g) => g.cardId === "T-02"),
    false,
  )
})

test("detectFactoryNeed ignora cards done", () => {
  const closed = {
    ...state,
    cards: {
      ...state.cards,
      "T-03": { ...state.cards["T-03"], state: "done" },
      "T-02": { ...state.cards["T-02"], state: "done" },
    },
  }
  const need = detectFactoryNeed(closed, roster)
  assert.equal(need.needs, false)
  assert.deepEqual(need.gaps, [])
})

test("synthesizeAgent es determinístico y elige el rol de motion", () => {
  const agents = parseAgents(roster)
  const card = parseCards(state)[1]
  const a = synthesizeAgent(card, agents, { now: "2026-10-29T00:00:00.000Z" })
  const b = synthesizeAgent(card, agents, { now: "2026-10-29T00:00:00.000Z" })
  assert.deepEqual(a, b)
  assert.equal(a.role, "frontend-motion-engineer")
  assert.equal(a.displayName, "Frontend Motion Engineer")
  assert.equal(a.fichaPath, ".opencode/agents/oficina-frontend-motion-engineer.md")
  assert.equal(a.fabricatedFor, "T-02")
  for (const cap of ["animation", "svg-canvas", "frontend"]) {
    assert.ok(a.capabilities.includes(cap), `falta ${cap}`)
  }
})

test("synthesizeAgent genera ids únicos contra el roster existente", () => {
  const agents = parseAgents(roster)
  const card = parseCards(state)[1]
  const first = synthesizeAgent(card, agents)
  const second = synthesizeAgent(card, [...agents, { ...agents[0], id: first.id }])
  assert.notEqual(first.id, second.id)
  assert.equal(second.id, `${first.id}-2`)
})

test("synthesizeAgent cae a un rol por tipo de card sin match", () => {
  const card = { id: "T-99", type: "bugfix", requiredCapabilities: ["telepatia"] }
  const agent = synthesizeAgent(card, [])
  assert.equal(agent.role, "bugfix-specialist")
  assert.ok(agent.capabilities.includes("telepatia"))
})

test("registerAgent no muta el roster original", () => {
  const agents = parseAgents(roster)
  const agent = synthesizeAgent(parseCards(state)[1], agents, {
    now: "2026-10-29T00:00:00.000Z",
  })
  const next = registerAgent(roster, agent)
  assert.equal(Object.keys(roster.agents).length, 1)
  assert.equal(Object.keys(next.agents).length, 2)
  assert.equal(next.agents[agent.id].state, "idle_available")
  assert.equal(next.agents[agent.id].source.kind, "factory")
})

test("projectMatch muestra el antes/después y el match de la próxima card", () => {
  const agents = parseAgents(roster)
  const agent = synthesizeAgent(parseCards(state)[1], agents, {
    now: "2026-10-29T00:00:00.000Z",
  })
  const projection = projectMatch(state, roster, { fabricated: agent })

  const t02 = projection.rows.find((r) => r.cardId === "T-02")
  assert.equal(t02.before.covered, false)
  assert.equal(t02.after.covered, true)
  assert.equal(t02.after.pct, 100)

  const t01 = projection.rows.find((r) => r.cardId === "T-01")
  assert.equal(t01.before.covered, true)
  assert.equal(t01.after.covered, true)
  assert.equal(t01.flipped, false)

  assert.ok(projection.flipped.length >= 1)
})

test("renderFichaMarkdown produce frontmatter y secciones obligatorias", () => {
  const agent = synthesizeAgent(parseCards(state)[1], parseAgents(roster))
  const md = renderFichaMarkdown(agent, parseCards(state)[1])
  assert.ok(md.startsWith("---\n"))
  assert.match(md, /mode: subagent/)
  assert.ok(md.includes("# Frontend Motion Engineer"))
  assert.ok(md.includes("T-02"))
  assert.ok(md.includes("evidence.md"))
  assert.ok(renderFichaLines(agent, parseCards(state)[1]).length > 10)
})
