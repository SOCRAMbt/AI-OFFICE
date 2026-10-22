/**
 * Dispatch: el momento en que el Commander crea el equipo.
 *
 * ## Qué resuelve
 *
 * El flujo "doy un objetivo → el jefe lo divide → crea los subagentes →
 * arrancan a trabajar juntos" necesita tres cosas que antes no existían:
 *
 * 1. **Cuántos subagentes hacen falta.** Uno por card, más los complementos
 *    que cubren capabilities que el primario no cubre. El presupuesto y el
 *    hard cap se respetan acá, no después.
 *
 * 2. **De dónde sale cada uno.** Primero el catálogo de agency-agents: si el
 *    rol existe, se materializa con su prompt original (verbatim). Si no
 *    existe, la factory lo fabrica con la card y el objetivo como contexto.
 *
 * 3. **Cómo arrancan.** Cada agente recibe su briefing completo como prompt
 *    de arranque, y queda registrado en el roster y en el board.
 *
 * ## El agente OpenCode que ejecuta
 *
 * El agente se materializa como markdown en `.opencode/agents/` del proyecto:
 * queda versionado con el repo y disponible la próxima sesión.
 *
 * El *spawn* usa `agent: "general"` con el prompt completo embebido. La razón
 * es práctica: OpenCode resuelve la lista de agentes al arrancar la sesión,
 * así que un archivo recién creado puede no estar registrable todavía. Con el
 * prompt embebido, el agente funciona **siempre**; y si el archivo ya está
 * registrado, el LLM puede invocarlo directo con `@oficina-<slug>`.
 */

import path from "node:path"
import type { Card, CatalogAgent, Ficha, OfficeState, Roster, RosterEntry } from "./types.js"
import { buildPanel, type RolePanel } from "./catalog.js"
import { buildBriefing, renderBriefingPrompt, type Briefing } from "./briefing.js"
import { ensureDir, nowIso, writeAtomic } from "./fsx.js"
import type { Office } from "./office.js"

export interface DispatchOptions {
  /** Raíz del proyecto (donde va `.opencode/agents/`). */
  projectRoot: string
  /** Catálogo de agency-agents. */
  catalog: CatalogAgent[]
  /** Objetivo de la corrida, para los prompts de factory. */
  objective: string
  /** Máximo de agentes a materializar. */
  maxAgents: number
  /** Tope de complementos por card. */
  maxComplements: number
  /** Cobertura mínima para aceptar un match del catálogo. */
  minCoverage: number
  /** Agentes ya registrados (para no duplicar roles). */
  existing: RosterEntry[]
}

export interface DispatchedAgent {
  /** Id lógico del agente (ficha). */
  agentId: string
  /** Nombre del agente OpenCode. */
  agentName: string
  /** Card que lleva. `null` si es un par disponible. */
  cardId: string | null
  role: string
  displayName: string
  source: "agency-agents" | "factory"
  coverage: number
  /** Capabilities que este agente aporta y el primario no cubría. */
  contributes: string[]
  /** El prompt con el que arranca. */
  prompt: string
  /** Archivo de agente materializado. */
  agentFile: string | null
  /** Nombres de los 4 artefactos del briefing. */
  artifacts: string[]
  /** ¿Es un par libre (sin card) o un owner? */
  isPeer: boolean
}

export interface DispatchResult {
  dispatched: DispatchedAgent[]
  /** Cards que quedaron sin owner. */
  unassigned: string[]
  /** Capabilities que ningún agente del equipo cubre. */
  uncovered: string[]
  /** Por qué no se pudo despachar algo. */
  notes: string[]
}

/** Nombre del agente OpenCode derivado del rol. */
export function agentNameFor(role: string): string {
  const slug = role
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return `oficina-${slug}`.slice(0, 48)
}

/**
 * Construye el prompt de arranque de un agente.
 *
 * Es la suma de tres cosas:
 * 1. El prompt de origen del catálogo (verbatim) — de ahí viene la especialidad.
 * 2. La ficha — el contrato del rol: scope, peers, límites.
 * 3. El briefing — la misión de esta card en concreto.
 */
