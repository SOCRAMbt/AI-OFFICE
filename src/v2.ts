/**
 * OFICINA — entry point del plugin para **OpenCode v2**.
 *
 * ## Por qué existe este archivo
 *
 * OpenCode v1 y v2 tienen APIs de plugins **incomunes**: no es que
 * cambiara una firma, es que cambió la forma. v1 exportaba una funcion que
 * devuelve hooks; v2 exige `export default { id, setup(ctx) }`. Un plugin
 * v1 bajo v2 falla con:
 *
 *     PluginModule.LoadError: Plugin must export a default definition with
 *     an id and an effect or setup function.
 *
 * Y al reves: un plugin v2 bajo v1 no carga.
 *
 * Este archivo es la implementacion **v2**. La de v1 vive en `v1.ts` y el
 * motor (`core/`, `tools/`) no depende de ninguna de las dos APIs: define
 * las tools en una forma neutra y cada entry la traduce.
 *
 * ## Que registra
 *
 * - **Tools** (`oficina_*`): la superficie de trabajo, via `ctx.tool.transform`.
 * - **Guard de scope** (`ctx.tool.hook` + `ctx.permission.hook`): dos capas.
 *   La primera intercepta la tool; la segunda es el punto de enforcement del
 *   framework y puede `deny` de verdad.
 * - **Tripwire** (`ctx.tool.hook("execute.after")`): detecta escrituras que se
 *   colaron por un comando de shell.
 * - **Estado de la oficina** (`ctx.session.hook("context")`): el agente no
 *   repregunta lo que ya sabe.
 * - **Auto-continuacion** (`session.idle`): la corrida sigue sola cuando el
 *   modelo para.
 * - **Costo** (`session.usage.recorded`): el numero real que reporta el motor.
 */

import path from "node:path"
import { Plugin } from "@opencode/plugin"
import { z } from "zod"
import { OfficeFactory } from "./core/officeFactory.js"
import { buildTools, type OficinaTool } from "./tools/index.js"
import { analyzeShellCommand, checkScope, type ScopePolicy } from "./core/sandbox.js"
import {
  extractCommand,
  extractPaths,
  resolveScopeCard,
  FILE_WRITE_TOOLS,
  SHELL_TOOLS,
} from "./hooks/scopeGuard.js"
import { Tripwire } from "./core/tripwire.js"
import { logger } from "./core/log.js"

const log = logger("oficina:v2")

/** Acciones de permiso que implican escribir un archivo. */
const WRITE_ACTIONS = new Set(["edit", "write", "patch", "multiedit", "apply_patch"])

export interface V2Options {
  /** Si es false, el guard de scope avisa pero no bloquea. */
  enforceScope?: boolean
  /** Tope de auto-reanudaciones por sesión. */
  maxAutoResumes?: number
  /** Tope de archivos que mira el tripwire por comando. */
  tripwireMaxFiles?: number
  /** Dashboard visual. `{ enabled: false }` para desactivarlo. */
  dashboard?: { enabled?: boolean; port?: number }
}

/**
 * Convierte un schema zod a JSON Schema.
 *
 * v2 exige JSON Schema plano en `tool.input`. zod v4 lo hace nativo.
 */
function toJsonSchema(schema: unknown): Record<string, unknown> {
  if (!schema) return { type: "object", additionalProperties: true }
  try {
    const converted = z.toJSONSchema(schema as never, {
      io: "input",
      unrepresentable: "any",
    }) as Record<string, unknown>
    // Si el schema no es de un objeto, se acepta igual pero se documenta.
    if (converted["type"] !== "object") {
      return { type: "object", additionalProperties: true, description: converted["description"] }
    }
    return { ...converted, additionalProperties: false }
  } catch {
    return { type: "object", additionalProperties: true }
  }
}

