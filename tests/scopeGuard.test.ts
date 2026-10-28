import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { globToRegex, matchesScope, extractPath } from "../src/hooks/scopeGuard.js"
import { Office } from "../src/core/office.js"
import { DEFAULT_LIMITS } from "../src/core/types.js"

let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-scope-"))
  await fs.writeFile(path.join(tmp, "package.json"), JSON.stringify({ name: "x" }))
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe("Matching de globs", () => {
  it("** matchea todo", () => {
    expect(matchesScope("src/a/b.ts", ["**"])).toBe(true)
    expect(matchesScope("a.ts", ["**"])).toBe(true)
  })

  it("src/** matchea archivos bajo src", () => {
    expect(matchesScope("src/a.ts", ["src/**"])).toBe(true)
    expect(matchesScope("src/deep/nested/a.ts", ["src/**"])).toBe(true)
    expect(matchesScope("lib/a.ts", ["src/**"])).toBe(false)
  })

  it("* no cruza directorios", () => {
    expect(matchesScope("src/a.ts", ["src/*"])).toBe(true)
    expect(matchesScope("src/deep/a.ts", ["src/*"])).toBe(false)
  })

  it("**/*.env matchea .env en cualquier nivel", () => {
    expect(matchesScope(".env", ["**/*.env"])).toBe(true)
    expect(matchesScope("config/.env", ["**/*.env"])).toBe(true)
    expect(matchesScope("src/env.ts", ["**/*.env"])).toBe(false)
  })

  it("normaliza separadores de Windows", () => {
    expect(matchesScope("src\\a\\b.ts", ["src/**"])).toBe(true)
  })

  it("quita el prefijo ./", () => {
    expect(matchesScope("./src/a.ts", ["src/**"])).toBe(true)
  })

  it("genera regex válidos", () => {
    expect(globToRegex("src/**").test("src/a/b.ts")).toBe(true)
  })
})

describe("Extracción del path de la tool", () => {
  it("busca filePath", () => {
    expect(extractPath("edit", { filePath: "/a/b.ts" })).toBe("/a/b.ts")
  })

  it("busca path", () => {
    expect(extractPath("write", { path: "/a/b.ts" })).toBe("/a/b.ts")
  })

  it("extrae del patch", () => {
    const patch = "--- a/src/x.ts\n+++ b/src/x.ts\n@@\n-old\n+new"
    expect(extractPath("patch", { patch })).toContain("src/x.ts")
  })

  it("devuelve undefined si no hay path", () => {
    expect(extractPath("read", { content: "x" })).toBeUndefined()
  })
})

describe("Guard de scope", () => {
  async function setup() {
    const office = new Office({ cwd: tmp, limits: DEFAULT_LIMITS })
    await office.init()
    const state = await office.loadState("Test")
    await office.savePlan(state, [
      {
        title: "T",
        type: "implementation",
        scope: { mayTouch: ["src/auth/**"], forbidden: ["src/server/**", "**/*.env"] },
        acceptance: ["a"],
        gate: "g",
      },
    ])
    state.cards["T-00"]!.owner = "e-a"
    state.cards["T-00"]!.reviewer = "e-b"
    office.bindSession(state, "ses-1", "e-a", "T-00")
    await office.saveState(state)
    return office
  }

  it("bloquea un archivo fuera del scope", async () => {
    const office = await setup()
    const hook = createGuard(office)

    await expect(
      hook(
        { tool: "edit", sessionID: "ses-1", callID: "c1" },
        { args: { filePath: path.join(tmp, "lib", "otro.ts") } },
      ),
    ).rejects.toThrow(/Scope violado/)
  })

  it("bloquea un archivo forbidden aunque esté en may_touch", async () => {
    const office = await setup()
    const hook = createGuard(office)

    await expect(
      hook(
        { tool: "write", sessionID: "ses-1", callID: "c2" },
        { args: { filePath: path.join(tmp, "src", "server", "x.ts") } },
      ),
    ).rejects.toThrow(/forbidden/)
  })

  it("permite un archivo dentro del scope", async () => {
    const office = await setup()
    const hook = createGuard(office)

    await expect(
      hook(
        { tool: "edit", sessionID: "ses-1", callID: "c3" },
        { args: { filePath: path.join(tmp, "src", "auth", "login.ts") } },
      ),
    ).resolves.toBeUndefined()
  })

  it("permite escribir en los artefactos de la oficina", async () => {
    const office = await setup()
    const hook = createGuard(office)

    await expect(
      hook(
        { tool: "write", sessionID: "ses-1", callID: "c4" },
        { args: { filePath: path.join(tmp, ".oficina", "artifacts", "T-00", "handoff.md") } },
      ),
    ).resolves.toBeUndefined()
  })

  it("ignora las tools de lectura", async () => {
    const office = await setup()
    const hook = createGuard(office)

    await expect(
      hook(
        { tool: "read", sessionID: "ses-1", callID: "c5" },
        { args: { filePath: path.join(tmp, "cualquiera.ts") } },
      ),
    ).resolves.toBeUndefined()
  })

  it("no bloquea si la sesión no tiene card activa", async () => {
    const office = await setup()
    const hook = createGuard(office)

    await expect(
      hook(
        { tool: "edit", sessionID: "ses-sin-card", callID: "c6" },
        { args: { filePath: path.join(tmp, "lo-que-sea.ts") } },
      ),
    ).resolves.toBeUndefined()
  })
})

