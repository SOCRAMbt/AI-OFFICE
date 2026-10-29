/**
 * Roster: la single source of truth de quién existe y qué está haciendo.
 *
 * Todos lo leen, nadie lo re-declara. El Integrador lo mantiene; los
 * especialistas se auto-registran y reportan estado.
 */

import type { AgentState, Roster, RosterEntry, Ficha, FichaSource } from "./types.js"
import { nowIso, readJson, writeJsonAtomic } from "./fsx.js"

export class RosterStore {
  constructor(
    private readonly rosterPath: string,
    private readonly clock: () => number = Date.now,
  ) {}

  /** Lee el roster. Si no existe, uno vacío. */
  async load(runId: string): Promise<Roster> {
    const result = await readJson<Roster>(this.rosterPath)
    if (result.ok) return result.value
    return {
      version: 2,
      runId,
      agents: {},
      updatedAt: nowIso(this.clock),
    }
  }

  /** Escribe el roster. */
  async save(roster: Roster): Promise<void> {
    roster.updatedAt = nowIso(this.clock)
    await writeJsonAtomic(this.rosterPath, roster)
  }

  /** Registra o actualiza un agente a partir de su ficha. */
  async upsert(roster: Roster, ficha: Ficha, state: AgentState = "deployed"): Promise<RosterEntry> {
    const existing = roster.agents[ficha.id]
    const entry: RosterEntry = existing ?? {
      id: ficha.id,
      role: ficha.role,
      displayName: ficha.displayName,
      state,
      capabilities: [...ficha.capabilities],
      fichaPath: "",
      currentCard: null,
      lease: null,
      idleSince: null,
      canAccept: true,
      helpGiven: 0,
      helpReceived: 0,
      helpedPeers: [],
      lastHeartbeat: nowIso(this.clock),
      source: ficha.source,
    }
    entry.role = ficha.role
    entry.displayName = ficha.displayName
    entry.capabilities = [...ficha.capabilities]
    entry.source = ficha.source
    entry.lastHeartbeat = nowIso(this.clock)
    roster.agents[ficha.id] = entry
    return entry
  }

  /** Cambia el estado de un agente. */
  setState(roster: Roster, agentId: string, state: AgentState): RosterEntry | undefined {
    const entry = roster.agents[agentId]
    if (!entry) return undefined
    entry.state = state
    entry.idleSince = state === "idle_available" ? nowIso(this.clock) : null
    entry.canAccept = state === "idle_available"
    entry.lastHeartbeat = nowIso(this.clock)
    return entry
  }

  /** Marca heartbeat. Un agente sin heartbeat está muerto. */
  heartbeat(roster: Roster, agentId: string): void {
    const entry = roster.agents[agentId]
    if (entry) entry.lastHeartbeat = nowIso(this.clock)
  }

  /** Asigna una card a un agente. */
  assign(roster: Roster, agentId: string, cardId: string): void {
    const entry = roster.agents[agentId]
    if (!entry) return
    entry.currentCard = cardId
    entry.state = "working"
    entry.canAccept = false
    entry.idleSince = null
  }

  /** Libera al agente. Vuelve al pool si corresponde. */
  release(roster: Roster, agentId: string): void {
    const entry = roster.agents[agentId]
    if (!entry) return
    entry.currentCard = null
    entry.lease = null
    if (entry.state !== "retired" && entry.state !== "blocked") {
      this.setState(roster, agentId, "idle_available")
    }
  }

  /** Agentes disponibles para aceptar trabajo. */
  idlePool(roster: Roster): RosterEntry[] {
    return Object.values(roster.agents)
      .filter((a) => a.state === "idle_available" && a.canAccept && a.lease === null)
      .sort((a, b) => (a.idleSince ?? "").localeCompare(b.idleSince ?? ""))
  }

  /** Agentes trabajando. */
  workingAgents(roster: Roster): RosterEntry[] {
    return Object.values(roster.agents).filter((a) => a.state === "working")
  }

  /**
   * Agentes cuyo heartbeat venció.
   *
   * Un agente que no da señales está muerto: su card se reasigna y su lease
   * expira. Sin esto, una corrida queda trabada por un subagente que murió
   * en silencio.
   */
  deadAgents(roster: Roster, timeoutSec: number): RosterEntry[] {
    const cutoff = this.clock() - timeoutSec * 1000
    return Object.values(roster.agents).filter(
      (a) =>
        a.state !== "retired" &&
        a.state !== "idle_available" &&
        Date.parse(a.lastHeartbeat) < cutoff,
    )
  }

  /** Registra que un agente ayudó a otro (anti-monotonía). */
  recordHelp(roster: Roster, helperId: string, helpedId: string): void {
    const helper = roster.agents[helperId]
    const helped = roster.agents[helpedId]
    if (helper) {
      helper.helpGiven += 1
      if (!helper.helpedPeers.includes(helpedId)) helper.helpedPeers.push(helpedId)
    }
    if (helped) helped.helpReceived += 1
  }

  /** Ubica un agente por rol. */
  findByRole(roster: Roster, role: string): RosterEntry | undefined {
    return Object.values(roster.agents).find((a) => a.role === role)
  }

  /** Agentes que tienen una capability dada. */
  findByCapability(roster: Roster, capability: string): RosterEntry[] {
    return Object.values(roster.agents).filter((a) => a.capabilities.includes(capability))
  }
}

/** Construye la fuente de una ficha desde el roster. */
export function sourceOf(entry: RosterEntry): FichaSource {
  return entry.source
}
