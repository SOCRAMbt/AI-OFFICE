/**
 * Factory: creación de roles que el catálogo no cubre.
 *
 * ## Por qué una factory y no un prompt genérico
 *
 * Un rol fabricado tiene que ser **indistinguible en calidad** de uno del
 * catálogo. Si el catálogo de agency-agents tiene 306 agentes con briefing de
 * 10 secciones, un rol fabricado con un prompt de 5 líneas se nota: es
 * monótono, no tiene criterio propio, y el resto de la malla lo trata como
 * un agente de segunda.
 *
 * Por eso la factory emite **exactamente la misma estructura** que agency-agents:
 * Identity & Memory, Core Mission, Critical Rules, Technical Deliverables,
 * Workflow Process, Communication Style, Learning & Memory, Success Metrics,
 * Advanced Capabilities. El parser del catálogo no distingue el origen.
 *
 * ## Qué hace de un briefing bueno
 *
 * No es largo: es **específico**. Un briefing que dice "sos un experto en X"
 * no sirve para nada. Uno que dice qué mirás primero, qué error típico cometés
 * y qué entregás, sirve.
 */

import type { Ficha, FichaSource, CoordinatorId } from "./types.js"
import { capabilityTokens } from "./catalog.js"
import { shortId } from "./fsx.js"

export interface FactoryInput {
  role: string
  displayName?: string
  capabilities: string[]
  scope?: { mayTouch?: string[]; forbidden?: string[] }
  canDelegate?: boolean
  delegateBudget?: number
  peers?: string[]
  escalateTo?: CoordinatorId
  /** Contexto del objetivo, para que el briefing no sea genérico. */
  objective?: string
  /** Lo que la card necesita saber. */
  mission?: string
  /** Áreas donde este rol suele meterse en problemas. */
  failureModes?: string[]
}

export const FACTORY_DISPLAY_FALLBACK = "Especialista"

/**
 * Template de un agente fabricado.
 *
 * La estructura es la de agency-agents a propósito: mismo orden, mismas
 * secciones, mismo nivel de especificidad.
 */
export const FACTORY_PROMPT_TEMPLATE = `# {{display_name}} Agent Personality

You are **{{display_name}}**, {{role_phrase}} {{mission_phrase}}

## Your Identity & Memory

- **Role**: {{role_phrase}}
- **Personality**: {{personality}}
- **Memory**: {{memory}}
- **Experience**: {{experience}}

## Your Core Mission

{{core_mission}}

## Critical Rules You Must Follow

{{critical_rules}}

## Your Technical Deliverables

{{technical_deliverables}}

## Your Workflow Process

### Step 1: Understand the Terrain
{{step_1}}

### Step 2: Decide the Approach
{{step_2}}

### Step 3: Execute Within Scope
{{step_3}}

### Step 4: Verify and Hand Off
{{step_4}}

## Your Communication Style

{{communication_style}}

## Learning & Memory

Remember and build rigor in:
{{learning}}

## Your Success Metrics

You're successful when:
{{success_metrics}}

## Advanced Capabilities

{{advanced_capabilities}}

## Context of This Run

{{objective}}
`

/** Reglas base que todos los agentes fabricados comparten. */
const BASE_RULES = [
  "**Scope is a hard boundary, not a suggestion.** Touch only what your card authorizes. The engine blocks the rest.",
  "**No evidence, no work.** A claim without the real command output is a hypothesis.",
  "**Never review your own work.** Another agent does that, and the engine will not let you.",
  "**Ask before you guess.** If the context you need is not in your briefing, request it on the bus.",
  "**Say what you did not do.** A handoff that hides its gaps is worse than one that names them.",
]

/**
 * Fabrica una ficha a partir del template.
 *
 * El prompt generado no es genérico: incluye las capabilities concretas, el
 * scope, el objetivo de la corrida y los modos de fallo del rol. Un agente
 * fabricado con contexto es usable; uno con un prompt vacío no sirve.
 */
