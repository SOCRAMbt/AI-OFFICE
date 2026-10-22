/**
 * Control de costo: contabilidad real + presupuesto + corte.
 *
 * Los presupuestos que ya existen (maxCards, maxAgentCalls, maxSpawnsTotal) son
 * presupuestos de CONTEO. Contar agentes no es controlar el costo: un agente
 * que relee el mismo contexto veinte veces puede gastar diez veces más que uno
 * que lo hace bien y a la primera. El límite útil es en dólares y en tokens.
 *
 * La buena noticia: el motor de OpenCode ya expone el costo real. En el evento
 * `message.updated`, el `AssistantMessage` trae `cost: number` y
 * `tokens: { input, output, reasoning, cache: { read, write } }`, más `modelID`,
 * `providerID` y `time: { created, completed }` para la latencia. O sea que
 * nadie tiene que adivinar el precio: este módulo lo contabiliza, lo desglosa y
 * lo corta.
 *
 * Reglas de diseño (no negociables):
 * - Determinismo total: no hay `Date.now()` interno, el reloj se inyecta. Dos
 *   corridas con el mismo reloj producen el mismo ledger, byte a byte.
 * - El ledger es JSON plano: se persiste en disco tal cual, sin transformarlo.
 * - Sin dependencias externas: los tipos se definen acá y no se piden de
 *   `types.ts`, para que este módulo se pueda usar sin acoplarlo al resto.
 */

import { nowIso } from "./fsx.js"

/** Fase de trabajo. Cada fase tiene presupuesto propio: el gasto de reparar no
 *  puede comerse el presupuesto de implementar, porque ahí no se puede
 *  recuperar nada. */
export type WorkPhase = "implementation" | "review" | "repair" | "exploration" | "verification"

/** Todas las fases, en orden de ciclo de vida de una card. */
export const WORK_PHASES: readonly WorkPhase[] = [
  "implementation",
  "review",
  "repair",
  "exploration",
  "verification",
]

/**
 * Tokens consumidos, desglosados.
 *
 * El cache va aparte a propósito: leer el mismo contexto desde el prompt cache
 * es dramáticamente más barato que pagarlo entero. Si se mezclara, un agente
 * que reusa bien su contexto parecería caro.
 */
