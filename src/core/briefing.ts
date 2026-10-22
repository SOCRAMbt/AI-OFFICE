/**
 * Briefing: el contrato de información que recibe cada agente.
 *
 * ## El problema que resuelve
 *
 * Un subagente arranca con un contexto vacío. Si elCommander le pasa un
 * prompt suelta ("implementá el login"), el agente tiene que adivinar: qué
 * sabe del proyecto, qué espera de él, qué puede tocar, a quién preguntarle
 * si se traba, y qué tiene que entregar. Adivinar es la fuente de todo el
 * trabajo que se repite y de los agentes que se salen del scope.
 *
 * ## La solución
 *
 * Un briefing con **orden fijo** y **mínimo verificable**:
 *
 * - **Orden**: la información llega en una secuencia que va de lo más
 *   estable a lo más cambiante. Identidad → misión → contexto → territorio
 *   → protocolo → bus → calidad → límites → éxito. Un agente lee de arriba
 *   hacia abajo y siempre tiene lo que necesita para el siguiente paso.
 *
 * - **Mínimo**: hay secciones **requeridas**. Si alguna queda vacía, el
 *   briefing se marca `incompleto` y **el agente no arranca**. Un briefing
 *   a medio llenar produce un agente a medio informado, que es peor que no
 *   tener agente.
 *
 * - **Cuatro artefactos**: el briefing se materializa en cuatro archivos en
 *   disco, porque un agente no "recuerda" un prompt largo: lo lee.
 */

import type { Card, Ficha, RosterEntry } from "./types.js"
import { CHANNELS } from "./bus.js"

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export type BriefingSectionId =
  | "identidad"
  | "mision"
  | "contexto-conocido"
  | "contexto-desconocido"
  | "territorio"
  | "protocolo"
  | "bus"
  | "calidad"
  | "limites"
  | "exito"

/** Definición de una sección del briefing. El orden es fijo. */
export interface BriefingSectionDef {
  id: BriefingSectionId
  order: number
  title: string
  /** Sin esto, el agente no puede arrancar. */
  required: boolean
  /** Para qué está la sección. Se le muestra alCommander. */
  purpose: string
}

/**
 * Las 10 secciones, en orden.
 *
 * El orden importa: identidad y misión siempre primero (qué sos y qué hacés),
 * después el contexto (qué sabés), después el territorio y el protocolo
 * (cómo hacés), y al final la definición de éxito (cómo se sabe que
 * terminaste).
 */
export const BRIEFING_SECTIONS: BriefingSectionDef[] = [
  {
    id: "identidad",
    order: 1,
    title: "Quién sos",
    required: true,
    purpose: "Rol, especialidad de origen y de dónde viene tu briefing. Determina cómo pensás.",
  },
  {
    id: "mision",
    order: 2,
    title: "Tu misión",
    required: true,
    purpose: "La card exacta, con criterios de aceptación y el control que tiene que pasar.",
  },
  {
    id: "contexto-conocido",
    order: 3,
    title: "Lo que ya sabés",
    required: true,
    purpose: "Decisiones tomadas, restricciones descubiertas y piezas ya construidas. Lo que NO tenés que volver a buscar.",
  },
  {
    id: "contexto-desconocido",
    order: 4,
    title: "Lo que NO sabés",
    required: true,
    purpose: "Los huecos explícitos y a quién preguntarle por cada uno. Lo que tenés que ir a buscar vos.",
  },
  {
    id: "territorio",
    order: 5,
    title: "Tu territorio",
    required: true,
    purpose: "Qué archivos podés tocar y cuáles no. El motor bloquea lo que está fuera.",
  },
  {
    id: "protocolo",
    order: 6,
    title: "Cómo trabajás",
    required: true,
    purpose: "El ciclo de trabajo, cuándo pedir ayuda, cuándo delegar y cuándo escalar.",
  },
  {
    id: "bus",
    order: 7,
    title: "Tu canal",
    required: true,
    purpose: "Dónde dejás y encontrás mensajes. Formato y tiempos de vida.",
  },
  {
    id: "calidad",
    order: 8,
    title: "Qué se espera de vos",
    required: true,
    purpose: "Los entregables exactos: handoff y evidencia. Sin evidencia no hay trabajo hecho.",
  },
  {
    id: "limites",
    order: 9,
    title: "Lo que no podés hacer",
    required: true,
    purpose: "Las prohibiciones duras. Están en código, no en tu discretion.",
  },
  {
    id: "exito",
    order: 10,
    title: "Cómo se mide que terminaste",
    required: true,
    purpose: "La definición de terminado. Si no podés cumplir esto, pedí ayuda antes de empezar.",
  },
]