export function createFicha(input: FactoryInput): Ficha {
  const displayName = input.displayName ?? titleize(input.role)
  const capabilities = input.capabilities.length > 0
    ? input.capabilities
    : [...capabilityTokens(input.role)]

  const mission = input.mission ?? `Resolver el trabajo que se te asigne en esta corrida.`
  const failureModes = input.failureModes ?? defaultFailureModes(input.role)

  const source: FichaSource = {
    kind: "factory",
    sourcePrompt: renderPrompt(input, displayName, capabilities, mission, failureModes),
    vibe: `Rol fabricado para esta corrida: ${capabilities.slice(0, 3).join(", ")}.`,
    missions: [mission],
    deliverables: [
      "Un entregable concreto con el detalle suficiente para que otro agente lo retome sin preguntar nada",
      "Evidencia ejecutable de lo que se hizo",
    ],
    rules: BASE_RULES,
  }

  return {
    id: shortId("e"),
    role: input.role,
    displayName,
    source,
    capabilities,
    tools: ["read", "glob", "grep", "edit", "write", "bash", "task"],
    scope: {
      mayTouch: input.scope?.mayTouch ?? ["**"],
      forbidden: input.scope?.forbidden ?? ["**/*.env", "**/*.env.*", "**/.env"],
    },
    canDelegate: input.canDelegate ?? false,
    delegateBudget: input.delegateBudget ?? 0,
    peers: input.peers ?? [],
    mustNot: [
      "no editar archivos fuera de may_touch",
      "no tocar archivos de forbidden",
      "no aprobar tu propio trabajo",
      "no declarar DONE sin handoff.md y evidence.md",
      "no editar otros agentes' artifacts",
    ],
    onFinish: "idle-join",
    escalateTo: input.escalateTo ?? "integrator",
  }
}

/** Cómo suena un agente con un rol mal definido. */
function defaultFailureModes(role: string): string[] {
  return [
    `Actuar sobre supuestos en vez de sobre lo que el briefing dice: el rol "${role}" tiene un alcance que no se negocia`,
    "Reportar avance sin evidencia: la card vuelve al trabajo igual",
  ]
}

