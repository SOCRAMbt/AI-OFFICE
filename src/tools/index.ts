/**
 * Tools de la OFICINA.
 *
 * La superficie que ve el modelo. Diez tools, no treinta: cada tool que se
 * suma es ruido en el contexto de todos los agentes.
 *
 * Lo que el modelo decide: el plan, el contenido, los veredictos, el triage.
 * Lo que el código decide: los gates, los invariantes, el routing, los
 * contadores, los leases. Esa división es la que hace que el sistema sea
 * determinista donde tiene que serlo y creativo donde tiene que serlo.
 */

import { z } from "zod"
import type { Card, CardType, MessageKind, MessagePriority } from "../core/types.js"
import { CHANNELS } from "../core/bus.js"
import { Office, renderFicha } from "../core/office.js"
import { renderBriefing } from "../core/briefing.js"
import { dispatchOffice } from "../core/dispatch.js"
import { snapshotMesa, renderMesa } from "../core/mesa.js"

/**
 * La forma neutra de una tool.
 *
 * ## Por qué el motor no depende de ninguna API de plugins
 *
 * OpenCode v1 y v2 tienen APIs de plugins **incompatibles**: v1 usa
 * `{ description, args: zodSchema, execute }` y v2 usa
 * `{ name, description, input: JSONSchema, execute }`. Si el motor usara
 * cualquiera de las dos, la otra version se rompia.
 *
 * Asi que el motor define la forma intermedia y cada entry la traduce:
 * `v1.ts` la envuelve con el helper del plugin v1, `v2.ts` la convierte a
 * JSON Schema con `z.toJSONSchema`.
 *
 * El parametro de tipo `TArgs` no es decorativo: es lo que hace que
 * `args.objective` siga siendo `string` dentro del `execute` en vez de
 * `unknown`. Sin el, el motor entero pierde el tipado de sus argumentos.
 */
export interface OficinaTool<TArgs extends z.ZodTypeAny = z.ZodTypeAny> {
  description: string
  /** Schema zod de los argumentos. */
  args?: TArgs
  execute(args: z.infer<TArgs>, ctx: ToolContext): Promise<OficinaToolResult>
}

/** Lo que recibe la tool: dónde corre y en qué sesión. */
export interface ToolContext {
  /** Directorio del proyecto. */
  directory: string
  /** Sesión que invocó la tool. */
  sessionID: string
  /** Agente que invocó la tool, si el host lo informa. */
  agent?: string
  /** Id del mensaje, si el host lo informa. */
  messageID?: string
}

/** Lo que devuelve la tool. */
export interface OficinaToolResult {
  title: string
  output: string
  metadata?: Record<string, unknown>
}

/**
 * Helper local: construye una tool en la forma neutra.
 *
 * Es la identidad a proposito. Antes usaba el `tool()` del plugin v1, que
 * ataba el motor a esa API.
 *
 * ## Por que construye el `z.object`
 *
 * El helper de v1 recibia los argumentos como **forma plana**
 * (`{ objective: z.string() }`) y armaba el `z.object` por dentro. El motor
 * esta escrito asi, y es la forma mas comoda de declarar una tool. Este
 * helper mantiene esa ergonomia y guarda el objeto construido, que es lo que
 * despues traduce cada entry (v1 lo pasa tal cual, v2 lo convierte a JSON
 * Schema).
 */
function tool<TShape extends z.ZodRawShape>(input: {
  description: string
  args: TShape
  execute(args: z.infer<z.ZodObject<TShape>>, ctx: ToolContext): Promise<OficinaToolResult>
}): OficinaTool<z.ZodObject<TShape>> {
  return {
    description: input.description,
    args: z.object(input.args),
    execute: input.execute,
  }
}

const cardTypeSchema = z.enum([
  "exploration",
  "design",
  "implementation",
  "bugfix",
  "refactor",
  "testing",
  "docs",
  "security",
  "infra",
])

/**
 * Construye el set de tools dado una instancia de Office.
 *
 * El tipo de retorno es explícito a propósito: sin la anotación, TypeScript
 * no puede nombrar el tipo de los schemas (que viene del zod anidado del
 * plugin) y el build falla con TS2742.
 */