export function buildAgentPrompt(ficha: Ficha, briefing: Briefing): string {
  const sections: string[] = []

  if (ficha.source.sourcePrompt) {
    sections.push(
      [
        "# Tu especialidad (prompt de origen)",
        "",
        "> Este texto define quién sos y cómo pensás. No lo resumas ni lo contradigas.",
        "",
        ficha.source.sourcePrompt,
      ].join("\n"),
    )
  }

  if (ficha.source.vibe) {
    sections.push(`**Tu vibe:** ${ficha.source.vibe}`)
  }

  sections.push(
    [
      "# Tu rol en esta oficina",
      "",
      `- **id:** \`${ficha.id}\``,
      `- **rol:** \`${ficha.role}\``,
      `- **capacidades:** ${ficha.capabilities.slice(0, 12).join(", ")}`,
      `- **podés tocar:** ${ficha.scope.mayTouch.join(", ")}`,
      `- **no podés tocar:** ${ficha.scope.forbidden.join(", ")}`,
      `- **tus pares (para pedir ayuda):** ${ficha.peers.join(", ") || "(ninguno declarado)"}`,
      "",
      "**Límites duros:**",
      ...ficha.mustNot.map((m) => `- ${m}`),
    ].join("\n"),
  )

  sections.push(
    [
      "# Tu briefing",
      "",
      "Leelo entero antes de tocar nada. Tiene el orden justo: lo que sos, lo que hacés, lo que ya sabés, lo que NO sabés, tu territorio, cómo trabajás, tu canal, qué se espera de vos, lo que no podés hacer y cómo se mide que terminaste.",
      "",
      renderBriefingPrompt(briefing),
    ].join("\n"),
  )

  sections.push(
    [
      "# Cómo trabajás en la mesa",
      "",
      "Estás en una mesa con otros agentes. Cada uno tiene lo suyo, pero se hablan:",
      "",
      "- **Si te trabás o te falta contexto:** pedí ayuda por el bus (`oficina_bus` action=`help`). No te tragues el trabajo de otro.",
      "- **Si te sobra tiempo:** ofrecé ayuda o reclamá una card sin owner (`oficina_bus` action=`claim`).",
      "- **Si alguien te pregunta:** contestá por el bus. No te quedes mudo.",
      "- **Si tu scope no alcanza:** pedí ampliación por el bus. No te lo expies por tu cuenta.",
      "- **Si encontrás algo que otro está haciendo:** avisá por el bus antes de tocarlo.",
      "",
      "Al terminar tu card: dejá `handoff.md` y `evidence.md` en `.oficina/artifacts/<cardId>/`, entregá con `oficina_submit`, y **ofrecé ayuda** para lo que sigue.",
    ].join("\n"),
  )

  return sections.join("\n\n---\n\n")
}

/**
 * Materializa un agente como archivo markdown de OpenCode.
 *
 * Se escribe en `.opencode/agents/` del proyecto: queda versionado con el
 * repo, es reproducible, y la próxima sesión el agente ya está registrado.
 */
export async function materializeAgent(
  projectRoot: string,
  ficha: Ficha,
  briefing: Briefing,
): Promise<string> {
  const dir = path.join(projectRoot, ".opencode", "agents")
  await ensureDir(dir)

  const name = agentNameFor(ficha.role)
  const file = path.join(dir, `${name}.md`)

  const frontmatter = [
    "---",
    `description: ${ficha.displayName} — ${ficha.capabilities.slice(0, 5).join(", ") || "especialista de la oficina"}`,
    "mode: subagent",
    "hidden: true",
    "permission:",
    "  edit: allow",
    "  shell: allow",
    "  task: allow",
    "---",
    "",
  ].join("\n")

  const body = [
    `# ${ficha.displayName}`,
    "",
    "> Agente generado por la OFICINA. Su especialidad viene del catálogo de agency-agents.",
    "",
    "## Tu especialidad (prompt de origen)",
    "",
    "```markdown",
    ficha.source.sourcePrompt ?? "(sin prompt de origen)",
    "```",
    "",
    "## Tu briefing",
    "",
    "> El briefing va completo acá para que el agente tenga el contexto aunque",
    "> se lo inyecto en el prompt de arranque. Mismo contenido, dos vías.",
    "",
    ...briefing.sections
      .filter((s) => s.id !== "identidad")
      .map((s) => `### ${s.title}\n\n${s.content}\n`),
    "## Cómo trabajás",
    "",
    "- Leé tu briefing completo antes de tocar nada.",
    "- Pedí ayuda por el bus si el trabajo se sale de tu scope.",
    "- No revises tu propio trabajo: otro lo hace.",
    "- Dejá `handoff.md` y `evidence.md` con la entrega.",
  ].join("\n")

  await writeAtomic(file, `${frontmatter}${body}\n`)
  return file
}

/**
 * Despacha el equipo de una corrida.
 *
 * Para cada card sin owner:
 * - Resuelve el panel (primario + complementos).
 * - Materializa el agente primario con su briefing.
 * - Materializa los complementos como pares disponibles.
 *
 * Respeta el presupuesto de agentes y reutiliza roles ya desplegados.
 */