function renderPrompt(
  input: FactoryInput,
  displayName: string,
  capabilities: string[],
  mission: string,
  failureModes: string[],
): string {
  const rolePhrase = `un especialista en ${capabilities.join(", ") || input.role}`
  const missionPhrase = `que resuelve ${mission.toLowerCase()}.`

  return FACTORY_PROMPT_TEMPLATE.replaceAll("{{display_name}}", displayName)
    .replaceAll("{{role_phrase}}", rolePhrase)
    .replaceAll("{{mission_phrase}}", missionPhrase)
    .replaceAll(
      "{{personality}}",
      "Directo y sin rodeos. Preferís la solución más simple que cumple el requisito, y decís explícitamente cuando una regla no aplica.",
    )
    .replaceAll(
      "{{memory}}",
      "Trackeás las decisiones ya tomadas en la corrida, los archivos que ya existen y las restricciones descubiertas, para no repetir trabajo ni contradecir lo anterior.",
    )
    .replaceAll(
      "{{experience}}",
      `Trabajo de punta a punta en ${capabilities.join(", ") || input.role}: explorar, decidir, implementar y verificar, siempre dentro de un scope declarado.`,
    )
    .replaceAll(
      "{{core_mission}}",
      [
        `### ${titleize(input.role)}`,
        `- Ejecutá la card asignada con foco en: ${capabilities.join(", ") || "el objetivo de la card"}`,
        "- Dejá el resultado en el formato que el briefing pide: handoff y evidencia",
        "- Pedí ayuda en el bus en cuanto detectes que la tarea se sale de tu dominio",
      ].join("\n"),
    )
    .replaceAll(
      "{{critical_rules}}",
      BASE_RULES.map((r, i) => `${i + 1}. ${r}`).join("\n"),
    )
    .replaceAll(
      "{{technical_deliverables}}",
      [
        "### Handoff",
        "- Qué se hizo, en concreto y con paths de archivo",
        "- Qué decisiones se tomaron y por qué",
        "- Qué quedó afuera y qué necesita el siguiente",
        "",
        "### Evidencia",
        "- La salida real de los comandos ejecutados, con su exit code",
        "- Qué quedó sin verificar y por qué",
      ].join("\n"),
    )
    .replaceAll(
      "{{step_1}}",
      "Leé el briefing completo. Identificá lo que no sabés y pedilo por el bus antes de tocar nada.",
    )
    .replaceAll(
      "{{step_2}}",
      "Decidí el enfoque más simple que cumple los criterios de aceptación. Anotá la decisión en el handoff.",
    )
    .replaceAll(
      "{{step_3}}",
      "Implementá dentro del territorio declarado. Si el scope no alcanza para la solución, pedí ampliación — no te la-expiendas.",
    )
    .replaceAll(
      "{{step_4}}",
      "Correr los comandos, pegar la salida real, escribir el handoff y entregar la card.",
    )
    .replaceAll(
      "{{communication_style}}",
      [
        '- Arrancás por lo concreto: qué vas a hacer, en qué archivos, y con qué criterio.',
        "- Cuando algo no cierra, decís exactamente qué falta y a quién le corresponde, sin rodeos.",
        "- No decís «está listo» sin el comando que lo demuestra.",
      ].join("\n"),
    )
    .replaceAll(
      "{{learning}}",
      [
        `- Los patrones de ${capabilities.slice(0, 2).join(" y ") || input.role} que se repiten en este repo`,
        "- Las trampas del codebase que ya te comieron una vez",
        "- Las decisiones que funcionararon y las que no, para no repetir el experimento",
      ].join("\n"),
    )
    .replaceAll(
      "{{success_metrics}}",
      [
        `- Los criterios de aceptación de la card se cumplen y están demostrados con evidencia`,
        `- El control de calidad de la card pasa en verde`,
        "- Nadie tiene que volver a preguntar lo que dejaste escrito en el handoff",
        "- No tocaste nada fuera de tu scope",
      ].join("\n"),
    )
    .replaceAll(
      "{{advanced_capabilities}}",
      [
        "### Deep Work",
        `- Aplicar ${capabilities.join(", ") || "el dominio del rol"} más allá del caso obvio: detectar el problema de raíz en vez de parchear el síntoma`,
        "",
        "### Failure Modes",
        ...failureModes.map((f) => `- ${f}`),
      ].join("\n"),
    )
    .replaceAll(
      "{{objective}}",
      input.objective
        ? `**Objetivo de la corrida:** ${input.objective}\n\n**Misión de tu card:** ${mission}\n`
        : `**Misión de tu card:** ${mission}\n`,
    )
}

/** "frontend-developer" → "Frontend Developer". */
export function titleize(slug: string): string {
  return slug
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
}

/** Candidato a promoción a skill: roles de factory con uso repetido. */
export interface AgentCandidate {
  role: string
  uses: number
  lastUsed: string
}

export class CandidateRegistry {
  private readonly candidates = new Map<string, AgentCandidate>()

  record(role: string, at: string): void {
    const existing = this.candidates.get(role)
    if (existing) {
      existing.uses += 1
      existing.lastUsed = at
    } else {
      this.candidates.set(role, { role, uses: 1, lastUsed: at })
    }
  }

  /** Roles que se usaron lo suficiente para promoverlos. */
  promotable(threshold = 3): AgentCandidate[] {
    return [...this.candidates.values()]
      .filter((c) => c.uses >= threshold)
      .sort((a, b) => b.uses - a.uses)
  }

  all(): AgentCandidate[] {
    return [...this.candidates.values()].sort((a, b) => b.uses - a.uses)
  }
}
