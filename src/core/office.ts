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
  AgentState,
  Card,
  CardState,
  CardType,
  CatalogAgent,
  CatalogMatch,
  Ficha,
  GatePhaseResult,
  GateResult,
  Limits,
  OfficeState,
  Roster,
  RosterEntry,
} from "./types.js"
import { DEFAULT_LIMITS, StateCorruptionError } from "./types.js"
import { Bus, CHANNELS } from "./bus.js"
import { RosterStore } from "./roster.js"
import { LeaseStore } from "./leases.js"
import { createRun, transitionCard, transitionRun, assertInvariants, selectNextCard, migrateState, isRunComplete } from "./state.js"
import { createFicha, CandidateRegistry } from "./factory.js"
import { scanCatalog, loadDynamicAgents, resolveRole, rankCandidates, type RolePanel } from "./catalog.js"
import {
  buildBriefing as buildBriefingContext,
  renderBriefing,
  type Briefing,
} from "./briefing.js"
import { routeCard, routeHelp, ownerStreak, type RouteResult } from "./router.js"
import { decideRetry, recordRejection, recordApproval } from "./retry.js"
import { recordGateOutcome, recordFailureFingerprint, recordClose } from "./memory.js"
import { shouldUseLite, normalizeModeArg } from "./triage.js"
import { recordFailure, blockReason } from "./circuitBreaker.js"
import { detectTooling, runTechnicalGates, runSecurityGate, consolidate, type CommandRunner, type Tooling } from "./gates.js"
import { ensureDir, exists, nowIso, readJson, readText, shortId, writeJsonAtomic, writeAtomic } from "./fsx.js"
import { cardDir, resolvePaths, type ResolvedPaths } from "./paths.js"
import { createStores, EvidenceStore } from "./stores.js"
import { logger } from "./log.js"
import { withLock } from "./atomic.js"

const log = logger("oficina")

export type AgentSpawner = (input: {
  sessionID: string
  agentName: string
  prompt: string
  description: string
  agentId?: string
  cardId?: string | null
}) => Promise<boolean | string | { id: string }>

export interface OfficeOptions {
  cwd: string
  limits?: Limits
  /** Raíz del repo agency-agents para el catálogo. */
  agencyRoot?: string
  /**
   * Catálogo de roles ya escaneado.
   *
   * Punto de inyección: en producción se autodetecta; en los tests se pasa
   * un catálogo controlado para no depender del repo externo.
   */
  catalog?: CatalogAgent[]
  /** Runner de comandos para los gates. Inyectable para tests. */
  runner?: CommandRunner
  clock?: () => number
  /**
   * Cliente del SDK de OpenCode **v1**.
   *
   * Se usa para **desviar subagentes**: `session.prompt` con una parte
   * `subtask` crea un subagente real. Sin cliente, la oficina funciona igual
   * (los agentes se materializan y el LLM los invoca con la tool `task`),
   * pero no puede arrancarlos sola.
   *
   * **En OpenCode v2 este camino no existe.** La v2 crea la sesion hija con
   * `session.create({ parentID })` y la dispara con `session.prompt`. Por eso
   * existe `spawner`: el entry v2 inyecta ahi su propia implementacion y el
   * motor no depende de ninguna de las dos APIs.
   */
  client?: {
    session: {
      prompt: (input: {
        path: { id: string }
        body: {
          parts: Array<{
            type: "subtask"
            prompt: string
            description: string
            agent: string
          }>
        }
      }) => Promise<unknown>
    }
  }
  /**
   * Como crear un subagente, si el host lo permite.
   *
   * Es el punto de extension del motor: el entry v1 usa el cliente de
   * OpenCode v1 (parte `subtask`), y el entry v2 usa `session.create` +
   * `session.prompt`. El motor solo pide "arranca este agente con este
   * prompt" y no sabe como lo hace el host.
   */
  spawner?: AgentSpawner
}

export class Office {
  readonly paths: ResolvedPaths
  readonly limits: Limits
  readonly bus: Bus
  readonly rosterStore: RosterStore
  readonly leases: LeaseStore
  readonly candidates = new CandidateRegistry()

  /**
   * Grafo de requisitos a evidencia.
   *
   * Vive aparte del estado: es un documento que crece con cada aporte y no
   * tiene sentido reescribirlo entero cada vez que cambia una card.
   */
  evidence!: EvidenceStore

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

