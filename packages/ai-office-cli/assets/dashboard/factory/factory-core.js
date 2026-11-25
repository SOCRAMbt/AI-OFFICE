/**
 * Factory core — pure, DOM-free logic for the "Factory creando agentes" panel.
 *
 * Loaded as a CLASSIC script (no import/export) so dashboard/factory.html keeps
 * working from file:// where ES module imports are blocked by CORS. The module
 * publishes its API on globalThis.FactoryCore, which is also how Node tests
 * consume it:
 *
 *   import "../factory/factory-core.js"   // side effect: globalThis.FactoryCore
 *   const { detectFactoryNeed } = globalThis.FactoryCore
 *
 * Contract (v1):
 *   parseCards(state)                        -> Card[]
 *   parseAgents(roster)                      -> Agent[]
 *   normalizeCapability(string)              -> string
 *   computeCoverage(card, agents)            -> Coverage
 *   detectFactoryNeed(state, roster, opts)   -> FactoryNeed
 *   synthesizeAgent(card, agents, opts)      -> FabricatedAgent
 *   renderFichaMarkdown(agent, card)         -> string
 *   renderFichaLines(agent, card)            -> string[]
 *   registerAgent(roster, agent)             -> Roster   (immutable)
 *   projectMatch(state, roster, opts)        -> MatchProjection
 *
 * All functions are side-effect free. Nothing here writes .oficina/ — the
 * dashboard is read-only; registration is a *projection* for the animation.
 */
