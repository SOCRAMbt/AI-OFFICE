import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import type { PluginInput } from "@opencode-ai/plugin"
import { OficinaPlugin } from "../src/v1.js"

let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-plugin-"))
  await fs.writeFile(path.join(tmp, "package.json"), JSON.stringify({ name: "demo", scripts: { test: "true" } }))
  await fs.mkdir(path.join(tmp, "src"), { recursive: true })
  await fs.writeFile(path.join(tmp, "src", "app.js"), "export const x = 1\n")
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

/** Host mockeado: captura lo que el plugin hace. */
function mockHost() {
  const sent: string[] = []
  const logs: unknown[] = []
  const input = {
    project: { id: "p", worktree: tmp, vcs: "git" },
    directory: tmp,
    worktree: tmp,
    client: {
      app: { log: async (x: unknown) => { logs.push(x) } },
      session: {
        promptAsync: async (x: { body: { parts: { text: string }[] } }) => {
          sent.push(x.body.parts[0]!.text)
          return { data: {} }
        },
      },
    },
    $: (() => {}) as never,
    serverUrl: new URL("http://localhost:1234"),
    experimental_workspace: { register: () => {} },
  } as unknown as PluginInput
  return { input, sent, logs }
}

describe("Plugin OFICINA (v1, OpenCode 1.x)", () => {
  it("se inicializa y registra las 16 tools", async () => {
    const { input } = mockHost()
    const hooks = await OficinaPlugin(input)

    expect(hooks.tool).toBeDefined()
    const names = Object.keys(hooks.tool!).sort()
    expect(names).toEqual([
      "oficina_assign",
      "oficina_board",
      "oficina_brief",
      "oficina_bus",
      "oficina_cost",
      "oficina_dispatch",
      "oficina_escalate",
      "oficina_evidence",
      "oficina_ficha",
      "oficina_gate",
      "oficina_mesa",
      "oficina_plan",
      "oficina_review",
      "oficina_spawn",
      "oficina_stop",
      "oficina_submit",
    ])
  })

  it("registra los hooks: event, tool.execute.before, system transform y compacting", async () => {
    const { input } = mockHost()
    const hooks = await OficinaPlugin(input)

    expect(hooks.event).toBeTypeOf("function")
    expect(hooks["tool.execute.before"]).toBeTypeOf("function")
    expect(hooks["experimental.chat.system.transform"]).toBeTypeOf("function")
    expect(hooks["experimental.session.compacting"]).toBeTypeOf("function")
  })

  it("registra las tres capas de enforcement del scope", async () => {
    // La segunda y la tercera capa son opcionales en el host, pero si el
    // plugin las declara, tienen que funcionar. Sin `tool.execute.before`
    // el scope pasa a ser una instrucción en vez de una restricción.
    const { input } = mockHost()
    const hooks = await OficinaPlugin(input)

    expect(hooks["tool.execute.before"]).toBeTypeOf("function")
    expect(hooks["tool.execute.after"]).toBeTypeOf("function")
    expect(hooks["permission.ask"]).toBeTypeOf("function")
  })

  it("el hook permission.ask deniega una escritura fuera del scope", async () => {
    const { input } = mockHost()
    const hooks = await OficinaPlugin(input)

    // Sin card activa no hay scope: se permite (no hay nada que proteger).
    const output = { status: "ask" as "ask" | "deny" | "allow" }
    await hooks["permission.ask"]!(
      {
        id: "p1",
        type: "edit",
        pattern: "cualquiera/cosa.ts",
        sessionID: "ses-sin-card",
        messageID: "m1",
        title: "edit",
        metadata: {},
        time: { created: 0 },
      },
      output,
    )
    expect(output.status).toBe("allow")
  })

  it("crea la estructura .oficina/ en el proyecto", async () => {
    const { input } = mockHost()
    await OficinaPlugin(input)
    expect(await fs.stat(path.join(tmp, ".oficina"))).toBeTruthy()
    expect(await fs.stat(path.join(tmp, ".oficina", "bus"))).toBeTruthy()
  })

  it("el hook de session.idle NO reanuda si no hay cards", async () => {
    const { input, sent } = mockHost()
    const hooks = await OficinaPlugin(input)
    await hooks.event!({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })
    expect(sent).toHaveLength(0)
  })

  it("el hook de session.idle reanuda si queda trabajo pendiente", async () => {
    const { input, sent } = mockHost()
    const hooks = await OficinaPlugin(input)

    // Crear un plan con una card pendiente.
    const plan = hooks.tool!.oficina_plan!
    await plan.execute(
      {
        objective: "Hacer login",
        cards: [
          {
            title: "Implementar login",
            type: "implementation",
            requiredCapabilities: [],
            scope: { mayTouch: ["src/**"], forbidden: [] },
            acceptance: ["endpoint de login"],
            gate: "npm test en verde",
            dependsOn: [],
          },
        ],
      },
      { sessionID: "ses-1", messageID: "m1", agent: "primary", directory: tmp, worktree: tmp, abort: new AbortController().signal, metadata: () => {}, ask: async () => {} },
    )

    await hooks.event!({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain("auto-continuación")
    expect(sent[0]).toContain("Implementar login")
  })

  it("el hook de session.idle NO reanuda una corrida pausada", async () => {
    const { input, sent } = mockHost()
    const hooks = await OficinaPlugin(input)

    await hooks.tool!.oficina_plan!.execute(
      {
        objective: "Hacer login",
        cards: [{ title: "T", type: "implementation", requiredCapabilities: [], scope: { mayTouch: ["**"], forbidden: [] }, acceptance: ["a"], gate: "g", dependsOn: [] }],
      },
      { sessionID: "ses-1", messageID: "m1", agent: "primary", directory: tmp, worktree: tmp, abort: new AbortController().signal, metadata: () => {}, ask: async () => {} },
    )

    // Pausar la corrida.
    const statePath = path.join(tmp, ".oficina", "state.json")
    const state = JSON.parse(await fs.readFile(statePath, "utf8"))
    state.status = "paused"
    await fs.writeFile(statePath, JSON.stringify(state))

    await hooks.event!({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })
    expect(sent).toHaveLength(0)
  })

  it("el system transform inyecta el estado de la oficina", async () => {
    const { input } = mockHost()
    const hooks = await OficinaPlugin(input)

    await hooks.tool!.oficina_plan!.execute(
      {
        objective: "Hacer login",
        cards: [{ title: "T", type: "implementation", requiredCapabilities: [], scope: { mayTouch: ["**"], forbidden: [] }, acceptance: ["a"], gate: "g", dependsOn: [] }],
      },
      { sessionID: "ses-1", messageID: "m1", agent: "primary", directory: tmp, worktree: tmp, abort: new AbortController().signal, metadata: () => {}, ask: async () => {} },
    )

    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]!({ sessionID: "ses-1", model: {} as never }, output)

    expect(output.system.length).toBeGreaterThan(0)
    expect(output.system[0]).toContain("OFICINA")
    expect(output.system[0]).toContain("Hacer login")
  })

  it("la compactación inyecta el estado sobrevivido", async () => {
    const { input } = mockHost()
    const hooks = await OficinaPlugin(input)

    await hooks.tool!.oficina_plan!.execute(
      {
        objective: "Hacer login",
        cards: [{ title: "T", type: "implementation", requiredCapabilities: [], scope: { mayTouch: ["**"], forbidden: [] }, acceptance: ["a"], gate: "g", dependsOn: [] }],
      },
      { sessionID: "ses-1", messageID: "m1", agent: "primary", directory: tmp, worktree: tmp, abort: new AbortController().signal, metadata: () => {}, ask: async () => {} },
    )

    const output = { context: [] as string[], prompt: undefined as string | undefined }
    await hooks["experimental.session.compacting"]!({ sessionID: "ses-1" }, output)

    expect(output.context.length).toBeGreaterThan(0)
    expect(output.context[0]).toContain("sobrevivió a la compactación")
    expect(output.context[0]).toContain("Hacer login")
  })

  it("el guard de scope bloquea escrituras fuera del scope", async () => {
    const { input } = mockHost()
    const hooks = await OficinaPlugin(input)

    // Plan con scope acotado.
    await hooks.tool!.oficina_plan!.execute(
      {
        objective: "T",
        cards: [
          {
            title: "T",
            type: "implementation",
            requiredCapabilities: [],
            scope: { mayTouch: ["src/auth/**"], forbidden: ["src/server/**"] },
            acceptance: ["a"],
            gate: "g",
            dependsOn: [],
          },
        ],
      },
      { sessionID: "ses-1", messageID: "m1", agent: "primary", directory: tmp, worktree: tmp, abort: new AbortController().signal, metadata: () => {}, ask: async () => {} },
    )

    // Vincular la sesión con la card.
    const statePath = path.join(tmp, ".oficina", "state.json")
    const state = JSON.parse(await fs.readFile(statePath, "utf8"))
    state.sessions = { "ses-1": { agentId: "e-a", cardId: "T-00", updatedAt: new Date().toISOString(), autoResumes: 0 } }
    await fs.writeFile(statePath, JSON.stringify(state))

    // Escritura fuera de scope → bloqueada.
    await expect(
      hooks["tool.execute.before"]!(
        { tool: "edit", sessionID: "ses-1", callID: "c1" },
        { args: { filePath: path.join(tmp, "lib", "otro.ts") } },
      ),
    ).rejects.toThrow(/Scope violado/)

    // Escritura dentro de scope → permitida.
    await expect(
      hooks["tool.execute.before"]!(
        { tool: "edit", sessionID: "ses-1", callID: "c2" },
        { args: { filePath: path.join(tmp, "src", "auth", "login.ts") } },
      ),
    ).resolves.toBeUndefined()
  })

  it("el tool oficina_board devuelve el estado", async () => {
    const { input } = mockHost()
    const hooks = await OficinaPlugin(input)

    await hooks.tool!.oficina_plan!.execute(
      {
        objective: "Hacer login",
        cards: [{ title: "T", type: "implementation", requiredCapabilities: [], scope: { mayTouch: ["**"], forbidden: [] }, acceptance: ["a"], gate: "g", dependsOn: [] }],
      },
      { sessionID: "ses-1", messageID: "m1", agent: "primary", directory: tmp, worktree: tmp, abort: new AbortController().signal, metadata: () => {}, ask: async () => {} },
    )

    const result = await hooks.tool!.oficina_board!.execute(
      { filter: "all" },
      { sessionID: "ses-1", messageID: "m1", agent: "primary", directory: tmp, worktree: tmp, abort: new AbortController().signal, metadata: () => {}, ask: async () => {} },
    )
    const output = typeof result === "string" ? result : result.output
    expect(output).toContain("Hacer login")
    expect(output).toContain("T-00")
  })

  it("el bus registra mensajes en disco", async () => {
    const { input } = mockHost()
    const hooks = await OficinaPlugin(input)

    await hooks.tool!.oficina_bus!.execute(
      { action: "send", agentId: "e-a", to: ["e-b"], kind: "NOTICE", subject: "T-00", body: "hola", priority: "normal" },
      { sessionID: "ses-1", messageID: "m1", agent: "primary", directory: tmp, worktree: tmp, abort: new AbortController().signal, metadata: () => {}, ask: async () => {} },
    )

    const files = await fs.readdir(path.join(tmp, ".oficina", "bus", "peer"))
    expect(files.length).toBe(1)
    expect(files[0]).toMatch(/^0001-m-/)
  })
})
