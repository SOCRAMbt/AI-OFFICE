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
 * - **Hook `experimental.chat.system.transform`**: el estado de la oficina
 *   viaja con cada llamada. El agente no repregunta lo que ya sabe.
 * - **Hook `experimental.session.compacting`**: el estado sobrevive a la
 *   compactación.
 *
 * Lo que NO hace: decidir el plan, escribir código ni emitir el veredicto de
 * review. Eso sigue siendo del modelo. El código pone los límites; el modelo
 * hace el trabajo.
 */

import type { Plugin, PluginInput } from "@opencode-ai/plugin"
import { Office } from "./core/office.js"
import { buildTools } from "./tools/index.js"
import { createSessionIdleHook } from "./hooks/sessionIdle.js"
import { createScopeGuardHook } from "./hooks/scopeGuard.js"
import { createSystemTransformHook } from "./hooks/systemTransform.js"
import { createCompactingHook } from "./hooks/compacting.js"
import { logger } from "./core/log.js"

const log = logger("oficina")

export interface OficinaOptions {
  /** Directorio del proyecto. Si se omite, se usa el del host. */
  directory?: string
  /** Raíz del repo agency-agents para el catálogo de roles. */
  agencyRoot?: string
  /** Tope de auto-reanudaciones por sesión. */
  maxAutoResumes?: number
  /** Si es false, el guard de scope avisa pero no bloquea. */
  enforceScope?: boolean
}

export const OficinaPlugin: Plugin = async (input: PluginInput, options?: OficinaOptions) => {
  const directory = options?.directory ?? input.directory ?? input.worktree
  const office = new Office({
    cwd: directory,
    agencyRoot: options?.agencyRoot,
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

  const tools = buildTools(office)

  const onSessionIdle = createSessionIdleHook(office, {
    maxAutoResumes: options?.maxAutoResumes ?? 25,
    sendPrompt: async (sessionID, text) => {
      await input.client.session.promptAsync({
        path: { id: sessionID },
        body: { parts: [{ type: "text", text }] },
      })
    },
  })

  const onScopeGuard = createScopeGuardHook(office, { enforce: options?.enforceScope ?? true })
  const onSystemTransform = createSystemTransformHook(office)
  const onCompacting = createCompactingHook(office)

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
    },

    "experimental.chat.system.transform": async (hookInput, hookOutput) => {
      await onSystemTransform(hookInput, hookOutput)
    },

    "experimental.session.compacting": async (hookInput, hookOutput) => {
      await onCompacting(hookInput, hookOutput)
    },
  }
}

export default OficinaPlugin
export { Office } from "./core/office.js"
export { Bus } from "./core/bus.js"
export * from "./core/types.js"