/** Construye el hook con la firma que usa el plugin. */
function createGuard(office: Office, options: boolean | { enforce?: boolean; resolveParentSession?: (sessionID: string) => Promise<string | undefined> } = {}) {
  const opts = typeof options === "boolean" ? { enforce: options } : options
  return async (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: Record<string, unknown> },
  ) => {
    const { createScopeGuardHook } = await import("../src/hooks/scopeGuard.js")
    const hook = createScopeGuardHook(office, { enforce: opts.enforce ?? true, resolveParentSession: opts.resolveParentSession })
    return hook(input, output)
  }
}

describe("Fail-closed behavior (H1/H2)", () => {
  async function setupWithFailingLoadState() {
    const office = new Office({ cwd: tmp, limits: DEFAULT_LIMITS })
    await office.init()
    const state = await office.loadState("Test")
    await office.savePlan(state, [
      {
        title: "T",
        type: "implementation",
        scope: { mayTouch: ["src/**"], forbidden: [] },
        acceptance: ["a"],
        gate: "g",
      },
    ])
    state.cards["T-00"]!.owner = "e-a"
    state.cards["T-00"]!.reviewer = "e-b"
    office.bindSession(state, "ses-1", "e-a", "T-00")
    await office.saveState(state)

    // Override loadState to simulate a failure
    const originalLoadState = office.loadState.bind(office)
    office.loadState = async () => {
      throw new Error("Simulated loadState failure")
    }
    return { office, originalLoadState }
  }

  it("blocks write when loadState fails and enforce=true (fail-closed)", async () => {
    const { office } = await setupWithFailingLoadState()
    const hook = createGuard(office, true)

    await expect(
      hook(
        { tool: "edit", sessionID: "ses-1", callID: "c1" },
        { args: { filePath: path.join(tmp, "src", "auth", "login.ts") } },
      ),
    ).rejects.toThrow(/Scope guard internal error/)
  })

  it("allows write when loadState fails and enforce=false (warn only)", async () => {
    const { office } = await setupWithFailingLoadState()
    const hook = createGuard(office, false)

    await expect(
      hook(
        { tool: "edit", sessionID: "ses-1", callID: "c1" },
        { args: { filePath: path.join(tmp, "src", "auth", "login.ts") } },
      ),
    ).resolves.toBeUndefined()
  })

  it("blocks write when resolveParentSession fails and enforce=true (no direct binding)", async () => {
    const office = new Office({ cwd: tmp, limits: DEFAULT_LIMITS })
    await office.init()
    const state = await office.loadState("Test")
    await office.savePlan(state, [
      {
        title: "T",
        type: "implementation",
        scope: { mayTouch: ["src/**"], forbidden: [] },
        acceptance: ["a"],
        gate: "g",
      },
    ])
    state.cards["T-00"]!.owner = "e-a"
    state.cards["T-00"]!.reviewer = "e-b"
    // Parent session has the card, child does NOT
    office.bindSession(state, "ses-parent", "e-a", "T-00")
    // Child session has no card binding - it will try to resolve parent
    await office.saveState(state)

    const hook = createGuard(office, { enforce: true, resolveParentSession: async () => { throw new Error("Parent resolution failed") } })

    // resolveParentSession throws
    await expect(
      hook(
        { tool: "edit", sessionID: "ses-child", callID: "c1" },
        { args: { filePath: path.join(tmp, "src", "auth", "login.ts") } },
      ),
    ).rejects.toThrow(/Scope verification failed/)
  })

  it("allows write when resolveParentSession fails and enforce=false (no direct binding)", async () => {
    const office = new Office({ cwd: tmp, limits: DEFAULT_LIMITS })
    await office.init()
    const state = await office.loadState("Test")
    await office.savePlan(state, [
      {
        title: "T",
        type: "implementation",
        scope: { mayTouch: ["src/**"], forbidden: [] },
        acceptance: ["a"],
        gate: "g",
      },
    ])
    state.cards["T-00"]!.owner = "e-a"
    state.cards["T-00"]!.reviewer = "e-b"
    office.bindSession(state, "ses-parent", "e-a", "T-00")
    await office.saveState(state)

    const hook = createGuard(office, false)

    await expect(
      hook(
        { tool: "edit", sessionID: "ses-child", callID: "c1" },
        { args: { filePath: path.join(tmp, "src", "auth", "login.ts") } },
      ),
    ).resolves.toBeUndefined()
  })
})

