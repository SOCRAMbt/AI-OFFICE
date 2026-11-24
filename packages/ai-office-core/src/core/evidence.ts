/**
 * Requirement-to-Evidence Graph: la capa que falta entre "compila" y "está".
 *
 * Los gates técnicos dicen que el código no está roto. No dicen que la card
 * resolvió lo que el usuario pidió. Una card puede compilar, pasar lint,
 * pasar todos los tests y aun así tener la autenticación mal, porque ningún
 * test contemplaba ese escenario: el criterio de aceptación era "el login
 * valida credenciales" y la suite solo verificaba que `login()` devolvía 200.
 *
 * Este módulo cierra ese hueco. Cada criterio de aceptación se convierte en
 * un nodo de requisito; cada evidencia (artefacto, test, gate, inspección,
 * evidencia externa) se engancha a un requisito con un nivel de verificación.
 * La regla que gobierna todo el módulo: si a un requisito obligatorio le
 * falta evidencia suficiente, la card NO puede declararse done.
 *
 * Decisiones de diseño que conviene no romper:
 *
 * 1. La pirámide de niveles ordena CONFianza, no cantidad:
 *    1 = estático (compila, lintea), 2 = comportamiento (algo lo ejercita),
 *    3 = validación de requisitos (alguien lo contrastó contra el criterio),
 *    4 = auditoría independiente (otro agente, no el owner, lo revisó).
 *    `reachedLevel` es el MÁXIMO de la evidencia del requisito, nunca el
 *    promedio: promediar dejaría pasar una card con un test y cinco gates
 *    cuando ningún requisito tiene un test.
 *
 * 2. El módulo no llama a `Date.now()`. Todo timestamp entra por `clock` o
 *    por `recordedAt`; sin ninguno se usa un epoch fijo. Un grafo que depende
 *    del reloj no es reproducible y sus tests miden el reloj, no el grafo.
 *
 * 3. No hay IO. Todo entra por parámetros y sale por el return. El módulo no
 *    sabe dónde viven los artefactos: recibe rutas como strings.
 *
 * 4. La evidencia se vincula por el TEXTO EXACTO del criterio de aceptación,
 *    no por índice, porque el texto es lo que el humano lee y lo que el
 *    Commander escribió; el índice solo desambigua duplicados. Si el texto no
 *    coincide, la evidencia se engancha igual por índice pero queda un riesgo
 *    visible: prefiero evidencia mal etiquetada con riesgo a evidencia
 *    perdida en silencio.
 *
 * 5. El módulo no importa `Card` de `types.ts`. Necesita el id y los
 *    criterios de aceptación, y nada más: acoplarse al schema completo de la
 *    card haría que cada cambio de card_schema rompiera el grafo de evidencia
 *    sin que tenga relación alguna con él.
 */

import path from "node:path"

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nivel de verificación alcanzado por una evidencia.
 *
 * La pirámide: 1 estático, 2 comportamiento, 3 validación de requisitos,
 * 4 auditoría independiente.
 */
export type VerificationLevel = 1 | 2 | 3 | 4

/** Naturaleza de una evidencia. */
export type EvidenceKind =
  | "artifact" // un archivo de .oficina/artifacts/<card>/
  | "test" // un test citado que verifica el requisito
  | "gate" // un resultado de gate
  | "inspection" // una inspección manual documentada
  | "external" // evidencia externa (link, captura, etc.)

/** Una evidencia concreta, atada a un requisito. */
export interface EvidenceNode {
  id: string
  cardId: string
  /** Texto exacto del criterio de aceptación que esta evidencia respalda. */
  requirement: string
  /** Índice del criterio de aceptación (0-based). -1 si se desconoce. */
  requirementIndex: number
  /** Si el criterio respaldado es obligatorio. */
  mandatory: boolean
  kind: EvidenceKind
  level: VerificationLevel
  /** Ruta del artefacto, nombre del test, id del gate. */
  ref: string
  note: string
  /** ISO. */
  recordedAt: string
  /** Id del agente que la registró. */
  recordedBy: string
  /**
   * `false` cuando la evidencia documenta un FALLO (un gate rojo, un test
   * que se rompió). En ese caso no suma al nivel alcanzado: documentar que
   * algo falló es honestidad, no verificación.
   */
  passed?: boolean
}

