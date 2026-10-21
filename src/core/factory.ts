/**
 * Factory: creación de roles que el catálogo no cubre.
 *
 * Cuando el catálogo de agency-agents no tiene un agente que cubra las
 * capabilities necesarias (cobertura < 60%), se fabrica uno desde un
 * template. La ficha resultante tiene la misma forma que una de catálogo —
 * esa uniformidad es lo que permite que el bus, el matching y los
 * coordinadores no distinguillian el origen.
 *
 * Un rol fabricado queda marcado `source.kind = "factory"` y se registra como
 * candidato a skill: si se usa mucho, se promueve.
 */

import type { Ficha, FichaSource, CoordinatorId } from "./types.js"
import { inferCapabilities } from "./catalog.js"
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
  /** Contexto del objetivo, para que el prompt no sea genérico. */
  objective?: string
}

/** Template base de un agente fabricado. */
export const FACTORY_PROMPT_TEMPLATE = `# {{display_name}}

Sos {{display_name}} dentro de la OFICINA — una malla de agentes que se coordinan por un bus de mensajes en disco.

## Tu rol

{{role_description}}

## Capacidades

{{capabilities}}

## Cómo trabajás

- **Leé antes de actuar.** Tu \`misiones.md\` y tu \`ficha.md\` son la spec. No inventes alcance.
- **Entregá artefactos, no promesas.** Tu salida va a disco: \`handoff.md\` (qué hiciste), \`evidence.md\` (salida real de comandos). Si no hay archivo, no hay hecho.
- **Pedí ayuda cuando el dominio no es tuyo.** No te tragues el trabajo de otro: usá el bus (\`HELP_REQUEST\`). Un reintento solo con tu scope es un error.
- **Delegá cuando te falta un rol.** Si el rol que te falta no está en el roster, pedí \`SPAWN_REQUEST\` al Integrador. No lo clones por tu cuenta.
- **Reportá el estado.** \`CLAIM\` cuando tomás trabajo, \`RELEASE\` cuando lo terminás, \`STATUS\` cuando cambia algo.
- **Respetá tu scope.** Podés tocar lo que está en \`may_touch\`. \`forbidden\` es zona prohibida absoluta.

## Límites duros

{{must_not}}

## Objetivo de la corrida

{{objective}}
`

/**
 * Fabrica una ficha a partir del template.
 *
 * El prompt generado no es genérico: incluye las capabilities concretas, el
 * scope y el objetivo de la corrida. Un agente fabricado con contexto es
 * usable; uno con un prompt vacío no sirve.
 */
export function createFicha(input: FactoryInput): Ficha {
  const displayName = input.displayName ?? titleize(input.role)
  const capabilities = input.capabilities.length > 0
    ? input.capabilities
    : inferCapabilities(displayName, input.role)

  const source: FichaSource = {
    kind: "factory",
    sourcePrompt: renderPrompt(input, displayName, capabilities),
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

function renderPrompt(input: FactoryInput, displayName: string, capabilities: string[]): string {
  return FACTORY_PROMPT_TEMPLATE.replaceAll("{{display_name}}", displayName)
    .replaceAll("{{role_description}}", `Tu rol es ${input.role}.`)
    .replaceAll("{{capabilities}}", capabilities.map((c) => `- ${c}`).join("\n"))
    .replaceAll(
      "{{must_not}}",
      [
        "- no editar archivos fuera de may_touch",
        "- no tocar archivos de forbidden",
        "- no aprobar tu propio trabajo",
        "- no declarar DONE sin handoff.md y evidence.md",
        "- no editar otros agentes' artifacts",
      ].join("\n"),
    )
    .replaceAll("{{objective}}", input.objective ?? "(no especificado)")
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
