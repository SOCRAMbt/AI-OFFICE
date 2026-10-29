/**
 * OFICINA — entry point del plugin para OpenCode.
 *
 * Qué registra:
 * - **Tools** (`oficina_*`): la superficie de trabajo.
 * - **Hook `event` → session.idle**: auto-reanudación. La oficina sigue
 *   trabajando cuando el modelo para. Esto es lo que hace que "trabajen
 *   incansablemente" sea una propiedad del sistema y no un pedido.
 * - **Hook `tool.execute.before`**: guard de scope. "No toques fuera de tu
 *   scope" pasa de ser una instrucción a ser una restricción.
 * - **Hook `tool.execute.after`**: tripwire. Detecta lo que el guard no
 *   pudo ver: escrituras que se colaron por un comando de shell.
 * - **Hook `permission.ask`**: segunda capa de enforcement, a nivel del
 *   framework. Cuando OpenCode pide permiso para una escritura, la oficina
 *   lo deniega si está fuera del scope.
 * - **Hook `event` → message.updated**: contabilidad de costo. El motor ya
 *   sabe cuánto costó cada llamada; la oficina lo anota y lo presupuesta.
 * - **Hook `experimental.chat.system.transform`**: el estado de la oficina
 *   viaja con cada llamada. El agente no repregunta lo que ya sabe.
 * - **Hook `experimental.session.compacting`**: el estado sobrevive a la
 *   compactación.
 * - **Hook `experimental.compaction.autocontinue`**: el freno de emergencia.
 *
 * Lo que NO hace: decidir el plan, escribir código ni emitir el veredicto de
 * review. Eso sigue siendo del modelo. El código pone los límites; el modelo
 * hace el trabajo.
 */

import type { Plugin, PluginInput } from "@opencode-ai/plugin"
import { tool as v1Tool, type ToolDefinition } from "@opencode-ai/plugin"
import { Office } from "./core/office.js"
import { buildTools, type OficinaTool } from "./tools/index.js"
import { createSessionIdleHook } from "./hooks/sessionIdle.js"
import { createScopeGuardHook, resolveScopeCard } from "./hooks/scopeGuard.js"
import { createSystemTransformHook } from "./hooks/systemTransform.js"
import { createCompactingHook } from "./hooks/compacting.js"
import { Tripwire } from "./core/tripwire.js"
import { checkScope } from "./core/sandbox.js"
import { logger } from "./core/log.js"

const log = logger("oficina")

/**
 * Traduce las tools del motor (forma neutra) a la forma de OpenCode v1.
 *
 * El motor no conoce la API de ningun host: define `{ description, args,
 * execute }` y cada entry la traduce. Acá va la traduccion a v1, que usa el
 * helper `tool()` del plugin.
 */
function toV1Tools(defs: Record<string, OficinaTool>): Record<string, ToolDefinition> {
  const out: Record<string, ToolDefinition> = {}
  for (const [name, def] of Object.entries(defs)) {
    out[name] = v1Tool({
      description: def.description,
      args: def.args as never,
      execute: def.execute as never,
    }) as ToolDefinition
  }
  return out
}

export interface OficinaOptions {
  /** Directorio del proyecto. Si se omite, se usa el del host. */
  directory?: string
  /** Raíz del repo agency-agents para el catálogo de roles. */
  agencyRoot?: string
  /** Tope de auto-reanudaciones por sesión. */
  maxAutoResumes?: number
  /** Si es false, el guard de scope avisa pero no bloquea. */
  enforceScope?: boolean
  /** Tope de archivos que mira el tripwire por comando. */
  tripwireMaxFiles?: number
}

