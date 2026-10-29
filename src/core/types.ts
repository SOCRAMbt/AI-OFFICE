/**
 * OFICINA — schema único del sistema.
 *
 * Todo lo que cruza el sistema (bus, roster, cards, fichas, gates) usa estas
 * formas. Un rol venga de agency-agents o de la factory se materializa en la
 * misma `Ficha`; una card, sin importar qué coordinó el Commander, usa la
 * misma `Card`. Esa unificación es lo que permite que el matching de
 * capacidades, la rotación, la auditoría y el bus no necesiten saber el
 * origen de nada.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Límites e invariantes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Invariantes globales.
 *
 * Los marcados `hard` son los que el sistema NUNCA puede violar: los
 * implementa `assertInvariants` en código, no la disciplina del agente. Un
 * prompt puede pedirle al modelo que no toque archivos fuera de scope; el
 * guard de scope lo impide aunque el modelo se lo salte.
 */
export interface Limits {
  /** Especialistas simultáneos. 10 base, 14 hard cap. */
  maxConcurrentAgents: number
  /** Niveles de spawn bajo un coordinador. */
  maxSpawnDepth: number
  /** Spawns totales por corrida. */
  maxSpawnsTotal: number
  /** Saltos máximos en una cadena de ayuda (anti-deadlock). */
  maxHelpChainHops: number
  /** Mensajes por agente (anti-spam). */
  maxMessagesPerAgent: number
  /** TTL de un mensaje, en segundos. */
  msgTtlSec: number
  /** TTL de un lease, en segundos. */
  leaseTtlSec: number
  /** Intervalo de heartbeat, en segundos. */
  heartbeatSec: number
  /** Rechazos de review antes de escalar. */
  maxReviewRejections: number
  /** Cards por corrida. */
  maxCards: number
  /** Invocaciones de subagente por corrida. */
  maxAgentCalls: number
  /** Cobertura mínima (0..1) para aceptar un match del catálogo. */
  minCatalogCoverage: number
  /** Invariante duro: sin gates en PASS no hay DONE. */
  gateRequiredBeforeDone: boolean
  /**
   * Invariante duro: sin evidencia de los requisitos obligatorios no hay
   * DONE.
   *
   * Los gates verifican que el codigo este sano. Esto verifica que el
   * objetivo este cumplido. Son preguntas distintas y hacen falta las dos.
   */
  evidenceRequiredBeforeDone: boolean
  /** Invariante duro: el revisor nunca es el owner. */
  reviewerNeqOwner: boolean
}

export const DEFAULT_LIMITS: Limits = {
  maxConcurrentAgents: 10,
  maxSpawnDepth: 2,
  maxSpawnsTotal: 20,
  maxHelpChainHops: 2,
  maxMessagesPerAgent: 150,
  msgTtlSec: 900,
  leaseTtlSec: 1800,
  heartbeatSec: 60,
  maxReviewRejections: 3,
  maxCards: 20,
  maxAgentCalls: 40,
  minCatalogCoverage: 0.6,
  gateRequiredBeforeDone: true,
  evidenceRequiredBeforeDone: true,
  reviewerNeqOwner: true,
}

// ─────────────────────────────────────────────────────────────────────────────
// Estados
// ─────────────────────────────────────────────────────────────────────────────

/** Ciclo de vida de un agente desplegado. */
export type AgentState =
  | "deployed"
  | "working"
  | "idle_available"
  | "blocked"
  | "retired"

/** Estados de una card. Las transiciones válidas viven en `state.ts`. */
export type CardState =
  | "todo"
  | "in_progress"
  | "review"
  | "rework"
  | "done"
  | "blocked"
  | "escalated"

/** Dominios particionados de los tres coordinadores. */
export type CoordinatorDomain = "command" | "arch" | "flow"

export type CoordinatorId = "commander" | "architect" | "integrator"

// ─────────────────────────────────────────────────────────────────────────────
// Ficha: el schema normalizado de un rol
// ─────────────────────────────────────────────────────────────────────────────

export type FichaSourceKind = "agency-agents" | "factory"

export interface FichaSource {
  kind: FichaSourceKind
  /** División de origen en agency-agents, si aplica. */
  division?: string
  /** Path relativo al repo de origen. */
  path?: string
  /** El system prompt original, verbatim. */
  sourcePrompt?: string
  /** El "vibe" del agente: la personality hook de una línea. */
  vibe?: string
  /** Las misiones declaradas del agente (de "Core Mission"). */
  missions?: string[]
  /** Los entregables declarados (de "Technical Deliverables"). */
  deliverables?: string[]
  /** Las reglas críticas declaradas (de "Critical Rules"). */
  rules?: string[]
}

/**
 * La ficha es lo que un agente recibe al desplegarse. Todo lo que el bus, los
 * coordinadores y el matching de ayuda necesitan saber de un rol cabe acá.
 */