/** Un criterio de aceptación con la evidencia que lo respalda. */
export interface RequirementNode {
  id: string
  cardId: string
  requirement: string
  index: number
  mandatory: boolean
  evidence: EvidenceNode[]
  /** Nivel más alto alcanzado por la evidencia. 0 = sin evidencia. */
  reachedLevel: VerificationLevel | 0
  status: "satisfied" | "partial" | "unsatisfied"
  /** Riesgos pendientes sobre este requisito. */
  risks: string[]
}

/** El grafo completo de una card. */
export interface EvidenceGraph {
  cardId: string
  requirements: RequirementNode[]
  /** Requisitos obligatorios sin evidencia suficiente. */
  missingMandatory: string[]
  /** true solo si todos los obligatorios están satisfied. */
  complete: boolean
  /** Nivel global más bajo entre los requisitos obligatorios. 0 si no hay. */
  minLevel: VerificationLevel | 0
  summary: string
  /**
   * Nivel exigido con el que se construyó el grafo.
   *
   * Vive en el grafo para que `addEvidence` pueda recomputar el estado de un
   * requisito con el mismo criterio con el que se lo evaluó al inicio. Si
   * quien arma el grafo no lo setea, se usa `DEFAULT_REQUIRED_LEVEL`.
   */
  requiredLevel?: VerificationLevel
  /** Evidencia que no se pudo vincular a ningún criterio de aceptación. */
  orphanedEvidence?: EvidenceNode[]
}

/**
 * Datos de la card que el grafo necesita.
 *
 * Una `Card` completa del sistema satisface esta forma: el grafo no necesita
 * el estado, el owner ni el scope, solo los criterios de aceptación y el id.
 */
export interface EvidenceCard {
  id: string
  acceptance: string[]
}

/** Opciones de construcción del grafo. */
export interface GraphOptions {
  /**
   * Cuántos criterios de aceptación son obligatorios, contados desde el
   * primero. Por defecto 2.
   */
  mandatoryCount?: number
  /**
   * Índices explícitos de criterios obligatorios. Si viene, gana sobre
   * `mandatoryCount`: hay cards cuyo criterio obligatorio no es el primero
   * (por ejemplo, el segundo es el que corta el objetivo).
   */
  mandatoryIndexes?: number[]
  /** Nivel mínimo para considerar un requisito `satisfied`. Por defecto 2. */
  requiredLevel?: VerificationLevel
  /** Reloj inyectable. Sin reloj ni `recordedAt`, se usa un epoch fijo. */
  clock?: () => number
  /** Timestamp fijo para toda la evidencia del grafo. */
  recordedAt?: string
}

/** Opciones de construcción de una evidencia. */
export interface EvidenceOptions {
  /** Índice del criterio de aceptación al que se vincula. */
  requirementIndex?: number
  /** Si el criterio es obligatorio. Se sincroniza al vincular la evidencia. */
  mandatory?: boolean
  note?: string
  /** Id del agente que registra la evidencia. */
  recordedBy?: string
  /** Timestamp ISO. */
  recordedAt?: string
  /** Reloj inyectable. */
  clock?: () => number
  /** Nivel explícito. Se recorta al máximo que admite cada tipo de evidencia. */
  level?: VerificationLevel
  /** Owner de la card, para distinguir inspección de auditoría. */
  owner?: string
  /** Revisor de la card, para distinguir inspección de auditoría. */
  reviewer?: string
}

/** Límites de cierre exigidos por quien decide si la card puede terminar. */
export interface EvidenceLimits {
  /**
   * Nivel mínimo exigido. Por defecto 2 (comportamiento). Si el grafo se
   * construyó con un nivel más estricto, manda el más estricto: nadie baja
   * el listón por pedido.
   */
  requiredLevel?: VerificationLevel
  /**
   * Si una card sin criterios de aceptación puede cerrarse. Por defecto no:
   * sin criterios no hay nada verificable, y dar por cumplidos requisitos
   * inexistentes es exactamente el agujero que este módulo tapa.
   */
  requireAcceptance?: boolean
}