export interface TokenUsage {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

/** Acumulado global de la corrida. */
export interface TotalCost {
  usd: number
  tokens: TokenUsage
  calls: number
  wallClockMs: number
}

/** Costo acumulado de una card. */
export interface CardCost {
  cardId: string
  usd: number
  tokens: TokenUsage
  calls: number
}

/** Costo acumulado de un agente. */
export interface AgentCost {
  agentId: string
  role: string
  usd: number
  tokens: TokenUsage
  calls: number
  /** Latencia acumulada del agente en todas sus llamadas. */
  latencyMs: number
  /** Último modelo visto (contexto para el informe, no para el presupuesto). */
  model?: string
  /** Último proveedor visto. */
  provider?: string
}

/** Costo acumulado de una fase de trabajo. */
export interface PhaseCost {
  phase: WorkPhase
  usd: number
  tokens: TokenUsage
  calls: number
}

/**
 * Ledger de costo de una corrida.
 *
 * Es un objeto plano y serializable: `JSON.stringify(ledger)` y listo. Se
 * escribe en disco después de cada uso para poder auditar cuánto costó cada
 * card aunque la corrida muera a mitad de camino.
 */
export interface CostLedger {
  version: number
  runId: string
  /** Acumulado por card. */
  byCard: Record<string, CardCost>
  /** Acumulado por agente. */
  byAgent: Record<string, AgentCost>
  /** Acumulado por fase. */
  byPhase: Record<string, PhaseCost>
  /** Acumulado global de la corrida. */
  total: TotalCost
  startedAt: string
  updatedAt: string
}

/**
 * Límites de presupuesto.
 *
 * Convención: un límite en `0` (o `Infinity`) significa SIN LÍMITE para esa
 * dimensión. La razón es práctica: un default en cero no puede tumbar una
 * corrida entera por un descuido de configuración, y "sin límite" es más
 * explícito como `Infinity` que como un cero que parece un valor real.
 */
export interface CostLimits {
  maxUsdPerRun: number
  maxUsdPerCard: number
  maxTokensPerRun: number
  maxWallClockMsPerRun: number
  /** Presupuestos separados por fase de trabajo. */
  perPhaseUsd: Partial<Record<WorkPhase, number>>
  /** Umbral a partir del cual el costo de una card pasa a considerarse excesivo
   *  (avisa, no bloquea). */
  warnUsdPerCard: number
}

/**
 * Defaults: una corrida de tamaño medio, no una corrida illimitada.
 *
 * Los presupuestos por fase suman exactamente `maxUsdPerRun` a propósito: si el
 * director reparte mal el gasto entre fases, el desbalance tiene que aparecer en
 * la fase que se pasó, no esconderse adentro del total.
 */
export const DEFAULT_COST_LIMITS: CostLimits = {
  maxUsdPerRun: 25,
  maxUsdPerCard: 5,
  maxTokensPerRun: 5_000_000,
  maxWallClockMsPerRun: 2 * 60 * 60 * 1000,
  perPhaseUsd: {
    implementation: 12,
    review: 4,
    repair: 6,
    exploration: 2,
    verification: 1,
  },
  warnUsdPerCard: 1,
}

/** Límite que se rompió, si se rompió alguno. */
export type BreachedLimit = "run-usd" | "card-usd" | "run-tokens" | "wall-clock" | "phase-usd"

/** Veredicto de un control de presupuesto. */
export interface CostDecision {
  allowed: boolean
  reason: string
  /** Qué límite se rompió, si se rompió alguno. */
  breached: BreachedLimit | null
  /** Dónde se va a reflejar el gasto a partir de ahora. */
  current: TotalCost
  /** Avisos que no bloquean (p.ej. costo de card por encima del umbral). */
  warnings: string[]
}

/** Evento de tool del agente, para el detector de trabajo redundante. */
export interface ToolEvent {
  agentId: string
  tool: string
  /** Path o comando. `null` si la tool no tenía objetivo. */
  target: string | null
  at: string
}

/** Resultado del análisis de redundancia. */
export interface RedundancyReport {
  repeatedReads: { target: string; count: number }[]
  repeatedCommands: { target: string; count: number }[]
  /** Fracción del trabajo que fue repetición: 0 (nada repetido) a 1 (todo). */
  wastedFraction: number
  summary: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Internos
// ─────────────────────────────────────────────────────────────────────────────

/** Versión del formato del ledger. Sube si cambia la forma del JSON. */
const LEDGER_VERSION = 1

/**
 * Dígitos decimales que se guardan para el USD.
 *
 * Sin esto, 0.1 + 0.2 = 0.30000000000000004 queda en el JSON persistido y los
 * tests de igualdad exacta se rompen por puro ruido binario. Nueve decimales
 * es precisión de nanodólares: de sobra para lo que se factura.
 */
const USD_DECIMALS = 9

/**
 * Tokens asumidos por llamada para la estimación previa.
 *
 * Supuesto declarado, no medido: 8k de entrada (contexto de la card + repo) y
 * 2k de salida (resolución). Si el supuesto queda corto, la estimación es
 * una cota baja — por eso la nota dice que el costo real puede ser mayor.
 */
export const ASSUMED_TOKENS_PER_CALL = 10_000

/** Redondea un monto a nanodólares. */
function roundUsd(value: number): number {
  if (!Number.isFinite(value)) return value
  return Math.round(value * 1e9) / 1e9
}

/** Tokens en cero. */
function emptyTokens(): TokenUsage {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
}

/** Suma dos conteos de tokens. */
function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  }
}

/**
 * Total de tokens facturables de una llamada.
 *
 * Suma input + output + reasoning + cache. El reasoning se cuenta aparte del
 * output porque el motor lo reporta aparte, pero se incluye en el presupuesto:
 * son tokens que se facturan y omitirlos sería subcontar el gasto real.
 */
export function totalTokens(tokens: TokenUsage): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite
}

/**
 * ¿El valor superó el límite?
 *
 * `max <= 0` o no finito significa "sin límite" (ver la convención de
 * `CostLimits`).
 */
function exceeds(used: number, max: number): boolean {
  if (!Number.isFinite(max) || max <= 0) return false
  return used > max
}

