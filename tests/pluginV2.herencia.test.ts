/**
 * El subagente hereda el scope.
 *
 * ## Por que esto importa mas que el guard
 *
 * Delegar es la via por la que un agente se multiplica. Si el subagente
 * NO hereda el scope, delegar es un escalon para salirse de el: el hijo no
 * tiene card, el guard no encuentra scope, y escribe donde quiera.
 *
 * En OpenCode v2 la sesion hija cuelga de la padre (`parentID`), asi que el
 * guard puede subir por la cadena hasta la sesion que tiene la card.
 *
 * Este archivo prueba las dos mitades: que el padre con card bloquea al
 * hijo, y que el hijo hereda de verdad.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import v2Plugin from "../src/v2.js"

let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-v2herencia-"))
  await fs.writeFile(path.join(tmp, "package.json"), JSON.stringify({ name: "demo", scripts: { test: "true" } }))
  await fs.mkdir(path.join(tmp, "src", "permitido"), { recursive: true })
  await fs.mkdir(path.join(tmp, "lib"), { recursive: true })
  await fs.writeFile(path.join(tmp, "src", "permitido", "ok.ts"), "export const ok = 1\n")
  await fs.writeFile(path.join(tmp, "lib", "prohibido.ts"), "export const no = 1\n")
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

interface Sesion {
  id: string
  parentID?: string
}

/** Host v2 mockeado, con arbol de sesiones. */
async function arrancar(sesiones: Record<string, Sesion>) {
  const hooks = new Map<string, (event: unknown) => Promise<void> | void>()
  const tools = new Map<string, { name: string; description: string; input: unknown; execute: unknown }>()
  const creados: { parentID?: string; title?: string; agent?: string }[] = []
  const prompts: { sessionID: string; text: string }[] = []

  const editor = {
    add: (tool: { name: string; description: string; input: unknown; execute: unknown }) => {
      tools.set(tool.name, tool)
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
    options: {},
    tool: {
      transform: async (cb: (e: unknown) => void) => {
        cb(editor)
        return { dispose: async () => {} }
      },
      reload: async () => {},
      list: async () => [],
      hook: async (name: string, cb: (event: unknown) => Promise<void> | void) => {
        hooks.set(name, cb)
        return { dispose: async () => {} }
      },
    },
    permission: {
      hook: async (name: string, cb: (event: unknown) => Promise<void> | void) => {
        hooks.set(`permission:${name}`, cb)
        return { dispose: async () => {} }
      },
      list: async () => [],
      get: async () => undefined,
      reply: async () => {},
      assert: async () => {},
    },
    session: {
      hook: async (name: string, cb: (event: unknown) => Promise<void> | void) => {
        hooks.set(`session:${name}`, cb)
        return { dispose: async () => {} }
      },
      get: async (input: { sessionID: string }) => sesiones[input.sessionID] ?? { id: input.sessionID },
      create: async (input: { parentID?: string; title?: string; agent?: string }) => {
        creados.push(input)
        const id = `ses-nueva-${creados.length}`
        sesiones[id] = { id, parentID: input.parentID }
        return sesiones[id]!
      },
      prompt: async (input: { sessionID: string; text: string }) => {
        prompts.push(input)
      },
      synthetic: async () => {},
      update: async () => {},
      list: async () => ({ data: [] }),
      remove: async () => {},
      switchAgent: async () => {},
      switchModel: async () => {},
      generate: async () => ({ text: "" }),
      command: async () => {},
      compact: async () => ({}) as never,
      interrupt: async () => {},
      move: async () => {},
      wait: async () => {},
      context: async () => [],
    },
    event: {
      subscribe: async function* (): AsyncGenerator<unknown> {
        return
      },
    },
  }

  const plugin = v2Plugin as unknown as { setup: (c: unknown) => Promise<unknown> }
  await plugin.setup(ctx)

  return { hooks, tools, creados, prompts }
}

/** Crea una card con scope y la vincula a la sesion padre. */
async function crearCardConScope(sessionID: string) {
  const { Office } = await import("../src/core/office.js")
  const office = new Office({ cwd: tmp })
  await office.init()

  const state = await office.loadState("Objetivo")
  await office.savePlan(state, [
    {
      title: "Trabajo con scope",
      type: "implementation",
      requiredCapabilities: ["react"],
      scope: { mayTouch: ["src/permitido/**"], forbidden: ["lib/**"] },
      acceptance: ["funciona"],
      gate: "npm test",
    },
  ])

  const fresh = await office.loadState("Objetivo")
  const claimed = await office.claimCard(fresh, "e-trabajador", "T-00", sessionID)
  expect(claimed.ok).toBe(true)
}

describe("El subagente hereda el scope", () => {
  it("el hijo de una sesion con card NO puede escribir fuera del scope", async () => {
    const sesiones: Record<string, Sesion> = {
      "ses-padre": { id: "ses-padre" },
      "ses-hijo": { id: "ses-hijo", parentID: "ses-padre" },
    }
    const { hooks } = await arrancar(sesiones)
    await crearCardConScope("ses-padre")

    const before = hooks.get("execute.before")!
    await expect(
      before({
        tool: "write",
        sessionID: "ses-hijo",
        agent: "general",
        messageID: "m1",
        id: "c1",
        input: { filePath: path.join(tmp, "lib", "prohibido.ts") },
      }),
    ).rejects.toThrow(/Scope violado/)
  })

  it("el nieto (dos niveles) tambien hereda", async () => {
    const sesiones: Record<string, Sesion> = {
      "ses-padre": { id: "ses-padre" },
      "ses-hijo": { id: "ses-hijo", parentID: "ses-padre" },
      "ses-nieto": { id: "ses-nieto", parentID: "ses-hijo" },
    }
    const { hooks } = await arrancar(sesiones)
    await crearCardConScope("ses-padre")

    const before = hooks.get("execute.before")!
    await expect(
      before({
        tool: "write",
        sessionID: "ses-nieto",
        agent: "general",
        messageID: "m1",
        id: "c1",
        input: { filePath: path.join(tmp, "lib", "prohibido.ts") },
      }),
    ).rejects.toThrow(/Scope violado/)
  })

  it("el hijo SI puede escribir dentro del scope", async () => {
    const sesiones: Record<string, Sesion> = {
      "ses-padre": { id: "ses-padre" },
      "ses-hijo": { id: "ses-hijo", parentID: "ses-padre" },
    }
    const { hooks } = await arrancar(sesiones)
    await crearCardConScope("ses-padre")

    const before = hooks.get("execute.before")!
    await expect(
      before({
        tool: "write",
        sessionID: "ses-hijo",
        agent: "general",
        messageID: "m1",
        id: "c2",
        input: { filePath: path.join(tmp, "src", "permitido", "ok.ts") },
      }),
    ).resolves.toBeUndefined()
  })

  it("una sesion sin ancestro con card NO tiene scope", async () => {
    const sesiones: Record<string, Sesion> = {
      "ses-padre": { id: "ses-padre" },
      "ses-hijo": { id: "ses-hijo", parentID: "ses-padre" },
      "ses-solitario": { id: "ses-solitario" },
    }
    const { hooks } = await arrancar(sesiones)
    await crearCardConScope("ses-padre")

    const before = hooks.get("execute.before")!
    await expect(
      before({
        tool: "write",
        sessionID: "ses-solitario",
        agent: "general",
        messageID: "m1",
        id: "c3",
        input: { filePath: path.join(tmp, "lib", "prohibido.ts") },
      }),
    ).resolves.toBeUndefined()
  })
})

describe("El dispatch crea subagentes en v2", () => {
  it("la tool de dispatch crea una sesion hija y le manda el prompt", async () => {
    const sesiones: Record<string, Sesion> = { "ses-padre": { id: "ses-padre" } }
    const { tools, creados, prompts } = await arrancar(sesiones)

    // El plan tiene que existir antes del dispatch.
    const { Office } = await import("../src/core/office.js")
    const office = new Office({ cwd: tmp })
    await office.init()
    const state = await office.loadState("Objetivo")
    await office.savePlan(state, [
      {
        title: "Trabajo con scope",
        type: "implementation",
        requiredCapabilities: ["react"],
        scope: { mayTouch: ["src/permitido/**"], forbidden: ["lib/**"] },
        acceptance: ["funciona"],
        gate: "npm test",
      },
    ])

    const dispatch = tools.get("oficina_dispatch")!
    expect(dispatch).toBeDefined()

    const result = (await (dispatch.execute as (a: unknown, c: unknown) => Promise<unknown>)(
      { maxAgents: 2, maxComplements: 0, spawn: true },
      { sessionID: "ses-padre", agent: "general", messageID: "m1" },
    )) as { metadata?: { spawned?: number } }

    // Se creo una sesion hija, colgando del padre.
    expect(creados.length).toBeGreaterThan(0)
    expect(creados[0]!.parentID).toBe("ses-padre")
    // Y se le mando el prompt del agente.
    expect(prompts.length).toBeGreaterThan(0)
    expect(prompts[0]!.text.length).toBeGreaterThan(500)
    // La metadata de la tool lo refleja.
    expect(result.metadata?.spawned).toBe(creados.length)
  })
})