export const OficinaPlugin: Plugin = async (input: PluginInput, options?: OficinaOptions) => {
  const directory = options?.directory ?? input.directory ?? input.worktree
  const office = new Office({
    cwd: directory,
    agencyRoot: options?.agencyRoot,
    // El cliente del SDK permite arrancar subagentes de verdad.
    client: input.client
      ? {
          session: {
            prompt: (args) => input.client.session.prompt(args as never) as never,
          },
        }
      : undefined,
  })
  await office.init()

  // Conecta el log del plugin al log estructurado del host, si hay cliente.
  if (input.client?.app?.log) {
    const { configureLogging } = await import("./core/log.js")
    configureLogging({
      sink: (entry) => {
        void input.client.app.log({
          body: {
            service: `oficina/${entry.service}`,
            level: entry.level,
            message: entry.message,
            extra: entry.extra ?? {},
          },
        })
      },
    })
  }

  const tools = toV1Tools(buildTools(office))

  /* ──────────────────────────────────────────────────────────────────────────
   * Resolucion del padre de una sesion
   *
   * Es lo que hace que los subagentes hereden el scope: el hijo sube por
   * la cadena de sesiones hasta encontrar la que tiene la card.
   * ────────────────────────────────────────────────────────────────────────── */
  const sessionParents = new Map<string, string | undefined>()

  const resolveParentSession = async (sessionID: string): Promise<string | undefined> => {
    if (!input.client?.session?.get) return undefined
    if (sessionParents.has(sessionID)) return sessionParents.get(sessionID)
    try {
      const session = await input.client.session.get({ path: { id: sessionID } })
      const parent = (session as { parentID?: string } | undefined)?.parentID
      sessionParents.set(sessionID, parent)
      return parent
    } catch {
      sessionParents.set(sessionID, undefined)
      return undefined
    }
  }

  const onSessionIdle = createSessionIdleHook(office, {
    maxAutoResumes: options?.maxAutoResumes ?? 25,
    sendPrompt: async (sessionID, text) => {
      await input.client.session.promptAsync({
        path: { id: sessionID },
        body: { parts: [{ type: "text", text }] },
      })
    },
  })

  const guardOptions = {
    enforce: options?.enforceScope ?? true,
    resolveParentSession,
  }

  const onScopeGuard = createScopeGuardHook(office, guardOptions)
  const onSystemTransform = createSystemTransformHook(office)
  const onCompacting = createCompactingHook(office)

  const tripwire = new Tripwire(office.paths.projectRoot, {
    maxFiles: options?.tripwireMaxFiles ?? 4000,
  })

  /** El scope que aplica a una sesión, si tiene. */
  const scopeOf = async (sessionID: string) => {
    try {
      const state = await office.loadState()
      const result = await resolveScopeCard(state, sessionID, guardOptions)
      if (result.kind === "VERIFICATION_FAILED") {
        log.error("verificacion de scope fallida", { sessionID, reason: result.reason })
        if (guardOptions.enforce) {
          throw new Error(`[OFICINA] Scope verification failed: ${result.reason}. Operation blocked (fail-closed).`)
        }
        return undefined
      }
      if (result.kind !== "AUTHORIZED") {
        return undefined
      }
      const card = result.card
      return { card, policy: { mayTouch: card.scope.mayTouch, forbidden: card.scope.forbidden } }
    } catch (err) {
      log.debug("no se pudo resolver el scope de la sesion", { sessionID, error: String(err) })
      if (guardOptions.enforce) {
        throw new Error(`[OFICINA] Scope verification failed: ${String(err)}. Operation blocked (fail-closed).`)
      }
      return undefined
    }
  }

  log.info("plugin inicializado", {
    directory,
    officeDir: office.paths.officeDir,
    projectRoot: office.paths.projectRoot,
  })

  return {
    tool: tools,

    event: async ({ event }) => {
      if (event.type === "session.idle") {
        await onSessionIdle({ event })
        return
      }

      // ── Contabilidad de costo ──
      //
      // El motor ya sabe cuanto costo cada llamada (`AssistantMessage.cost`)
      // y cuantos tokens consumio. La oficina lo anota, lo desglosa por
      // card, agente y fase, y lo presupuesta. No estimamos nada: el
      // numero real es el que llega.
      if (event.type === "message.updated") {
        const info = event.properties?.info as
          | {
              role?: string
              sessionID?: string
              cost?: number
              tokens?: {
                input: number
                output: number
                reasoning: number
                cache?: { read: number; write: number }
              }
              modelID?: string
              providerID?: string
              time?: { created?: number; completed?: number }
            }
          | undefined
        if (info?.role === "assistant" && info.cost !== undefined) {
          try {
            const state = await office.loadState()
            const binding = info.sessionID ? state.sessions[info.sessionID] : undefined
            const cardId = binding?.cardId ?? null
            await office.recordUsage({
              agentId: binding?.agentId ?? info.sessionID ?? "desconocido",
              role: binding?.agentId ?? "agente",
              cardId,
              phase: cardId ? "implementation" : "exploration",
              model: info.modelID ?? "desconocido",
              provider: info.providerID ?? "desconocido",
              cost: info.cost,
              tokens: info.tokens ?? { input: 0, output: 0, reasoning: 0 },
              latencyMs: (info.time?.completed ?? 0) - (info.time?.created ?? 0),
            })
          } catch (err) {
            log.debug("no se pudo registrar el uso", { error: String(err) })
          }
        }
      }
    },

    "tool.execute.before": async (hookInput, hookOutput) => {
      await onScopeGuard(
        {
          tool: hookInput.tool,
          sessionID: hookInput.sessionID,
          callID: hookInput.callID,
        },
        hookOutput,
      )

      // El tripwire se arma antes de cualquier comando: una foto del arbol.
      // Despues se compara, y lo que cambio fuera del scope se reporta.
      const scope = await scopeOf(hookInput.sessionID)
      if (scope) {
        await tripwire.arm(hookInput.callID, scope.policy.mayTouch)
      }
    },

    "tool.execute.after": async (hookInput) => {
      const scope = await scopeOf(hookInput.sessionID)
      if (!scope) return
      const { changes: cambios, incomplete, errors, armFailed } = await tripwire.check(hookInput.callID, scope.policy.mayTouch)
      if (cambios.length === 0 && !incomplete && errors.length === 0 && !armFailed) return

      const detalle = cambios.map((c) => `  - ${c.kind}: ${c.path}`).join("\n")
      log.warn("escrituras fuera del scope detectadas", {
        card: scope.card.id,
        tool: hookInput.tool,
        cambios: cambios.length,
        incomplete,
        errors: errors.length,
        armFailed,
      })
      log.warn(`\n${detalle}`)

      // Se le avisa al agente por el bus: puede que no haya sido
      // deliberado, y el tripwire no revierte.
      await office.bus
        .send("peer", {
          from: "oficina",
          to: ["*"],
          kind: "NOTICE",
          subject: scope.card.id,
          body: {
            notice: "scope",
            message:
              `Se detectaron ${cambios.length} cambio(s) fuera del scope de la card ${scope.card.id} ` +
              `durante \`${hookInput.tool}\`:\n${detalle}\n\n` +
              `${incomplete ? "⚠️ Inspección incompleta (límite de archivos alcanzado). " : ""}` +
              `${errors.length > 0 ? `⚠️ ${errors.length} error(es) durante la inspección. ` : ""}` +
              `${armFailed ? "⚠️ No se pudo tomar la instantánea inicial (arm falló). " : ""}` +
              `Si fue deliberado, avisalo por el bus. Si no, revisé lo que tocaste.`,
          },
        })
        .catch(() => {})
    },

    /**
     * Segunda capa de enforcement, a nivel del framework.
     *
     * Cuando OpenCode pide permiso para algo, la oficina decide. Si la
     * sesion tiene una card con scope, y lo que se pide escribir esta fuera
     * de el, se deniega.
     *
     * Esto cubre el caso que el guard propio no cubre: tools de providers
     * que el motor decideroxitos o con permisos declarados en el agente.
     */
    "permission.ask": async (permission, output) => {
      try {
        const type = String(permission.type ?? "")
        if (!["edit", "write", "patch", "multiedit"].includes(type)) {
          output.status = "allow"
          return
        }
        const patterns = permission.pattern
        const lista = Array.isArray(patterns) ? patterns : patterns ? [patterns] : []
        if (lista.length === 0) {
          output.status = "allow"
          return
        }

        const scope = await scopeOf(permission.sessionID)
        if (!scope) {
          output.status = "allow"
          return
        }

        for (const patron of lista) {
          const veredicto = await checkScope(office.paths.projectRoot, patron, scope.policy)
          if (!veredicto.allowed) {
            log.warn("permiso denegado por scope", { card: scope.card.id, patron, kind: veredicto.kind })
            output.status = "deny"
            return
          }
        }
        output.status = "allow"
      } catch (err) {
        // Ante la duda, se permite: este hook es una capa extra, no la
        // unica. Si el guard propio falla, es un bug de la oficina, no una
        // violacion del usuario.
        log.debug("fallo en permission.ask", { error: String(err) })
        output.status = "allow"
      }
    },

    "experimental.chat.system.transform": async (hookInput, hookOutput) => {
      await onSystemTransform(hookInput, hookOutput)
    },

    "experimental.session.compacting": async (hookInput, hookOutput) => {
      await onCompacting(hookInput, hookOutput)
    },

    /**
     * Freno de emergencia.
     *
     * La auto-continuacion post-compactacion es la via por la que una
     * corrida puede seguir gastando sola. Con el freno puesto, se
     * desactiva.
     */
    "experimental.compaction.autocontinue": async (_hookInput, output) => {
      try {
        const state = await office.loadState()
        if (state.halt) {
          output.enabled = false
          log.info("auto-continuacion desactivada: la corrida esta detenida", {
            reason: state.halt.reason,
          })
        }
      } catch {
        // Sin estado no se puede saber: se deja como estaba.
      }
    },
  }
}

export default OficinaPlugin
export { Office } from "./core/office.js"
export { Bus } from "./core/bus.js"
export * from "./core/types.js"