/** Copia profunda del total, para que el decisor no pueda mutar el ledger. */
function copyTotal(total: TotalCost): TotalCost {
  return {
    usd: total.usd,
    tokens: { ...total.tokens },
    calls: total.calls,
    wallClockMs: total.wallClockMs,
  }
}

/** Comparación de strings estable e independiente del locale. */
function cmpStr(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/** Formatea un entero con separadores de miles (determinista, sin locale). */
function formatInt(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")
}

/** Formatea dólares con 4 decimales. */
function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "$∞"
  return `$${value.toFixed(4)}`
}

/** Formatea una duración en milisegundos de forma legible. */
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—"
  if (ms < 1000) return `${Math.round(ms)} ms`
  const seconds = Math.floor(ms / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  if (hours > 0) return `${hours}h ${minutes}m ${rest}s`
  if (minutes > 0) return `${minutes}m ${rest}s`
  return `${rest}s`
}

/** Formatea un porcentaje de 0 a 1. */
function formatPercent(ratio: number): string {
  if (!Number.isFinite(ratio)) return "∞"
  return `${(ratio * 100).toFixed(1)}%`
}

// ─────────────────────────────────────────────────────────────────────────────
// Ledger
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Crea un ledger en cero.
 *
 * `clock` es inyectable porque el módulo tiene que ser reproducible en tests:
 * con el mismo reloj, la misma secuencia de llamadas produce el mismo ledger.
 */
export function createLedger(runId: string, clock: () => number = Date.now): CostLedger {
  const stamp = nowIso(clock)
  return {
    version: LEDGER_VERSION,
    runId,
    byCard: {},
    byAgent: {},
    byPhase: {},
    total: { usd: 0, tokens: emptyTokens(), calls: 0, wallClockMs: 0 },
    startedAt: stamp,
    updatedAt: stamp,
  }
}

/** Uso de una llamada, tal como lo reporta el motor. */
export interface UsageInput {
  agentId: string
  role: string
  /** `null` si la llamada no estaba atada a una card (coordinación, exploración). */
  cardId: string | null
  phase: WorkPhase
  model: string
  provider: string
  /** Costo en USD que reportó el motor. */
  cost: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cache?: { read: number; write: number }
  }
  /** Latencia de la llamada en ms (`time.completed - time.created`). */
  latencyMs: number
}

/**
 * Acumula el uso de una llamada en el ledger.
 *
 * Muta el ledger recibido y lo devuelve, así que funciona igual
 * `recordUsage(l, x)` que `l = recordUsage(l, x)`. Se eligió mutar (y no
 * devolver una copia) porque el ledger es estado compartido y persistido: si
 * una copia, un caller que olvide reasignar pierde el gasto en silencio, que
 * es el peor modo de falla para un control de presupuesto.
 *
 * El wall clock de la corrida se recalcula contra `startedAt`, que se puede
 * recuperar del propio JSON porque el ISO tiene precisión de milisegundos.
 */
export function recordUsage(
  ledger: CostLedger,
  input: UsageInput,
  clock: () => number = Date.now,
): CostLedger {
  const usd = roundUsd(input.cost)
  const tokens: TokenUsage = {
    input: input.tokens.input,
    output: input.tokens.output,
    reasoning: input.tokens.reasoning,
    cacheRead: input.tokens.cache?.read ?? 0,
    cacheWrite: input.tokens.cache?.write ?? 0,
  }
  const latencyMs = Math.max(0, input.latencyMs)

  // ── Total de la corrida ──
  ledger.total.usd = roundUsd(ledger.total.usd + usd)
  ledger.total.tokens = addTokens(ledger.total.tokens, tokens)
  ledger.total.calls += 1

  const elapsed = Math.max(0, clock() - Date.parse(ledger.startedAt))
  ledger.total.wallClockMs = Math.max(ledger.total.wallClockMs, elapsed)

  // ── Por card ──
  if (input.cardId) {
    const card = ledger.byCard[input.cardId]
    if (card) {
      card.usd = roundUsd(card.usd + usd)
      card.tokens = addTokens(card.tokens, tokens)
      card.calls += 1
    } else {
      ledger.byCard[input.cardId] = {
        cardId: input.cardId,
        usd,
        tokens: { ...tokens },
        calls: 1,
      }
    }
  }

  // ── Por agente ──
  const agent = ledger.byAgent[input.agentId]
  if (agent) {
    agent.usd = roundUsd(agent.usd + usd)
    agent.tokens = addTokens(agent.tokens, tokens)
    agent.calls += 1
    agent.latencyMs += latencyMs
    if (input.role) agent.role = input.role
    agent.model = input.model
    agent.provider = input.provider
  } else {
    ledger.byAgent[input.agentId] = {
      agentId: input.agentId,
      role: input.role,
      usd,
      tokens: { ...tokens },
      calls: 1,
      latencyMs,
      model: input.model,
      provider: input.provider,
    }
  }

  // ── Por fase ──
  const phase = ledger.byPhase[input.phase]
  if (phase) {
    phase.usd = roundUsd(phase.usd + usd)
    phase.tokens = addTokens(phase.tokens, tokens)
    phase.calls += 1
  } else {
    ledger.byPhase[input.phase] = {
      phase: input.phase,
      usd,
      tokens: { ...tokens },
      calls: 1,
    }
  }

  ledger.updatedAt = nowIso(clock)
  return ledger
}