export default Plugin.define({
  id: "oficina",

  async setup(ctx) {
    const options = (ctx.options ?? {}) as V2Options
    const enforce = options.enforceScope !== false
    // El root de la oficina es el directorio de la SESIÓN, no el cwd del
    // proceso de OpenCode. Si el server arrancó desde otro proyecto, el cwd
    // miente: la oficina se rootaba en el proyecto equivocado (ej.
    // cedears-tracker-pro) y los agentes iban a escribir ahí.
    // ctx.location.directory es el directorio real de la sesión;
    // process.cwd() es solo el último recurso.
    const cwd = ctx.location?.directory ?? process.cwd()

    const spawner = async ({ sessionID, agentName, prompt, description }: {
      sessionID: string
      agentName: string
      prompt: string
      description: string
      agentId?: string
      cardId?: string | null
    }) => {
      try {
        const child = (await ctx.session.create({
          parentID: sessionID,
          title: description || `Oficina: ${agentName}`,
          // El agente materializado puede no estar registrado todavia
          // (OpenCode arma su lista al arrancar), asi que se dispara con
          // `general` y la especialidad viaja completa en el prompt.
          agent: "general",
        })) as { id: string }
        await ctx.session.prompt({
          sessionID: child.id,
          text: prompt,
          metadata: { oficina: { agent: agentName, description } },
        })
        return child.id
      } catch (err) {
        log.warn("no se pudo arrancar el subagente", { agent: agentName, error: String(err) })
        return false
      }
    }

    const factory = new OfficeFactory({ spawner })
    const office = factory.getPrimary(cwd)
    await office.init()

    /* Caché de directorio por sesión: cada ventana/proyecto usa SU oficina. */
    const sessionDirCache = new Map<string, string>()
    const resolveSessionDir = async (sessionID: string): Promise<string> => {
      const cached = sessionDirCache.get(sessionID)
      if (cached) return cached
      try {
        const session = (await ctx.session.get({ sessionID })) as
          | { location?: { directory?: string } }
          | undefined
        const dir = session?.location?.directory
        if (typeof dir === "string" && dir.trim().length > 0) {
          sessionDirCache.set(sessionID, dir.trim())
          return dir.trim()
        }
      } catch (err) {
        log.debug("no se pudo resolver el directorio de la sesión", {
          sessionID,
          error: String(err),
        })
      }
      sessionDirCache.set(sessionID, cwd)
      return cwd
    }

    /* ────────────────────────────────────────────────────────────────────────
     * 0. DASHBOARD VISUAL
     *
     * El servidor arranca en background (detached) apenas el plugin carga,
     * así que cuando la corrida empieza ya está conectado a `.oficina/`.
     * El navegador se abre cuando hay una corrida activa: al guardar el plan
     * (`oficina_plan`) o al reanudar una corrida `running`.
     * ──────────────────────────────────────────────────────────────────────── */
    const dashboardEnabled =
      (options as V2Options).dashboard?.enabled !== false &&
      // En tests y CI el auto-start spawnearía un proceso detached que
      // bloquea los temp dirs del suite (EBUSY en el cleanup).
      !process.env.VITEST &&
      !process.env.CI
    const dashboard = await import("./core/dashboard.js")
    const ensureDashboard = async (projectRoot: string) => {
      try {
        const info = await dashboard.startDashboard(projectRoot, path.join(projectRoot, ".oficina"))
        if (info) log.info("dashboard listo", { projectRoot, url: info.url })
        return info
      } catch (err) {
        log.debug("dashboard best-effort", { projectRoot, error: String(err) })
        return undefined
      }
    }
    if (dashboardEnabled) {
      void (async () => {
        const info = await ensureDashboard(cwd)
        if (!info) return
        // ¿Hay una corrida activa que reanudar? Abrir el navegador ya.
        const state = await office.loadState().catch(() => undefined)
        if (state?.status === "running") dashboard.openBrowser(info.url)
      })()
    }

    const tripwires = new Map<string, Tripwire>()
    const getTripwire = (dir: string): Tripwire => {
      const key = path.resolve(dir)
      let tw = tripwires.get(key)
      if (!tw) {
        tw = new Tripwire(key, { maxFiles: options.tripwireMaxFiles ?? 4000 })
        tripwires.set(key, tw)
      }
      return tw
    }

    /**
     * El padre de una sesion, con cache.
     *
     * Es lo que hace que un subagente **herede el scope** de quien lo
     * lanzo: la sesion hija cuelga de la padre, y el guard sube por la
     * cadena hasta encontrar la sesion que tiene la card.
     *
     * Sin esto, delegar seria un escalon para salirse del scope: el
     * subagente no tendria card y el guard lo dejaria pasar todo.
     */
    const parentCache = new Map<string, string>()

    const resolveParentSession = async (sessionID: string): Promise<string | undefined> => {
      if (parentCache.has(sessionID)) return parentCache.get(sessionID)
      try {
        const session = (await ctx.session.get({ sessionID })) as { parentID?: string } | undefined
        const parent = session?.parentID
        if (typeof parent === "string" && parent.length > 0) {
          parentCache.set(sessionID, parent)
          return parent
        }
        return undefined
      } catch (err) {
        log.debug("no se pudo resolver el padre de la sesion", { sessionID, error: String(err) })
        return undefined
      }
    }

    /** El scope que aplica a una sesion, si tiene (root-aware). */
    const scopeOf = async (sessionID: string) => {
      const sidDir = await resolveSessionDir(sessionID)
      const off = factory.get(sidDir)
      try {
        const state = await off.loadState().catch(() => undefined)
        if (!state) return undefined
        const result = await resolveScopeCard(state, sessionID, { enforce, resolveParentSession })
        if (result.kind === "VERIFICATION_FAILED") {
          log.error("verificacion de scope fallida", { sessionID, reason: result.reason })
          if (enforce) {
            throw new Error(`[OFICINA] Scope verification failed: ${result.reason}. Operation blocked (fail-closed).`)
          }
          return undefined
        }
        if (result.kind !== "AUTHORIZED") {
          return undefined
        }
        const card = result.card
        const policy: ScopePolicy = {
          mayTouch: card.scope.mayTouch,
          forbidden: card.scope.forbidden,
        }
        return { card, policy, projectRoot: off.paths.projectRoot }
      } catch (err) {
        log.debug("no se pudo resolver el scope de la sesion", { sessionID, error: String(err) })
        if (enforce) {
          throw new Error(`[OFICINA] Scope verification failed: ${String(err)}. Operation blocked (fail-closed).`)
        }
        return undefined
      }
    }

    /** Tripwire per-root para la oficina de este sessionID */
    const tripwireFor = async (sessionID: string): Promise<Tripwire> =>
      getTripwire(await resolveSessionDir(sessionID))

    /* ────────────────────────────────────────────────────────────────────────
     * 1. TOOLS
     * ──────────────────────────────────────────────────────────────────────── */

    const defs = buildTools(office, {
      onRunStart: async (runId, off) => {
        if (!dashboardEnabled) return undefined
        try {
          const info = await ensureDashboard(off.paths.projectRoot)
          if (info) {
            dashboard.openBrowser(info.url)
            log.info("dashboard abierto", { runId, url: info.url })
            return info.url
          }
          log.warn("dashboard no disponible", { runId })
        } catch (err) {
          log.debug("dashboard: arranque best-effort", { runId, error: String(err) })
        }
        return undefined
      },
      getOffice: (dir: string) => factory.get(dir),
    })
    await ctx.tool.transform((editor) => {
      for (const [name, def] of Object.entries(defs)) {
        editor.add({
          name,
          description: def.description,
          input: toJsonSchema(def.args),
          execute: async (input: unknown, toolCtx: { sessionID: string; agent: string; messageID: string }) => {
            const parsed = def.args ? def.args.parse(input ?? {}) : (input ?? {})
            const sessionDir = await resolveSessionDir(toolCtx.sessionID)
            const result = await def.execute(parsed as Record<string, unknown>, {
              directory: sessionDir,
              sessionID: toolCtx.sessionID,
              agent: toolCtx.agent,
              messageID: toolCtx.messageID,
            })
            // dashboard per-root: plan y dispatch la disparan; el resto de tools no.
            if (dashboardEnabled && (name === "oficina_plan" || name === "oficina_dispatch")) {
              void ensureDashboard(sessionDir).catch(() => undefined)
            }
            return {
              content: result.output,
              metadata: result.metadata,
            }
          },
        } as never)
      }
    })

    /* ────────────────────────────────────────────────────────────────────────
     * 2. GUARD DE SCOPE
     *
     * Dos capas, porque cada una cubre lo que la otra no:
     *
     * - `tool.hook("execute.before")`: ve el path exacto de cada tool que
     *   escribe, incluso los que no pasan por el sistema de permisos.
     * - `permission.hook("evaluate")`: es el punto de enforcement del
     *   framework y puede `deny` de verdad, con motivo.
     * ──────────────────────────────────────────────────────────────────────── */

    /** Verifica un path contra el scope. Devuelve el motivo si viola. */
    const violation = async (
      sessionID: string,
      rawPath: string,
    ): Promise<{ reason: string; kind: string } | undefined> => {
      const scope = await scopeOf(sessionID)
      if (!scope) return undefined
      const verdict = await checkScope(scope.projectRoot, rawPath, scope.policy)
      if (verdict.allowed) return undefined
      return { reason: verdict.reason, kind: verdict.kind }
    }

    await ctx.tool.hook("execute.before", async (event) => {
      const tool = String(event.tool)
      const input = (event.input ?? {}) as Record<string, unknown>

      // Lecturas: nunca se tocan.
      if (!FILE_WRITE_TOOLS.has(tool) && !SHELL_TOOLS.has(tool)) {
        // Igual se arma el tripwire: una tool de lectura puede escribir
        // (un `grep` con redireccion, por ejemplo) y no hay que confiar en
        // el nombre de la tool.
        const scopeLectura = await scopeOf(event.sessionID)
        if (scopeLectura) await (await tripwireFor(event.sessionID)).arm(String(event.id), scopeLectura.policy.mayTouch)
        return
      }

      const scope = await scopeOf(event.sessionID)
      if (!scope) return

      if (FILE_WRITE_TOOLS.has(tool)) {
        for (const rawPath of extractPaths(tool, input)) {
          const bad = await violation(event.sessionID, rawPath)
          if (!bad) continue
          const mensaje = `[OFICINA] Scope violado: ${bad.reason} (card ${scope.card.id})`
          log.warn("scope violado (archivo)", { card: scope.card.id, path: rawPath, kind: bad.kind })
          if (enforce) throw new Error(mensaje)
        }
        // El tripwire se arma una sola vez, con el mismo hook: registrar
        // `execute.before` dos veces hacia que la segunda pise a la primera
        // (y el guard dejaba de bloquear).
        await (await tripwireFor(event.sessionID)).arm(String(event.id), scope.policy.mayTouch)
        return
      }

      if (SHELL_TOOLS.has(tool)) {
        const command = extractCommand(input)
        if (!command) return
        for (const candidate of analyzeShellCommand(command)) {
          if (candidate.uncertain) {
            // Hay una escritura que no sabemos interpretar. No se bloquea
            // (seria inservible), pero el tripwire va a mirar.
            log.warn("shell con escritura no interpretable", {
              card: scope.card.id,
              op: candidate.op,
            })
            continue
          }
          const bad = await violation(event.sessionID, candidate.target)
          if (!bad) continue
          const mensaje = `[OFICINA] Scope violado: ${bad.reason} (card ${scope.card.id})`
          log.warn("scope violado (shell)", {
            card: scope.card.id,
            target: candidate.target,
            kind: bad.kind,
          })
          if (enforce) throw new Error(mensaje)
        }
        await (await tripwireFor(event.sessionID)).arm(String(event.id), scope.policy.mayTouch)
      }
    })

    await ctx.permission.hook("evaluate", async (event) => {
      if (!WRITE_ACTIONS.has(String(event.action))) return

      const scope = await scopeOf(event.sessionID)
      if (!scope) return

      for (const resource of event.resources) {
        const bad = await violation(event.sessionID, resource)
        if (!bad) continue
        event.effect = "deny"
        event.message = `[OFICINA] Scope violado: ${bad.reason} (card ${scope.card.id})`
        log.warn("permiso denegado por scope", {
          card: scope.card.id,
          resource,
          kind: bad.kind,
        })
        return
      }
    })

    /* ────────────────────────────────────────────────────────────────────────
     * 3. TRIPWIRE
     *
     * Fotografia el arbol antes de una tool y compara despues. Lo que cambio
     * fuera del scope se reporta por el bus: detecta, no revierte.
     * ──────────────────────────────────────────────────────────────────────── */

    await ctx.tool.hook("execute.after", async (event) => {
      const scope = await scopeOf(event.sessionID)
      if (!scope) return
      const { changes: cambios, incomplete, errors, armFailed } = await (await tripwireFor(event.sessionID)).check(String(event.id), scope.policy.mayTouch)
      if (cambios.length === 0 && !incomplete && errors.length === 0 && !armFailed) return

      const detalle = cambios.map((c) => `  - ${c.kind}: ${c.path}`).join("\n")
      log.warn("escrituras fuera del scope detectadas", {
        card: scope.card.id,
        tool: event.tool,
        cambios: cambios.length,
        incomplete,
        errors: errors.length,
        armFailed,
      })

      const sidDir = await resolveSessionDir(event.sessionID)
      const offScope = factory.get(sidDir)
      await offScope.bus
        .send("peer", {
          from: "oficina",
          to: ["*"],
          kind: "NOTICE",
          subject: scope.card.id,
          body: {
            notice: "scope",
            message:
              `Se detectaron ${cambios.length} cambio(s) fuera del scope de la card ${scope.card.id} ` +
              `durante \`${event.tool}\`:\n${detalle}\n\n` +
              `${incomplete ? "⚠️ Inspección incompleta (límite de archivos alcanzado). " : ""}` +
              `${errors.length > 0 ? `⚠️ ${errors.length} error(es) durante la inspección. ` : ""}` +
              `${armFailed ? "⚠️ No se pudo tomar la instantánea inicial (arm falló). " : ""}` +
              `Si fue deliberado, avisalo por el bus. Si no, revisé lo que tocaste.`,
          },
        })
        .catch(() => undefined)
    })

    /* ────────────────────────────────────────────────────────────────────────
     * 4. EL ESTADO DE LA OFICINA VIAJA CON CADA LLAMADA
     * ──────────────────────────────────────────────────────────────────────── */

    await ctx.session.hook("context", async (event) => {
      try {
        const { buildSystemPrompt } = await import("./core/systemPrompt.js")
        const sid = (event as { sessionID?: string }).sessionID
        const off = typeof sid === "string" && sid.length > 0 ? factory.get(await resolveSessionDir(sid)) : office
        const state = await off.loadState().catch(() => undefined)
        if (!state) return
        event.system.push({ type: "text", text: await buildSystemPrompt(off, state) })
      } catch (err) {
        log.debug("no se pudo inyectar el estado", { error: String(err) })
      }
    })

    /* ────────────────────────────────────────────────────────────────────────
     * 5. COMPACTACION
     *
     * El estado sobrevive a la compactacion: se lee del disco, no de la
     * memoria de la conversacion.
     * ──────────────────────────────────────────────────────────────────────── */

    await ctx.session.hook("compaction", async (event) => {
      try {
        const { buildSystemPrompt } = await import("./core/systemPrompt.js")
        const sid = (event as { sessionID?: string }).sessionID
        const off = typeof sid === "string" && sid.length > 0 ? factory.get(await resolveSessionDir(sid)) : office
        const state = await off.loadState().catch(() => undefined)
        if (!state) return
        event.system.push({ type: "text", text: await buildSystemPrompt(off, state) })
      } catch (err) {
        log.debug("no se pudo inyectar el estado al compactar", { error: String(err) })
      }
    })

    /* ────────────────────────────────────────────────────────────────────────
     * 6. EVENTOS: auto-continuacion y costo
     * ──────────────────────────────────────────────────────────────────────── */

    const maxAutoResumes = options.maxAutoResumes ?? 25
    const resumes = new Map<string, number>()
    const lastResume = new Map<string, number>()

    const controller = new AbortController()
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          /* ── Auto-continuacion ── */
          if (event.type === "session.idle") {
            const sessionID = event.data?.sessionID
            if (!sessionID) continue
            try {
              const dir = await resolveSessionDir(sessionID)
              const off = factory.get(dir)
              const state = await off.loadState().catch(() => undefined)
              if (!state) continue
              if (state.status !== "running") continue
              if (state.halt) continue

              const cards = Object.values(state.cards)
              const pending = cards.filter((c) => c.state !== "done")
              if (pending.length === 0) continue

              const count = resumes.get(sessionID) ?? 0
              if (count >= maxAutoResumes) {
                log.warn("tope de auto-reanudaciones alcanzado", { sessionID, count })
                continue
              }
              const last = lastResume.get(sessionID)
              if (last !== undefined && Date.now() - last < 1_500) continue
              lastResume.set(sessionID, Date.now())
              resumes.set(sessionID, count + 1)

              const { renderMesaBrief, snapshotMesa } = await import("./core/mesa.js")
              const mesa = await snapshotMesa(off)
              const mesaBrief = renderMesaBrief(mesa)

              const texto = [
                "[OFICINA - auto-continuacion]",
                "",
                `La corrida sigue abierta. Quedan ${pending.length} card(s) sin terminar.`,
                "",
                ...(mesaBrief ? ["---", "", "**La mesa:**", "", mesaBrief] : []),
                "",
                "Usá `oficina_board` para el panorama y `oficina_mesa` para ver la mesa.",
                "No declares la corrida terminada mientras queden cards sin DONE.",
              ].join("\n")

              await ctx.session.synthetic({
                sessionID,
                text: texto,
                description: "OFICINA: auto-continuacion",
              })
            } catch (err) {
              log.error("fallo en la auto-continuacion", { error: String(err) })
            }
            continue
          }

        }
      } catch (err) {
        if (!controller.signal.aborted) {
          log.error("el stream de eventos se corto", { error: String(err) })
        }
      }
    })()

    log.info("plugin inicializado", {
      directory: process.cwd(),
      tools: Object.keys(defs).length,
      officeDir: office.paths.officeDir,
    })

    return () => controller.abort()
  },
})