/**
 * Forma mínima de un resultado de gate que este módulo sabe leer.
 *
 * Se declara estructuralmente, sin importar `GateResult` de `types.ts`, a
 * propósito: el grafo de evidencia tiene que sobrevivir a un cambio en la
 * representación interna de los gates. Si el objeto trae `phase`/`outcome`
 * (una fase) o `technical[]` (un gate completo), el módulo lo entiende.
 */
export interface GateEvidenceInput {
  phase?: string
  outcome?: string
  detail?: string
  reason?: string
  passed?: boolean
  technical?: GateEvidenceInput[]
  security?: GateEvidenceInput[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────────────────────

/** Cuántos criterios de aceptación son obligatorios por defecto. */
export const DEFAULT_MANDATORY_COUNT = 2

/** Nivel de evidencia exigido por defecto: comportamiento, no estático. */
export const DEFAULT_REQUIRED_LEVEL: VerificationLevel = 2

/**
 * Epoch por defecto para la evidencia sin reloj inyectado.
 *
 * Feo a propósito: mejor una fecha obviamente sintética que un timestamp
 * silenciosamente dependiente del momento en que corrió el test.
 */
export const DEFAULT_RECORDED_AT = "1970-01-01T00:00:00.000Z"

/** Agente por defecto cuando nadie dice quién registró la evidencia. */
export const DEFAULT_RECORDED_BY = "unknown"

/**
 * Nivel máximo que puede alcanzar cada tipo de evidencia.
 *
 * Un artefacto es una descripción del trabajo, no el trabajo: describe
 * comportamiento pero no lo demuestra más allá de lo que el autor afirma.
 * Por eso tope 2. La inspección manual llega a 3. Solo una revisión de otro
 * agente, que puede decir "esto no cumple", llega a 4.
 */
const KIND_MAX_LEVEL: Record<EvidenceKind, VerificationLevel> = {
  artifact: 2,
  test: 2,
  gate: 2,
  inspection: 4,
  external: 4,
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────────────────────────

/** Convierte un número a nivel válido. Cualquier cosa fuera de 1..4 es 0. */
function toLevel(value: number): VerificationLevel | 0 {
  if (value === 1) return 1
  if (value === 2) return 2
  if (value === 3) return 3
  if (value === 4) return 4
  return 0
}

/** Recorta un nivel al máximo que admite su tipo de evidencia. */
function clampLevel(level: number, max: VerificationLevel): VerificationLevel {
  const capped = toLevel(Math.min(Math.max(Math.trunc(level), 1), 4))
  if (capped === 0) return 1
  return capped <= max ? capped : max
}

/** Slug estable para ids y refs: sin acentos, sin mayúsculas, sin ruido. */
function slugify(text: string): string {
  // `Diacritic` es la forma Unicode de quitar las marcas combinantes que
  // deja NFD ("autenticación" -> "autenticacion") sin escribir un rango de
  // caracteres combinantes a mano.
  const normalized = text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return normalized.slice(0, 48) || "ref"
}

/** Id estable de un nodo de requisito. */
export function requirementId(cardId: string, index: number): string {
  return `req-${slugify(cardId)}-${index}`
}

/** Id estable de un nodo de evidencia. */
export function evidenceId(cardId: string, requirementIndex: number, kind: EvidenceKind, ref: string): string {
  const idx = requirementIndex >= 0 ? String(requirementIndex) : "x"
  return `ev-${slugify(cardId)}-${idx}-${kind}-${slugify(ref)}`
}

/**
 * Resuelve el timestamp de una evidencia.
 *
 * Precedencia: `recordedAt` explícito > `clock` inyectado > epoch fijo.
 */
function resolveRecordedAt(opts: { recordedAt?: string; clock?: () => number }): string {
  if (opts.recordedAt) return opts.recordedAt
  if (opts.clock) return new Date(opts.clock()).toISOString()
  return DEFAULT_RECORDED_AT
}

/** Índices de criterios obligatorios. */
function resolveMandatoryIndexes(total: number, options: GraphOptions): Set<number> {
  if (options.mandatoryIndexes) {
    return new Set(options.mandatoryIndexes.filter((i) => i >= 0 && i < total))
  }
  const count = Math.min(Math.max(options.mandatoryCount ?? DEFAULT_MANDATORY_COUNT, 0), total)
  return new Set(Array.from({ length: count }, (_, i) => i))
}

/** Escapa texto para una celda de tabla markdown. */
function escapeCell(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\|/g, "\\|")
}

// ─────────────────────────────────────────────────────────────────────────────
// Construcción
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Crea un nodo de requisito por cada criterio de aceptación de la card.
 *
 * Los primeros `mandatoryCount` criterios (2 por defecto) quedan obligatorios.
 * La obligatoriedad existe porque no todos los criterios cortan el objetivo:
 * "el botón dice Hola" puede quedar sin probar y la card sigue sirviendo,
 * pero "el login valida credenciales" no.
 */
export function buildRequirementNodes(card: EvidenceCard, options: GraphOptions = {}): RequirementNode[] {
  const mandatory = resolveMandatoryIndexes(card.acceptance.length, options)
  return card.acceptance.map((requirement, index) => ({
    id: requirementId(card.id, index),
    cardId: card.id,
    requirement,
    index,
    mandatory: mandatory.has(index),
    evidence: [],
    reachedLevel: 0,
    status: "unsatisfied",
    risks: [],
  }))
}

/**
 * Recalcula el estado derivado de un requisito a partir de su evidencia.
 *
 * Todo el estado (`reachedLevel`, `status`, `risks`) se deriva de la
 * evidencia, nunca se anota a mano: si el estado puede quedar desincronizado
 * con los hechos, el grafo miente.
 */
function recomputeRequirement(req: RequirementNode, requiredLevel: VerificationLevel): RequirementNode {
  const valid = req.evidence.filter((e) => e.passed !== false)

  let reached: VerificationLevel | 0 = 0
  for (const e of valid) {
    reached = reached === 0 ? e.level : toLevel(Math.max(reached, e.level))
  }

  const status: RequirementNode["status"] =
    reached === 0 ? "unsatisfied" : reached >= requiredLevel ? "satisfied" : "partial"

  const risks: string[] = []
  for (const e of req.evidence) {
    if (e.passed === false) {
      risks.push(`Hay evidencia que documenta un fallo: ${e.ref}`)
    }
    if (e.requirement !== req.requirement) {
      risks.push(`La evidencia ${e.ref} cita «${e.requirement}», que no es el texto del criterio`)
    }
  }
  if (valid.length > 0 && reached < requiredLevel) {
    risks.push(`Nivel de evidencia insuficiente: ${reached} < ${requiredLevel}`)
  }
  if (req.mandatory && req.evidence.length === 0) {
    risks.push("Sin evidencia registrada para un requisito obligatorio")
  }

  return { ...req, evidence: [...req.evidence], reachedLevel: reached, status, risks }
}

/**
 * Recalcula los campos derivados del grafo completo.
 *
 * `missingMandatory` incluye tanto los requisitos obligatorios SIN evidencia
 * como los que tienen evidencia por debajo del nivel exigido: en los dos
 * casos falta evidencia *suficiente*, que es lo que importa para cerrar.
 */
function recompute(graph: EvidenceGraph): EvidenceGraph {
  const requiredLevel = graph.requiredLevel ?? DEFAULT_REQUIRED_LEVEL
  const requirements = graph.requirements.map((r) => recomputeRequirement(r, requiredLevel))
  const mandatory = requirements.filter((r) => r.mandatory)

  const missingMandatory = mandatory
    .filter((r) => r.status !== "satisfied")
    .map((r) => r.requirement)

  let minLevel: VerificationLevel | 0 = 0
  if (mandatory.length > 0) {
    minLevel = mandatory[0]!.reachedLevel
    for (const r of mandatory) {
      minLevel = toLevel(Math.min(minLevel, r.reachedLevel))
    }
  }

  const complete = missingMandatory.length === 0

  let summary: string
  if (mandatory.length === 0) {
    summary =
      requirements.length === 0
        ? "La card no declara criterios de aceptación: no hay nada que verificar."
        : `${requirements.length} criterio(s) de aceptación, ninguno obligatorio.`
  } else if (complete) {
    summary = `Los ${mandatory.length} requisito(s) obligatorio(s) tienen evidencia suficiente (nivel mínimo ${minLevel}).`
  } else {
    summary = `Faltan ${missingMandatory.length} requisito(s) obligatorio(s): ${missingMandatory.join("; ")}.`
  }

  return { ...graph, requirements, missingMandatory, complete, minLevel, summary }
}

/**
 * Encuentra el requisito al que pertenece una evidencia.
 *
 * Primero por texto exacto (la identidad del criterio es su texto); el
 * índice solo desambigua duplicados. Si el texto no coincide con ninguno, se
 * cae al índice: la evidencia se guarda y la discrepancia queda registrada
 * como riesgo en el requerimiento.
 */
function resolveTarget(requirements: RequirementNode[], node: EvidenceNode): RequirementNode | undefined {
  if (requirements.length === 0) return undefined

  const exact = requirements.filter((r) => r.requirement === node.requirement)
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) {
    return exact.find((r) => r.index === node.requirementIndex) ?? exact[0]
  }

  return requirements.find((r) => r.index === node.requirementIndex)
}

/**
 * Agrega una evidencia al grafo y recalcula el estado.
 *
 * La función es pura: no muta el grafo recibido, devuelve uno nuevo. Quien
 * la llame puede conservar el anterior para comparar versiones.
 */
export function addEvidence(graph: EvidenceGraph, node: EvidenceNode): EvidenceGraph {
  const requirements = graph.requirements.map((r) => ({ ...r, evidence: [...r.evidence] }))
  const target = resolveTarget(requirements, node)

  if (!target) {
    const orphans = [...(graph.orphanedEvidence ?? []), node]
    return recompute({ ...graph, requirements, orphanedEvidence: orphans })
  }

  // El flag `mandatory` de la evidencia lo manda el requisito: el criterio
  // manda sobre lo que diga la evidencia, no al revés.
  target.evidence.push({ ...node, mandatory: target.mandatory })
  return recompute({ ...graph, requirements })
}

/**
 * Construye el grafo de evidencia de una card.
 *
 * Es el camino normal: se pasa la card, la lista de evidencia y las opciones.
 * La evidencia se aplica en orden, así que el orden de la lista importa
 * para el orden interno (no para el estado, que se recalcula siempre).
 */
export function buildEvidenceGraph(
  card: EvidenceCard,
  evidence: EvidenceNode[],
  options: GraphOptions = {},
): EvidenceGraph {
  const requiredLevel = options.requiredLevel ?? DEFAULT_REQUIRED_LEVEL
  let graph: EvidenceGraph = {
    cardId: card.id,
    requirements: buildRequirementNodes(card, options),
    missingMandatory: [],
    complete: false,
    minLevel: 0,
    summary: "",
    requiredLevel,
    orphanedEvidence: [],
  }
  for (const node of evidence) {
    graph = addEvidence(graph, node)
  }
  return recompute(graph)
}

// ─────────────────────────────────────────────────────────────────────────────
// Constructores de evidencia
// ─────────────────────────────────────────────────────────────────────────────

/** Base común de los constructores de evidencia. */
function makeEvidence(args: {
  cardId: string
  requirement: string
  kind: EvidenceKind
  level: VerificationLevel
  ref: string
  note: string
  passed: boolean
  opts: EvidenceOptions
}): EvidenceNode {
  const index = args.opts.requirementIndex ?? -1
  return {
    id: evidenceId(args.cardId, index, args.kind, args.ref),
    cardId: args.cardId,
    requirement: args.requirement,
    requirementIndex: index,
    mandatory: args.opts.mandatory ?? false,
    kind: args.kind,
    level: args.level,
    ref: args.ref,
    note: args.note,
    recordedAt: resolveRecordedAt(args.opts),
    recordedBy: args.opts.recordedBy ?? DEFAULT_RECORDED_BY,
    passed: args.passed,
  }
}

/**
 * Evidencia de artefacto: un archivo de `.oficina/artifacts/<cardId>/`.
 *
 * Tope nivel 2. Un `handoff.md` describe lo que el agente dice que hizo;
 * believe, but verify: el artefacto es el relato, no la ejecución.
 */
export function evidenceFromArtifact(
  artifactPath: string,
  cardId: string,
  requirement: string,
  opts: EvidenceOptions = {},
): EvidenceNode {
  const ref = artifactPath.replace(/\\/g, "/")
  return makeEvidence({
    cardId,
    requirement,
    kind: "artifact",
    level: clampLevel(opts.level ?? 2, KIND_MAX_LEVEL.artifact),
    ref,
    note: opts.note ?? `artefacto ${path.basename(ref)}`,
    passed: true,
    opts,
  })
}

/**
 * Evidencia de test: un test citado que ejercita el requisito.
 *
 * Tope nivel 2: un test demuestra comportamiento, no criterio de negocio
 * auditado. Si el test fue citado pero no lo cubre, el riesgo queda escrito
 * en la nota; la auditoría de nivel 4 es la que verifica esa cobertura.
 */
export function evidenceFromTest(
  testRef: string,
  cardId: string,
  requirement: string,
  opts: EvidenceOptions = {},
): EvidenceNode {
  return makeEvidence({
    cardId,
    requirement,
    kind: "test",
    level: clampLevel(opts.level ?? 2, KIND_MAX_LEVEL.test),
    ref: testRef,
    note: opts.note ?? `test ${testRef}`,
    passed: true,
    opts,
  })
}

/**
 * Elige qué fase de un gate se cita como evidencia.
 *
 * Se prefiere la fase de tests: es la única que ejercita comportamiento, así
 * que es la que aporta nivel 2. Si no hay fase de tests, se cita la primera
 * disponible (build, typecheck, lint…) que aporta nivel 1.
 */
function pickGatePhase(input: GateEvidenceInput): GateEvidenceInput {
  const phases = [...(input.technical ?? []), ...(input.security ?? [])]
  if (phases.length === 0) return input
  return phases.find((p) => p.phase === "test") ?? phases[0]!
}

/**
 * Evidencia de gate: el resultado de una fase ejecutada.
 *
 * Nivel 2 solo para la fase de tests; el resto de fases son estáticas
 * (nivel 1). Un gate que falló se registra igual, con `passed: false`: saber
 * qué se rompió es información, no verificación.
 */
export function evidenceFromGate(
  gateResult: GateEvidenceInput,
  cardId: string,
  requirement: string,
  opts: EvidenceOptions = {},
): EvidenceNode {
  const cited = pickGatePhase(gateResult)
  const phase = cited.phase ?? "gate"
  const level: VerificationLevel = phase === "test" ? 2 : 1
  const passed = cited.outcome !== undefined ? cited.outcome === "pass" : (cited.passed ?? false)
  const detail =
    opts.note ?? cited.detail ?? cited.reason ?? (cited.outcome ? `gate ${phase}: ${cited.outcome}` : `gate ${phase}`)

  return makeEvidence({
    cardId,
    requirement,
    kind: "gate",
    level: clampLevel(opts.level ?? level, KIND_MAX_LEVEL.gate),
    ref: `gate:${phase}`,
    note: detail,
    passed,
    opts,
  })
}

/**
 * Evidencia de inspección manual documentada.
 *
 * Una inspección es nivel 3: alguien se puso a contrastar el resultado
 * contra el criterio. Pasa a nivel 4 SOLO si la hizo un revisor distinto del
 * owner, porque ahí deja de ser la opinión del autor y pasa a ser una
 * auditoría que puede contradecirlo.
 */
export function evidenceFromInspection(
  inspectionRef: string,
  cardId: string,
  requirement: string,
  opts: EvidenceOptions = {},
): EvidenceNode {
  const isAudit = Boolean(opts.owner && opts.reviewer && opts.owner !== opts.reviewer)
  const level: VerificationLevel = isAudit ? 4 : 3
  return makeEvidence({
    cardId,
    requirement,
    kind: "inspection",
    level: clampLevel(opts.level ?? level, KIND_MAX_LEVEL.inspection),
    ref: inspectionRef,
    note: opts.note ?? (isAudit ? `auditoría de ${opts.reviewer} (owner: ${opts.owner})` : `inspección ${inspectionRef}`),
    passed: true,
    opts,
  })
}

/**
 * Evidencia de auditoría independiente: la revisó un agente que no es el
 * owner.
 *
 * A diferencia de `evidenceFromInspection`, acá el nivel 4 es parte del
 * contrato: si no hay owner y revisor distintos, la auditoría no ocurrió y
 * se lanza el error en vez de devolver una evidencia de nivel 3 con cara de
 * auditoría. Un "audit" que en realidad es auto-revisión es el peor de los
 * dos mundos: parece verificado y no lo está.
 */
export function evidenceFromAudit(
  auditRef: string,
  cardId: string,
  requirement: string,
  opts: EvidenceOptions = {},
): EvidenceNode {
  if (!opts.owner || !opts.reviewer) {
    throw new Error("Una auditoría requiere owner y reviewer: sin ambos no se puede afirmar independencia")
  }
  if (opts.owner === opts.reviewer) {
    throw new Error(`Una auditoría no puede tener al mismo owner y reviewer (${opts.owner})`)
  }
  return makeEvidence({
    cardId,
    requirement,
    kind: "inspection",
    level: clampLevel(opts.level ?? 4, KIND_MAX_LEVEL.inspection),
    ref: auditRef,
    note: opts.note ?? `auditoría de ${opts.reviewer} sobre el trabajo de ${opts.owner}`,
    passed: true,
    opts,
  })
}

/**
 * Evidencia externa: un link, una captura, un reporte de terceros.
 *
 * Nivel 1 por defecto. No se puede verificar desde adentro del repo, así que
 * por sí sola no demuestra comportamiento; quien la registra puede subirla de
 * nivel si documentó el contexto.
 */
export function evidenceFromExternal(
  externalRef: string,
  cardId: string,
  requirement: string,
  opts: EvidenceOptions = {},
): EvidenceNode {
  return makeEvidence({
    cardId,
    requirement,
    kind: "external",
    level: clampLevel(opts.level ?? 1, KIND_MAX_LEVEL.external),
    ref: externalRef,
    note: opts.note ?? `evidencia externa ${externalRef}`,
    passed: true,
    opts,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Veredicto de cierre
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ¿Se puede declarar `done` esta card?
 *
 * Es el corazón del módulo. Responde con una razón legible, en español, que
 * diga QUÉ falta — no solo que falta. Un "no" sin explicación hace que el
 * agente adivine y vuelva a hacer lo mismo.
 *
 * Reglas:
 * - Sin criterios de aceptación no hay nada verificable → no cierra.
 * - Si algún requisito obligatorio no está `satisfied` → no cierra.
 * - Si el nivel mínimo entre los obligatorios no alcanza el exigido → no cierra.
 */
export function canCloseCard(graph: EvidenceGraph, limits: EvidenceLimits = {}): { ok: boolean; reason: string } {
  const requireAcceptance = limits.requireAcceptance ?? true

  // El nivel exigido es el más estricto de los dos: el del grafo y el del
  // que evalúa. Nadie baja el listón por pedido.
  let requiredLevel = toLevel(
    Math.max(graph.requiredLevel ?? DEFAULT_REQUIRED_LEVEL, limits.requiredLevel ?? DEFAULT_REQUIRED_LEVEL),
  )
  if (requiredLevel === 0) requiredLevel = DEFAULT_REQUIRED_LEVEL

  if (requireAcceptance && graph.requirements.length === 0) {
    return {
      ok: false,
      reason:
        "La card no declara criterios de aceptación: no hay nada verificable, así que no puede declararse done.",
    }
  }

  if (graph.missingMandatory.length > 0) {
    const details = graph.requirements
      .filter((r) => r.mandatory && r.status !== "satisfied")
      .map((r) => `«${r.requirement}» (evidencia actual: nivel ${r.reachedLevel}, exigido: ${requiredLevel})`)
    return {
      ok: false,
      reason: `Falta evidencia suficiente para ${graph.missingMandatory.length} requisito(s) obligatorio(s): ${details.join("; ")}.`,
    }
  }

  // El chequeo de nivel solo aplica si hay requisitos obligatorios: `minLevel`
  // en 0 con cero obligatorios significa "no hay nada que medir", no "nivel 0
  // alcanzado". Confundir los dos volvería imposible de cerrar una card sin
  // requisitos obligatorios.
  const hasMandatory = graph.requirements.some((r) => r.mandatory)
  if (hasMandatory && graph.minLevel < requiredLevel) {
    return {
      ok: false,
      reason: `El nivel de evidencia mínimo entre los requisitos obligatorios (${graph.minLevel}) es inferior al exigido (${requiredLevel}).`,
    }
  }

  const mandatoryCount = graph.requirements.filter((r) => r.mandatory).length
  return {
    ok: true,
    reason: `Los ${mandatoryCount} requisito(s) obligatorio(s) tienen evidencia suficiente (nivel mínimo ${graph.minLevel}, exigido ${requiredLevel}).`,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Renderiza el grafo como markdown legible.
 *
 * Va al artefacto de la card: un humano tiene que poder leer, en treinta
 * segundos, si los criterios de aceptación del Commander están respaldados
 * o si son deseos.
 */
export function renderEvidenceGraph(graph: EvidenceGraph): string {
  const requiredLevel = graph.requiredLevel ?? DEFAULT_REQUIRED_LEVEL
  const lines: string[] = []

  lines.push(`# Grafo de evidencia — ${graph.cardId}`)
  lines.push("")
  lines.push(`**Resumen:** ${graph.summary}`)
  lines.push("")
  lines.push(`**Estado:** ${graph.complete ? "COMPLETO" : "INCOMPLETO"}`)
  lines.push("")
  lines.push(`**Nivel mínimo entre requisitos obligatorios:** ${graph.minLevel} (exigido: ${requiredLevel})`)
  lines.push("")
  lines.push("## Requisitos")
  lines.push("")
  lines.push("| # | Requisito | Obligatorio | Estado | Nivel | Evidencia |")
  lines.push("|---|-----------|-------------|--------|-------|-----------|")

  for (const r of graph.requirements) {
    lines.push(
      `| ${r.index + 1} | ${escapeCell(r.requirement)} | ${r.mandatory ? "sí" : "no"} | ${r.status} | ${r.reachedLevel} | ${r.evidence.length} |`,
    )
  }
  lines.push("")
  lines.push("## Detalle por requisito")
  lines.push("")

  for (const r of graph.requirements) {
    lines.push(`### ${r.index + 1}. ${r.requirement}`)
    lines.push("")
    lines.push(`- **Obligatorio:** ${r.mandatory ? "sí" : "no"}`)
    lines.push(`- **Estado:** ${r.status}`)
    lines.push(`- **Nivel alcanzado:** ${r.reachedLevel} / ${requiredLevel}`)
    lines.push("")

    if (r.evidence.length === 0) {
      lines.push("- Sin evidencia registrada.")
    } else {
      lines.push("**Evidencia:**")
      lines.push("")
      for (const e of r.evidence) {
        const flag = e.passed === false ? " — FALLIDA" : ""
        const note = e.note ? ` — ${e.note}` : ""
        lines.push(
          `- \`${e.kind}\` **${e.ref}** (nivel ${e.level})${flag}${note} — registrado por ${e.recordedBy} (${e.recordedAt})`,
        )
      }
    }
    lines.push("")

    lines.push("**Riesgos:**")
    if (r.risks.length === 0) {
      lines.push("- Ninguno.")
    } else {
      for (const risk of r.risks) {
        lines.push(`- ${risk}`)
      }
    }
    lines.push("")
  }

  lines.push("## Requisitos obligatorios pendientes")
  lines.push("")
  if (graph.missingMandatory.length === 0) {
    lines.push("- Ninguno: todos los requisitos obligatorios tienen evidencia suficiente.")
  } else {
    for (const m of graph.missingMandatory) {
      lines.push(`- ${m}`)
    }
  }
  lines.push("")

  const orphans = graph.orphanedEvidence ?? []
  if (orphans.length > 0) {
    lines.push("## Evidencia sin vincular")
    lines.push("")
    for (const e of orphans) {
      lines.push(
        `- \`${e.kind}\` ${e.ref} — cita «${e.requirement}», que no es un criterio de aceptación de esta card.`,
      )
    }
    lines.push("")
  }

  return lines.join("\n")
}