export interface Briefing {
  agentId: string
  role: string
  objective: string
  card: {
    id: string
    title: string
    type: string
    acceptance: string[]
    gate: string
  }
  /** Las 10 secciones, en orden, con su contenido. */
  sections: BriefingSection[]
  /** Ids de secciones requeridas que quedaron vacías. */
  missing: BriefingSectionId[]
  /** ¿Se puede arrancar? */
  complete: boolean
  /** Los 4 archivos que se escriben en disco para el agente. */
  artifacts: BriefingArtifact[]
}

/** Una sección del briefing, ya resuelta. */
export interface BriefingSection {
  id: BriefingSectionId
  /** El orden fijo. */
  order: number
  title: string
  /** Sin esto, el agente no puede arrancar. */
  required: boolean
  /** Para qué está la sección. */
  purpose: string
  /** El contenido renderizado. */
  content: string
  /** ¿Tiene contenido? */
  filled: boolean
}

export interface BriefingArtifact {
  filename: string
  content: string
}

/** Contexto que el Commander le pasa al briefing. */
export interface BriefingContext {
  ficha: Ficha
  card: Card
  objective: string
  /** Decisiones ya tomadas en la corrida. */
  knownDecisions?: string[]
  /** Restricciones descubiertas. */
  knownConstraints?: string[]
  /** Piezas ya construidas. */
  builtPieces?: string[]
  /** Trampas: lo que no hay que tocar. */
  knownTraps?: string[]
  /** Temas abiertos: huecos que el agente puede tener que cubrir. */
  openQuestions?: string[]
  /** Peers del roster, para saber a quién pedirle ayuda. */
  peers?: RosterEntry[]
  /** Id del coordinador al que escala. */
  coordinatorId?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Construcción
// ─────────────────────────────────────────────────────────────────────────────

/** Construye el briefing completo de un agente. */
export function buildBriefing(ctx: BriefingContext): Briefing {
  const { ficha, card, objective } = ctx

  const contents: Record<BriefingSectionId, string> = {
    identidad: renderIdentity(ficha, objective),
    mision: renderMission(card, objective),
    "contexto-conocido": renderKnownContext(ctx),
    "contexto-desconocido": renderUnknownContext(ctx),
    territorio: renderTerritory(card, ficha),
    protocolo: renderProtocol(ficha, card),
    bus: renderBus(ficha, ctx.coordinatorId),
    calidad: renderQuality(card),
    limites: renderLimits(ficha, card),
    exito: renderSuccess(card, ficha),
  }

  const sections: BriefingSection[] = BRIEFING_SECTIONS.map((def) => {
    const content = contents[def.id] ?? ""
    return {
      id: def.id,
      order: def.order,
      title: def.title,
      required: def.required,
      purpose: def.purpose,
      content,
      filled: content.trim().length > 0,
    }
  })

  const missing = sections
    .filter((s) => s.required && !s.filled)
    .map((s) => s.id)

  return {
    agentId: ficha.id,
    role: ficha.role,
    objective,
    card: {
      id: card.id,
      title: card.title,
      type: card.type,
      acceptance: card.acceptance,
      gate: card.gate,
    },
    sections,
    missing,
    complete: missing.length === 0,
    artifacts: renderArtifacts(sections, ficha, card),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Render de cada sección
// ─────────────────────────────────────────────────────────────────────────────

function renderIdentity(ficha: Ficha, objective: string): string {
  // Sin identidad no hay briefing: el agente no sabe qué rol tiene.
  if (!ficha.displayName || !ficha.role) return ""

  const lines = [
    `Sos **${ficha.displayName}** (\`${ficha.id}\`), rol \`${ficha.role}\`.`,
    "",
    `**Especialidad:** ${ficha.capabilities.slice(0, 8).join(", ") || "genérica"}.`,
    `**Origen del briefing:** ${ficha.source.kind === "agency-agents" ? `catálogo agency-agents · ${ficha.source.division}/${ficha.source.path}` : "factory (rol fabricado para esta corrida)"}.`,
  ]
  if (ficha.source.vibe) lines.push(`**Vibe:** ${ficha.source.vibe}`)
  lines.push("", `**Corrida:** ${objective}`)
  return lines.join("\n")
}

function renderMission(card: Card, objective: string): string {
  return [
    `**Card ${card.id} — ${card.title}** (${card.type})`,
    "",
    "**Criterios de aceptación** (todos tienen que cumplirse):",
    ...card.acceptance.map((a, i) => `${i + 1}. ${a}`),
    "",
    `**Control de calidad de la card:** ${card.gate}`,
    "",
    "**Objetivo de la corrida:** " + objective,
  ].join("\n")
}

function renderKnownContext(ctx: BriefingContext): string {
  const lines: string[] = []
  const push = (title: string, items: string[] | undefined) => {
    if (!items || items.length === 0) return
    lines.push(`**${title}:**`)
    lines.push(...items.map((i) => `- ${i}`))
    lines.push("")
  }

  push("Decisiones ya tomadas", ctx.knownDecisions)
  push("Restricciones descubiertas", ctx.knownConstraints)
  push("Piezas ya construidas", ctx.builtPieces)
  push("Trampas — no toques esto", ctx.knownTraps)

  if (lines.length === 0) {
    return "Todavía no hay decisiones tomadas en esta corrida. Sos el primero: lo que decidas queda escrito para los que vengan después."
  }

  return lines.join("\n").trim()
}

function renderUnknownContext(ctx: BriefingContext): string {
  const lines: string[] = []
  const push = (title: string, items: string[] | undefined) => {
    if (!items || items.length === 0) return
    lines.push(`**${title}:**`)
    lines.push(...items.map((i) => `- ${i}`))
    lines.push("")
  }

  push("Temas abiertos en la corrida", ctx.openQuestions)

  if (ctx.peers && ctx.peers.length > 0) {
    lines.push("**A quién preguntarle si te trabás:**")
    for (const peer of ctx.peers) {
      lines.push(`- \`${peer.id}\` (${peer.role}) — ${peer.capabilities.slice(0, 4).join(", ")}`)
    }
    lines.push("")
    lines.push("Pedí ayuda por el bus (`HELP_REQUEST`). No te quedes trabado esperando: el que puede, responde.")
  }

  if (lines.length === 0) {
    return "No hay huecos conocidos. Si descubrís algo que no sabías, anotalo en el handoff."
  }

  return lines.join("\n").trim()
}

function renderTerritory(card: Card, ficha: Ficha): string {
  const extra = ficha.scope.forbidden.filter((f) => !card.scope.forbidden.includes(f))
  return [
    "**Podés tocar:**",
    ...(card.scope.mayTouch.length > 0
      ? card.scope.mayTouch.map((s) => `- \`${s}\``)
      : ["- (sin restricción declarada)"]),
    "",
    "**No podés tocar:**",
    ...card.scope.forbidden.map((s) => `- \`${s}\``),
    ...extra.map((s) => `- \`${s}\` (prohibido por tu ficha)`),
    "",
    "**Además, tu ficha te prohíbe:**",
    ...ficha.mustNot.map((m) => `- ${m}`),
    "",
    "El motor rechaza cualquier escritura fuera de tu territorio. No es una sugerencia.",
  ].join("\n")
}

function renderProtocol(ficha: Ficha, card: Card): string {
  const canDelegate = ficha.canDelegate
  return [
    "**Ciclo de trabajo:**",
    "1. Leé tu briefing entero antes de tocar nada.",
    "2. Explorá lo que no sabés (sección 4). No inventes: preguntá o buscalo.",
    "3. Trabajá **solo** dentro de tu territorio (sección 5).",
    "4. Escribí el handoff y la evidencia (sección 8).",
    "5. Entregá. Otro agente te revisa — y no sos vos.",
    "",
    "**Si te trabás:**",
    "- Si el problema es de otro dominio → `HELP_REQUEST` por el bus a un peer. Antes de acceptar.help, evaluá vos si podés hacerlo ya sin romper tu propia card.",
    "- Si el peer no está desplegado → pedí `SPAWN_REQUEST` al Integrador. **No lo clones por tu cuenta.**",
    "- Si el problema es una decisión de producto → escalá alCommander.",
    "- Si no vas a poder cumplir los criterios de aceptación → pedí ayuda antes de empezar, no después.",
    "",
    canDelegate
      ? "**Podés delegar:** sí, hasta \`delegate_budget\` solicitudes. Usalo cuando el rol que falta es genuinamente otro."
      : "**Podés delegar:** no. Si falta un rol, pedilo por el bus al Integrador.",
    "",
    `**Revisor de tu card:** \`${card.reviewer ?? "por asignar"}\` — no podés ser vos.`,
  ].join("\n")
}

function renderBus(ficha: Ficha, coordinatorId?: string): string {
  return [
    "**Dónde dejás y encontrás mensajes:**",
    `- Tu inbox: \`inbox/${ficha.id}/\``,
    `- Canal general entre pares: \`${CHANNELS.peer}/\``,
    coordinatorId ? `- Tu coordinador: \`${coordinatorId}\` (canal \`${CHANNELS.flow}/\`)` : "",
    "",
    "**Formato de mensaje:**",
    "```json",
    '{ "from": "' + ficha.id + '", "to": ["e-otro"], "kind": "HELP_REQUEST",',
    '  "subject": "' + ficha.id + '", "body": { "need": "...", "why_me": "..." } }',
    "```",
    "",
    "**Reglas del canal:**",
    "- Los mensajes se acumulan: no se borran. Lo que escribís queda en el historial.",
    `- Tiempos de vida: ${900} segundos. Un pedido viejo no bloquea a nadie, pero tampoco se pierde.`,
    "- Acusá recibo de lo que leés (`ack`). Así el emisor sabe que llegaste.",
    "- No repitas un pedido con la misma clave: el bus lo deduplica.",
    "- Los mensajes que no son para vos no se muestran. Un pedido de ayuda a alguien más no es tuyo.",
  ]
    .filter(Boolean)
    .join("\n")
}

function renderQuality(card: Card): string {
  return [
    "**Entregables obligatorios** (ambos van a disco, en `.oficina/artifacts/" + card.id + "/`):",
    "",
    "**1. `handoff.md` — qué hiciste**",
    "- Qué implementaste, en concreto",
    "- Qué archivos tocaste, uno por línea, con el motivo",
    "- Qué decisiones tomaste y por qué",
    "- Qué quedó **afuera** y por qué",
    "- Qué necesitás que sepa el siguiente",
    "",
    "**2. `evidence.md` — la prueba**",
    "- La salida **real** de los comandos que corriste, pegada literal",
    "- El comando que corriste y su exit code",
    "- Sin evidencia, la card no puede aprobarse. No es un formality: es la diferencia entre «lo hice» y «creo que lo hice».",
  ].join("\n")
}

function renderLimits(ficha: Ficha, card: Card): string {
  const limits = new Set([...ficha.mustNot, ...card.scope.forbidden.map((f) => `no tocar ${f}`)])
  return [
    "Estas reglas están en código. No son criterio: si las violás, el motor te corta.",
    "",
    ...[...limits].map((l) => `- ${l}`),
    "",
    "**Nunca:**",
    "- Declarar la card terminada sin el control de calidad en verde",
    "- Aprobar tu propio trabajo",
    "- Tocar archivos de otros agentes o de sus artefactos",
    "- Inventar output de un comando que no corriste",
  ].join("\n")
}

function renderSuccess(card: Card, ficha: Ficha): string {
  return [
    "**Terminaste cuando las tres cosas son verdad:**",
    "",
    `1. Todos los criterios de aceptación se cumplen — y lo podés demostrar.`,
    `2. El control de calidad de la card (\`${card.gate}\`) pasa.`,
    "3. Dejaste `handoff.md` y `evidence.md` en disco.",
    "",
    `**Tu card:** \`${card.id}\` — ${card.title}`,
    `**Tu rol:** \`${ficha.role}\``,
    "",
    "Si llegaste hasta acá y algo no cumple, **no lo declares terminado**: pedí ayuda o escalá. Un trabajo a medio hacer, reportado como terminado, es peor que un trabajo a medio hecho reportado como a medio hacer.",
  ].join("\n")
}

// ─────────────────────────────────────────────────────────────────────────────
// Artefactos
// ─────────────────────────────────────────────────────────────────────────────

/** Mapea qué secciones van a cada artefacto. */
const ARTIFACT_MAP: { filename: string; sections: BriefingSectionId[]; intro: string }[] = [
  {
    filename: "ficha.md",
    sections: ["identidad"],
    intro: "# Tu ficha",
  },
  {
    filename: "misiones.md",
    sections: ["mision", "contexto-conocido", "contexto-desconocido"],
    intro: "# Tus misiones",
  },
  {
    filename: "protocolo.md",
    sections: ["protocolo", "territorio", "calidad", "limites", "exito"],
    intro: "# Cómo trabajás",
  },
  {
    filename: "bus.md",
    sections: ["bus"],
    intro: "# Tu canal",
  },
]

/** Renderiza el briefing como los 4 archivos que el agente lee. */
function renderArtifacts(
  sections: BriefingSection[],
  ficha: Ficha,
  card: Card,
): BriefingArtifact[] {
  const byId = new Map(sections.map((s) => [s.id, s]))

  return ARTIFACT_MAP.map(({ filename, sections: ids, intro }) => {
    const body = ids
      .map((id) => {
        const section = byId.get(id)
        if (!section) return ""
        return `## ${section.title}\n\n${section.content}`
      })
      .filter(Boolean)
      .join("\n\n---\n\n")

    return {
      filename,
      content: `${intro}\n\n> Agente \`${ficha.id}\` · card \`${card.id}\`\n\n${body}\n`,
    }
  })
}

/** Renderiza el briefing como un documento único (para lectura humana). */
export function renderBriefing(briefing: Briefing): string {
  const lines: string[] = [
    `# Briefing — ${briefing.role}`,
    "",
    `> Agente \`${briefing.agentId}\` · card \`${briefing.card.id}\` · ${briefing.complete ? "completo" : `INCOMPLETO — faltan: ${briefing.missing.join(", ")}`}`,
    "",
  ]

  for (const section of briefing.sections) {
    lines.push(`## ${section.order}. ${section.title}`)
    lines.push("")
    lines.push(section.content)
    lines.push("")
    lines.push("---")
    lines.push("")
  }

  return lines.join("\n")
}

/** Texto compacto para inyectar en el prompt de una delegación. */
export function renderBriefingPrompt(briefing: Briefing): string {
  const required = briefing.sections.filter((s) => s.required && s.filled)
  return required
    .map((s) => `## ${s.title}\n${s.content}`)
    .join("\n\n")
}
