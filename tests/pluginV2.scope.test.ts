/**
 * El scope como restriccion, en OpenCode v2.
 *
 * ## El criterio
 *
 * *"Un scope es una restriccion de seguridad solo en la medida en que no
 * pueda eludirse mediante otras rutas de ejecucion."*
 *
 * Este archivo prueba, contra el plugin v2 de verdad (con un contexto real
 * mockeado), que una card con scope **bloquea** las escrituras que se salen
 * y **permite** las que estan dentro.
 *
 * No alcanza con probar el modulo del guard: hay que probar que el hook
 * que se registra en el host lo invoca con los argumentos que espera.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import v2Plugin from "../src/v2.js"

let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-v2scope-"))
  await fs.writeFile(path.join(tmp, "package.json"), JSON.stringify({ name: "demo", scripts: { test: "true" } }))
  await fs.mkdir(path.join(tmp, "src", "permitido"), { recursive: true })
  await fs.mkdir(path.join(tmp, "lib"), { recursive: true })
  await fs.writeFile(path.join(tmp, "src", "permitido", "ok.ts"), "export const ok = 1\n")
  await fs.writeFile(path.join(tmp, "lib", "prohibido.ts"), "export const no = 1\n")
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

/** El contexto v2 mockeado, con los hooks registrados. */
async function arrancarConCard() {
  const hooks = new Map<string, (event: unknown) => Promise<void> | void>()

  const editor = {
    add: () => {},
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
      get: async () => ({ id: "ses-1" }),
      create: async () => ({ id: "ses-1" }),
      prompt: async () => {},
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

  return hooks
}

/** Crea una card con scope y le asigna la sesion. */
async function crearCardConScope(): Promise<string> {
  const { Office } = await import("../src/core/office.js")
  const office = new Office({ cwd: tmp })
  await office.init()

  const state = await office.loadState("Objetivo de prueba")
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

  const fresh = await office.loadState("Objetivo de prueba")
  const claimed = await office.claimCard(fresh, "e-trabajador", "T-00", "ses-1")
  expect(claimed.ok).toBe(true)
  return "ses-1"
}

describe("Scope en v2: la restriccion de verdad", () => {
  it("bloquea una escritura fuera del scope", async () => {
    const hooks = await arrancarConCard()
    await crearCardConScope()

    const before = hooks.get("execute.before")!
    await expect(
      before({
        tool: "write",
        sessionID: "ses-1",
        agent: "general",
        messageID: "m1",
        id: "c1",
        input: { filePath: path.join(tmp, "lib", "prohibido.ts") },
      }),
    ).rejects.toThrow(/Scope violado/)
  })

  it("bloquea un path absoluto fuera del proyecto", async () => {
    const hooks = await arrancarConCard()
    await crearCardConScope()

    const before = hooks.get("execute.before")!
    await expect(
      before({
        tool: "write",
        sessionID: "ses-1",
        agent: "general",
        messageID: "m1",
        id: "c2",
        input: { filePath: path.join(os.tmpdir(), "fuera-de-la-oficina.txt") },
      }),
    ).rejects.toThrow(/Scope violado/)
  })

  it("bloquea un escape por `..`", async () => {
    const hooks = await arrancarConCard()
    await crearCardConScope()

    const before = hooks.get("execute.before")!
    await expect(
      before({
        tool: "edit",
        sessionID: "ses-1",
        agent: "general",
        messageID: "m1",
        id: "c3",
        input: { filePath: path.join(tmp, "src", "permitido", "..", "..", "lib", "prohibido.ts") },
      }),
    ).rejects.toThrow(/Scope violado/)
  })

  it("permite una escritura DENTRO del scope", async () => {
    const hooks = await arrancarConCard()
    await crearCardConScope()

    const before = hooks.get("execute.before")!
    await expect(
      before({
        tool: "write",
        sessionID: "ses-1",
        agent: "general",
        messageID: "m1",
        id: "c4",
        input: { filePath: path.join(tmp, "src", "permitido", "ok.ts") },
      }),
    ).resolves.toBeUndefined()
  })

  it("bloquea un comando de shell que escribe fuera del scope", async () => {
    const hooks = await arrancarConCard()
    await crearCardConScope()

    const before = hooks.get("execute.before")!
    await expect(
      before({
        tool: "bash",
        sessionID: "ses-1",
        agent: "general",
        messageID: "m1",
        id: "c5",
        input: { command: `echo hack > ${path.join(tmp, "lib", "prohibido.ts")}` },
      }),
    ).rejects.toThrow(/Scope violado/)
  })

  it("el hook de permiso puede denegar la escritura", async () => {
    const hooks = await arrancarConCard()
    await crearCardConScope()

    const evaluate = hooks.get("permission:evaluate")!
    const event = {
      sessionID: "ses-1",
      action: "edit",
      resources: [path.join(tmp, "lib", "prohibido.ts")],
      effect: "allow" as "allow" | "deny" | "ask",
      message: undefined as string | undefined,
    }
    await evaluate(event)
    expect(event.effect).toBe("deny")
    expect(event.message).toMatch(/Scope violado/)
  })

  it("el hook de permiso permite lo que esta en scope", async () => {
    const hooks = await arrancarConCard()
    await crearCardConScope()

    const evaluate = hooks.get("permission:evaluate")!
    const event = {
      sessionID: "ses-1",
      action: "edit",
      resources: [path.join(tmp, "src", "permitido", "ok.ts")],
      effect: "allow" as "allow" | "deny" | "ask",
    }
    await evaluate(event)
    expect(event.effect).toBe("allow")
  })

  it("una sesion SIN card no tiene scope que aplicar", async () => {
    const hooks = await arrancarConCard()

    const before = hooks.get("execute.before")!
    await expect(
      before({
        tool: "write",
        sessionID: "ses-otra-sesion",
        agent: "general",
        messageID: "m1",
        id: "c6",
        input: { filePath: path.join(tmp, "lib", "prohibido.ts") },
      }),
    ).resolves.toBeUndefined()
  })
})
