/**
 * Mesa: el estado compartido de la oficina.
 *
 * ## Qué es
 *
 * Los subagentes de OpenCode son procesos aislados. No se ven. No saben quién
 * más está trabajando, qué cards están libres, ni a quién le puede preguntar
 * algo.
 *
 * La mesa es la vista compartida: quién está en qué, qué está abierto, qué
 * se está pidiendo. Vive en el disco (el roster + el bus), así que todos la
 * leen sin necesidad de memoria compartida.
 *
 * ## Por qué importa
 *
 * Sin mesa, el trabajo paralelo degenera en caos: dos agentes tocan el mismo
 * archivo, uno espera un dato que nadie tiene, y el claim proactivo nunca
 * pasa porque nadie sabe qué hay para tomar.
 *
 * Con mesa, cada agente sabe: qué tengo yo, qué tienen los demás, qué está
 * libre, y a quién le puedo preguntar.
 */

import type { BusMessage } from "./types.js"
import type { Office } from "./office.js"
import { CHANNELS } from "./bus.js"

export interface MesaEntry {
  agentId: string
  role: string
  displayName: string
  state: string
  /** Card en la que está trabajando. */
  card: string | null
  /** Capabilities por las que le pueden preguntar. */
  capabilities: string[]
  /** Si puede recibir trabajo ahora. */
  available: boolean
}

export interface MesaSnapshot {
  /** Quién está sentado en la mesa. */
  presentes: MesaEntry[]
  /** Quién está trabajando y en qué. */
  trabajando: MesaEntry[]
  /** Quién está libre y puede ayudar. */
  libres: MesaEntry[]
  /** Cards sin owner: candidatas a claim proactivo. */
  sinOwner: { cardId: string; title: string; requiredCapabilities: string[] }[]
  /** Pedidos de ayuda sin responder. */
  ayudaAbierta: {
    messageId: string
    from: string
    card: string
    need: string
    responders: string[]
  }[]
  /** Preguntas abiertas al equipo. */
  preguntasAbiertas: { messageId: string; from: string; question: string }[]
  /** Iteración y presupuesto. */
  iteracion: number
  presupuesto: { cards: string; agentes: string; spawns: string }
}

/** Construye la foto de la mesa. */
export async function snapshotMesa(office: Office): Promise<MesaSnapshot> {
  const state = await office.loadState()
  const roster = await office.loadRoster(state.runId)
  const agents = Object.values(roster.agents)

  const presentes: MesaEntry[] = agents.map((a) => ({
    agentId: a.id,
    role: a.role,
    displayName: a.displayName,
    state: a.state,
    card: a.currentCard,
    capabilities: a.capabilities.slice(0, 8),
    available: a.state === "idle_available" && a.canAccept,
  }))

  const sinOwner = state.order
    .map((id) => state.cards[id])
    .filter((c): c is NonNullable<typeof c> => !!c && c.state === "todo" && !c.owner)
    .map((c) => ({
      cardId: c.id,
      title: c.title,
      requiredCapabilities: c.requiredCapabilities,
    }))

  // Pedidos de ayuda sin responder: un HELP_REQUEST sin ningún HELP_ACCEPT
  // ni HELP_DECLINE dirigido al mismo par.
  const peerMessages = await office.bus.readChannel(CHANNELS.peer)
  const ayudaAbierta: MesaSnapshot["ayudaAbierta"] = []

  for (const msg of peerMessages) {
    if (msg.kind !== "HELP_REQUEST") continue
    if (isExpired(msg)) continue

    const answered = peerMessages.some(
      (r) =>
        r.kind.startsWith("HELP_") &&
        r.kind !== "HELP_REQUEST" &&
        r.inReplyTo === msg.id,
    )
    if (answered) continue

    ayudaAbierta.push({
      messageId: msg.id,
      from: msg.from,
      card: msg.subject,
      need: String((msg.body as Record<string, unknown>)?.need ?? "(sin detalle)"),
      responders: msg.to.includes("*") ? [] : msg.to,
    })
  }

  const preguntasAbiertas: MesaSnapshot["preguntasAbiertas"] = []
  for (const msg of peerMessages) {
    if (msg.kind !== "QUESTION") continue
    if (isExpired(msg)) continue
    const answered = peerMessages.some((r) => r.kind === "ANSWER" && r.inReplyTo === msg.id)
    if (answered) continue
    preguntasAbiertas.push({
      messageId: msg.id,
      from: msg.from,
      question: String((msg.body as Record<string, unknown>)?.question ?? ""),
    })
  }

  return {
    presentes,
    trabajando: presentes.filter((p) => p.state === "working"),
    libres: presentes.filter((p) => p.available),
    sinOwner,
    ayudaAbierta,
    preguntasAbiertas,
    iteracion: state.iteration,
    presupuesto: {
      cards: `${state.budget.cardsUsed}/${state.budget.maxCards}`,
      agentes: `${state.budget.agentCallsUsed}/${state.budget.maxAgentCalls}`,
      spawns: `${state.budget.spawnsUsed}/${state.budget.maxSpawnsTotal}`,
    },
  }
}

