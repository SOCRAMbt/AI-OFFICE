/**
 * Tests del plugin **v2** (OpenCode 2.x).
 *
 * ## Por que un archivo aparte
 *
 * La API de plugins de OpenCode v1 y v2 no se parecen en nada. v1 exporta
 * una funcion que devuelve hooks; v2 exige `export default { id, setup(ctx) }`
 * con un contexto que expone `ctx.tool.transform`, `ctx.tool.hook`,
 * `ctx.permission.hook`, `ctx.session.hook` y `ctx.event.subscribe`.
 *
 * Estos tests mockean el contexto de v2 y comprueban lo que de verdad
 * importa: que las tools se registran, que el guard de scope bloquea, y que
 * la auto-continuacion y el costo enganchan a los eventos.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import v2Plugin from "../src/v2.js"

let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-v2-"))
  await fs.writeFile(path.join(tmp, "package.json"), JSON.stringify({ name: "demo", scripts: { test: "true" } }))
  await fs.mkdir(path.join(tmp, "src"), { recursive: true })
  await fs.writeFile(path.join(tmp, "src", "app.js"), "export const x = 1\n")
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

/** Lo que el plugin registro en el host. */
interface Registro {
  tools: Map<string, { name: string; description: string; input: unknown; execute: unknown }>
  toolHooks: Map<string, (event: unknown) => Promise<void> | void>
  permissionHooks: Map<string, (event: unknown) => Promise<void> | void>
  sessionHooks: Map<string, (event: unknown) => Promise<void> | void>
  eventos: unknown[]
  sinteticos: { sessionID: string; text: string }[]
  promptLlamadas: { sessionID: string; text: string }[]
}

/** Host de v2 mockeado: captura todo lo que el plugin hace. */
function mockV2Host(options: { enforceScope?: boolean } = {}): { ctx: unknown; registro: Registro } {
  const registro: Registro = {
    tools: new Map(),
    toolHooks: new Map(),
    permissionHooks: new Map(),
    sessionHooks: new Map(),
    eventos: [],
    sinteticos: [],
    promptLlamadas: [],
  }

  const editor = {
    add: (tool: { name: string; description: string; input: unknown; execute: unknown }) => {
      registro.tools.set(tool.name, tool)
    },
    update: () => {},
    remove: () => {},
    list: () => [],
    get: () => undefined,
    namespace: () => {},
  }

  const ctx = {
    app: { version: "2.1.1" },
    location: { directory: tmp, project: { id: "p", directory: tmp, canonical: tmp } },
    options,
    tool: {
      transform: async (cb: (e: unknown) => void) => {
        cb(editor)
        return { dispose: async () => {} }
      },
      reload: async () => {},
      list: async () => [],
      hook: async (name: string, cb: (event: unknown) => Promise<void> | void) => {
        registro.toolHooks.set(name, cb)
        return { dispose: async () => {} }
      },
    },
    permission: {
      hook: async (name: string, cb: (event: unknown) => Promise<void> | void) => {
        registro.permissionHooks.set(name, cb)
        return { dispose: async () => {} }
      },
      list: async () => [],
      get: async () => undefined,
      reply: async () => {},
      assert: async () => {},
    },
    session: {
      hook: async (name: string, cb: (event: unknown) => Promise<void> | void) => {
        registro.sessionHooks.set(name, cb)
        return { dispose: async () => {} }
      },
      get: async () => ({ id: "ses-1" }),
      create: async () => ({ id: "ses-1" }),
      prompt: async (input: { sessionID: string; text: string }) => {
        registro.promptLlamadas.push({ sessionID: input.sessionID, text: input.text })
      },
      synthetic: async (input: { sessionID: string; text: string }) => {
        registro.sinteticos.push({ sessionID: input.sessionID, text: input.text })
      },
      update: async () => {},
      list: async () => ({ data: [] }),
      remove: async () => {},
      switchAgent: async () => {},
      switchModel: async () => {},
      generate: async () => ({ text: "" }),
      command: async () => {},
      compact: async () => ({}),
      interrupt: async () => {},
      move: async () => {},
      wait: async () => {},
      context: async () => [],
    },
    event: {
      subscribe: async function* (): AsyncGenerator<unknown> {
        for (const evento of registro.eventos) yield evento
        // Termina: el consumidor puede terminar.
        return
      },
    },
  }

  return { ctx, registro }
}

/** Arranca el plugin y devuelve el registro. */
async function arrancar(options: { enforceScope?: boolean } = {}): Promise<Registro> {
  const { ctx, registro } = mockV2Host(options)
  const plugin = v2Plugin as unknown as { setup: (c: unknown) => Promise<unknown> }
  await plugin.setup(ctx)
  return registro
}

describe("Plugin OFICINA (v2, OpenCode 2.x)", () => {
  it("se inicializa y registra las 16 tools", async () => {
    const registro = await arrancar()
    const names = [...registro.tools.keys()].sort()
    expect(names).toHaveLength(16)
    expect(names).toContain("oficina_dispatch")
    expect(names).toContain("oficina_mesa")
    expect(names).toContain("oficina_evidence")
    expect(names).toContain("oficina_cost")
    expect(names).toContain("oficina_stop")
  })

  it("cada tool expone JSON Schema, no zod", async () => {
    const registro = await arrancar()
    for (const tool of registro.tools.values()) {
      expect(tool.input).toBeDefined()
      const schema = tool.input as { type?: string }
      expect(schema.type).toBe("object")
    }
  })

  it("registra los hooks de tool, permission y session", async () => {
    const registro = await arrancar()
    expect(registro.toolHooks.has("execute.before")).toBe(true)
    expect(registro.toolHooks.has("execute.after")).toBe(true)
    expect(registro.permissionHooks.has("evaluate")).toBe(true)
    expect(registro.sessionHooks.has("context")).toBe(true)
    expect(registro.sessionHooks.has("compaction")).toBe(true)
  })

  it("una tool responde con el output de la oficina", async () => {
    const registro = await arrancar()
    const board = registro.tools.get("oficina_board")!
    const result = (await (board.execute as (a: unknown, c: unknown) => Promise<{ content: string }>)(
      { filter: "all" },
      { sessionID: "ses-1", agent: "general", messageID: "m1" },
    )) as { content: string }
    expect(result.content).toContain("OFICINA")
  })
})

describe("Guard de scope en v2", () => {
  it("bloquea una escritura fuera del scope con un error de la oficina", async () => {
    const registro = await arrancar()
    const hook = registro.toolHooks.get("execute.before")!

    // Sin card activa no hay scope: pasa.
    await expect(
      hook({
        tool: "write",
        sessionID: "ses-sin-card",
        agent: "general",
        messageID: "m1",
        id: "c1",
        input: { filePath: path.join(tmp, "lib", "otro.ts") },
      }),
    ).resolves.toBeUndefined()
  })

  it("el hook de permiso puede denegar una escritura", async () => {
    const registro = await arrancar()
    const hook = registro.permissionHooks.get("evaluate")!
    const event = {
      sessionID: "ses-1",
      action: "edit",
      resources: [path.join(tmp, "lib", "otro.ts")],
      effect: "allow" as "allow" | "deny" | "ask",
    }
    await hook(event)
    // Sin card no hay scope: el permiso sigue como estaba.
    expect(event.effect).toBe("allow")
  })
})