// ─────────────────────────────────────────────────────────────────────────────
// Presupuesto
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decide si se puede seguir gastando.
 *
 * Precedencia de las comprobaciones (de la más específica a la más global):
 * `card-usd` → `phase-usd` → `run-usd` → `run-tokens` → `wall-clock`. Se
 * empieza por las acotadas porque son las accionables: dicen qué card parar y
 * en qué fase, no sólo que "la corrida se pasó".
 *
 * `cardId` y `phase` son opcionales: si no se pasan, esas dimensiones no se
 * evalúan. El límite de card no se aplica "de rebote" cuando no se sabe de qué
 * card se trata, porque adivinar sería bloquear trabajo válido.
 */
export function checkBudget(
  ledger: CostLedger,
  limits: CostLimits,
  cardId?: string,
  phase?: WorkPhase,
): CostDecision {
  const current = copyTotal(ledger.total)
  const warnings: string[] = []
  const runTokens = totalTokens(ledger.total.tokens)

  // 1. Card
  if (cardId) {
    const cardUsd = ledger.byCard[cardId]?.usd ?? 0
    if (exceeds(cardUsd, limits.maxUsdPerCard)) {
      return {
        allowed: false,
        reason:
          `La card ${cardId} gastó ${formatUsd(cardUsd)} y su presupuesto es ` +
          `${formatUsd(limits.maxUsdPerCard)}. La corrida total va en ${formatUsd(ledger.total.usd)}.`,
        breached: "card-usd",
        current,
        warnings,
      }
    }
    if (exceeds(cardUsd, limits.warnUsdPerCard)) {
      warnings.push(
        `La card ${cardId} ya gastó ${formatUsd(cardUsd)}, por encima del umbral ` +
          `de ${formatUsd(limits.warnUsdPerCard)}. Costo excesivo para un requisito.`,
      )
    }
  }

  // 2. Fase
  if (phase) {
    const phaseBudget = limits.perPhaseUsd[phase]
    const phaseUsd = ledger.byPhase[phase]?.usd ?? 0
    if (phaseBudget !== undefined && exceeds(phaseUsd, phaseBudget)) {
      return {
        allowed: false,
        reason:
          `La fase "${phase}" gastó ${formatUsd(phaseUsd)} y su presupuesto es ` +
          `${formatUsd(phaseBudget)}. La corrida total va en ${formatUsd(ledger.total.usd)}.`,
        breached: "phase-usd",
        current,
        warnings,
      }
    }
  }

  // 3. Costo total
  if (exceeds(ledger.total.usd, limits.maxUsdPerRun)) {
    return {
      allowed: false,
      reason:
        `La corrida gastó ${formatUsd(ledger.total.usd)} y el presupuesto total es ` +
        `${formatUsd(limits.maxUsdPerRun)}.`,
      breached: "run-usd",
      current,
      warnings,
    }
  }

  // 4. Tokens
  if (exceeds(runTokens, limits.maxTokensPerRun)) {
    return {
      allowed: false,
      reason:
        `La corrida consumió ${formatInt(runTokens)} tokens y el presupuesto es ` +
        `${formatInt(limits.maxTokensPerRun)}.`,
      breached: "run-tokens",
      current,
      warnings,
    }
  }

  // 5. Wall clock
  if (exceeds(ledger.total.wallClockMs, limits.maxWallClockMsPerRun)) {
    return {
      allowed: false,
      reason:
        `La corrida lleva ${formatDuration(ledger.total.wallClockMs)} y el presupuesto ` +
        `es ${formatDuration(limits.maxWallClockMsPerRun)}.`,
      breached: "wall-clock",
      current,
      warnings,
    }
  }

  return {
    allowed: true,
    reason:
      `Dentro de presupuesto: ${formatUsd(ledger.total.usd)} de ${formatUsd(limits.maxUsdPerRun)}, ` +
      `${formatInt(runTokens)} de ${formatInt(limits.maxTokensPerRun)} tokens, ` +
      `${formatDuration(ledger.total.wallClockMs)} de ${formatDuration(limits.maxWallClockMsPerRun)}.`,
    breached: null,
    current,
    warnings,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Estimación
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estimación previa a una corrida grande.
 *
 * Es una proyección lineal y declaradamente burda: multiplica cards por
 * agentes por llamadas por costo promedio. Sirve para decidir si la corrida
 * entra en el presupuesto antes de empezarla, no para reemplazar la
 * contabilidad real.
 *
 * La nota dice explícitamente los supuestos, porque una estimación sin
 * supuestos es una prophecy.
 */
export function estimateRun(
  cards: number,
  agentsPerCard: number,
  avgCallsPerAgent: number,
  avgUsdPerCall: number,
): { usd: number; tokens: number; note: string } {
  const invalid =
    !Number.isFinite(cards) ||
    !Number.isFinite(agentsPerCard) ||
    !Number.isFinite(avgCallsPerAgent) ||
    !Number.isFinite(avgUsdPerCall) ||
    cards < 0 ||
    agentsPerCard < 0 ||
    avgCallsPerAgent < 0 ||
    avgUsdPerCall < 0

  const c = invalid ? 0 : cards
  const a = invalid ? 0 : agentsPerCard
  const k = invalid ? 0 : avgCallsPerAgent
  const price = invalid ? 0 : avgUsdPerCall

  const calls = c * a * k
  const usd = roundUsd(calls * price)
  const tokens = Math.round(calls * ASSUMED_TOKENS_PER_CALL)

  const note = invalid
    ? "Entradas inválidas: se devuelve una estimación de cero. Se esperan números no negativos."
    : `Estimación lineal: ${c} cards × ${a} agentes × ${k} llamadas = ${formatInt(calls)} llamadas. ` +
      `A ${formatUsd(price)} por llamada ≈ ${formatUsd(usd)} de costo total. ` +
      `Tokens estimados a ${formatInt(ASSUMED_TOKENS_PER_CALL)} por llamada ` +
      `(8k de entrada + 2k de salida) ≈ ${formatInt(tokens)}. ` +
      `Supuesto: los agentes no releen el mismo contexto; si lo hacen, el costo real sube. ` +
      `El cache de lectura puede bajar la cifra; los tokens de razonamiento la suben.`

  return { usd, tokens, note }
}

// ─────────────────────────────────────────────────────────────────────────────
// Informe
// ─────────────────────────────────────────────────────────────────────────────

/** Presión sobre un límite: cuánto se consumió contra cuánto había. */
interface LimitPressure {
  key: string
  label: string
  used: number
  max: number
  ratio: number
  format: "usd" | "tokens" | "ms"
}

/** Calcula la presión de cada límite para detectar el más cercano de romperse. */
function limitPressures(ledger: CostLedger, limits: CostLimits): LimitPressure[] {
  const rows: LimitPressure[] = []

  const worstCard = Object.values(ledger.byCard).reduce(
    (max, card) => (card.usd > max ? card.usd : max),
    0,
  )

  rows.push({
    key: "run-usd",
    label: "Costo total de la corrida",
    used: ledger.total.usd,
    max: limits.maxUsdPerRun,
    ratio: safeRatio(ledger.total.usd, limits.maxUsdPerRun),
    format: "usd",
  })

  rows.push({
    key: "card-usd",
    label: "Costo de la card más cara",
    used: worstCard,
    max: limits.maxUsdPerCard,
    ratio: safeRatio(worstCard, limits.maxUsdPerCard),
    format: "usd",
  })

  const tokens = totalTokens(ledger.total.tokens)
  rows.push({
    key: "run-tokens",
    label: "Tokens totales",
    used: tokens,
    max: limits.maxTokensPerRun,
    ratio: safeRatio(tokens, limits.maxTokensPerRun),
    format: "tokens",
  })

  rows.push({
    key: "wall-clock",
    label: "Wall clock de la corrida",
    used: ledger.total.wallClockMs,
    max: limits.maxWallClockMsPerRun,
    ratio: safeRatio(ledger.total.wallClockMs, limits.maxWallClockMsPerRun),
    format: "ms",
  })

  for (const phase of WORK_PHASES) {
    const budget = limits.perPhaseUsd[phase]
    if (budget === undefined) continue
    const used = ledger.byPhase[phase]?.usd ?? 0
    rows.push({
      key: `phase-usd:${phase}`,
      label: `Fase ${phase}`,
      used,
      max: budget,
      ratio: safeRatio(used, budget),
      format: "usd",
    })
  }

  return rows
}

/** Uso de un límite, donde 0 / Infinity significa "sin límite". */
function safeRatio(used: number, max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 0
  return used / max
}

/** Formatea un valor según el tipo de la fila de límite. */
function formatLimitValue(value: number, format: LimitPressure["format"]): string {
  if (format === "usd") return formatUsd(value)
  if (format === "tokens") return formatInt(value)
  return formatDuration(value)
}

/**
 * Renderiza el ledger como markdown.
 *
 * El informe tiene que servir para dos lecturas: la del humano que quiere
 * saber cuánto costó la corrida, y la del director que quiere saber qué
 * cortar primero. Por eso el cierre no es un número suelto sino el límite
 * con más presión.
 */
export function renderCostReport(ledger: CostLedger, limits: CostLimits): string {
  const lines: string[] = []
  const tokens = ledger.total.tokens

  lines.push(`# Costo — corrida \`${ledger.runId}\``)
  lines.push("")
  lines.push(`**Inicio:** ${ledger.startedAt} · **Actualizado:** ${ledger.updatedAt}`)
  lines.push("")

  // ── Totales ──
  lines.push("## Totales")
  lines.push("")
  lines.push("| Métrica | Valor |")
  lines.push("|---|---|")
  lines.push(`| USD | ${formatUsd(ledger.total.usd)}${
    // Un modelo gratis reporta 0. Sin esta nota, un ledger con 40 llamadas
    // y 0 dolares parece un bug de contabilidad.
    ledger.total.usd === 0 && ledger.total.calls > 0 ? " (modelo sin costo por token)" : ""
  } |`)
  lines.push(`| Tokens | ${formatInt(totalTokens(tokens))} |`)
  lines.push(`| └ entrada | ${formatInt(tokens.input)} |`)
  lines.push(`| └ salida | ${formatInt(tokens.output)} |`)
  lines.push(`| └ razonamiento | ${formatInt(tokens.reasoning)} |`)
  lines.push(`| └ cache lectura | ${formatInt(tokens.cacheRead)} |`)
  lines.push(`| └ cache escritura | ${formatInt(tokens.cacheWrite)} |`)
  lines.push(`| Llamadas | ${formatInt(ledger.total.calls)} |`)
  lines.push(`| Wall clock | ${formatDuration(ledger.total.wallClockMs)} |`)
  lines.push("")

  // ── Por card ──
  lines.push("## Por card")
  lines.push("")
  const cards = Object.values(ledger.byCard).sort((a, b) => b.usd - a.usd || cmpStr(a.cardId, b.cardId))
  if (cards.length === 0) {
    lines.push("_Sin cards registradas._")
  } else {
    lines.push("| Card | USD | Tokens | Llamadas | % del límite |")
    lines.push("|---|---|---|---|---|")
    for (const card of cards) {
      const ratio = safeRatio(card.usd, limits.maxUsdPerCard)
      const flag = exceeds(card.usd, limits.warnUsdPerCard) ? " ⚠️" : ""
      lines.push(
        `| \`${card.cardId}\`${flag} | ${formatUsd(card.usd)} | ${formatInt(totalTokens(card.tokens))} | ` +
          `${formatInt(card.calls)} | ${formatPercent(ratio)} |`,
      )
    }
  }
  lines.push("")

  // ── Por agente ──
  lines.push("## Por agente")
  lines.push("")
  const agents = Object.values(ledger.byAgent).sort((a, b) => b.usd - a.usd || cmpStr(a.agentId, b.agentId))
  if (agents.length === 0) {
    lines.push("_Sin agentes registrados._")
  } else {
    lines.push("| Agente | Rol | Modelo | USD | Tokens | Llamadas | Latencia media |")
    lines.push("|---|---|---|---|---|---|---|")
    for (const agent of agents) {
      const avg = agent.calls > 0 ? agent.latencyMs / agent.calls : 0
      const model = agent.model
        ? `${agent.model}${agent.provider ? ` (${agent.provider})` : ""}`
        : "—"
      lines.push(
        `| \`${agent.agentId}\` | ${agent.role || "—"} | ${model} | ${formatUsd(agent.usd)} | ` +
          `${formatInt(totalTokens(agent.tokens))} | ${formatInt(agent.calls)} | ${formatDuration(avg)} |`,
      )
    }
  }
  lines.push("")

  // ── Por fase ──
  lines.push("## Por fase")
  lines.push("")
  const phases = Object.values(ledger.byPhase).sort((a, b) => b.usd - a.usd || cmpStr(a.phase, b.phase))
  if (phases.length === 0) {
    lines.push("_Sin fases registradas._")
  } else {
    lines.push("| Fase | USD | Tokens | Llamadas | Presupuesto | % |")
    lines.push("|---|---|---|---|---|---|")
    for (const phase of phases) {
      const budget = limits.perPhaseUsd[phase.phase]
      const ratio = safeRatio(phase.usd, budget ?? 0)
      lines.push(
        `| ${phase.phase} | ${formatUsd(phase.usd)} | ${formatInt(totalTokens(phase.tokens))} | ` +
          `${formatInt(phase.calls)} | ${budget === undefined ? "—" : formatUsd(budget)} | ${formatPercent(ratio)} |`,
      )
    }
  }
  lines.push("")

  // ── Límites ──
  lines.push("## Límites")
  lines.push("")
  lines.push("| Límite | Actual | Máximo | Uso |")
  lines.push("|---|---|---|---|")
  for (const row of limitPressures(ledger, limits)) {
    const unlimited = !Number.isFinite(row.max) || row.max <= 0
    lines.push(
      `| ${row.label} | ${formatLimitValue(row.used, row.format)} | ` +
        `${unlimited ? "sin límite" : formatLimitValue(row.max, row.format)} | ${formatPercent(row.ratio)} |`,
    )
  }
  lines.push("")

  // ── El más cerca de romperse ──
  const pressured = limitPressures(ledger, limits)
    .filter((row) => Number.isFinite(row.max) && row.max > 0)
    .sort((a, b) => b.ratio - a.ratio || cmpStr(a.key, b.key))
  const closest = pressured[0]

  if (closest) {
    lines.push(
      `**Más cerca de romperse:** \`${closest.key}\` — ${formatPercent(closest.ratio)} del presupuesto ` +
        `(${formatLimitValue(closest.used, closest.format)} de ${formatLimitValue(closest.max, closest.format)}).`,
    )
  } else {
    lines.push("**Más cerca de romperse:** sin límites definidos.")
  }
  lines.push("")

  // ── Avisos ──
  const warned = cards.filter((card) => exceeds(card.usd, limits.warnUsdPerCard))
  if (warned.length > 0) {
    lines.push("## Avisos")
    lines.push("")
    for (const card of warned) {
      lines.push(
        `- La card \`${card.cardId}\` gastó ${formatUsd(card.usd)}, por encima del umbral de ` +
          `${formatUsd(limits.warnUsdPerCard)}.`,
      )
    }
    lines.push("")
  }

  return lines.join("\n")
}

// ─────────────────────────────────────────────────────────────────────────────
// Trabajo redundante
// ─────────────────────────────────────────────────────────────────────────────

/** Tools que leen un archivo. */
const READ_TOOLS = new Set([
  "read",
  "readfile",
  "view",
  "cat",
  "open",
  "openfile",
  "notebookread",
  "getfile",
])

/** Tools que ejecutan un comando. */
const COMMAND_TOOLS = new Set([
  "bash",
  "sh",
  "shell",
  "zsh",
  "cmd",
  "powershell",
  "pwsh",
  "exec",
  "execute",
  "command",
  "run",
  "runcommand",
  "terminal",
])

/**
 * Clasifica una tool como lectura, comando o ninguna.
 *
 * Se miran los nombres conocidos y, si no alcanzan, prefijos y subcadenas:
 * el nombre exacto de la tool cambia entre versiones del motor y no vale la
 * pena romperse por eso. Las tools de mutación (edit, write) NO se cuentan:
 * repetir una escritura no es trabajo redundante, es una reescritura.
 */
function classifyTool(tool: string): "read" | "command" | null {
  const key = tool.toLowerCase().replace(/[^a-z0-9]/g, "")
  if (!key) return null
  if (READ_TOOLS.has(key)) return "read"
  if (COMMAND_TOOLS.has(key)) return "command"
  if (key.startsWith("read")) return "read"
  if (/(bash|shell|exec|command|terminal|powershell)/.test(key)) return "command"
  return null
}

/** Normaliza un path de lectura: separadores Windows y Unix son el mismo archivo. */
function normalizeReadTarget(target: string): string {
  return target.trim().replace(/\\/g, "/")
}

/** Normaliza un comando: los espacios de más no cambian el comando. */
function normalizeCommandTarget(target: string): string {
  return target.trim().replace(/\s+/g, " ")
}

/**
 * Detecta trabajo redundante en la traza de tools de un agente.
 *
 * Esto es lo que el review pidió medir: "cuántas veces un agente vuelve a leer
 * el mismo contexto". Un agente que lee el mismo archivo cinco veces está
 * paying cinco veces por la misma información, y eso no lo detecta ningún
 * presupuesto de conteo de agentes.
 *
 * Dos precisiones importantes:
 * - La redundancia se cuenta POR AGENTE: dos agentes distintos que leen el
 *   mismo archivo no es redundancia (cada uno necesita su contexto). El
 *   `count` que se reporta, en cambio, agrega por archivo entre agentes.
 * - `wastedFraction` se calcula sobre los eventos de lectura y ejecución con
 *   objetivo: la fracción que fue repetición de algo que ese mismo agente ya
 *   tenía.
 */
export function detectRedundantWork(events: ToolEvent[]): RedundancyReport {
  const readCounts = new Map<string, number>()
  const commandCounts = new Map<string, number>()
  const seen = new Set<string>()
  let considered = 0
  let redundant = 0

  for (const event of events) {
    const kind = classifyTool(event.tool)
    if (!kind) continue
    if (!event.target) continue
    const target = kind === "read" ? normalizeReadTarget(event.target) : normalizeCommandTarget(event.target)
    if (!target) continue

    considered += 1
    const key = `${event.agentId}|${kind}|${target}`
    if (seen.has(key)) redundant += 1
    else seen.add(key)

    const counts = kind === "read" ? readCounts : commandCounts
    counts.set(target, (counts.get(target) ?? 0) + 1)
  }

  const repeatedReads = [...readCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([target, count]) => ({ target, count }))
    .sort((a, b) => b.count - a.count || cmpStr(a.target, b.target))

  const repeatedCommands = [...commandCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([target, count]) => ({ target, count }))
    .sort((a, b) => b.count - a.count || cmpStr(a.target, b.target))

  const wastedFraction = considered === 0 ? 0 : redundant / considered

  const readOccurrences = repeatedReads.reduce((sum, item) => sum + item.count, 0)
  const commandOccurrences = repeatedCommands.reduce((sum, item) => sum + item.count, 0)

  let summary: string
  if (considered === 0) {
    summary = "Sin eventos de lectura o ejecución con objetivo: no hay redundancia que medir."
  } else {
    const top = repeatedReads[0] ?? repeatedCommands[0]
    const topText = top ? ` El peor caso es "${top.target}" (${top.count} veces).` : ""
    summary =
      `Se repitieron ${repeatedReads.length} path(s) de lectura (${readOccurrences} ocurrencias) y ` +
      `${repeatedCommands.length} comando(s) (${commandOccurrences} ocurrencias). ` +
      `${redundant} de ${considered} eventos (${formatPercent(wastedFraction)}) fueron repeticiones ` +
      `del mismo agente sobre material que ya tenía.${topText}`
  }

  return { repeatedReads, repeatedCommands, wastedFraction, summary }
}
