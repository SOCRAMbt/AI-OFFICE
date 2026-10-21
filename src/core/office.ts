/**
 * Office: la fachada que amarra los módulos.
 *
 * Es el único objeto que las tools y los hooks tocan. Encapsula paths, bus,
 * roster, leases, state, catálogo y límites. Si algo necesita tocar dos
 * módulos a la vez, pasa por acá.
 */

import path from "node:path"
import fs from "node:fs/promises"
import type {
  Card,
  CardState,
  CardType,
  CatalogAgent,
  Ficha,
  GateResult,
  Limits,
  OfficeState,
  Roster,
  RosterEntry,
} from "./types.js"
import { DEFAULT_LIMITS } from "./types.js"
import { Bus, CHANNELS } from "./bus.js"
import { RosterStore } from "./roster.js"
import { LeaseStore } from "./leases.js"
import { createRun, transitionCard, transitionRun, assertInvariants, selectNextCard, migrateState } from "./state.js"
import { createFicha, CandidateRegistry } from "./factory.js"
import { scanCatalog, resolveRole } from "./catalog.js"
import { routeCard, routeHelp, ownerStreak, type RouteResult } from "./router.js"
import { decideRetry, recordRejection, recordApproval, consumeAgentCall } from "./retry.js"
import { detectTooling, runTechnicalGates, runSecurityGate, consolidate, type CommandRunner, type Tooling } from "./gates.js"
import { ensureDir, exists, nowIso, readJson, shortId, writeJsonAtomic, writeAtomic } from "./fsx.js"
import { cardDir, resolvePaths, type ResolvedPaths } from "./paths.js"
import { logger } from "./log.js"

const log = logger("oficina")

export interface OfficeOptions {
  cwd: string
  limits?: Limits
  /** Raíz del repo agency-agents para el catálogo. */
  agencyRoot?: string
  /** Runner de comandos para los gates. Inyectable para tests. */
  runner?: CommandRunner
  clock?: () => number
}

export class Office {
  readonly paths: ResolvedPaths
  readonly limits: Limits
  readonly bus: Bus
  readonly rosterStore: RosterStore
  readonly leases: LeaseStore
  readonly candidates = new CandidateRegistry()

  private catalogCache: CatalogAgent[] | null = null
  private toolingCache: Tooling | null = null

  constructor(private readonly options: OfficeOptions) {
    this.limits = options.limits ?? DEFAULT_LIMITS
    // `resolvePaths` es async; se resuelve en `init()`.
    this.paths = {
      projectRoot: path.resolve(options.cwd),
      officeDir: path.join(path.resolve(options.cwd), ".oficina"),
      busDir: path.join(path.resolve(options.cwd), ".oficina", "bus"),
      inboxDir: path.join(path.resolve(options.cwd), ".oficina", "inbox"),
      leasesDir: path.join(path.resolve(options.cwd), ".oficina", "leases"),
      artifactsDir: path.join(path.resolve(options.cwd), ".oficina", "artifacts"),
      fichasDir: path.join(path.resolve(options.cwd), ".oficina", "fichas"),
      rosterPath: path.join(path.resolve(options.cwd), ".oficina", "roster.json"),
      statePath: path.join(path.resolve(options.cwd), ".oficina", "state.json"),
      contextPath: path.join(path.resolve(options.cwd), ".oficina", "context.md"),
      boardPath: path.join(path.resolve(options.cwd), ".oficina", "board.md"),
      configPath: path.join(path.resolve(options.cwd), ".oficina", "config.json"),
      fallback: false,
    }
    this.bus = new Bus(this.paths, { ttlSec: this.limits.msgTtlSec, clock: options.clock })
    this.rosterStore = new RosterStore(this.paths.rosterPath, options.clock)
    this.leases = new LeaseStore(this.paths.leasesDir, this.limits, options.clock)
  }

  /** Resuelve paths reales y crea la estructura. */
  async init(): Promise<void> {
    const resolved = await resolvePaths(this.options.cwd)
    Object.assign(this.paths, resolved)
    // Re-armar bus y stores con los paths definitivos.
    ;(this as { bus: Bus }).bus = new Bus(this.paths, {
      ttlSec: this.limits.msgTtlSec,
      clock: this.options.clock,
    })
    ;(this as { rosterStore: RosterStore }).rosterStore = new RosterStore(
      this.paths.rosterPath,
      this.options.clock,
    )
    ;(this as { leases: LeaseStore }).leases = new LeaseStore(
      this.paths.leasesDir,
      this.limits,
      this.options.clock,
    )

    await ensureDir(this.paths.officeDir)
    await ensureDir(this.paths.busDir)
    await ensureDir(this.paths.inboxDir)
    await ensureDir(this.paths.leasesDir)
    await ensureDir(this.paths.artifactsDir)
    await ensureDir(this.paths.fichasDir)
  }