    // Los stores se arman despues de resolver los paths definitivos.
    const stores = createStores(this.paths.officeDir, { runId: "pending" } as OfficeState)
    this.evidence = stores.evidence
  }

  // ───────────────────────────────────────────────────────────────────────────
  // State
  // ───────────────────────────────────────────────────────────────────────────

  /** Carga o crea el estado de la corrida. Migra v1 → v2 si hace falta. */
  async loadState(objective?: string): Promise<OfficeState> {
    const result = await readJson<unknown>(this.paths.statePath)
    if (result.ok) {
      const migrated = migrateState(result.value, this.limits)
      if (migrated) {
        // Si venía de v1, se persiste en v2 para no migrar cada vez.
        if (migrated.version !== 2 || (result.value as { version?: number }).version !== 2) {
          await this.saveState(migrated)
        }
        return migrated
      }
    }
    if (!result.ok && result.kind === "corrupt") {
      // Estado corrupto: NO crear uno nuevo silenciosamente.
      // El archivo corrupto ya fue puesto en cuarentena por readJson.
      // Lanzamos un error tipado para que el llamador decida qué hacer.
      throw new StateCorruptionError(
        `Estado corrupto en ${this.paths.statePath}: ${result.error.message}. ` +
        `El archivo original fue movido a cuarentena. Use --force-new-run para crear uno nuevo.`,
        this.paths.statePath,
        result.error
      )
    }
    if (!result.ok && result.kind === "error") {
      throw result.error
    }
    // No existe: crear estado nuevo
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

  /** Carga el runId más reciente desde el archivo de estado, si existe. */
  async loadLatestRunId(): Promise<string | null> {
    const result = await readJson<{ runId?: string }>(this.paths.statePath)
    if (result.ok && result.value?.runId) {
      return result.value.runId
    }
    return null
  }

  async saveRoster(roster: Roster): Promise<void> {
    await this.rosterStore.save(roster)
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Catálogo y fichas
  // ───────────────────────────────────────────────────────────────────────────

  /** Catálogo de agency-agents (cacheado) + agentes dinámicos de factory. */
  async catalog(): Promise<CatalogAgent[]> {
    if (this.catalogCache) return this.catalogCache
    if (this.options.catalog) {
      this.catalogCache = this.options.catalog
      return this.catalogCache
    }
    const root = this.options.agencyRoot ?? this.defaultAgencyRoot()
    let baseCatalog: CatalogAgent[] = []
    if (root) {
      try {
        baseCatalog = await scanCatalog({ root })
      } catch (err) {
        log.warn("no se pudo escanear el catálogo", { root, error: String(err) })
      }
    }
    // Cargar agentes dinámicos creados por la factory
    const dynamicAgents = await loadDynamicAgents(this.paths.projectRoot)
    this.catalogCache = [...baseCatalog, ...dynamicAgents]
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
    mission?: string
  }): Promise<{
    ficha: Ficha
    source: "agency-agents" | "factory"
    coverage: number
    /** Por qué se eligió este agente y qué le falta cubrir. */
    match?: CatalogMatch
    /** Alternativas válidas, por si elCommander quiere repartir carga. */
    alternatives: CatalogMatch[]
    /** El panel completo: primario + complementos + huecos. */
    panel?: RolePanel
  }> {
    const catalog = await this.catalog()
    const { match, needsFactory, panel } = resolveRole(
      catalog,
      input.capabilities,
      this.limits.minCatalogCoverage,
    )
    const alternatives = rankCandidates(catalog, input.capabilities, 5).filter(
      (m) => m.agent.slug !== match?.agent.slug,
    )

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
          vibe: match.agent.vibe,
          missions: match.agent.missions,
          deliverables: match.agent.deliverables,
          rules: match.agent.rules,
        },
        // Las capabilities vienen del cuerpo del agente, no del nombre: son
        // su especialidad real (Core Mission + Advanced + Deliverables).
        capabilities: match.agent.capabilities.slice(0, 24),
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
      return { ficha, source: "agency-agents", coverage: match.coverage, match, alternatives, panel }
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
      mission: input.mission,
    })
    this.candidates.record(ficha.role, nowIso(this.options.clock))
    return { ficha, source: "factory", coverage: match?.coverage ?? 0, match, alternatives, panel }
  }

  /**
   * Arranca un subagente.
   *
   * Usa `session.prompt` con una parte `subtask`: es la vía que OpenCode
   * provee para crear un subagente real, con su prompt de sistema y su
   * contexto propio.
   *
   * El `agent` que se pasa es `"general"`, y el specialty viaja completo en el
   * prompt. La razón es práctica: OpenCode arma la lista de agentes al
   * arrancar la sesión, así que un `.opencode/agents/oficina-<slug>.md`
   * recién creado puede no estar registrable todavía. Con el prompt embebido
   * el agente funciona siempre.
   */
  async spawnAgent(
    sessionID: string,
    agentName: string,
    prompt: string,
    description: string,
    req?: { agentId?: string; cardId?: string | null },
  ): Promise<boolean | string> {
    // El spawner del host tiene prioridad: es el que sabe como se crea un
    // subagente en ESTA version de OpenCode.
    if (this.options.spawner) {
      try {
        const res = await this.options.spawner({
          sessionID,
          agentName,
          prompt,
          description,
          agentId: req?.agentId,
          cardId: req?.cardId,
        })
        if (!res) return false

        const childSessionId =
          typeof res === "string"
            ? res
            : typeof res === "object" && res !== null && "id" in (res as Record<string, unknown>)
              ? String((res as Record<string, unknown>).id)
              : undefined

        if (childSessionId && req?.agentId) {
          const state = await this.loadState()
          this.bindSession(state, childSessionId, req.agentId, req.cardId ?? null)
          await this.saveState(state)
          if (req.cardId) {
            await this.leases.acquire(req.cardId, req.agentId)
          }
        }
        return childSessionId ?? Boolean(res)
      } catch (err) {
        log.warn("el spawner del host fallo", { agent: agentName, error: String(err) })
        return false
      }
    }

    const client = this.options.client
    if (!client) return false

    const state = await this.loadState()
    if (state.halt) {
      log.warn("spawn rechazado: la corrida esta detenida", { reason: state.halt.reason })
      return false
    }
    await this.saveState(state)

    try {
      await client.session.prompt({
        path: { id: sessionID },
        body: {
          parts: [
            {
              type: "subtask",
              prompt,
              description: description || `Oficina: ${agentName}`,
              agent: "general",
            },
          ],
        },
      })
      if (req?.agentId && req?.cardId) {
        await this.leases.acquire(req.cardId, req.agentId)
      }
      return true
    } catch (err) {
      log.warn("no se pudo arrancar el subagente", { agent: agentName, error: String(err) })
      return false
    }
  }

  /* ────────────────────────────────────────────────────────────────────────────
   * Freno de emergencia
   * ──────────────────────────────────────────────────────────────────────────── */

  /**
   * Detiene la corrida.
   *
   * El freno tiene que existir por una razon concreta: una malla de agentes
   * que se auto-continua puede quedarse quemando tokens y tokens hasta
   * que se agota el presupuesto, sin que nadie lo note. Un freno explicito
   * convierte eso en una decision de una persona.
   *
   * Con el freno puesto: el hook de auto-continuacion no reanuda, el
   * dispatcher no despacha, y la compilacion automatica del motor se
   * desactiva.
   */
  async halt(state: OfficeState, reason: string, by = "usuario"): Promise<OfficeState> {
    return this.withRunLock(state, async (freshState) => {
      freshState.halt = { reason, at: nowIso(this.options.clock), by }
      freshState.status = "paused"
      await this.saveState(freshState)
      Object.assign(state, freshState)
      log.warn("corrida detenida", { reason, by })
      return state
    })
  }

  /** Reanuda una corrida detenida. */
  async resume(state: OfficeState): Promise<OfficeState> {
    return this.withRunLock(state, async (freshState) => {
      if (!freshState.halt) {
        Object.assign(state, freshState)
        return state
      }
      freshState.halt = null
      if (freshState.status === "paused") transitionRun(freshState, "running")
      await this.saveState(freshState)
      Object.assign(state, freshState)
      log.info("corrida reanudada")
      return state
    })
  }

  /** ¿La corrida esta detenida? */
  isHalted(state: OfficeState): boolean {
    return state.halt !== null
  }

  /**
   * Construye el briefing de un agente para una card.
   *
   * El briefing es el contrato de información: qué sabe, qué no, qué tiene
   * que entregar y a quién escalar. Se valida antes de usarlo — si le falta
   * una sección requerida, el agente no arranca.
   *
   * El contexto sale del ledger de la corrida (`.oficina/context.md`), que
   * es lo que evita que un agente repita lo que ya se decidió.
   */
  buildBriefing(ficha: Ficha, card: Card, roster?: Roster, state?: OfficeState): Briefing {
    const peers = roster
      ? Object.values(roster.agents).filter((a) => a.id !== ficha.id && a.state !== "retired")
      : []
    const context = state?.context
    return buildBriefingContext({
      ficha,
      card,
      objective: state?.objective || card.title,
      knownDecisions: context?.decisions,
      knownConstraints: context?.constraints,
      builtPieces: context?.pieces,
      knownTraps: context?.traps,
      openQuestions: context?.open,
      peers,
      coordinatorId: ficha.escalateTo,
    })
  }

  /**
   * Despliega un agente: lo registra en el roster y escribe su briefing.
   *
   * El briefing se materializa en 4 archivos: `ficha.md`, `misiones.md`,
   * `protocolo.md` y `bus.md`. El agente **no arranca sin `misiones.md`**.
   */
  async deploy(ficha: Ficha, card?: Card, roster?: Roster, state?: OfficeState): Promise<RosterEntry> {
    const runId = state?.runId ?? (await this.loadLatestRunId()) ?? shortId("run")
    const currentRoster = roster ?? (await this.loadRoster(runId))
    const entry = await this.rosterStore.upsert(currentRoster, ficha, "deployed")
    await this.saveRoster(currentRoster)

    const dir = path.join(this.paths.fichasDir, ficha.id)
    await ensureDir(dir)

    const target = card ?? PLACEHOLDER_CARD(ficha.id)
    const briefing = this.buildBriefing(ficha, target, currentRoster, state)
    for (const artifact of briefing.artifacts) {
      await writeAtomic(path.join(dir, artifact.filename), artifact.content)
    }
    await writeAtomic(path.join(dir, "briefing.md"), renderBriefing(briefing))

    entry.fichaPath = path.join(dir, "ficha.md")
    await this.saveRoster(currentRoster)
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
    options?: { mode?: "full" | "lite" | "auto" },
  ): Promise<OfficeState> {
    return this.withRunLock(state, async (freshState) => {
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
        freshState.cards[id] = card
        if (!freshState.order.includes(id)) {
          freshState.order.push(id)
        }
        assigned.push(card)
      }

      // Modo de ejecución: auto-triage determinístico, o explícito vía mode.
      {
        const requested = normalizeModeArg(options?.mode)
        const triage =
          requested === "auto"
            ? shouldUseLite({ objective: freshState.objective, cards: cards.map((c) => ({ acceptance: c.acceptance, scope: c.scope })) })
            : { useLite: requested === "lite", reason: `explícito (--${requested})` }
        freshState.mode = requested === "lite" || (requested === "auto" && triage.useLite) ? "lite" : "full"
        freshState.decisions.push({
          at: nowIso(this.options.clock),
          cardId: "—",
          decision: freshState.mode === "lite" ? "replan" : "approved",
          reason: `modo ${freshState.mode}: ${triage.reason}`,
          actor: "integrator",
        })
        if (freshState.mode === "lite") {
          await this.bus.send(CHANNELS.flow, {
            from: "integrator",
            to: ["integrator"],
            kind: "NOTICE",
            subject: "modo-lite",
            body: { mode: "lite", reason: triage.reason, objective: freshState.objective.slice(0, 160) },
          })
        }
      }

      // Routing determinista de owner y reviewer.
      const roster = await this.loadRoster(freshState.runId)
      const catalog = await this.catalog()

      for (const card of assigned) {
        const streak = ownerStreak(freshState.cards, freshState.order, "", card.type)
        const route = routeCard(card, roster, catalog, { ownerStreak: streak })
        card.owner = route.owner?.id ?? null
        card.reviewer = route.reviewer?.id ?? null
        if (route.reason) {
          freshState.decisions.push({
            at: nowIso(this.options.clock),
            cardId: card.id,
            decision: "approved",
            reason: `routing: ${route.reason}`,
            actor: "integrator",
          })
        }
      }

      // El status de corrida pasa por la tabla de transiciones, no por
      // mutación directa: `planning -> running` es una transición válida, pero
      // saltarse la tabla hace que el invariante no sirva para nada.
      if (freshState.status === "planning") {
        transitionRun(freshState, "running")
      }
      await this.saveState(freshState)
      await this.saveRoster(roster)
      Object.assign(state, freshState)
      return state
    })
  }

  /** Elige y reclama la próxima card para un agente dado. */
  async claimNext(
    state: OfficeState,
    agentId: string,
    sessionId?: string,
  ): Promise<{ card: Card | null; reason: string; state: OfficeState }> {
    if (state.halt) {
      return { card: null, reason: `la corrida está detenida: ${state.halt.reason}`, state }
    }

    return this.withRunLock(state, async (freshState): Promise<{ card: Card | null; reason: string; state: OfficeState }> => {
      if (freshState.halt) {
        Object.assign(state, freshState)
        return { card: null, reason: `la corrida está detenida: ${freshState.halt.reason}`, state: freshState }
      }

      // Validar agente en roster
      const roster = await this.loadRoster(freshState.runId)
      const agentCheck = this.assertAgentInRoster(roster, agentId)
      if (!agentCheck.ok) {
        Object.assign(state, freshState)
        return { card: null, reason: (agentCheck.reason ?? "agente no válido"), state: freshState }
      }

      const next = selectNextCard(freshState, agentId)
      if (!next.card) {
        Object.assign(state, freshState)
        return { card: null, reason: next.reason, state: freshState }
      }

      const card = next.card

      // Revalidar que la card sigue elegible (estado, dependencias, owner)
      if (card.state !== "todo" && card.state !== "rework" && card.state !== "in_progress") {
        Object.assign(state, freshState)
        return { card: null, reason: `la card ${card.id} ya no es elegible (estado: ${card.state})`, state: freshState }
      }
      if (card.dependsOn.some((dep) => freshState.cards[dep]?.state !== "done")) {
        Object.assign(state, freshState)
        return { card: null, reason: `la card ${card.id} tiene dependencias no satisfechas`, state: freshState }
      }

      const lease = await this.leases.acquire(card.id, agentId)
      if (!lease) {
        Object.assign(state, freshState)
        return { card: null, reason: `la card ${card.id} ya está tomada por otro agente`, state: freshState }
      }

      this.rosterStore.assign(roster, agentId, card.id)
      await this.saveRoster(roster)

      let activeCard = card
      if (card.state !== "in_progress") {
        activeCard = transitionCard(freshState, card.id, "in_progress", { owner: agentId })
      } else {
        card.owner = agentId
        card.updatedAt = new Date().toISOString()
        activeCard = card
      }
      if (sessionId) this.bindSession(freshState, sessionId, agentId, card.id)
      await this.saveState(freshState)

      // Validar binding de sesión
      if (sessionId) {
        const bindingCheck = this.assertSessionBinding(freshState, sessionId, agentId, card.id)
        if (!bindingCheck.ok) {
          Object.assign(state, freshState)
          return { card: null, reason: bindingCheck.reason, state: freshState }
        }
      }

      await this.bus.send(CHANNELS.flow, {
        from: agentId,
        to: ["integrator"],
        kind: "CLAIM",
        subject: card.id,
        body: { card: card.id, title: card.title },
        idempotencyKey: `claim:${card.id}:${agentId}:${card.attempts}`,
      })

      Object.assign(state, freshState)
      return { card: activeCard, reason: next.reason, state: freshState }
    })
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

  /** Libera el binding de una sesión (cardId = null). Usado para liberar el scope del agente director. */
  releaseSession(state: OfficeState, sessionId: string): void {
    const existing = state.sessions[sessionId]
    if (existing) {
      state.sessions[sessionId] = {
        ...existing,
        cardId: null,
        updatedAt: nowIso(this.options.clock),
      }
    }
  }

  /** Card en curso de una sesión. */
  sessionCard(state: OfficeState, sessionId: string): Card | undefined {
    const binding = state.sessions[sessionId]
    if (!binding?.cardId) return undefined
    return state.cards[binding.cardId]
  }

  /** Wrapper para ejecutar mutaciones bajo el lock de corrida. */
  private async withRunLock<T>(state: OfficeState, fn: (freshState: OfficeState) => Promise<T>): Promise<T> {
    const runLockPath = path.join(this.paths.leasesDir, `.run-${state.runId}.lock`)
    return withLock(runLockPath, async () => {
      const freshState = await this.loadState()
      return fn(freshState)
    })
  }

  /** Valida que la sesión esté bindeada al agente y card correctos. */
  private assertSessionBinding(
    state: OfficeState,
    sessionId: string,
    agentId: string,
    cardId: string
  ): { ok: boolean; reason: string } {
    const binding = state.sessions[sessionId]
    if (!binding) {
      return { ok: false, reason: `sesión ${sessionId} no tiene binding` }
    }
    if (binding.agentId !== agentId) return { ok: false, reason: `sesión ${sessionId} bindeada a ${binding.agentId}, no a ${agentId}` }
    if (binding.cardId !== cardId) return { ok: false, reason: `sesión ${sessionId} bindeada a card ${binding.cardId}, no a ${cardId}` }
    return { ok: true, reason: "" }
  }

  /** Escribe el artefacto de bloqueo con el historial de intentos. */
  private async writeBlockedArtifact(
    cardId: string,
    reason: string,
    history: Array<{ at: string; fingerprint: string; message: string }>,
  ): Promise<void> {
    const dir = cardDir(this.paths, cardId)
    await ensureDir(dir)
    const lines = [
      `# ${cardId} — BLOCKED_ESCALATED`,
      "",
      `**Causa raíz:** ${reason}`,
      `**Fecha:** ${nowIso(this.options.clock)}`,
      "",
      "## Historial de intentos",
      "",
      "| # | Fingerprint | Error (200c) | At |",
      "|---|-------------|--------------|----|",
      ...history.map(
        (h, i) => `| ${i + 1} | ${h.fingerprint} | ${h.message.replace(/\|/g, "\\|")} | ${h.at} |`,
      ),
      "",
      "## Qué hacer",
      "",
      "- El resto del DAG sigue avanzando: esta card es terminal y no es elegible en `selectNextCard`.",
      "- Para rearmar: revisar `review.md`/`gates.md`, corregir la causa raíz y reasignar con `oficina_assign` tras un replan.",
      "- No reintentar con el mismo error: el fingerprint demuestra que ya se intentó `n` veces.",
    ]
    await writeAtomic(path.join(dir, "blocked.md"), lines.join("\n"))
  }

  /** Valida que el agente exista en el roster. */
  private assertAgentInRoster(roster: Roster, agentId: string): { ok: boolean; reason: string } {
    if (!roster.agents[agentId]) return { ok: false, reason: `agente ${agentId} no está desplegado en esta corrida` }
    return { ok: true, reason: "" }
  }

  /**
   * Asigna reviewer a las cards que tienen owner pero reviewer=null.
   *
   * ## Por qué existe
   *
   * El routing de savePlan corre cuando el roster está VACÍO (los agentes
   * todavía no existen): deja reviewer=null en todas las cards. El dispatch
   * después materializa los agentes pero no vuelve a rutear, así que el
   * review quedaba estructuralmente imposible: submitReview exigía
   * `card.reviewer === reviewerId` y ese campo era null para siempre.
   *
   * Este método es la segunda mitad del routing: corre DESPUÉS del dispatch,
   * con el roster completo, y cierra el hueco.
   */
  async assignReviewers(state: OfficeState): Promise<string[]> {
    return this.withRunLock(state, async (freshState) => {
      const roster = await this.loadRoster(freshState.runId)
      if (Object.keys(roster.agents).length === 0) {
        Object.assign(state, freshState)
        return []
      }

      const catalog = await this.catalog()
      const assigned: string[] = []

      for (const id of freshState.order) {
        const card = freshState.cards[id]
        if (!card || !card.owner || card.reviewer) continue

        const streak = ownerStreak(freshState.cards, freshState.order, "", card.type)
        const route = routeCard(card, roster, catalog, { ownerStreak: streak })
        // El router garantiza reviewer !== su propio owner, pero el owner que
        // él eligió puede diferir del owner actual de la card: se revalida.
        if (route.reviewer && route.reviewer.id !== card.owner) {
          card.reviewer = route.reviewer.id
          assigned.push(`${id} → ${route.reviewer.id}`)
        }
      }

      if (assigned.length > 0) await this.saveState(freshState)
      Object.assign(state, freshState)
      return assigned
    })
  }


  /** Reclama una card específica (claim proactivo del pool idle). */
  async claimCard(
    state: OfficeState,
    agentId: string,
    cardId: string,
    sessionId?: string,
  ): Promise<{ ok: boolean; reason: string }> {
    return this.withRunLock(state, async (freshState) => {
      if (freshState.halt) {
        Object.assign(state, freshState)
        return { ok: false, reason: `la corrida está detenida: ${freshState.halt.reason}` }
      }
      const card = freshState.cards[cardId]
      if (!card) {
        Object.assign(state, freshState)
        return { ok: false, reason: `no existe la card ${cardId}` }
      }

      // Validar agente en roster
      const roster = await this.loadRoster(freshState.runId)
      const agentCheck = this.assertAgentInRoster(roster, agentId)
      if (!agentCheck.ok) {
        Object.assign(state, freshState)
        return { ...agentCheck, reason: agentCheck.reason ?? "agente no válido" }
      }

      // Si la card ya tiene owner, solo ÉSE puede reclamarla (reclaim tras rework)
      if (card.owner && card.owner !== agentId) {
        Object.assign(state, freshState)
        return { ok: false, reason: `la card ${cardId} pertenece a ${card.owner}, no a ${agentId}` }
      }

      // Validar elegibilidad ANTES de acquire (evita lease innecesario)
      if (card.state !== "todo" && card.state !== "rework" && card.state !== "in_progress") {
        Object.assign(state, freshState)
        return { ok: false, reason: `la card ${cardId} está en estado ${card.state}, no se puede reclamar` }
      }

      // El lease se verifica: un doble claim es el diagnóstico más específico
      const lease = await this.leases.acquire(cardId, agentId)
      if (!lease) {
        Object.assign(state, freshState)
        return { ok: false, reason: `la card ${cardId} ya está tomada por otro agente` }
      }

      this.rosterStore.assign(roster, agentId, cardId)
      await this.saveRoster(roster)

      if (card.state !== "in_progress") {
        transitionCard(freshState, cardId, "in_progress", { owner: agentId })
      } else {
        card.owner = agentId
        card.updatedAt = new Date().toISOString()
      }
      if (sessionId) this.bindSession(freshState, sessionId, agentId, cardId)
      await this.saveState(freshState)

      // Validar binding de sesión si se proveyó
      if (sessionId) {
        const bindingCheck = this.assertSessionBinding(freshState, sessionId, agentId, cardId)
        if (!bindingCheck.ok) {
          Object.assign(state, freshState)
          return { ...bindingCheck, reason: bindingCheck.reason ?? "binding inválido" }
        }
      }

      Object.assign(state, freshState)
      return { ok: true, reason: `card ${cardId} reclamada` }
    })
  }

  /** Envía el trabajo de una card a review. */
  async submitWork(
    state: OfficeState,
    cardId: string,
    agentId: string,
    payload: { handoff: string; evidence?: string },
    sessionId?: string,
  ): Promise<{ ok: boolean; reason: string }> {
    return this.withRunLock(state, async (freshState) => {
      if (freshState.halt) {
        Object.assign(state, freshState)
        return { ok: false, reason: `la corrida está detenida: ${freshState.halt.reason}` }
      }
      const card = freshState.cards[cardId]
      if (!card) {
        Object.assign(state, freshState)
        return { ok: false, reason: `no existe la card ${cardId}` }
      }
      if (card.owner !== agentId) {
        Object.assign(state, freshState)
        return { ok: false, reason: `la card ${cardId} no la tiene ${agentId} (owner: ${card.owner})` }
      }

      // Validar agente en roster
      const roster = await this.loadRoster(freshState.runId)
      const agentCheck = this.assertAgentInRoster(roster, agentId)
      if (!agentCheck.ok) {
        Object.assign(state, freshState)
        return agentCheck
      }

      // Validar binding de sesión
      if (sessionId) {
        const bindingCheck = this.assertSessionBinding(freshState, sessionId, agentId, cardId)
        if (!bindingCheck.ok) {
          Object.assign(state, freshState)
          return bindingCheck
        }
      }

      const dir = cardDir(this.paths, cardId)
      await ensureDir(dir)
      await writeAtomic(path.join(dir, "handoff.md"), payload.handoff)
      if (payload.evidence) {
        await writeAtomic(path.join(dir, "evidence.md"), payload.evidence)
      } else {
        const hasEvidence = await readText(path.join(dir, "evidence.md"))
        if (!hasEvidence) {
          await writeAtomic(
            path.join(dir, "evidence.md"),
            `# Evidencia — ${cardId}\n\n(pendiente: el owner no adjuntó evidencia)\n`,
          )
        }
      }

      transitionCard(freshState, cardId, "review")
      await this.saveState(freshState)
      await this.saveRoster(roster)
      Object.assign(state, freshState)
      return { ok: true, reason: `card ${cardId} entregada a revisión` }
    })
  }

  /** Registra el veredicto del reviewer. */
  async submitReview(
    state: OfficeState,
    cardId: string,
    reviewerId: string,
    verdict: "approved" | "rejected",
    payload: { review: string; reason?: string },
    sessionId?: string,
  ): Promise<{ ok: boolean; reason: string; action: string }> {
    return this.withRunLock(state, async (freshState) => {
      if (freshState.halt) {
        return { ok: false, reason: `la corrida está detenida: ${freshState.halt.reason}`, action: "none" }
      }
      const card = freshState.cards[cardId]
      if (!card) return { ok: false, reason: `no existe la card ${cardId}`, action: "none" }

      // Validar agente en roster
      const roster = await this.loadRoster(freshState.runId)
      const agentCheck = this.assertAgentInRoster(roster, reviewerId)
      if (!agentCheck.ok) return { ...agentCheck, reason: agentCheck.reason ?? "agente no válido", action: "none" }

      // Validar que es EL reviewer asignado (no cualquiera del roster)
      if (card.reviewer !== reviewerId) {
        return { ok: false, reason: `la card ${cardId} está asignada a ${card.reviewer}, no a ${reviewerId}`, action: "none" }
      }

      // Check self-review
      if (card.owner === reviewerId) {
        return {
          ok: false,
          reason: "el revisor no puede ser el owner de la card",
          action: "none",
        }
      }

      // Validar binding de sesión
      if (sessionId) {
        const binding = freshState.sessions?.[sessionId]
        if (binding) {
          if (binding.agentId !== reviewerId) {
            return {
              ok: false,
              reason: `sesión ${sessionId} bindeada a ${binding.agentId}, no a ${reviewerId}`,
              action: "none",
            }
          }
        } else if (!freshState.sessions || Object.keys(freshState.sessions).length === 0) {
          if (card.reviewer === reviewerId) {
            this.bindSession(freshState, sessionId, reviewerId, cardId)
          }
        } else {
          return { ok: false, reason: `sesión ${sessionId} no tiene binding`, action: "none" }
        }
      }

      const dir = cardDir(this.paths, cardId)
      await ensureDir(dir)
      await writeAtomic(path.join(dir, "review.md"), payload.review)

      if (verdict === "approved") {
        recordApproval(card, payload.reason ?? "sin observaciones")
        await this.saveState(freshState)
        Object.assign(state, freshState)
        return { ok: true, reason: "review APROBADO — falta el gate", action: "run_gates" }
      }

      recordRejection(card, payload.reason ?? "sin motivo declarado")
      // Circuit breaker primero: 3 fallos idénticos o 5 intentos totales hacen la
      // card terminal BLOCKED_ESCALATED — no otra vuelta de rework.
      const failure = recordFailure(card, payload.reason ?? "rechazado por el reviewer")
      try {
        await recordFailureFingerprint(
          this.paths.officeDir,
          cardId,
          failure.verdict.fingerprint,
          payload.reason ?? "rechazado por el reviewer",
        )
      } catch {
        // best-effort
      }

      const decision = decideRetry(failure.card, this.limits)

      if (failure.verdict.blocked) {
        const reason = blockReason(failure.verdict.consecutive, failure.verdict.total)
        freshState.cards[cardId] = failure.card
        transitionCard(freshState, cardId, "blocked_escalated", {
          result: `${reason} — último fallo: ${(payload.reason ?? "").slice(0, 200)}`,
        })
        freshState.decisions.push({
          at: nowIso(this.options.clock),
          cardId,
          decision: "escalated",
          reason,
          actor: reviewerId,
        })
        await this.writeBlockedArtifact(cardId, reason, failure.card.failureHistory ?? [])
        await this.leases.remove(cardId, freshState.cards[cardId]!.owner ?? reviewerId)
        await this.bus.send(CHANNELS.flow, {
          from: reviewerId,
          to: ["integrator"],
          kind: "NOTICE",
          subject: cardId,
          body: { blocked_escalated: true, reason, fingerprint: failure.verdict.fingerprint },
        })
        await this.saveState(freshState)
        Object.assign(state, freshState)
        return { ok: true, reason, action: "blocked_escalated" }
      }

      if (decision.action === "escalate") {
        const prevOwner = failure.card.owner
        freshState.cards[cardId] = { ...failure.card, owner: null }
        transitionCard(freshState, cardId, "escalated", { result: failure.card.result, owner: null })
        freshState.escalations.push({
          id: shortId("esc"),
          cardId,
          at: nowIso(this.options.clock),
          cause: decision.reason,
          reason: "max-review-rejections",
          agentId: prevOwner,
          detail: decision.reason,
          createdAt: nowIso(this.options.clock),
          resolved: false,
          attempts: [{ iteration: failure.card.attempts, summary: `${failure.card.rejections} rejections` }],
          options: [
            { id: "o1", label: "Replanificar card", tradeoff: "Requiere rediseñar objetivos" },
            { id: "o2", label: "Reasignar a otro agente", tradeoff: "Pierde contexto previo" },
          ],
          recommendation: decision.instruction || decision.reason,
          status: "open",
        })
        if (prevOwner) {
          await this.leases.release(cardId, prevOwner)
        }
      } else {
        const nextOwner = decision.rotateOwner ? null : failure.card.owner
        if (decision.rotateOwner && failure.card.owner) {
          await this.leases.release(cardId, failure.card.owner)
        }
        freshState.cards[cardId] = failure.card
        transitionCard(freshState, cardId, "rework", { result: failure.card.result, owner: nextOwner })
      }
      freshState.decisions.push({
        at: nowIso(this.options.clock),
        cardId,
        decision: decision.action === "escalate" ? "escalated" : decision.action === "replan" ? "replan" : "rework",
        reason: decision.reason,
        actor: reviewerId,
      })
      await this.saveState(freshState)
      Object.assign(state, freshState)
      return { ok: true, reason: decision.instruction || decision.reason, action: decision.action }
    })
  }

  /**
   * Corre los gates de una card.
   *
   * ## Tres dimensiones, no una
   *
   * - **Tecnicas** (build, typecheck, lint, test, diff): el codigo esta sano.
   * - **Seguridad** (secretos): no hay credenciales en el arbol.
   * - **Requisitos** (verify): el objetivo del usuario esta cumplido, con
   *   evidencia enlazada a cada criterio de aceptacion.
   *
   * La tercera es la que falta en casi todos los sistemas de CI: un
   * proyecto puede pasar las dos primeras y tener la autenticacion mal
   * porque ningun test contemplaba ese escenario.
   */
  async runGates(state: OfficeState, cardId: string): Promise<GateResult> {
    const card = state.cards[cardId]
    if (!card) throw new Error(`no existe la card ${cardId}`)

    if (!this.toolingCache) {
      this.toolingCache = await detectTooling(this.paths.projectRoot)
    }
    const hasGlobal = card.scope.mayTouch.some((s) => s.trim() === "**")
    let scope = hasGlobal
      ? ["."]
      : card.scope.mayTouch
          .map((s) => s.replace(/\/?\*\*.*$/, "").replace(/\/?\*.*$/, "").trim())
          .filter(Boolean)
    if (scope.length === 0 && card.scope.mayTouch.length > 0) {
      scope = ["."]
    }
    const runner = this.options.runner

    const technical = await runTechnicalGates(this.paths.projectRoot, this.toolingCache, runner, scope)
    // El guard anti-gate-verde-vacío vive en `runTechnicalGates` (fase test):
    // la oficina lo hereda por acá a propósito. No se reimplementa ni se
    // re-clasifica el resultado en este nivel, o habría dos verdades.
    const security = await runSecurityGate(this.paths.projectRoot, scope, runner)
    const requirements = await this.runRequirementGate(card)
    const result = consolidate(cardId, technical, security, requirements)

    const dir = cardDir(this.paths, cardId)
    await ensureDir(dir)
    const { renderGate } = await import("./gates.js")
    await writeAtomic(path.join(dir, "gates.md"), renderGate(result))
    // Memoria episódica: registrar los fallos de gate (los gates OK no se guardan).
    try {
      await recordGateOutcome(
        this.paths.officeDir,
        cardId,
        technical.map((t) => ({ phase: t.phase, outcome: t.outcome, exitCode: t.exitCode ?? null, output: t.output })),
      )
    } catch {
      // La memoria es best-effort: no bloquea el gate.
    }

    // Circuit breaker: un gate que falla por lo mismo 3 veces seguidas (o
    // la card acumula 5 intentos) deja de reintentarse — BLOCKED_ESCALATED,
    // lease liberado, resto del DAG sigue. Bajo el run-lock para no pisar
    // un fallo concurrente de otra card.
    if (!result.passed) {
      const fail = technical.find((t) => t.outcome === "fail" || t.outcome === "not_run")
      const source = fail?.output ?? requirements[0]?.reason ?? `gate no aprobado (${result.technicalOutcome},${result.securityOutcome},${result.requirementsOutcome})`
      await this.withRunLock(state, async (freshState) => {
        const freshCard = freshState.cards[cardId]
        if (!freshCard) return
        const applied = recordFailure(freshCard, (source ?? "").slice(0, 2000), fail?.exitCode)
        freshState.cards[cardId] = applied.card
        if (applied.verdict.blocked) {
          const reason = blockReason(applied.verdict.consecutive, applied.verdict.total)
          transitionCard(freshState, cardId, "blocked_escalated", { result: reason })
          freshState.decisions.push({
            at: nowIso(this.options.clock),
            cardId,
            decision: "escalated",
            reason,
            actor: "integrator",
          })
          await this.writeBlockedArtifact(cardId, reason, applied.card.failureHistory ?? [])
          await this.leases.remove(cardId, freshState.cards[cardId]!.owner ?? "")
          await this.bus.send(CHANNELS.flow, {
            from: "integrator",
            to: ["integrator"],
            kind: "NOTICE",
            subject: cardId,
            body: { blocked_escalated: true, reason, fingerprint: applied.verdict.fingerprint },
          })
        }
        await this.saveState(freshState)
      })
    }

    return result
  }

  /**
   * Gate de requisitos: cada criterio de aceptacion con su evidencia.
   *
   * Devuelve UNA fase (la peor de todas) con el detalle de lo que falta.
   */
  private async runRequirementGate(card: Card): Promise<GatePhaseResult[]> {
    const graph = await this.evidence.graph(card)
    const veredicto = await this.evidence.canClose(card)

    const detail = graph.missingMandatory.length > 0
      ? `Falta evidencia de ${graph.missingMandatory.length} requisito(s) obligatorio(s):\n` +
        graph.missingMandatory.map((r) => `  - ${r}`).join("\n")
      : graph.complete
        ? `${graph.requirements.length} requisito(s) con evidencia suficiente (nivel ${graph.minLevel}).`
        : "La card no tiene criterios de aceptación: no hay nada que verificar."

    return [
      {
        phase: "verify",
        command: null,
        outcome: veredicto.ok ? "pass" : "fail",
        exitCode: veredicto.ok ? 0 : 1,
        output: veredicto.reason,
        detail,
        reason: veredicto.ok ? undefined : veredicto.reason,
      },
    ]
  }

  /** Cierra una card si los gates pasaron. Aplica los invariantes. */
  async closeCard(state: OfficeState, cardId: string, gates: GateResult): Promise<{ ok: boolean; reason: string }> {
    return this.withRunLock(state, async (freshState) => {
      const card = freshState.cards[cardId]
      if (!card) {
        Object.assign(state, freshState)
        return { ok: false, reason: `no existe la card ${cardId}` }
      }

      // La evidencia se evalua aparte de los gates: los gates dicen que el
      // codigo esta sano, la evidencia dice que el objetivo esta cumplido.
      const evidencia = await this.evidence.canClose(card)

      try {
        // Los invariantes se evalúan contra la card **como quedaría** si el
        // cierre tuviera exito, no como está ahora.
        //
        // Esto no es un detalle: `gate-required-before-done` y
        // `evidence-required-before-done` solo tienen sentido si la card está
        // en `done`. Validarlas contra el estado previo (`review`) las
        // Hacía vacuas: la card se cerraba y el invariante nunca había
        // Saltado nunca.
        assertInvariants({
          card: { ...card, state: "done" },
          state: freshState,
          limits: this.limits,
          gatesPassed: gates.passed,
          evidenceComplete: evidencia.ok,
        })
      } catch (err) {
        if (card.state === "review") {
          transitionCard(freshState, cardId, "rework", { result: (err as Error).message })
        }
        await this.saveState(freshState)
        Object.assign(state, freshState)
        return { ok: false, reason: String((err as Error).message) }
      }

      if (!gates.passed) {
        const failureReason = `gate no aprobado (técnico: ${gates.technicalOutcome}, seguridad: ${gates.securityOutcome}, requisitos: ${gates.requirementsOutcome})`
        if (card.state === "review") {
          transitionCard(freshState, cardId, "rework", { result: failureReason })
        }
        await this.saveState(freshState)
        Object.assign(state, freshState)
        return { ok: false, reason: failureReason }
      }

      if (!evidencia.ok) {
        const failureReason = `evidencia incompleta: ${evidencia.reason}`
        if (card.state === "review") {
          transitionCard(freshState, cardId, "rework", { result: failureReason })
        }
        await this.saveState(freshState)
        Object.assign(state, freshState)
        return { ok: false, reason: failureReason }
      }

      if (card.owner) {
        await this.leases.release(cardId, card.owner)
      }
      const roster = await this.loadRoster(freshState.runId)
      this.rosterStore.release(roster, card.owner ?? "")
      await this.saveRoster(roster)

      transitionCard(freshState, cardId, "done")
      try {
        await recordClose(this.paths.officeDir, cardId, card.owner ?? "")
      } catch {
        // best-effort
      }

      if (isRunComplete(freshState) && freshState.status === "running") {
        transitionRun(freshState, "delivered")
      }

      await this.saveState(freshState)
      Object.assign(state, freshState)

      return { ok: true, reason: `card ${cardId} cerrada` }
    })
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
    return this.withRunLock(state, async (freshState) => {
      const roster = await this.loadRoster(freshState.runId)
      const requester = roster.agents[requesterId]
      const peers = requester?.peers && requester.peers.length > 0
        ? requester.peers
        : (requester?.capabilities ?? [])
      const route = routeHelp(requesterId, roster, peers)

      const card = freshState.cards[cardId]
      if (card) {
        card.helpRequests.push(requesterId)
        card.helpHops += 1
        assertInvariants({ card, state: freshState, limits: this.limits })
        await this.saveState(freshState)
      }
      Object.assign(state, freshState)
      return route
    })
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

  /** Cambia el estado de un agente directamente. */
  async setAgentState(state: OfficeState, agentId: string, newState: AgentState): Promise<void> {
    const freshState = await this.loadState()
    const roster = await this.loadRoster(freshState.runId)
    this.rosterStore.setState(roster, agentId, newState)
    await this.saveRoster(roster)
    Object.assign(state, freshState)
  }

  /** Limpia mensajes expirados del bus. */
  async cleanupBus(): Promise<number> {
    return this.bus.cleanupExpired()
  }
}

/** Card vacía para un agente recién desplegado, antes de que le asignen una. */
function PLACEHOLDER_CARD(agentId: string): Card {
  return {
    id: "sin-card",
    title: "Sin card asignada",
    type: "exploration",
    state: "todo",
    owner: agentId,
    reviewer: null,
    requiredCapabilities: [],
    scope: { mayTouch: ["**"], forbidden: ["**/*.env"] },
    acceptance: ["Esperar la asignación de una card"],
    gate: "sin gate hasta que se le asigne una card",
    dependsOn: [],
    attempts: 0,
    rejections: 0,
    artifacts: "",
    result: null,
    helpRequests: [],
    helpHops: 0,
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