export async function dispatchOffice(
  office: Office,
  state: OfficeState,
  options: DispatchOptions,
): Promise<DispatchResult> {
  const result: DispatchResult = {
    dispatched: [],
    unassigned: [],
    uncovered: [],
    notes: [],
  }

  const roster = await office.loadRoster(state.runId)
  const alreadyDeployed = new Map(options.existing.map((e) => [e.role, e]))

  let budget = options.maxAgents

  for (const cardId of state.order) {
    const card = state.cards[cardId]
    if (!card) continue
    if (card.owner) continue

    const panel: RolePanel = buildPanel(options.catalog, card.requiredCapabilities, {
      maxComplements: options.maxComplements,
    })

    if (!panel.primary) {
      result.unassigned.push(cardId)
      result.notes.push(
        `La card ${cardId} no tiene match en el catálogo con cobertura ≥ ${options.minCoverage}.`,
      )
      continue
    }

    for (const missing of panel.primary.missing) {
      if (!result.uncovered.includes(missing)) result.uncovered.push(missing)
    }

    if (budget <= 0) {
      result.unassigned.push(cardId)
      result.notes.push(`Sin presupuesto de agentes: ${cardId} quedó sin owner.`)
      continue
    }

    const primary = await instantiate(
      office,
      roster,
      panel.primary.agent,
      card,
      options,
      panel.primary.agent.capabilities,
      [],
      false,
      alreadyDeployed.get(panel.primary.agent.slug),
    )
    if (!primary) {
      result.unassigned.push(cardId)
      continue
    }
    budget -= 1
    result.dispatched.push(primary)
    card.owner = primary.agentId
    card.reviewer = null // el Integrador lo asigna después

    // Las capabilities que el primario no cubre se cubren con los
    // complementos. El hueco real se calcula al final, cuando ya sabemos
    // quién cubre qué.
    for (const complement of panel.complements) {
      if (budget <= 0) {
        result.notes.push(
          `Sin presupuesto para materializar el complemento ${complement.agent.slug} de ${cardId}.`,
        )
        break
      }
      const contributes = complement.matched.filter((m) => !panel.primary!.matched.includes(m))
      const peer = await instantiate(
        office,
        roster,
        complement.agent,
        card,
        options,
        complement.agent.capabilities,
        contributes,
        true,
        alreadyDeployed.get(complement.agent.slug),
      )
      if (!peer) continue
      budget -= 1
      result.dispatched.push(peer)
      // Lo que aporta el complemento ya no es un hueco.
      for (const cap of contributes) {
        const idx = result.uncovered.indexOf(cap)
        if (idx !== -1) result.uncovered.splice(idx, 1)
      }
    }
  }

  await office.saveRoster(roster)
  await office.saveState(state)
  return result
}

/** Crea (o reutiliza) un agente y devuelve el payload de despacho. */
async function instantiate(
  office: Office,
  roster: Roster,
  catalogAgent: CatalogAgent,
  card: Card,
  options: DispatchOptions,
  capabilities: string[],
  contributes: string[],
  isPeer: boolean,
  reused: RosterEntry | undefined,
): Promise<DispatchedAgent | undefined> {
  const role = catalogAgent.slug
  const agentId = reused?.id ?? `e-${role}`.slice(0, 40)

  const ficha: Ficha = {
    id: agentId,
    role,
    displayName: catalogAgent.displayName,
    source: {
      kind: "agency-agents",
      division: catalogAgent.division,
      path: catalogAgent.path,
      sourcePrompt: catalogAgent.sourcePrompt,
      vibe: catalogAgent.vibe,
      missions: catalogAgent.missions,
      deliverables: catalogAgent.deliverables,
      rules: catalogAgent.rules,
    },
    capabilities,
    tools: ["read", "glob", "grep", "edit", "write", "bash", "task"],
    scope: {
      mayTouch: card.scope.mayTouch,
      forbidden: card.scope.forbidden,
    },
    canDelegate: true,
    delegateBudget: 2,
    peers: [],
    mustNot: [
      "no editar archivos fuera de may_touch",
      "no tocar archivos de forbidden",
      "no aprobar tu propio trabajo",
      "no declarar DONE sin handoff.md y evidence.md",
    ],
    onFinish: "idle-join",
    escalateTo: "integrator",
  }

  const briefing = office.buildBriefing(ficha, card, roster)
  const agentFile = await materializeAgent(options.projectRoot, ficha, briefing)
  const prompt = buildAgentPrompt(ficha, briefing)

  roster.agents[ficha.id] = {
    id: ficha.id,
    role: ficha.role,
    displayName: ficha.displayName,
    state: isPeer ? "idle_available" : "working",
    capabilities: ficha.capabilities,
    fichaPath: agentFile,
    currentCard: isPeer ? null : card.id,
    lease: null,
    idleSince: isPeer ? nowIso() : null,
    canAccept: isPeer,
    helpGiven: 0,
    helpReceived: 0,
    helpedPeers: [],
    lastHeartbeat: nowIso(),
    source: ficha.source,
  }

  return {
    agentId: ficha.id,
    agentName: agentNameFor(ficha.role),
    cardId: isPeer ? null : card.id,
    role: ficha.role,
    displayName: ficha.displayName,
    source: "agency-agents",
    coverage: 0,
    contributes,
    prompt,
    agentFile,
    artifacts: briefing.artifacts.map((a) => a.filename),
    isPeer,
  }
}