export interface Ficha {
  /** Id de despliegue, único por corrida. */
  id: string
  /** Rol canónico. */
  role: string
  displayName: string
  source: FichaSource
  capabilities: string[]
  tools: string[]
  scope: {
    mayTouch: string[]
    forbidden: string[]
  }
  /** Si este rol puede desplegar subagentes. */
  canDelegate: boolean
  delegateBudget: number
  /** Con qué roles tiene relación de pares (para pedir ayuda). */
  peers: string[]
  /** Límites duros, leídos por los coordinadores. */
  mustNot: string[]
  /** Qué hace al terminar su objetivo. */
  onFinish: "idle-join" | "retire"
  /** A qué coordinador escala. */
  escalateTo: CoordinatorId
}

// ─────────────────────────────────────────────────────────────────────────────
// Card: unidad de trabajo
// ─────────────────────────────────────────────────────────────────────────────

export type CardType =
  | "exploration"
  | "design"
  | "implementation"
  | "bugfix"
  | "refactor"
  | "testing"
  | "docs"
  | "security"
  | "infra"

export interface Card {
  id: string
  title: string
  type: CardType
  state: CardState
  /** Id del agente owner (ficha `id`). */
  owner: string | null
  /** Id del agente revisor. Distinto del owner por invariante. */
  reviewer: string | null
  /** Capabilities que la card requiere. */
  requiredCapabilities: string[]
  scope: {
    mayTouch: string[]
    forbidden: string[]
  }
  /** Criterios de aceptación verificables. */
  acceptance: string[]
  /** Condición que debe cumplirse para pasar a DONE. */
  gate: string
  dependsOn: string[]
  /** Intentos de ejecución. */
  attempts: number
  /** Rechazos acumulados del revisor. */
  rejections: number
  /** Artefactos de esta card, relativos a la office dir. */
  artifacts: string
  /** Resultado final. */
  result: string | null
  /** Ids de cards donde este agente pidió ayuda. */
  helpRequests: string[]
  /** Cuántos saltos lleva la cadena de ayuda de esta card. */
  helpHops: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Bus de mensajes
// ─────────────────────────────────────────────────────────────────────────────

export type MessageKind =
  | "HELP_REQUEST"
  | "HELP_ACCEPT"
  | "HELP_DECLINE"
  | "HELP_PARTIAL"
  | "HELP_QUESTION"
  | "QUESTION"
  | "ANSWER"
  | "SPAWN_REQUEST"
  | "SPAWN_APPROVED"
  | "SPAWN_REJECTED"
  | "CLAIM"
  | "RELEASE"
  | "STATUS"
  | "NOTICE"

export type MessagePriority = "low" | "normal" | "high" | "critical"

/** Envelope de mensaje del bus. Append-only, con seq monótono por canal. */
export interface BusMessage {
  id: string
  /** Secuencia monótona dentro del canal. */
  seq: number
  from: string
  /** Destinatarios. `["*"]` es broadcast al pool. */
  to: string[]
  kind: MessageKind
  /** Card o subject al que se refiere. */
  subject: string
  body: Record<string, unknown>
  replyTo: string | null
  inReplyTo: string | null
  ttlSec: number
  createdAt: string
  priority: MessagePriority
  /** Clave de idempotencia: evita storms de "me ayudás?". */
  idempotencyKey: string | null
  /** Cuántos saltos lleva esta cadena de ayuda. */
  hops: number
}

export interface BusAck {
  messageId: string
  agentId: string
  ackedAt: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Roster
// ─────────────────────────────────────────────────────────────────────────────

export interface RosterEntry {
  id: string
  role: string
  displayName: string
  state: AgentState
  capabilities: string[]
  fichaPath: string
  /** Card en la que está trabajando. */
  currentCard: string | null
  /** Lease tomado, si hay. */
  lease: string | null
  idleSince: string | null
  canAccept: boolean
  /** Cuántas veces pidió ayuda / ayudó a otro (anti-monotonía). */
  helpGiven: number
  helpReceived: number
  /** Pares con los que ya colaboraron, para rotar. */
  helpedPeers: string[]
  lastHeartbeat: string
  source: FichaSource
}

export interface Roster {
  version: number
  runId: string
  agents: Record<string, RosterEntry>
  updatedAt: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Gates
// ─────────────────────────────────────────────────────────────────────────────

export type GatePhase =
  | "build"
  | "typecheck"
  | "lint"
  | "test"
  | "secrecy"
  | "diff"
  /**
   * Verificacion por requisitos.
   *
   * Los otros cinco fases dicen "el codigo esta sano". Esta dice "el
   * objetivo del usuario esta cumplido". Son cosas distintas: un proyecto
   * puede compilar, pasar todos sus tests y tener la autenticacion mal
   * porque ningun test contemplaba ese escenario.
   */
  | "verify"

export type GateOutcome = "pass" | "fail" | "na" | "not_run"

export interface GatePhaseResult {
  phase: GatePhase
  command: string | null
  outcome: GateOutcome
  exitCode: number | null
  /** Salida real, recortada. */
  output: string
  detail: string
  /** Si falló, el motivo por el que la card no puede pasar. */
  reason?: string
}

export interface GateResult {
  cardId: string
  technical: GatePhaseResult[]
  security: GatePhaseResult[]
  /** Verificacion por requisitos: cada criterio de aceptación con evidencia. */
  requirements: GatePhaseResult[]
  technicalOutcome: GateOutcome
  securityOutcome: GateOutcome
  requirementsOutcome: GateOutcome
  passed: boolean
  ranAt: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Estado de la oficina
// ─────────────────────────────────────────────────────────────────────────────

export type RunStatus =
  | "planning"
  | "running"
  | "paused"
  | "delivered"
  | "blocked"
  | "escalated"
  | "abandoned"

export interface OfficeState {
  version: number
  runId: string
  objective: string
  createdAt: string
  updatedAt: string
  status: RunStatus
  /**
   * Freno de emergencia.
   *
   * Cuando se activa, la oficina deja de avanzar: el hook de auto-continuacion
   * no reanuda, el dispatcher no despacha y las tools de trabajo se niegan.
   * Es el freno que impide que una corrida se queme sola en tokens.
   */
  halt: {
    reason: string
    at: string
    by: string
  } | null
  /** Cards del plan, indexadas por id. */
  cards: Record<string, Card>
  /** Orden de ejecución. */
  order: string[]
  budget: {
    cardsUsed: number
    maxCards: number
    agentCallsUsed: number
    maxAgentCalls: number
    spawnsUsed: number
    maxSpawnsTotal: number
  }
  /** Bitácora de decisiones. */
  decisions: DecisionRecord[]
  /** Escalaciones al usuario. */
  escalations: Escalation[]
  /** Contexto acumulado (evita repetición). */
  context: ContextLedger
  /** Iteración del loop principal. */
  iteration: number
  /** Ids de cards pendientes de gate. */
  pendingGates: string[]
  /**
   * Qué sesión está haciendo qué.
   *
   * Lo usa el guard de scope: cuando una sesión intenta editar un archivo,
   * el motor necesita saber contra qué card está trabajando esa sesión.
   */
  sessions: Record<string, SessionBinding>
}

export interface SessionBinding {
  /** Id de agente. */
  agentId: string
  /** Card en curso de esa sesión. */
  cardId: string | null
  updatedAt: string
  /** Cuántas veces el motor auto-reanudó esta sesión. */
  autoResumes: number
}

export interface DecisionRecord {
  at: string
  cardId: string
  decision: "approved" | "rework" | "replan" | "escalated" | "spawn_approved" | "spawn_rejected"
  reason: string
  actor: string
}

export interface Escalation {
  id: string
  cardId: string
  at: string
  cause: string
  attempts: { iteration: number; summary: string }[]
  options: EscalationOption[]
  recommendation: string
  status: "open" | "resolved"
}

export interface EscalationOption {
  id: string
  label: string
  tradeoff: string
}

export interface ContextLedger {
  decisions: string[]
  constraints: string[]
  pieces: string[]
  traps: string[]
  open: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Capacidades y matching
// ─────────────────────────────────────────────────────────────────────────────

export interface CatalogAgent {
  /** Slug del archivo, sin extensión. */
  slug: string
  displayName: string
  description: string
  /** La personality hook de una línea que trae el frontmatter. */
  vibe: string
  division: string
  path: string
  /**
   * Capabilities inferidas del **cuerpo**, no del nombre.
   *
   * Es la diferencia entre "de qué se ocupa" (description) y "en qué es
   * exactamente bueno" (Core Mission + Advanced Capabilities + Deliverables).
   */
  capabilities: string[]
  /** Subtítulos de "Core Mission": la especialidad declarada. */
  missions: string[]
  /** Subtítulos de "Technical Deliverables": lo que sabe producir. */
  deliverables: string[]
  /** Subtítulos de "Advanced Capabilities". */
  advanced: string[]
  /** Items de "Critical Rules". */
  rules: string[]
  /** Secciones H2 parseadas del cuerpo. */
  sections: Record<string, string>
  /** Prompt original completo. */
  sourcePrompt: string
  /** Texto indexable para matching. */
  searchText: string
}

export interface CatalogMatch {
  agent: CatalogAgent
  /** 0..1. */
  coverage: number
  matched: string[]
  missing: string[]
}

/** Error lanzado cuando el estado de la oficina está corrupto y no se puede recuperar automáticamente. */
export class StateCorruptionError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    public readonly originalError?: Error
  ) {
    super(message)
    this.name = "StateCorruptionError"
  }
}