export function buildTools(office: Office): Record<string, OficinaTool> {
  const officeOf = (ctx: { directory: string }) => {
    // El directorio del contexto tiene prioridad sobre el cwd del plugin:
    // es el proyecto real en el que se está trabajando.
    if (ctx.directory && ctx.directory !== office.paths.projectRoot) {
      const alt = new Office({ cwd: ctx.directory, limits: office.limits })
      return alt
    }
    return office
  }

  return {
    /**
     * Guarda el plan de cards. El modelo propone; el código valida y rutea.
     */
    oficina_plan: tool({
      description:
        "Guarda el plan de trabajo de la oficina: descompone el objetivo en cards con acceptance criteria verificables, scope y gate. " +
        "El motor valida el plan, rutea owner y reviewer automáticamente, y persiste el estado. " +
        "Usá esto UNA vez, al inicio de la corrida. Un card = un entregable coherente; si tiene más de 5 criterios de aceptación, partila.",
      args: {
        objective: z.string().describe("El objetivo de la corrida, textual."),
        cards: z
          .array(
            z.object({
              title: z.string().describe("Verbo + objeto. Específico."),
              type: cardTypeSchema.describe("Tipo de trabajo."),
              requiredCapabilities: z
                .array(z.string())
                .describe("Capabilities que el agente necesita. Se usan para resolver el rol desde el catálogo."),
              scope: z
                .object({
                  mayTouch: z.array(z.string()).describe("Globs que el agente puede tocar."),
                  forbidden: z.array(z.string()).describe("Globs prohibidos."),
                })
                .optional(),
              acceptance: z
                .array(z.string())
                .describe("Criterios verificables. Nada de 'hecho' genérico."),
              gate: z.string().describe("Condición concreta para pasar a DONE."),
              dependsOn: z.array(z.string()).describe("Ids de cards que deben estar DONE."),
            }),
          )
          .describe("Las cards del plan, en orden de ejecución."),
      },
      async execute(args, ctx) {
        const off = officeOf(ctx)
        await off.init()
        const state = await off.loadState(args.objective)
        const updated = await off.savePlan(state, args.cards as never)
        return {
          title: `Plan guardado: ${updated.order.length} cards`,
          output: [
            `Plan guardado. ${updated.order.length} cards en la corrida.`,
            "",
            ...updated.order.map((id) => {
              const c = updated.cards[id]!
              return `- **${id}** ${c.title} [${c.type}] owner=${c.owner ?? "(sin owner)"} reviewer=${c.reviewer ?? "(sin reviewer)"} — gate: ${c.gate}`
            }),
            "",
            `Siguiente paso: llamá \`oficina_assign\` para tomar la primera card.`,
          ].join("\n"),
          metadata: { runId: updated.runId, cards: updated.order.length },
        }
      },
    }),

    /**
     * Lee el estado de la corrida.
     */
    oficina_board: tool({
      description:
        "Muestra el estado de la oficina: cards, sus owners, revisiones pendientes, agentes libres, agentes muertos y presupuesto. " +
        "Usá esto para saber en qué punto estás antes de actuar.",
      args: {
        filter: z.enum(["all", "todo", "in_progress", "review", "done", "blocked", "escalated"]).default("all"),
      },
      async execute(args, ctx) {
        const off = officeOf(ctx)
        const snap = await off.snapshot()
        const { state, roster, idle, working, dead } = snap

        const cards = Object.values(state.cards).filter(
          (c) => args.filter === "all" || c.state === args.filter,
        )

        const lines: string[] = [
          `# OFICINA — ${state.objective}`,
          "",
          `**Estado:** ${state.status} · **iteración:** ${state.iteration} · **presupuesto:** ${state.budget.cardsUsed}/${state.budget.maxCards} cards, ${state.budget.agentCallsUsed}/${state.budget.maxAgentCalls} agentes, ${state.budget.spawnsUsed}/${state.budget.maxSpawnsTotal} spawns`,
          "",
          "## Cards",
          "",
          cards.length === 0 ? "(ninguna)" : "",
          ...cards.map(
            (c) =>
              `- **${c.id}** [${c.state}] ${c.title} · owner=${c.owner ?? "—"} reviewer=${c.reviewer ?? "—"} · rechazos=${c.rejections} · ${c.result ?? ""}`,
          ),
          "",
          `## Agentes (${Object.keys(roster.agents).length})`,
          "",
          `**Trabajando:** ${working.map((a) => `${a.id}(${a.role})`).join(", ") || "—"}`,
          `**Libres:** ${idle.map((a) => `${a.id}(${a.role})`).join(", ") || "—"}`,
          `**Sin heartbeat:** ${dead.map((a) => `${a.id}(${a.role})`).join(", ") || "—"}`,
        ]

        return {
          title: `Oficina: ${state.status} · ${state.budget.cardsUsed} cards`,
          output: lines.join("\n"),
          metadata: {
            status: state.status,
            cards: state.budget.cardsUsed,
            idle: idle.length,
            dead: dead.length,
          },
        }
      },
    }),

    /**
     * Toma trabajo: claim de la próxima card o de una card puntual.
     */
    oficina_assign: tool({
      description:
        "Tomá trabajo en la oficina. Sin cardId, toma la próxima card lista (dependencias satisfechas, o retomando una en curso). " +
        "Con cardId, reclama una card puntual — es el claim proactivo del pool libre. Si la card ya está tomada por otro agente, el motor lo rechaza.",
      args: {
        agentId: z.string().describe("Tu id de agente (el de tu ficha)."),
        cardId: z.string().optional().describe("Card puntual a reclamar. Opcional."),
      },
      async execute(args, ctx) {
        const off = officeOf(ctx)
        const state = await off.loadState()

        let card: Card | null = null
        let reason = ""

        if (args.cardId) {
          const claimed = await off.claimCard(state, args.agentId, args.cardId, ctx.sessionID)
          if (!claimed.ok) {
            return { title: "No se pudo reclamar", output: claimed.reason }
          }
          card = state.cards[args.cardId] ?? null
          reason = claimed.reason
        } else {
          const next = await off.claimNext(state, args.agentId, ctx.sessionID)
          card = next.card
          reason = next.reason
        }

        if (!card) {
          return { title: "Sin trabajo disponible", output: reason }
        }

        const roster = await off.loadRoster(state.runId)
        const entry = roster.agents[args.agentId]

        return {
          title: `${card.id}: ${card.title}`,
          output: [
            `**Card ${card.id}: ${card.title}** (${card.type})`,
            "",
            `**Por qué esta:** ${reason}`,
            "",
            "**Acceptance criteria:**",
            ...card.acceptance.map((a: string) => `- ${a}`),
            "",
            `**Gate:** ${card.gate}`,
            "",
            "**Scope (may_touch):**",
            ...card.scope.mayTouch.map((s: string) => `- ${s}`),
            "",
            "**Scope (forbidden):**",
            ...card.scope.forbidden.map((s: string) => `- ${s}`),
            "",
            `**Tus peers:** ${entry?.capabilities.join(", ") ?? "—"}`,
            `**Revisor:** ${card.reviewer ?? "—"} (no sos vos)`,
            "",
            "Escribí tu trabajo, y cuando termines llamá `oficina_submit` con el handoff y la evidencia real.",
          ].join("\n"),
          metadata: { cardId: card.id, type: card.type },
        }
      },
    }),

    /**
     * Entrega el trabajo de una card.
     */
    oficina_submit: tool({
      description:
        "Entrega el trabajo de una card: escribís el handoff (qué hiciste, qué archivos tocaste, qué decidiste, qué quedó afuera) y la evidencia real (salida literal de los comandos que corriste). " +
        "Sin evidencia pegada, la card no se puede aprobar. Después de esto, la card pasa a REVIEW.",
      args: {
        agentId: z.string().describe("Tu id de agente."),
        cardId: z.string().describe("La card que entregás."),
        handoff: z.string().describe("Qué hiciste. Con paths de archivo concretos."),
        evidence: z.string().optional().describe("Salida real de los comandos, pegada literal."),
      },
      async execute(args, ctx) {
        const off = officeOf(ctx)
        const state = await off.loadState()
        const result = await off.submitWork(state, args.cardId, args.agentId, {
          handoff: args.handoff,
          evidence: args.evidence,
        })
        if (!result.ok) return { title: "No se pudo entregar", output: result.reason }

        const card = state.cards[args.cardId]!
        return {
          title: `${args.cardId} entregada`,
          output: [
            result.reason,
            "",
            `**Revisor asignado:** ${card.reviewer ?? "(sin asignar)"}`,
            "",
            "El revisor corre ahora. Si te rechaza, vas a recibir el motivo y una instrucción concreta de qué corregir.",
          ].join("\n"),
          metadata: { cardId: args.cardId },
        }
      },
    }),

    /**
     * Registra el veredicto de revisión.
     */
    oficina_review: tool({
      description:
        "Registrá el veredicto de una revisión. NUNCA revises una card que vos implementaste: el motor te lo rechaza. " +
        "El review necesita un ledger de lectura (qué leíste completo, qué callers leíste) y findings con confianza 0-100. " +
        "Solo se reportan findings con confianza ≥ 80.",
      args: {
        agentId: z.string().describe("Tu id de agente (el revisor)."),
        cardId: z.string().describe("La card revisada."),
        verdict: z.enum(["approved", "rejected"]).describe("Veredicto."),
        reason: z.string().describe("Por qué. Si aprobaste, qué te quedó claro; si rechazaste, qué falla exactamente."),
        review: z.string().describe("El review completo en markdown: ledger de lectura, findings con path:línea, escenario de reproducción, fix y test de regresión."),
      },
      async execute(args, ctx) {
        const off = officeOf(ctx)
        const state = await off.loadState()
        const result = await off.submitReview(state, args.cardId, args.agentId, args.verdict, {
          review: args.review,
          reason: args.reason,
        })
        if (!result.ok) return { title: "Review inválido", output: result.reason }
        return {
          title: `${args.cardId}: ${args.verdict}`,
          output: [
            `**Veredicto: ${args.verdict.toUpperCase()}**`,
            "",
            result.reason,
            "",
            result.action === "run_gates"
              ? "Ahora corré los gates: `oficina_gate`."
              : result.action === "escalate"
                ? "La card agotó los reintentos. Se escala al usuario con opciones concretas."
                : "La card vuelve a trabajo. Corregí exactamente lo que el review marcó.",
          ].join("\n"),
          metadata: { cardId: args.cardId, verdict: args.verdict, action: result.action },
        }
      },
    }),

    /**
     * Corre los gates de calidad.
     */
    oficina_gate: tool({
      description:
        "Corre los gates de calidad de una card: build, type check, lint, tests, security grep y diff review. " +
        "Son comandos reales — el motor interpretan exit codes, no tu opinión. Si pasan, la card se cierra. " +
        "Si fallan, la salida real queda en el artefacto y la card vuelve a trabajo con el motivo.",
      args: {
        cardId: z.string().describe("La card a verificar."),
      },
      async execute(args, ctx) {
        const off = officeOf(ctx)
        const state = await off.loadState()
        const gates = await off.runGates(state, args.cardId)

        const table = (rows: typeof gates.technical) =>
          rows.map((r) => `| ${r.phase} | \`${r.command ?? "—"}\` | ${r.outcome.toUpperCase()} | ${r.detail} |`).join("\n")

        const closed = await off.closeCard(state, args.cardId, gates)

        return {
          title: `${args.cardId}: gates ${gates.passed ? "PASS" : "FAIL"}`,
          output: [
            `## Gate técnico: ${gates.technicalOutcome.toUpperCase()}`,
            "",
            "| Fase | Comando | Resultado | Detalle |",
            "|------|---------|-----------|---------|",
            table(gates.technical),
            "",
            `## Gate seguridad: ${gates.securityOutcome.toUpperCase()}`,
            "",
            "| Fase | Comando | Resultado | Detalle |",
            "|------|---------|-----------|---------|",
            table(gates.security),
            "",
            closed.ok
              ? `✅ **${closed.reason}**`
              : `❌ **${closed.reason}**`,
            "",
            "La salida completa de cada comando quedó en `.oficina/artifacts/<card>/gates.md`.",
          ].join("\n"),
          metadata: {
            cardId: args.cardId,
            passed: gates.passed,
            technical: gates.technicalOutcome,
            security: gates.securityOutcome,
          },
        }
      },
    }),

    /**
     * Bus de mensajes: pedir ayuda, recibir, acusar recibo.
     */
    oficina_bus: tool({
      description:
        "Bus de mensajes de la oficina. Acciones: 'send' (mandar un mensaje), 'receive' (leer lo que te llegó), 'ack' (acusar recibo), 'help' (pedir ayuda a un peer o al pool). " +
        "Pedir ayuda es un verbo de primera clase: si la tarea es de otro dominio, pedila en vez de Stretcharla.",
      args: {
        action: z.enum(["send", "receive", "ack", "help"]),
        agentId: z.string().describe("Tu id de agente."),
        to: z.array(z.string()).describe("Destinatarios. ['*'] es broadcast al pool."),
        kind: z
          .enum([
            "HELP_REQUEST",
            "HELP_ACCEPT",
            "HELP_DECLINE",
            "HELP_PARTIAL",
            "HELP_QUESTION",
            "QUESTION",
            "ANSWER",
            "SPAWN_REQUEST",
            "SPAWN_APPROVED",
            "SPAWN_REJECTED",
            "CLAIM",
            "RELEASE",
            "STATUS",
            "NOTICE",
          ])
          .optional()
          .describe("Tipo de mensaje. Requerido para send/help."),
        subject: z.string().optional().describe("Card o tema del mensaje."),
        body: z.string().optional().describe("Cuerpo del mensaje en texto o JSON."),
        messageId: z.string().optional().describe("Id del mensaje (para ack)."),
        need: z.string().optional().describe("Para help: qué necesitás."),
        whyMe: z.string().optional().describe("Para help: por qué no lo resolvés vos."),
        priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
      },
      async execute(args, ctx) {
        const off = officeOf(ctx)
        await off.init()

        if (args.action === "receive") {
          const messages = await off.bus.receive(args.agentId, [CHANNELS.peer, CHANNELS.flow, CHANNELS.command, CHANNELS.arch])
          if (messages.length === 0) {
            return { title: "Sin mensajes", output: "No hay mensajes nuevos en tu inbox." }
          }
          return {
            title: `${messages.length} mensajes`,
            output: messages
              .map(
                (m) =>
                  `### [${m.kind}] de ${m.from} — ${m.subject}\n${JSON.stringify(m.body, null, 2)}\n_(id: ${m.id})_`,
              )
              .join("\n\n"),
            metadata: { count: messages.length },
          }
        }

        if (args.action === "ack") {
          if (!args.messageId) return { title: "Falta messageId", output: "Indicá el messageId a acusar." }
          await off.bus.ack(args.agentId, args.messageId)
          return { title: "Acusado", output: `Mensaje ${args.messageId} acusado.` }
        }

        if (args.action === "help") {
          if (!args.need) return { title: "Falta need", output: "Indicá qué necesitás." }
          const state = await off.loadState()
          const cardId = args.subject ?? ""
          const route = await off.routeHelpRequest(state, args.agentId, cardId)
          const targets = route.targets.length > 0 ? route.targets : args.to
          if (targets.length === 0) {
            return { title: "Sin destinatario", output: `No hay a quién pedirle: ${route.reason}` }
          }
          const msg = await off.bus.broadcastHelp({
            from: args.agentId,
            cardId,
            need: args.need,
            whyMe: args.whyMe ?? "",
          })
          return {
            title: `Ayuda pedida a ${targets.join(", ")}`,
            output: `Pedido de ayuda publicado (${msg.id}). Destinatarios: ${targets.join(", ")}. Razón del routing: ${route.reason}.`,
            metadata: { messageId: msg.id, targets },
          }
        }

        // send
        if (!args.kind) return { title: "Falta kind", output: "Indicá el tipo de mensaje." }
        const msg = await off.bus.send(CHANNELS.peer, {
          from: args.agentId,
          to: args.to,
          kind: args.kind as MessageKind,
          subject: args.subject ?? "",
          body: args.body ? safeJson(args.body) : {},
          priority: args.priority as MessagePriority,
        })
        return { title: `Mensaje ${msg.id}`, output: `Publicado en el canal peer (seq ${msg.seq}).` }
      },
    }),

    /**
     * Solicita desplegar un agente nuevo.
     */
    oficina_spawn: tool({
      description:
        "Pedí desplegar un agente nuevo cuando el rol que te falta NO está en el roster. " +
        "El Integrador aprueba o rechaza: si la capacidad ya la cubre un peer desplegado, te dice a quién preguntar. " +
        "No clones agentes por tu cuenta: el motor mantiene el registro y el presupuesto de spawns.",
      args: {
        agentId: z.string().describe("Tu id de agente."),
        requestedRole: z.string().describe("El rol que necesitás."),
        capabilities: z.array(z.string()).describe("Capabilities del rol nuevo."),
        reason: z.string().describe("Por qué lo necesitás y por qué ningún peeractual lo cubre."),
        cardId: z.string().optional().describe("Card donde lo vas a usar."),
      },
      async execute(args, ctx) {
        const off = officeOf(ctx)
        const state = await off.loadState()
        const roster = await off.loadRoster(state.runId)

        // ¿Ya existe un agente con ese rol?
        const existing = Object.values(roster.agents).find((a) => a.role === args.requestedRole)
        if (existing) {
          return {
            title: "El rol ya existe",
            output: `El rol \`${args.requestedRole}\` ya está desplegado como \`${existing.id}\` (${existing.state}). Pedile ayuda a él en vez de spawnear.`,
          }
        }

        // ¿Algún peer ya cubre la capacidad?
        const covered = Object.values(roster.agents).filter((a) =>
          args.capabilities.some((c) => a.capabilities.includes(c)),
        )
        if (covered.length > 0) {
          return {
            title: "La capacidad ya está cubierta",
            output: [
              `Estos agentes ya cubren alguna de las capabilities que pediste:`,
              ...covered.map((a) => `- ${a.id} (${a.role}) — ${a.capabilities.join(", ")}`),
              "",
              "Pediles ayuda por el bus antes de spawnear. Spawnear duplicaría capacidad.",
            ].join("\n"),
          }
        }

        const msg = await off.bus.send(CHANNELS.flow, {
          from: args.agentId,
          to: ["integrator"],
          kind: "SPAWN_REQUEST",
          subject: args.cardId ?? "",
          body: {
            requested_role: args.requestedRole,
            capabilities: args.capabilities,
            reason: args.reason,
            budget: {
              spawns_used: state.budget.spawnsUsed,
              spawns_remaining: state.budget.maxSpawnsTotal - state.budget.spawnsUsed,
            },
          },
          idempotencyKey: `spawn:${args.requestedRole}:${args.agentId}`,
        })

        return {
          title: `Spawn solicitado: ${args.requestedRole}`,
          output: `Spawn request publicado (${msg.id}). El Integrador lo aprueba o lo rechaza. Te llega la respuesta por el bus.`,
          metadata: { messageId: msg.id, role: args.requestedRole },
        }
      },
    }),

    /**
     * Escala al usuario.
     */
    oficina_escalate: tool({
      description:
        "Escalá al usuario cuando hay un bloqueo real: dependencia externa, conflicto que ningún coordinador resuelve, " +
        "o presupuesto agotado. NUNCA con un monólogo: siempre 2-3 opciones concretas con trade-off y tu recomendación. " +
        "Lo que un coordinador puede resolver NO se escala.",
      args: {
        agentId: z.string().describe("Tu id de agente."),
        cardId: z.string().describe("La card bloqueada."),
        cause: z.string().describe("Causa raíz. Qué impide avanzar."),
        options: z
          .array(
            z.object({
              label: z.string().describe("Qué hacer."),
              tradeoff: z.string().describe("Qué cuesta o qué se pierde."),
            }),
          )
          .min(2)
          .describe("Entre 2 y 3 opciones concretas."),
        recommendation: z.string().describe("Cuál recomendás y por qué."),
      },
      async execute(args, ctx) {
        const off = officeOf(ctx)
        const state = await off.loadState()
        const card = state.cards[args.cardId]

        state.escalations.push({
          id: `esc-${state.escalations.length + 1}`,
          cardId: args.cardId,
          at: new Date().toISOString(),
          cause: args.cause,
          attempts: card ? [{ iteration: card.attempts, summary: card.result ?? "sin detalle" }] : [],
          options: args.options.map((o, i) => ({ id: `o${i + 1}`, label: o.label, tradeoff: o.tradeoff })),
          recommendation: args.recommendation,
          status: "open",
        })
        state.decisions.push({
          at: new Date().toISOString(),
          cardId: args.cardId,
          decision: "escalated",
          reason: args.cause,
          actor: args.agentId,
        })
        if (card) card.state = "escalated"
        await off.saveState(state)

        return {
          title: `Escalado: ${args.cardId}`,
          output: [
            `**Causa raíz:** ${args.cause}`,
            "",
            "**Opciones:**",
            ...args.options.map((o, i) => `${i + 1}. ${o.label} — ${o.tradeoff}`),
            "",
            `**Recomendación:** ${args.recommendation}`,
          ].join("\n"),
          metadata: { cardId: args.cardId, options: args.options.length },
        }
      },
    }),

    /**
     * Genera el briefing de un agente para una card.
     */
    oficina_brief: tool({
      description:
        "Generá el briefing de un agente: el contrato de información completo con 10 secciones en orden fijo " +
        "(quién sos · tu misión · lo que ya sabés · lo que NO sabés · tu territorio · cómo trabajás · tu canal · " +
        "qué se espera de vos · lo que no podés hacer · cómo se mide que terminaste). " +
        "Las secciones requeridas son el mínimo: si falta alguna, el briefing se marca INCOMPLETO y el agente no arranca. " +
        "Devuelve también las alternativas de rol que servían, para que elCommander pueda repartir carga.",
      args: {
        role: z.string().describe("El rol que querés. Se resuelve contra el catálogo de agency-agents."),
        capabilities: z.array(z.string()).describe("Capabilities que el rol necesita."),
        cardId: z.string().optional().describe("Card a la que se asignará. Si se omite, se usa una card de ejemplo."),
        objective: z.string().optional().describe("Objetivo de la corrida, para que el briefing no sea genérico."),
      },
      async execute(args, ctx) {
        const off = officeOf(ctx)
        await off.init()

        const resolved = await off.resolveFicha({
          role: args.role,
          capabilities: args.capabilities,
          objective: args.objective,
        })

        const state = await off.loadState()
        const card =
          (args.cardId ? state.cards[args.cardId] : undefined) ??
          state.order.map((id) => state.cards[id]).find((c) => c && c.state === "todo")

        if (!card) {
          return {
            title: "Sin card para el briefing",
            output:
              "No hay ninguna card en la corrida. Pasá `cardId` de una card existente, o armá el plan primero con `oficina_plan`.",
          }
        }

        const roster = await off.loadRoster(state.runId)
        const briefing = off.buildBriefing(resolved.ficha, card, roster)

        const alternatives = resolved.alternatives
          .slice(0, 4)
          .map(
            (alt) =>
              `- \`${alt.agent.slug}\` (${alt.agent.division}) — cobertura ${(alt.coverage * 100).toFixed(0)}%`,
          )

        // El panel: primario + complementos + huecos. Los complementos son
        // los agentes que cubren lo que el primario NO cubre.
        const panel = resolved.panel
        const panelLines: string[] = []
        if (panel?.primary) {
          panelLines.push(
            `**Primario:** \`${panel.primary.agent.slug}\` (${panel.primary.agent.division}) — ${(panel.primary.coverage * 100).toFixed(0)}% · cubre ${panel.primary.matched.join(", ") || "—"}`,
          )
          for (const c of panel.complements) {
            const aporta = c.matched.filter((m) => !panel.primary!.matched.includes(m))
            panelLines.push(
              `**Complemento:** \`${c.agent.slug}\` (${c.agent.division}) — ${(c.coverage * 100).toFixed(0)}% · aporta ${aporta.join(", ") || "—"}`,
            )
          }
          if (panel.uncovered.length > 0) {
            panelLines.push(
              `**Sin cubrir por nadie del panel:** ${panel.uncovered.join(", ")} — considerá partir la card o fabricar un rol.`,
            )
          }
        }

        return {
          title: `Briefing de ${resolved.ficha.displayName} — ${card.id}`,
          output: [
            `**Rol:** \`${resolved.ficha.role}\` · **origen:** ${resolved.source} · **cobertura:** ${(resolved.coverage * 100).toFixed(0)}%`,
            `**Card:** ${card.id} — ${card.title}`,
            `**Briefing:** ${briefing.complete ? "COMPLETO" : `INCOMPLETO — faltan: ${briefing.missing.join(", ")}`}`,
            "",
            ...(panelLines.length > 0 ? ["### Panel de roles", "", ...panelLines, ""] : []),
            "---",
            "",
            renderBriefing(briefing),
            "---",
            "",
            "**Alternativas de rol** (por si querés repartir carga):",
            ...alternatives,
            "",
            `Los 4 artefactos (\`ficha.md\`, \`misiones.md\`, \`protocolo.md\`, \`bus.md\`) se escriben en \`.oficina/fichas/${resolved.ficha.id}/\` al desplegar.`,
          ].join("\n"),
          metadata: {
            agentId: resolved.ficha.id,
            source: resolved.source,
            coverage: resolved.coverage,
            complete: briefing.complete,
            missing: briefing.missing,
            complements: resolved.panel?.complements.length ?? 0,
            uncovered: resolved.panel?.uncovered ?? [],
          },
        }
      },
    }),

    /**
     * Resuelve un rol a una ficha.
     */
    oficina_ficha: tool({
      description:
        "Resolvé un rol a una ficha de agente. El motor busca en el catálogo de agency-agents el agente que mejor matchea las capabilities; " +
        "si la cobertura es menor al 60%, lo fabrica desde un template con el contexto de la corrida. " +
        "Devuelve la ficha completa: scope, peers, límites y prompt de origen.",
      args: {
        role: z.string().describe("El rol que querés."),
        capabilities: z.array(z.string()).describe("Capabilities necesarias."),
        scope: z
          .object({
            mayTouch: z.array(z.string()).optional(),
            forbidden: z.array(z.string()).optional(),
          })
          .optional(),
        canDelegate: z.boolean().default(false),
        delegateBudget: z.number().int().min(0).max(5).default(0),
        peers: z.array(z.string()).default([]),
        objective: z.string().optional().describe("Objetivo de la corrida, para que el prompt no sea genérico."),
      },
      async execute(args, ctx) {
        const off = officeOf(ctx)
        await off.init()
        const result = await off.resolveFicha({
          role: args.role,
          capabilities: args.capabilities,
          scope: args.scope,
          canDelegate: args.canDelegate,
          delegateBudget: args.delegateBudget,
          peers: args.peers,
          objective: args.objective,
        })
        const entry = await off.deploy(result.ficha)

        return {
          title: `${result.ficha.displayName} (${result.source})`,
          output: [
            renderFicha(result.ficha),
            `**Agente desplegado:** \`${entry.id}\` — usá este id en todas las llamadas.`,
            `**Origen:** ${result.source} · **cobertura:** ${(result.coverage * 100).toFixed(0)}%`,
          ].join("\n"),
          metadata: { agentId: entry.id, source: result.source, coverage: result.coverage },
        }
      },
    }),

    /**
     * Despacha el equipo: crea los subagentes y les da el briefing.
     */
    oficina_dispatch: tool({
      description:
        "Despacha el equipo de la corrida. Para cada card sin owner: resuelve el rol desde el catálogo de agency-agents " +
        "(o lo fabrica si no hay match), materializa el agente con su briefing de 10 secciones, y devuelve el prompt " +
        "de arranque de cada uno. Los complementos del panel quedan disponibles como pares para pedir ayuda. " +
        "Usá esto UNA vez, después de `oficina_plan`: es el momento en que el equipo se forma.",
      args: {
        maxAgents: z.number().int().min(1).max(14).default(10).describe("Máximo de agentes a materializar."),
        maxComplements: z.number().int().min(0).max(3).default(2).describe("Complementos por card."),
        spawn: z
          .boolean()
          .default(true)
          .describe("Si es true, arranca los subagentes en paralelo automáticamente."),
      },
      async execute(args, ctx) {
        const off = officeOf(ctx)
        await off.init()
        const state = await off.loadState()
        const catalog = await off.catalog()
        const roster = await off.loadRoster(state.runId)

        const result = await dispatchOffice(off, state, {
          projectRoot: off.paths.projectRoot,
          catalog,
          objective: state.objective,
          maxAgents: Math.min(args.maxAgents, off.limits.maxConcurrentAgents),
          maxComplements: args.maxComplements,
          minCoverage: off.limits.minCatalogCoverage,
          existing: Object.values(roster.agents),
        })

        // Arranque en paralelo de los agentes con card propia.
        const spawned: string[] = []
        if (args.spawn) {
          for (const agent of result.dispatched) {
            if (agent.isPeer) continue
            const ok = await off.spawnAgent(ctx.sessionID, agent.agentName, agent.prompt, agent.cardId ?? "")
            if (ok) spawned.push(`${agent.agentName} (${agent.role})`)
          }
        }

        const lines: string[] = [
          `**Equipo despachado:** ${result.dispatched.length} agentes (${result.dispatched.filter((a) => !a.isPeer).length} con card, ${result.dispatched.filter((a) => a.isPeer).length} como pares libres)`,
          "",
          "| Agente | Rol | Card | Origen | Aporta |",
          "|--------|-----|------|--------|---------|",
          ...result.dispatched.map(
            (a) =>
              `| \`${a.agentName}\` | ${a.displayName} | ${a.cardId ?? "— (par libre)"} | ${a.source} | ${a.contributes.join(", ") || "—"} |`,
          ),
        ]

        if (spawned.length > 0) {
          lines.push("", `**Arrancados en paralelo:** ${spawned.join(", ")}`)
        }
        if (result.uncovered.length > 0) {
          lines.push(
            "",
            `**Capabilities que nadie cubre:** ${result.uncovered.join(", ")}`,
            "",
            "Opciones: partir la card en dos (una por dominio), fabricar el rol con `oficina_spawn`, o aceptar la deuda.",
          )
        }
        if (result.unassigned.length > 0) {
          lines.push("", `**Cards sin owner:** ${result.unassigned.join(", ")}`)
        }
        for (const note of result.notes) lines.push(`- ${note}`)

        lines.push(
          "",
          "**Agentes materializados en** `.opencode/agents/` — versionados con el repo y disponibles la próxima sesión.",
        )

        return {
          title: `Equipo despachado: ${result.dispatched.length} agentes`,
          output: lines.join("\n"),
          metadata: {
            dispatched: result.dispatched.length,
            spawned: spawned.length,
            uncovered: result.uncovered,
            unassigned: result.unassigned,
          },
        }
      },
    }),

    /**
     * La mesa: la vista compartida del equipo.
     */
    oficina_mesa: tool({
      description:
        "La mesa de la oficina: quién está trabajando en qué, quién está libre para ayudar, qué cards no tienen owner, " +
        "qué pedidos de ayuda siguen sin responder y qué preguntas están abiertas. " +
        "Usala antes de reclamar trabajo, antes de pedir ayuda (para saber a quién) y cuando te digan que te asignaron una card.",
      args: {
        action: z
          .enum(["view", "read", "respond", "offer", "claim"])
          .default("view")
          .describe("view = foto de la mesa · read = mis mensajes · respond = contestar un pedido · offer = ofrecer ayuda · claim = reclamar una card"),
        agentId: z.string().describe("Tu id de agente."),
        messageId: z.string().optional().describe("Mensaje al que respondés (para respond)."),
        kind: z
          .enum([
            "HELP_ACCEPT",
            "HELP_DECLINE",
            "HELP_PARTIAL",
            "HELP_QUESTION",
            "CLAIM",
            "NOTICE",
          ])
          .optional()
          .describe("Tipo de respuesta (para respond/offer)."),
        cardId: z.string().optional().describe("Card (para respond/claim)."),
        body: z.string().optional().describe("Tu respuesta o anuncio."),
        to: z.array(z.string()).optional().describe("Destinatarios (para offer)."),
      },
      async execute(args, ctx) {
        const off = officeOf(ctx)
        await off.init()

        if (args.action === "view") {
          const snapshot = await snapshotMesa(off)
          return {
            title: `Mesa: ${snapshot.trabajando.length} trabajando · ${snapshot.libres.length} libres`,
            output: renderMesa(snapshot),
            metadata: {
              working: snapshot.trabajando.length,
              free: snapshot.libres.length,
              unowned: snapshot.sinOwner.length,
              helpOpen: snapshot.ayudaAbierta.length,
            },
          }
        }

        if (args.action === "read") {
          const messages = await off.bus.receive(args.agentId, [CHANNELS.peer, CHANNELS.flow, CHANNELS.command, CHANNELS.arch])
          if (messages.length === 0) {
            return { title: "Sin mensajes", output: "No hay mensajes nuevos en tu inbox." }
          }
          return {
            title: `${messages.length} mensajes`,
            output: messages
              .map(
                (m) =>
                  `### [${m.kind}] de ${m.from} — ${m.subject}\n${JSON.stringify(m.body, null, 2)}\n_(id: ${m.id})_`,
              )
              .join("\n\n"),
            metadata: { count: messages.length },
          }
        }

        if (args.action === "respond" || args.action === "offer") {
          if (!args.messageId && args.action === "respond") {
            return { title: "Falta messageId", output: "Indicá el messageId del pedido al que respondés." }
          }
          const msg = await off.bus.send(CHANNELS.peer, {
            from: args.agentId,
            to: args.to ?? [],
            kind: (args.kind ?? "HELP_ACCEPT") as never,
            subject: args.cardId ?? "",
            body: args.body ? safeJson(args.body) : {},
            inReplyTo: args.messageId ?? null,
          })
          await off.bus.ack(args.agentId, args.messageId ?? msg.id)
          return {
            title: `Mensaje publicado: ${msg.kind}`,
            output: `Publicado en el canal peer (seq ${msg.seq}).`,
            metadata: { messageId: msg.id },
          }
        }

        // claim
        if (!args.cardId) {
          return { title: "Falta cardId", output: "Indicá la card que reclamás." }
        }
        const state = await off.loadState()
        const claimed = await off.claimCard(state, args.agentId, args.cardId)
        if (!claimed.ok) {
          return { title: "No se pudo reclamar", output: claimed.reason }
        }
        await off.bus.send(CHANNELS.peer, {
          from: args.agentId,
          to: ["*"],
          kind: "CLAIM",
          subject: args.cardId,
          body: { claimed: args.cardId },
        })
        return {
          title: `Card ${args.cardId} reclamada`,
          output: `Reclamaste \`${args.cardId}\`. Avisado en el canal peer.`,
          metadata: { cardId: args.cardId },
        }
      },
    }),

    /**
     * El grafo de requisitos a evidencia.
     */
    oficina_evidence: tool({
      description:
        "La evidencia de una card: cada criterio de aceptación enlazado a lo que lo respalda. " +
        "Usá `view` para ver qué falta y `add` para registrar evidencia (un artefacto, un test, " +
        "un gate o una inspección). Una card NO se puede cerrar sin evidencia de todos sus " +
        "requisitos obligatorios: los gates dicen que el código está sano, la evidencia dice que " +
        "el objetivo está cumplido.",
      args: {
        action: z.enum(["view", "add"]).default("view").describe("view = grafo · add = registrar evidencia"),
        cardId: z.string().describe("Card."),
        agentId: z.string().describe("Tu id de agente."),
        requirement: z.string().optional().describe("Criterio de aceptación (texto exacto). Si falta, se usa el índice."),
        requirementIndex: z.number().int().min(0).optional().describe("Índice del criterio de aceptación."),
        kind: z
          .enum(["artifact", "test", "gate", "inspection", "external"])
          .default("artifact")
          .describe("Tipo de evidencia."),
        ref: z.string().optional().describe("Ruta del artefacto, nombre del test, id del gate o referencia."),
        note: z.string().optional().describe("Qué demuestra esta evidencia."),
      },
      async execute(args, ctx) {
        const off = officeOf(ctx)
        await off.init()
        const state = await off.loadState()
        const card = state.cards[args.cardId]
        if (!card) return { title: "Card inexistente", output: `No existe la card ${args.cardId}.` }

        if (args.action === "view") {
          const graph = await off.evidence.graph(card)
          const { renderEvidenceGraph } = await import("../core/evidence.js")
          return {
            title: `Evidencia: ${graph.requirements.length} requisitos, ${graph.missingMandatory.length} sin cubrir`,
            output: renderEvidenceGraph(graph),
            metadata: {
              complete: graph.complete,
              missing: graph.missingMandatory.length,
              minLevel: graph.minLevel,
            },
          }
        }

        if (!args.ref) {
          return { title: "Falta ref", output: "Indicá el `ref`: la ruta del artefacto, el test o el gate." }
        }

        const { evidenceFromArtifact, evidenceFromInspection, evidenceFromExternal, evidenceFromTest } =
          await import("../core/evidence.js")

        const requirementText =
          args.requirement ?? card.acceptance[args.requirementIndex ?? 0] ?? ""
        const options = {
          recordedBy: args.agentId,
          requirementIndex: args.requirementIndex ?? card.acceptance.indexOf(requirementText),
          note: args.note,
          owner: card.owner ?? undefined,
          reviewer: card.reviewer ?? undefined,
        }

        const node =
          args.kind === "test"
            ? evidenceFromTest(args.ref, card.id, requirementText, options)
            : args.kind === "inspection"
              ? evidenceFromInspection(args.ref, card.id, requirementText, options)
              : args.kind === "external"
                ? evidenceFromExternal(args.ref, card.id, requirementText, options)
                : evidenceFromArtifact(args.ref, card.id, requirementText, options)

        await off.evidence.add(card.id, node)
        const graph = await off.evidence.graph(card)
        const { renderEvidenceGraph } = await import("../core/evidence.js")
        return {
          title: `Evidencia registrada (${graph.complete ? "card completa" : "faltan requisitos"})`,
          output: renderEvidenceGraph(graph),
          metadata: { complete: graph.complete, missing: graph.missingMandatory.length },
        }
      },
    }),

    /**
     * El costo de la corrida.
     */
    oficina_cost: tool({
      description:
        "El costo real de la corrida: tokens y USD por card, por agente y por fase de trabajo, " +
        "con los presupuestos y cuánto falta para cada límite. También mide trabajo redundante " +
        "(releer el mismo contexto, repetir el mismo comando). Usá `estimate` antes de arrancar " +
        "una corrida grande.",
      args: {
        action: z.enum(["report", "estimate", "redundancy"]).default("report"),
        cards: z.number().int().min(1).max(100).default(10).describe("Para estimate: cards estimadas."),
        agentsPerCard: z.number().int().min(1).max(10).default(2).describe("Para estimate: agentes por card."),
        callsPerAgent: z.number().int().min(1).max(100).default(10).describe("Para estimate: llamadas por agente."),
        usdPerCall: z.number().min(0).default(0.02).describe("Para estimate: USD por llamada."),
      },
      async execute(args, ctx) {
        const { checkBudget, estimateRun, renderCostReport, DEFAULT_COST_LIMITS } = await import(
          "../core/cost.js"
        )
        const state = await officeOf(ctx).loadState()
        const ledger = await officeOf(ctx).cost.load(state.runId)

        if (args.action === "estimate") {
          const est = estimateRun(args.cards, args.agentsPerCard, args.callsPerAgent, args.usdPerCall)
          return {
            title: `Estimación: ~$${est.usd.toFixed(2)}`,
            output:
              `**Estimación previa**\n\n` +
              `- Cards: ${args.cards}\n` +
              `- Agentes por card: ${args.agentsPerCard}\n` +
              `- Llamadas por agente: ${args.callsPerAgent}\n` +
              `- USD por llamada: $${args.usdPerCall}\n\n` +
              `**Costo estimado: ~$${est.usd.toFixed(2)}** · ~${est.tokens.toLocaleString("es-AR")} tokens\n\n` +
              `_${est.note}_`,
            metadata: { usd: est.usd, tokens: est.tokens },
          }
        }

        if (args.action === "redundancy") {
          const { detectRedundantWork } = await import("../core/cost.js")
          const report = detectRedundantWork([])
          return {
            title: "Trabajo redundante",
            output: report.summary,
            metadata: { wasted: report.wastedFraction },
          }
        }

        const decision = checkBudget(ledger, DEFAULT_COST_LIMITS)
        return {
          title: `Costo: $${ledger.total.usd.toFixed(4)} · ${ledger.total.calls} llamadas`,
          output:
            renderCostReport(ledger, DEFAULT_COST_LIMITS) +
            `\n\n**Veredicto de presupuesto:** ${decision.allowed ? "dentro de los límites" : `EXCEDIDO (${decision.breached})`}\n` +
            `${decision.reason}`,
          metadata: { usd: ledger.total.usd, allowed: decision.allowed, breached: decision.breached },
        }
      },
    }),

    /**
     * El freno de emergencia.
     */
    oficina_stop: tool({
      description:
        "Frena la corrida. Con `halt` la oficina deja de avanzar: no se reanuda sola, no se " +
        "despacha y no se gastan mas tokens. Con `resume` vuelve. Usalo si la corrida se esta " +
        "descontrolando, si el costo se dispara o si querés revisar antes de seguir.",
      args: {
        action: z.enum(["halt", "resume"]).default("halt"),
        reason: z.string().optional().describe("Por que frenas (para halt)."),
        agentId: z.string().optional().describe("Quien frena."),
      },
      async execute(args, ctx) {
        const off = officeOf(ctx)
        await off.init()
        const state = await off.loadState()

        if (args.action === "resume") {
          await off.resume(state)
          return {
            title: "Corrida reanudada",
            output: "La corrida vuelve a avanzar. El freno de emergencia quedó desactivado.",
            metadata: { halted: false },
          }
        }

        const reason = args.reason ?? "freno manual"
        await off.halt(state, reason, args.agentId ?? "usuario")
        return {
          title: "Corrida detenida",
          output:
            `**La oficina está detenida.**\n\nMotivo: ${reason}\n\n` +
            `No se van a despachar agentes ni a reanudar sesiones. ` +
            `Cuando quieras seguir: \`oficina_stop\` con action="resume".`,
          metadata: { halted: true, reason },
        }
      },
    }),
  }
}

function safeJson(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text)
    return typeof parsed === "object" && parsed !== null ? parsed : { text }
  } catch {
    return { text }
  }
}