  // ───────────────────────────────────────────────────────────────────────────
  // State
  // ───────────────────────────────────────────────────────────────────────────

  /** Carga o crea el estado de la corrida. Migra v1 → v2 si hace falta. */
  async loadState(objective?: string): Promise<OfficeState> {
    const existing = await readJson<unknown>(this.paths.statePath)
    if (existing) {
      const migrated = migrateState(existing, this.limits)
      if (migrated) {
        // Si venía de v1, se persiste en v2 para no migrar cada vez.
        if (migrated.version !== 2 || (existing as { version?: number }).version !== 2) {
          await this.saveState(migrated)
        }
        return migrated
      }
    }
    const state = createRun(objective ?? "", shortId("run"), this.limits)
    await this.saveState(state)
    return state
  }

  async saveState(state: OfficeState): Promise<void> {
    await writeJsonAtomic(this.paths.statePath, state)
  }

  async loadRoster(runId: string): Promise<Roster> {
    return this.rosterStore.load(runId)
  }

  async saveRoster(roster: Roster): Promise<void> {
    await this.rosterStore.save(roster)
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Catálogo y fichas
  // ───────────────────────────────────────────────────────────────────────────

  /** Catálogo de agency-agents (cacheado). */
  async catalog(): Promise<CatalogAgent[]> {
    if (this.catalogCache) return this.catalogCache
    const root = this.options.agencyRoot ?? this.defaultAgencyRoot()
    if (!root) {
      this.catalogCache = []
      return this.catalogCache
    }
    try {
      this.catalogCache = await scanCatalog({ root })
    } catch (err) {
      log.warn("no se pudo escanear el catálogo", { root, error: String(err) })
      this.catalogCache = []
    }
    return this.catalogCache
  }

  private defaultAgencyRoot(): string | undefined {
    const candidates = [
      path.join(this.paths.projectRoot, "agency-agents"),
      path.join(process.env.HOME ?? process.env.USERPROFILE ?? "", "agency-agents"),
    ]
    return candidates.find((c) => exists(c))
  }

  /**
   * Resuelve un rol a una ficha.
   *
   * Catálogo primero; si la cobertura es baja, factory. El resultado queda
   * registrado en el roster como agente desplegado.
   */
  async resolveFicha(input: {
    role: string
    capabilities: string[]
    scope?: { mayTouch?: string[]; forbidden?: string[] }
    canDelegate?: boolean
    delegateBudget?: number
    peers?: string[]
    objective?: string
  }): Promise<{ ficha: Ficha; source: "agency-agents" | "factory"; coverage: number }> {
    const catalog = await this.catalog()
    const { match, needsFactory } = resolveRole(catalog, input.capabilities, this.limits.minCatalogCoverage)

    if (match && !needsFactory) {
      const ficha: Ficha = {
        id: shortId("e"),
        role: match.agent.slug,
        displayName: match.agent.displayName,
        source: {
          kind: "agency-agents",
          division: match.agent.division,
          path: match.agent.path,
          sourcePrompt: match.agent.sourcePrompt,
        },
        capabilities: match.agent.capabilities,
        tools: ["read", "glob", "grep", "edit", "write", "bash"],
        scope: {
          mayTouch: input.scope?.mayTouch ?? ["**"],
          forbidden: input.scope?.forbidden ?? ["**/*.env", "**/*.env.*"],
        },
        canDelegate: input.canDelegate ?? false,
        delegateBudget: input.delegateBudget ?? 0,
        peers: input.peers ?? [],
        mustNot: [
          "no editar archivos fuera de may_touch",
          "no tocar archivos de forbidden",
          "no aprobar tu propio trabajo",
        ],
        onFinish: "idle-join",
        escalateTo: "integrator",
      }
      return { ficha, source: "agency-agents", coverage: match.coverage }
    }

    const ficha = createFicha({
      role: input.role,
      displayName: input.role,
      capabilities: input.capabilities,
      scope: input.scope,
      canDelegate: input.canDelegate,
      delegateBudget: input.delegateBudget,
      peers: input.peers,
      objective: input.objective,
    })
    this.candidates.record(ficha.role, nowIso(this.options.clock))
    return { ficha, source: "factory", coverage: match?.coverage ?? 0 }
  }

  /** Despliega un agente: lo registra en el roster y escribe su ficha. */
  async deploy(ficha: Ficha): Promise<RosterEntry> {
    const roster = await this.loadRoster(ficha.id)
    const entry = await this.rosterStore.upsert(roster, ficha, "deployed")
    await this.saveRoster(roster)

    const fichaPath = path.join(this.paths.fichasDir, `${ficha.id}.md`)
    await writeAtomic(fichaPath, renderFicha(ficha))
    entry.fichaPath = fichaPath
    await this.saveRoster(roster)
    return entry
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Cards
  // ───────────────────────────────────────────────────────────────────────────

  /** Valida y persiste un plan propuesto por el modelo. */
  async savePlan(
    state: OfficeState,
    cards: Array<{
      id?: string
      title: string
      type: CardType
      requiredCapabilities?: string[]
      scope?: { mayTouch?: string[]; forbidden?: string[] }
      acceptance: string[]
      gate: string
      dependsOn?: string[]
    }>,
  ): Promise<OfficeState> {
    const assigned: Card[] = []

    for (const [index, raw] of cards.entries()) {
      const id = raw.id ?? `T-${String(index).padStart(2, "0")}`
      const card: Card = {
        id,
        title: raw.title,
        type: raw.type,
        state: "todo",
        owner: null,
        reviewer: null,
        requiredCapabilities: raw.requiredCapabilities ?? [],
        scope: {
          mayTouch: raw.scope?.mayTouch ?? ["**"],
          forbidden: raw.scope?.forbidden ?? ["**/*.env", "**/*.env.*"],
        },
        acceptance: raw.acceptance,
        gate: raw.gate,
        dependsOn: raw.dependsOn ?? [],
        attempts: 0,
        rejections: 0,
        artifacts: path.join(".oficina", "artifacts", id),
        result: null,
        helpRequests: [],
        helpHops: 0,
      }
      state.cards[id] = card
      state.order.push(id)
      assigned.push(card)
    }

    // Routing determinista de owner y reviewer.
    const roster = await this.loadRoster(state.runId)
    const catalog = await this.catalog()

    for (const card of assigned) {
      const streak = ownerStreak(state.cards, state.order, "", card.type)
      const route = routeCard(card, roster, catalog, { ownerStreak: streak })
      card.owner = route.owner?.id ?? null
      card.reviewer = route.reviewer?.id ?? null
      if (route.reason) {
        state.decisions.push({
          at: nowIso(this.options.clock),
          cardId: card.id,
          decision: "approved",
          reason: `routing: ${route.reason}`,
          actor: "integrator",
        })
      }
    }

    state.budget.cardsUsed = assigned.length
    state.status = "running"
    await this.saveState(state)
    await this.saveRoster(roster)
    return state
  }

  /** Elige y reclama la próxima card para un agente dado. */
  async claimNext(
    state: OfficeState,
    agentId: string,
    sessionId?: string,
  ): Promise<{ card: Card | null; reason: string }> {
    const next = selectNextCard(state)
    if (!next.card) return { card: null, reason: next.reason }

    const card = next.card
    const lease = await this.leases.acquire(card.id, agentId)
    if (!lease) return { card: null, reason: `la card ${card.id} ya está tomada por otro agente` }

    const roster = await this.loadRoster(state.runId)
    this.rosterStore.assign(roster, agentId, card.id)
    await this.saveRoster(roster)

    transitionCard(state, card.id, "in_progress", { owner: agentId })
    consumeAgentCall(state)
    if (sessionId) this.bindSession(state, sessionId, agentId, card.id)
    await this.saveState(state)

    await this.bus.send(CHANNELS.flow, {
      from: agentId,
      to: ["integrator"],
      kind: "CLAIM",
      subject: card.id,
      body: { card: card.id, title: card.title },
      idempotencyKey: `claim:${card.id}:${agentId}:${card.attempts}`,
    })

    return { card, reason: next.reason }
  }

  /** Asocia una sesión con un agente y una card. Lo usa el guard de scope. */
  bindSession(state: OfficeState, sessionId: string, agentId: string, cardId: string | null): void {
    const existing = state.sessions[sessionId]
    state.sessions[sessionId] = {
      agentId,
      cardId,
      updatedAt: nowIso(this.options.clock),
      autoResumes: existing?.autoResumes ?? 0,
    }
  }

  /** Card en curso de una sesión. */
  sessionCard(state: OfficeState, sessionId: string): Card | undefined {
    const binding = state.sessions[sessionId]
    if (!binding?.cardId) return undefined
    return state.cards[binding.cardId]
  }

  /** Reclama una card específica (claim proactivo del pool idle). */
  async claimCard(
    state: OfficeState,
    agentId: string,
    cardId: string,
    sessionId?: string,
  ): Promise<{ ok: boolean; reason: string }> {
    const card = state.cards[cardId]
    if (!card) return { ok: false, reason: `no existe la card ${cardId}` }

    // El lease se verifica PRIMERO: un doble claim es el diagnóstico más
    // específico y el más común.
    const lease = await this.leases.acquire(cardId, agentId)
    if (!lease) return { ok: false, reason: `la card ${cardId} ya está tomada por otro agente` }

    // Una card se puede reclamar si está pendiente de trabajo. El `rework`
    // cuenta: es trabajo pendiente, y es el más urgente de todos.
    if (card.state !== "todo" && card.state !== "rework" && card.state !== "in_progress") {
      await this.leases.release(cardId, agentId)
      return {
        ok: false,
        reason: `la card ${cardId} está en estado ${card.state}, no se puede reclamar`,
      }
    }

    const roster = await this.loadRoster(state.runId)
    this.rosterStore.assign(roster, agentId, cardId)
    await this.saveRoster(roster)

    if (card.state !== "in_progress") {
      transitionCard(state, cardId, "in_progress", { owner: agentId })
    } else {
      card.owner = agentId
    }
    consumeAgentCall(state)
    if (sessionId) this.bindSession(state, sessionId, agentId, cardId)
    await this.saveState(state)
    return { ok: true, reason: `card ${cardId} reclamada` }
  }

  /** Envía el trabajo de una card a review. */
  async submitWork(
    state: OfficeState,
    cardId: string,
    agentId: string,
    payload: { handoff: string; evidence?: string },
  ): Promise<{ ok: boolean; reason: string }> {
    const card = state.cards[cardId]
    if (!card) return { ok: false, reason: `no existe la card ${cardId}` }
    if (card.owner !== agentId) {
      return { ok: false, reason: `la card ${cardId} no la tiene ${agentId} (owner: ${card.owner})` }
    }

    const dir = cardDir(this.paths, cardId)
    await ensureDir(dir)
    await writeAtomic(path.join(dir, "handoff.md"), payload.handoff)
    if (payload.evidence) {
      await writeAtomic(path.join(dir, "evidence.md"), payload.evidence)
    } else {
      const hasEvidence = await readJson<unknown>(path.join(dir, "evidence.md"))
      if (!hasEvidence) {
        // Sin evidencia no hay hecho. Pero no bloqueamos el handoff: el
        // reviewer va a marcarlo.
        await writeAtomic(
          path.join(dir, "evidence.md"),
          `# Evidencia — ${cardId}\n\n(pendiente: el owner no adjuntó evidencia)\n`,
        )
      }
    }

    transitionCard(state, cardId, "review")
    await this.saveState(state)

    const roster = await this.loadRoster(state.runId)
    await this.saveRoster(roster)
    return { ok: true, reason: `card ${cardId} entregada a revisión` }
  }

  /** Registra el veredicto del reviewer. */
  async submitReview(
    state: OfficeState,
    cardId: string,
    reviewerId: string,
    verdict: "approved" | "rejected",
    payload: { review: string; reason?: string },
  ): Promise<{ ok: boolean; reason: string; action: string }> {
    const card = state.cards[cardId]
    if (!card) return { ok: false, reason: `no existe la card ${cardId}`, action: "none" }

    if (card.owner === reviewerId) {
      return {
        ok: false,
        reason: "el revisor no puede ser el owner de la card",
        action: "none",
      }
    }

    const dir = cardDir(this.paths, cardId)
    await ensureDir(dir)
    await writeAtomic(path.join(dir, "review.md"), payload.review)

    if (verdict === "approved") {
      recordApproval(card, payload.reason ?? "sin observaciones")
      await this.saveState(state)
      return { ok: true, reason: "review APROBADO — falta el gate", action: "run_gates" }
    }

    recordRejection(card, payload.reason ?? "sin motivo declarado")
    const decision = decideRetry(card, this.limits)
    transitionCard(state, cardId, "rework", { result: card.result })
    state.decisions.push({
      at: nowIso(this.options.clock),
      cardId,
      decision: decision.action === "escalate" ? "escalated" : decision.action === "replan" ? "replan" : "rework",
      reason: decision.reason,
      actor: reviewerId,
    })
    await this.saveState(state)
    return { ok: true, reason: decision.instruction || decision.reason, action: decision.action }
  }

  /** Corre los gates de una card. */
  async runGates(state: OfficeState, cardId: string): Promise<GateResult> {
    const card = state.cards[cardId]
    if (!card) throw new Error(`no existe la card ${cardId}`)

    if (!this.toolingCache) {
      this.toolingCache = await detectTooling(this.paths.projectRoot)
    }
    const scope = card.scope.mayTouch.filter((s) => !s.includes("*"))
    const runner = this.options.runner

    const technical = await runTechnicalGates(this.paths.projectRoot, this.toolingCache, runner, scope)
    const security = await runSecurityGate(this.paths.projectRoot, scope, runner)
    const result = consolidate(cardId, technical, security)

    const dir = cardDir(this.paths, cardId)
    await ensureDir(dir)
    const { renderGate } = await import("./gates.js")
    await writeAtomic(path.join(dir, "gates.md"), renderGate(result))

    return result
  }

  /** Cierra una card si los gates pasaron. Aplica los invariantes. */
  async closeCard(state: OfficeState, cardId: string, gates: GateResult): Promise<{ ok: boolean; reason: string }> {
    const card = state.cards[cardId]
    if (!card) return { ok: false, reason: `no existe la card ${cardId}` }

    try {
      assertInvariants({
        card,
        state,
        limits: this.limits,
        gatesPassed: gates.passed,
      })
    } catch (err) {
      return { ok: false, reason: String((err as Error).message) }
    }

    if (!gates.passed) {
      return {
        ok: false,
        reason: `gate no aprobado (técnico: ${gates.technicalOutcome}, seguridad: ${gates.securityOutcome})`,
      }
    }

    transitionCard(state, cardId, "done")
    await this.saveState(state)

    const roster = await this.loadRoster(state.runId)
    this.rosterStore.release(roster, card.owner ?? "")
    await this.saveRoster(roster)
    await this.leases.release(cardId, card.owner ?? "")

    return { ok: true, reason: `card ${cardId} cerrada` }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Ayuda
  // ───────────────────────────────────────────────────────────────────────────

  /** Enruta un pedido de ayuda a los peers disponibles. */
  async routeHelpRequest(
    state: OfficeState,
    requesterId: string,
    cardId: string,
  ): Promise<{ targets: string[]; reason: string }> {
    const roster = await this.loadRoster(state.runId)
    const requester = roster.agents[requesterId]
    const route = routeHelp(requesterId, roster, requester?.capabilities ?? [])

    const card = state.cards[cardId]
    if (card) {
      card.helpRequests.push(requesterId)
      card.helpHops += 1
      assertInvariants({ card, state, limits: this.limits })
      await this.saveState(state)
    }
    return route
  }

  /** Snapshot del estado para el prompt. */
  async snapshot(): Promise<{
    state: OfficeState
    roster: Roster
    idle: RosterEntry[]
    working: RosterEntry[]
    dead: RosterEntry[]
  }> {
    const state = await this.loadState()
    const roster = await this.loadRoster(state.runId)
    return {
      state,
      roster,
      idle: this.rosterStore.idlePool(roster),
      working: this.rosterStore.workingAgents(roster),
      dead: this.rosterStore.deadAgents(roster, this.limits.heartbeatSec * 3),
    }
  }
}

/** Renderiza una ficha como markdown. */
export function renderFicha(ficha: Ficha): string {
  return [
    `# ${ficha.displayName}`,
    "",
    `**id:** \`${ficha.id}\`  `,
    `**rol:** \`${ficha.role}\`  `,
    `**origen:** ${ficha.source.kind}${ficha.source.division ? ` (${ficha.source.division})` : ""}`,
    "",
    "## Capacidades",
    "",
    ...ficha.capabilities.map((c) => `- ${c}`),
    "",
    "## Scope",
    "",
    `- **may_touch:** ${ficha.scope.mayTouch.join(", ")}`,
    `- **forbidden:** ${ficha.scope.forbidden.join(", ")}`,
    "",
    "## Delegación",
    "",
    `- **can_delegate:** ${ficha.canDelegate}`,
    `- **delegate_budget:** ${ficha.delegateBudget}`,
    `- **peers:** ${ficha.peers.join(", ") || "(ninguno)"}`,
    `- **escalate_to:** ${ficha.escalateTo}`,
    "",
    "## Límites duros",
    "",
    ...ficha.mustNot.map((m) => `- ${m}`),
    "",
    "## Prompt de origen",
    "",
    "```markdown",
    ficha.source.sourcePrompt ?? "(sin prompt de origen)",
    "```",
    "",
  ].join("\n")
}