describe("resolveScopeCard result type", () => {
  it("returns AUTHORIZED when card bound directly", async () => {
    const { resolveScopeCard } = await import("../src/hooks/scopeGuard.js")
    const office = new Office({ cwd: tmp, limits: DEFAULT_LIMITS })
    await office.init()
    const state = await office.loadState("Test")
    await office.savePlan(state, [
      {
        title: "T",
        type: "implementation",
        scope: { mayTouch: ["src/**"], forbidden: [] },
        acceptance: ["a"],
        gate: "g",
      },
    ])
    state.cards["T-00"]!.owner = "e-a"
    state.cards["T-00"]!.reviewer = "e-b"
    office.bindSession(state, "ses-1", "e-a", "T-00")
    await office.saveState(state)

    const result = await resolveScopeCard(state, "ses-1", { enforce: true })
    expect(result.kind).toBe("AUTHORIZED")
    if (result.kind === "AUTHORIZED") {
      expect(result.card.id).toBe("T-00")
    }
  })

  it("returns NO_SCOPE_APPLICABLE when session has no card and no parent resolver", async () => {
    const { resolveScopeCard } = await import("../src/hooks/scopeGuard.js")
    const office = new Office({ cwd: tmp, limits: DEFAULT_LIMITS })
    await office.init()
    const state = await office.loadState("Test")
    // No cards, no bindings

    const result = await resolveScopeCard(state, "ses-1", { enforce: true })
    expect(result.kind).toBe("NO_SCOPE_APPLICABLE")
  })

  it("returns VERIFICATION_FAILED when parent resolver throws (no direct binding)", async () => {
    const { resolveScopeCard } = await import("../src/hooks/scopeGuard.js")
    const office = new Office({ cwd: tmp, limits: DEFAULT_LIMITS })
    await office.init()
    const state = await office.loadState("Test")
    await office.savePlan(state, [
      {
        title: "T",
        type: "implementation",
        scope: { mayTouch: ["src/**"], forbidden: [] },
        acceptance: ["a"],
        gate: "g",
      },
    ])
    state.cards["T-00"]!.owner = "e-a"
    state.cards["T-00"]!.reviewer = "e-b"
    // Parent has the card, child does NOT
    office.bindSession(state, "ses-parent", "e-a", "T-00")
    await office.saveState(state)

    const result = await resolveScopeCard(state, "ses-child", {
      enforce: true,
      resolveParentSession: async () => {
        throw new Error("Parent resolution failed")
      },
    })
    expect(result.kind).toBe("VERIFICATION_FAILED")
    if (result.kind === "VERIFICATION_FAILED") {
      expect(result.reason).toContain("Parent resolution failed")
    }
  })
})
