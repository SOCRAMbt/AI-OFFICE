/**
 * Router: qué agente hace qué card, y con qué rotación.
 *
 * Dos reglas hardcoded que vienen de los síntomas reportados:
 *
 * 1. **El revisor nunca es el owner.** Sin auto-aprobación.
 * 2. **Rotación.** Si el mismo agente sería owner de 3 cards del mismo tipo
 *    seguidas, la cuarta la toma otro. El "subagente monotono" es un bug de
 *    routing, no de capacidad.
 *
 * La extensión: la rotación también aplica a la ayuda. Si el par A↔B ya se
 * ayudaron dos veces, el tercer pedido se enruta a un tercero.
 */

import type { Card, CatalogAgent, Ficha, Roster, RosterEntry } from "./types.js"
import { matchCapabilities } from "./catalog.js"

export interface RouteOptions {
  /** Un agente con este rol ya hizo N cards del mismo tipo seguidos. */
  ownerStreak?: number
  /** Máximo de cards del mismo tipo con el mismo owner antes de rotar. */
  rotationThreshold?: number
  /** Pares que ya colaboraron N veces. */
  pairCollaborationCount?: number
  /** Máximo de colaboraciones por par antes de enrutar a un tercero. */
  pairRotationThreshold?: number
}

export interface RouteResult {
  owner: RosterEntry | null
  reviewer: RosterEntry | null
  /** Por qué se eligió ese owner. */
  reason: string
  /** Si no hay owner posible, qué haría falta. */
  missing: string[]
}

/** Tipo de card → rol canónico que debería ejecutarla. */
export const ROLE_BY_CARD_TYPE: Record<Card["type"], string[]> = {
  exploration: ["code-explorer", "researcher", "explorer"],
  design: ["code-architect", "architect", "system-designer"],
  implementation: ["frontend-developer", "backend-developer", "developer", "engineer"],
  bugfix: ["bug-fixer", "developer", "engineer", "code-architect"],
  refactor: ["refactorer", "developer", "engineer"],
  testing: ["qa-engineer", "test-engineer", "developer"],
  docs: ["technical-writer", "documentation-writer"],
  security: ["security-auditor", "security-engineer"],
  infra: ["devops-engineer", "sre", "platform-engineer"],
}

export const DEFAULT_ROTATION_THRESHOLD = 3
export const DEFAULT_PAIR_ROTATION_THRESHOLD = 2

/**
 * Elige owner y reviewer para una card.
 *
 * Preferencia de owner:
 * 1. Rol canónico del tipo de card (si está en el roster y está libre).
 * 2. Mejor match por capabilities entre los agentes libres.
 * 3. Agente idle del pool (para repartir carga).
 *
 * El reviewer se elige entre los que NO son el owner, priorizando los que no
 * hayan reciente-compliant colaborado con el owner (umbral de anti-monotonía).
 */
