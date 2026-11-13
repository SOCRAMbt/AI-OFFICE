import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { Office } from "../src/core/office.js"
import { shouldUseLite, normalizeModeArg } from "../src/core/triage.js"
import { dispatchOffice } from "../src/core/dispatch.js"
import { DEFAULT_LIMITS } from "../src/core/types.js"
import { CHANNELS } from "../src/core/bus.js"

let tmp: string
let office: Office

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-lite-"))
  await fs.writeFile(
    path.join(tmp, "package.json"),
    JSON.stringify({ name: "demo", scripts: { test: "true" } }),
  )
  office = new Office({ cwd: tmp, limits: DEFAULT_LIMITS })
  await office.init()
})
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe("shouldUseLite", () => {
  it("degrada una tarea chica: 1 card, objetivo corto, <=3 criterios, sin palabras transversales", () => {
    const r = shouldUseLite({
      objective: "arreglar el bug de la tabla de precios",
      cards: [{ acceptance: ["el precio aparece", "no rompe el layout"] }],
    })
    expect(r.useLite).toBe(true)
  })

  it("no degrada varios pasos (>1 card)", () => {
    const r = shouldUseLite({
      objective: "objetivo grande",
      cards: [{ acceptance: ["a"] }, { acceptance: ["b"] }],
    })
    expect(r.useLite).toBe(false)
  })

  it("no degrada objetivos largos", () => {
    const r = shouldUseLite({
      objective: "x".repeat(200),
      cards: [{ acceptance: ["a"] }],
    })
    expect(r.useLite).toBe(false)
  })

  it("no degrada objetivos transversales", () => {
    const r = shouldUseLite({
      objective: "refactor del sistema de pagos",
      cards: [{ acceptance: ["a"] }],
    })
    expect(r.useLite).toBe(false)
  })

  it("no degrada si hay muchos criterios", () => {
    const r = shouldUseLite({
      objective: "fix login",
      cards: [{ acceptance: ["a", "b", "c", "d"] }],
    })
    expect(r.useLite).toBe(false)
  })

  it("normalizeModeArg mapea full/lite/auto", () => {
    expect(normalizeModeArg("lite")).toBe("lite")
    expect(normalizeModeArg("full")).toBe("full")
    expect(normalizeModeArg(undefined)).toBe("auto")
    expect(normalizeModeArg("--full")).toBe("auto")
  })
})

describe("savePlan con Modo Célula", () => {
  it("mode=lite persiste state.mode=lite y registra la decisión", async () => {
    let state = await office.loadState("arreglar el bug de la tabla")
    await office.savePlan(
      state,
      [{ title: "Fix tabla", type: "bugfix", acceptance: ["muestra el precio"], gate: "npm test" }],
      { mode: "lite" },
    )
    state = await office.loadState()
    expect(state.mode).toBe("lite")
    const md = state.decisions.find((d) => d.reason.startsWith("modo lite"))
    expect(md).toBeDefined()
  })

  it("auto degrada al Modo Célula y lo registra en el bus", async () => {
    let state = await office.loadState("arreglar el bug de la tabla")
    await office.savePlan(
      state,
      [{ title: "Fix tabla", type: "bugfix", acceptance: ["muestra el precio"], gate: "npm test" }],
      { mode: "auto" },
    )
    state = await office.loadState()
    expect(state.mode).toBe("lite")
    // El bus FS (bus/flow/*.json) registra el mensaje de degradación.
    const flowDir = path.join(tmp, ".oficina", "bus", "coord-flow")
    const files = await fs.readdir(flowDir).catch(() => [] as string[])
    const bodies = await Promise.all(files.map((f) => fs.readFile(path.join(flowDir, f), "utf8")))
    expect(bodies.some((b) => b.includes("modo-lite"))).toBe(true)
  })

  it("auto en proyecto grande queda en Full", async () => {
    let state = await office.loadState("refactor del sistema de pagos para migrar a arquitectura hexagonal transversal en todo el monorepo")
    await office.savePlan(
      state,
      [{ title: "Refactor", type: "refactor", acceptance: ["a", "b", "c", "d"], gate: "npm test" }],
      { mode: "auto" },
    )
    state = await office.loadState()
    expect(state.mode).toBe("full")
  })
})

describe("dispatchOffice respeta el Modo Célula", () => {
  it("en lite despacha un solo agente (sin pares) aunque haya panel", async () => {
    let state = await office.loadState("arreglar el bug de la tabla")
    await office.savePlan(
      state,
      [{ title: "Fix tabla", type: "bugfix", requiredCapabilities: ["html"], acceptance: ["muestra el precio"], gate: "npm test" }],
      { mode: "lite" },
    )
    state = await office.loadState()
    const catalog = await office.catalog()
    const result = await dispatchOffice(office, state, {
      projectRoot: tmp,
      catalog,
      objective: state.objective,
      maxAgents: 4,
      maxComplements: 2,
      minCoverage: 0.7,
      existing: Object.values((await office.loadRoster(state.runId)).agents),
    })
    expect(result.dispatched.length).toBe(1)
  })
})