;(function factoryCore(root) {
  "use strict"

const COVERAGE_THRESHOLD = 0.6

/** Card states that still demand catalog coverage. */
const OPEN_CARD_STATES = [
  "todo",
  "in_progress",
  "review",
  "rework",
  "blocked",
  "escalated",
]

const TERMINAL_CARD_STATES = ["done", "cancelled"]

/**
 * Normalize a capability token so "SVG-Canvas", "svg_canvas" and "svgcanvas"
 * compare equal. Keeps a-z0-9 only.
 */
function normalizeCapability(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function str(value, fallback = "") {
  return typeof value === "string" ? value : fallback
}

/**
 * state.json stores `cards` as an object keyed by id (v3), older snapshots as
 * an array. Accept both, plus `order` for stable sequencing.
 */
function parseCards(state) {
  const raw = state && typeof state === "object" ? state.cards : null
  const order = asArray(state && state.order)
  const entries = Array.isArray(raw)
    ? raw.map((card) => [str(card && card.id), card])
    : raw && typeof raw === "object"
      ? Object.entries(raw)
      : []

  const byId = new Map(entries)
  const ids = []
  for (const id of order) {
    if (byId.has(id) && !ids.includes(id)) ids.push(id)
  }
  for (const id of byId.keys()) {
    if (!ids.includes(id)) ids.push(id)
  }

  return ids.map((id) => {
    const card = byId.get(id) || {}
    return {
      id: str(card.id, id),
      title: str(card.title, id),
      type: str(card.type, "implementation"),
      state: str(card.state || card.status, "todo").toLowerCase(),
      owner: card.owner ? str(card.owner) : null,
      reviewer: card.reviewer ? str(card.reviewer) : null,
      requiredCapabilities: asArray(card.requiredCapabilities).map((c) => str(c)),
      gate: str(card.gate),
      dependsOn: asArray(card.dependsOn).map((d) => str(d)),
      rejections: Number.isFinite(card.rejections) ? card.rejections : 0,
      isOpen: !TERMINAL_CARD_STATES.includes(
        str(card.state || card.status, "todo").toLowerCase(),
      ),
      raw: card,
    }
  })
}

/**
 * roster.json v2 stores `agents` as an object keyed by id. Tolerate arrays.
 */
function parseAgents(roster) {
  const raw = roster && typeof roster === "object" ? roster.agents : null
  const entries = Array.isArray(raw)
    ? raw.map((agent) => [str(agent && agent.id), agent])
    : raw && typeof raw === "object"
      ? Object.entries(raw)
      : []

  return entries.map(([id, agent]) => ({
    id: str(agent && agent.id, id),
    role: str(agent && agent.role, id),
    displayName: str(
      agent && (agent.displayName || agent.name),
      str(agent && agent.role, id),
    ),
    state: str(agent && agent.state, "idle_available"),
    capabilities: asArray(agent && agent.capabilities).map((c) => str(c)),
    capabilityKeys: asArray(agent && agent.capabilities).map(normalizeCapability),
    fichaPath: str(agent && agent.fichaPath),
    currentCard: agent && agent.currentCard ? str(agent.currentCard) : null,
    source: (agent && agent.source) || null,
    raw: agent,
  }))
}

/** Union of every capability the roster can currently provide. */
function catalogKeys(agents) {
  const keys = new Set()
  for (const agent of agents) {
    for (const key of agent.capabilityKeys || []) keys.add(key)
  }
  return keys
}

/**
 * @returns {{required:string[], matched:string[], missing:string[],
 *            ratio:number, pct:number, covered:boolean}}
 */
function computeCoverage(card, agents, threshold = COVERAGE_THRESHOLD) {
  const required = asArray(card && card.requiredCapabilities).map((c) => str(c))
  if (required.length === 0) {
    return {
      required: [],
      matched: [],
      missing: [],
      ratio: 1,
      pct: 100,
      covered: true,
    }
  }
  const keys = catalogKeys(agents)
  const matched = []
  const missing = []
  for (const capability of required) {
    if (keys.has(normalizeCapability(capability))) matched.push(capability)
    else missing.push(capability)
  }
  const ratio = matched.length / required.length
  return {
    required,
    matched,
    missing,
    ratio,
    pct: Math.round(ratio * 100),
    covered: ratio >= threshold,
  }
}

/** Percent of roster capabilities that the card actually uses. */
function bestAgentFor(card, agents) {
  const required = new Set(
    asArray(card && card.requiredCapabilities).map(normalizeCapability),
  )
  let best = null
  for (const agent of agents) {
    let hits = 0
    for (const key of agent.capabilityKeys || []) {
      if (required.has(key)) hits += 1
    }
    if (!best || hits > best.hits) best = { agent, hits }
  }
  return best
}

/**
 * The detection criterion of T-08: a card whose required capabilities cannot
 * be covered by >= threshold of the roster (and that nobody is actually
 * building with a matched ficha) is a factory gap.
 */
function detectFactoryNeed(state, roster, options = {}) {
  const threshold = Number.isFinite(options.threshold)
    ? options.threshold
    : COVERAGE_THRESHOLD
  const cards = parseCards(state)
  const agents = parseAgents(roster)

  const gaps = []
  for (const card of cards) {
    if (!card.isOpen) continue
    const coverage = computeCoverage(card, agents, threshold)
    if (coverage.covered) continue
    const best = bestAgentFor(card, agents)
    // An owner whose ficha still fails the threshold is the "sin match" case
    // too: the assignment exists on paper but the catalog cannot back it.
    const ownerAgent = card.owner
      ? agents.find((agent) => agent.id === card.owner)
      : null
    gaps.push({
      cardId: card.id,
      title: card.title,
      type: card.type,
      state: card.state,
      owner: card.owner,
      ownerKnown: Boolean(ownerAgent),
      coverage: coverage.ratio,
      pct: coverage.pct,
      required: coverage.required,
      matched: coverage.matched,
      missing: coverage.missing,
      bestAgentId: best && best.agent ? best.agent.id : null,
      bestHits: best ? best.hits : 0,
    })
  }

  const overall = cards.length
    ? Math.round(
        (cards.reduce(
          (sum, card) =>
            sum + computeCoverage(card, agents, threshold).ratio,
          0,
        ) /
          cards.length) *
          100,
      ) /
        100
    : 1

  return {
    needs: gaps.length > 0,
    threshold,
    thresholdPct: Math.round(threshold * 100),
    cardCount: cards.length,
    agentCount: agents.length,
    overallCoverage: overall,
    overallPct: Math.round(overall * 100),
    gaps: gaps.sort((a, b) => a.coverage - b.coverage),
    cards,
    agents,
  }
}

const ROLE_BY_CAPABILITY = [
  {
    match: ["animation", "motion", "gsap", "transitions", "svgcanvas", "webgl"],
    role: "frontend-motion-engineer",
    displayName: "Frontend Motion Engineer",
    defaults: ["animation", "css", "svg", "accessibility"],
  },
  {
    match: ["kanban", "dragdrop", "dnd", "interaction"],
    role: "interaction-engineer",
    displayName: "Interaction Engineer",
    defaults: ["interaction", "dom", "accessibility", "animation"],
  },
  {
    match: ["realtime", "realtimeui", "polling", "websocket"],
    role: "realtime-ui-engineer",
    displayName: "Realtime UI Engineer",
    defaults: ["realtime", "polling", "javascript", "performance"],
  },
  {
    match: ["datavisualization", "dataviz", "chart", "charts", "visualization"],
    role: "dataviz-engineer",
    displayName: "Data Visualization Engineer",
    defaults: ["dataviz", "svg", "accessibility", "typescript"],
  },
  {
    match: ["chatui", "threading", "conversation"],
    role: "conversation-ui-engineer",
    displayName: "Conversation UI Engineer",
    defaults: ["chat", "threading", "accessibility", "aria"],
  },
  {
    match: ["decisiontracking", "decisions", "governance"],
    role: "decision-systems-analyst",
    displayName: "Decision Systems Analyst",
    defaults: ["documentation", "analysis", "traceability"],
  },
  {
    match: ["testing", "qa", "vitest", "playwright", "coverage"],
    role: "qa-automation-engineer",
    displayName: "QA Automation Engineer",
    defaults: ["testing", "vitest", "coverage", "automation"],
  },
  {
    match: ["frontend", "html", "css", "ui", "ux"],
    role: "frontend-ui-engineer",
    displayName: "Frontend UI Engineer",
    defaults: ["frontend", "css", "accessibility", "javascript"],
  },
  {
    match: ["typescript", "node", "filesystem", "backend"],
    role: "node-systems-engineer",
    displayName: "Node Systems Engineer",
    defaults: ["typescript", "node", "filesystem", "testing"],
  },
]

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
}

function titleCase(role) {
  return role
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

/** Deterministic: same card + same roster => same fabricated agent. */
function synthesizeAgent(card, agents, options = {}) {
  const required = asArray(card && card.requiredCapabilities).map((c) => str(c))
  const keys = required.map(normalizeCapability)
  const candidates = []
  for (const group of ROLE_BY_CAPABILITY) {
    let score = 0
    for (const needle of group.match) {
      if (keys.some((key) => key === needle || key.includes(needle))) score += 1
    }
    if (score > 0) candidates.push({ score, group })
  }
  candidates.sort((a, b) => b.score - a.score)
  const picked = candidates[0]?.group

  const cardType = slugify(card && card.type) || "implementation"
  const role = picked ? picked.role : `${cardType}-specialist`
  const displayName = picked
    ? picked.displayName
    : `${titleCase(cardType)} Specialist`

  const existing = new Set(asArray(agents).map((agent) => agent.id))
  const base = `e-factory-${role}`
  let id = base
  let n = 2
  while (existing.has(id)) {
    id = `${base}-${n}`
    n += 1
  }

  const capabilities = []
  for (const capability of required) {
    if (!capabilities.includes(capability)) capabilities.push(capability)
  }
  if (picked) {
    for (const capability of picked.defaults) {
      if (!capabilities.includes(capability)) capabilities.push(capability)
    }
  }

  const gapCardId = card && card.id ? str(card.id) : "unknown-card"
  return {
    id,
    role,
    slug: role,
    displayName,
    capabilities,
    fichaPath: `.opencode/agents/oficina-${role}.md`,
    status: "fabricated",
    fabricatedFor: gapCardId,
    fabricatedAt: options.now ? str(options.now) : new Date().toISOString(),
    rationale: picked
      ? `Cobertura insuficiente para ${gapCardId}: el roster no cubre ${asArray(card && card.requiredCapabilities).join(", ") || "los requisitos"}. Se sintetiza ${displayName} con las capabilities faltantes.`
      : `Cobertura insuficiente para ${gapCardId}: no hay rol de catálogo que matchee; se crea ${displayName}.`,
  }
}

/** Markdown of the ficha that the animation "types" into .opencode/agents/. */
function renderFichaMarkdown(agent, card) {
  const capabilities = asArray(agent && agent.capabilities).join(", ")
  const target = card && card.id ? `${card.id} — ${card.title || ""}`.trim() : "card pendiente"
  return [
    "---",
    `description: ${agent.description || `Rol fabricado para ${target}`}`,
    "mode: subagent",
    `capabilities: ${asArray(agent && agent.capabilities).slice(0, 6).join(", ")}`,
    "---",
    "",
    `# ${agent.displayName}`,
    "",
    `Rol: \`${agent.role}\``,
    `Origen: factory · ${agent.fabricatedFor || "sin card"}`,
    "",
    "## Quién sos",
    `Sos ${agent.displayName}, sintetizado por la Factory para cerrar un hueco de cobertura del catálogo.`,
    "",
    "## Tu misión",
    `Cubrir los criterios de aceptación de ${target} sin tocar fuera de su scope.`,
    "",
    "## Capabilities",
    capabilities || "ninguna",
    "",
    "## Cómo trabajás",
    "1. Leé el briefing de la card.",
    "2. Verificá los archivos que podés tocar.",
    "3. Implementá, medí y dejá evidencia.",
    "",
    "## Qué no podés hacer",
    "- Declarar terminado sin evidence.md.",
    "- Aprobar tu propio trabajo.",
    "",
  ].join("\n")
}

function renderFichaLines(agent, card) {
  return renderFichaMarkdown(agent, card).split("\n")
}

/** Immutable roster registration (animation projection, not a disk write). */
function registerAgent(roster, agent, options = {}) {
  const copy =
    roster && typeof roster === "object"
      ? { ...roster, agents: { ...(roster.agents || {}) } }
      : { version: 2, agents: {} }
  copy.agents[agent.id] = {
    id: agent.id,
    role: agent.role,
    displayName: agent.displayName,
    state: "idle_available",
    capabilities: [...asArray(agent.capabilities)],
    fichaPath: agent.fichaPath,
    currentCard: null,
    lease: null,
    idleSince: options.now || agent.fabricatedAt,
    canAccept: true,
    helpGiven: 0,
    helpReceived: 0,
    helpedPeers: [],
    lastHeartbeat: options.now || agent.fabricatedAt,
    source: {
      kind: "factory",
      fabricatedFor: agent.fabricatedFor,
      at: options.now || agent.fabricatedAt,
      cardTitle: options.cardTitle || null,
    },
  }
  return copy
}

/**
 * What changes after registration:
 *  - the triggering card's coverage goes up,
 *  - the *next* open card flips to covered (that's the "match en próxima card"),
 *  - previously impossible cards become routable.
 */
function projectMatch(state, roster, options = {}) {
  const threshold = Number.isFinite(options.threshold)
    ? options.threshold
    : COVERAGE_THRESHOLD
  const cards = parseCards(state)
  const agents = parseAgents(roster)
  const before = new Map()
  for (const card of cards) {
    before.set(card.id, computeCoverage(card, agents, threshold))
  }

  const fabricated = options.fabricated || null
  const afterAgents = fabricated
    ? parseAgents(registerAgent(roster, fabricated))
    : agents

  const rows = cards.map((card) => {
    const prev = before.get(card.id)
    const next = computeCoverage(card, afterAgents, threshold)
    return {
      cardId: card.id,
      title: card.title,
      state: card.state,
      before: prev,
      after: next,
      flipped: !prev.covered && next.covered,
      improved: next.ratio > prev.ratio,
      owner: card.owner,
    }
  })

  const flipped = rows.filter((row) => row.flipped)
  const ordered = []
  for (const id of asArray(state && state.order)) {
    const row = rows.find((r) => r.cardId === id)
    if (row) ordered.push(row)
  }
  for (const row of rows) {
    if (!ordered.includes(row)) ordered.push(row)
  }

  return {
    threshold,
    rows: ordered,
    flipped,
    nextMatch:
      flipped.find((row) => row.cardId !== (fabricated && fabricated.fabricatedFor)) ||
      flipped[0] ||
      null,
  }
}

  const api = {
    COVERAGE_THRESHOLD,
    OPEN_CARD_STATES,
    normalizeCapability,
    parseCards,
    parseAgents,
    catalogKeys,
    computeCoverage,
    bestAgentFor,
    detectFactoryNeed,
    synthesizeAgent,
    renderFichaMarkdown,
    renderFichaLines,
    registerAgent,
    projectMatch,
  }

  root.FactoryCore = api
})(typeof globalThis !== "undefined" ? globalThis : window)