export function routeCard(
  card: Card,
  roster: Roster,
  catalog: CatalogAgent[] = [],
  options: RouteOptions = {},
): RouteResult {
  const rotationThreshold = options.rotationThreshold ?? DEFAULT_ROTATION_THRESHOLD
  const pairThreshold = options.pairRotationThreshold ?? DEFAULT_PAIR_ROTATION_THRESHOLD

  const all = Object.values(roster.agents).filter((a) => a.state !== "retired")
  const free = all.filter((a) => a.currentCard === null && a.state !== "blocked")

  // 1. Rol canónico del tipo de card.
  const preferredRoles = ROLE_BY_CARD_TYPE[card.type] ?? []
  let owner: RosterEntry | null =
    preferredRoles
      .map((role) => free.find((a) => a.role === role))
      .find((a): a is RosterEntry => !!a) ?? null

  let reason = owner
    ? `rol canónico del tipo ${card.type}`
    : ""

  // 2. Mejor match por capabilities.
  if (!owner && card.requiredCapabilities.length > 0) {
    const match = matchCapabilities(catalog, card.requiredCapabilities)
    if (match) {
      owner = free.find((a) => a.role === match.agent.slug) ?? null
      if (owner) reason = `match de catálogo con cobertura ${(match.coverage * 100).toFixed(0)}%`
    }
  }

  // 3. Pool idle por capacidad.
  if (!owner && card.requiredCapabilities.length > 0) {
    const scored = free
      .map((a) => ({
        agent: a,
        score: a.capabilities.filter((c) =>
          card.requiredCapabilities.some((r) => c.includes(r) || r.includes(c)),
        ).length,
      }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
    if (scored[0]) {
      owner = scored[0].agent
      reason = `mejor match de capabilities (${scored[0].score})`
    }
  }

  // 4. Cualquiera libre — SOLO si la card no pide capabilities.
  //
  // Si la card pide capacidades específicas y ningún agente las cubre, NO se
  // fuerza un mal match: un rol medio-tonto en el equipo arruina más de lo
  // que aporta. En ese caso se devuelve null y las capabilities faltantes,
  // para que la oficina fabrique el rol o pida ayuda.
  if (!owner && card.requiredCapabilities.length === 0 && free.length > 0) {
    owner = free[0]!
    reason = "único agente libre (la card no exige capabilities)"
  }

  // 5. Anti-monotonía: si el owner lleva una racha, rotar.
  if (owner && (options.ownerStreak ?? 0) >= rotationThreshold) {
    const alternative = free.find((a) => a.id !== owner!.id)
    if (alternative) {
      owner = alternative
      reason = `rotación anti-monotonía (racha de ${options.ownerStreak})`
    }
  }

  // Reviewer: nunca el owner, idealmente sin colaboración reciente.
  const candidates = all.filter((a) => a.id !== owner?.id)
  let reviewer = candidates.find((a) => {
    const pair = owner ? owner.helpedPeers.includes(a.id) : false
    const collabs = options.pairCollaborationCount ?? 0
    return !pair || collabs < pairThreshold
  })
  if (!reviewer) {
    // Todos colaboraron mucho: se permite igual, pero se anota.
    reviewer = candidates[0]
  }

  const missing = owner
    ? []
    : card.requiredCapabilities.filter(
        (c) => !all.some((a) => a.capabilities.includes(c)),
      )

  return {
    owner: owner ?? null,
    reviewer: reviewer ?? null,
    reason: reason || "sin agente disponible",
    missing,
  }
}

/**
 * A quién enrutar un pedido de ayuda.
 *
 * 1. Los peers declarados en la ficha que estén libres.
 * 2. Un tercero si el par ya colaboró demasiado (anti-monotonía extendida).
 */
export function routeHelp(
  requesterId: string,
  roster: Roster,
  requesterPeers: string[] = [],
  options: RouteOptions = {},
): { targets: string[]; reason: string } {
  const pairThreshold = options.pairRotationThreshold ?? DEFAULT_PAIR_ROTATION_THRESHOLD
  const all = Object.values(roster.agents)
  const requester = roster.agents[requesterId]

  const peers = requesterPeers
    .map((role) => all.find((a) => a.role === role || a.id === role))
    .filter((a): a is RosterEntry => !!a && a.id !== requesterId)

  const fresh = peers.filter((p) => {
    const count = requester?.helpedPeers.includes(p.id)
      ? (options.pairCollaborationCount ?? 0)
      : 0
    return count < pairThreshold
  })

  if (fresh.length > 0) {
    return { targets: fresh.map((a) => a.id), reason: "peer declarado, colaboración bajo el umbral" }
  }

  const third = all.find(
    (a) =>
      a.id !== requesterId &&
      !peers.some((p) => p.id === a.id) &&
      a.state !== "retired" &&
      a.currentCard === null,
  )
  if (third) {
    return { targets: [third.id], reason: "rotación: pares ya colaboraron demasiado" }
  }

  return { targets: [], reason: "sin pares disponibles" }
}

/**
 * Calcula la racha de cards del mismo tipo con el mismo owner.
 *
 * Se usa para decidir rotación.
 */
export function ownerStreak(
  cards: Record<string, Card> | Card[],
  order: string[],
  ownerId: string,
  type: Card["type"],
): number {
  const get = (id: string): Card | undefined =>
    Array.isArray(cards) ? cards.find((c) => c.id === id) : cards[id]

  let streak = 0
  for (let i = order.length - 1; i >= 0; i--) {
    const card = get(order[i]!)
    if (!card) continue
    if (card.type !== type) break
    if (card.owner !== ownerId) break
    if (card.state === "todo") continue
    streak++
  }
  return streak
}

/** Construye la ficha de un agente de roster (para renderizar artefactos). */
export function fichaFromEntry(entry: RosterEntry, source?: Ficha["source"]): Ficha {
  return {
    id: entry.id,
    role: entry.role,
    displayName: entry.displayName,
    source: source ?? entry.source,
    capabilities: entry.capabilities,
    tools: ["read", "glob", "grep", "edit", "write", "bash"],
    scope: { mayTouch: ["**"], forbidden: ["**/*.env"] },
    canDelegate: false,
    delegateBudget: 0,
    peers: [],
    mustNot: [],
    onFinish: "idle-join",
    escalateTo: "integrator",
  }
}