function isExpired(message: BusMessage): boolean {
  const age = (Date.now() - Date.parse(message.createdAt)) / 1000
  return age > message.ttlSec
}

/** Renderiza la mesa como markdown, para que un agente la lea. */
export function renderMesa(snapshot: MesaSnapshot): string {
  const lines: string[] = ["# Mesa de la oficina", ""]

  lines.push(`**Iteración:** ${snapshot.iteracion} · **Presupuesto:** ${snapshot.presupuesto.cards} cards, ${snapshot.presupuesto.agentes} agentes, ${snapshot.presupuesto.spawns} spawns`)
  lines.push("")

  lines.push("## Quién está trabajando")
  lines.push("")
  if (snapshot.trabajando.length === 0) {
    lines.push("(nadie)")
  } else {
    for (const p of snapshot.trabajando) {
      lines.push(`- **${p.displayName}** (\`${p.agentId}\`, ${p.role}) → card ${p.card ?? "—"}`)
    }
  }
  lines.push("")

  lines.push("## Quién está libre y puede ayudar")
  lines.push("")
  if (snapshot.libres.length === 0) {
    lines.push("(nadie)")
  } else {
    for (const p of snapshot.libres) {
      lines.push(`- **${p.displayName}** (\`${p.agentId}\`, ${p.role}) — ${p.capabilities.join(", ")}`)
    }
  }
  lines.push("")

  if (snapshot.sinOwner.length > 0) {
    lines.push("## Cards sin owner (reclamables)")
    lines.push("")
    for (const c of snapshot.sinOwner) {
      lines.push(`- **${c.cardId}** ${c.title} — necesita: ${c.requiredCapabilities.join(", ") || "(sin especificar)"}`)
    }
    lines.push("")
  }

  if (snapshot.ayudaAbierta.length > 0) {
    lines.push("## Ayuda pedida (sin responder)")
    lines.push("")
    for (const h of snapshot.ayudaAbierta) {
      lines.push(`- **${h.from}** pide ayuda en \`${h.card}\`: ${h.need}`)
      lines.push(`  - respondé con \`oficina_bus\` action=\`respond\` inReplyTo=\`${h.messageId}\``)
    }
    lines.push("")
  }

  if (snapshot.preguntasAbiertas.length > 0) {
    lines.push("## Preguntas abiertas")
    lines.push("")
    for (const q of snapshot.preguntasAbiertas) {
      lines.push(`- **${q.from}**: ${q.question}`)
    }
    lines.push("")
  }

  return lines.join("\n")
}

/**
 * Resume la mesa para el prompt de auto-continuación.
 *
 * Es lo que el hook inyecta cuando la sesión queda idle: lo mínimo para que
 * el agente sepa si hay trabajo libre, ayuda que ofrecer o algo que responder.
 */
export function renderMesaBrief(snapshot: MesaSnapshot): string {
  const parts: string[] = []

  if (snapshot.ayudaAbierta.length > 0) {
    parts.push(
      "**Hay pedidos de ayuda sin responder:**",
      ...snapshot.ayudaAbierta.map(
        (h) => `- ${h.from} en ${h.card}: ${h.need} (respondé con \`oficina_bus\` action=\`respond\` inReplyTo=\`${h.messageId}\`)`,
      ),
    )
  }

  if (snapshot.preguntasAbiertas.length > 0) {
    parts.push(
      "**Hay preguntas abiertas:**",
      ...snapshot.preguntasAbiertas.map((q) => `- ${q.from}: ${q.question}`),
    )
  }

  if (snapshot.sinOwner.length > 0) {
    parts.push(
      "**Cards sin owner — podés reclamar una:**",
      ...snapshot.sinOwner.map(
        (c) => `- ${c.cardId}: ${c.title} (necesita ${c.requiredCapabilities.join(", ") || "cualquiera"})`,
      ),
    )
  }

  if (snapshot.libres.length > 0) {
    parts.push(
      `**Agentes libres (podés pedirles ayuda):** ${snapshot.libres.map((p) => `${p.agentId} (${p.role})`).join(", ")}`,
    )
  }

  return parts.join("\n\n")
}
