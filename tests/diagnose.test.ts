/**
 * El diagnostico tiene que DETECTAR las roturas, no solo contarlas.
 *
 * ## Por que importa
 *
 * Un diagnostico que siempre dice "todo bien" es peor que no tener
 * ninguno: da confianza falsa. Este archivo arma corridas a mano —una
 * sana y varias rotas— y afirma que el diagnostico las distingue.
 *
 * Las corridas se escriben a disco a proposito, no se simulan: el
 * diagnostico lee el filesystem, y un fixture en memoria no probaria
 * nada.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { diagnose } from "../scripts/diagnose-run.js"

let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-diag-"))
  await fs.writeFile(path.join(tmp, "package.json"), JSON.stringify({ name: "demo" }))
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

interface CardFixture {
  id: string
  state?: string
  owner?: string | null
  reviewer?: string | null
  acceptance?: string[]
}

/** Escribe una corrida completa en disco. */
async function escribirCorrida(
  cards: CardFixture[],
  opciones: {
    gates?: Record<string, string>
    evidencia?: Record<string, { requirement: string; requirementIndex?: number }[]>
    roster?: Record<string, unknown>
  } = {},
) {
  const dir = path.join(tmp, ".oficina")
  await fs.mkdir(path.join(dir, "artifacts"), { recursive: true })
  await fs.mkdir(path.join(dir, "evidence"), { recursive: true })

  const order = cards.map((c) => c.id)
  const state = {
    runId: "run-test",
    objective: "Objetivo de prueba",
    status: "running",
    iteration: 1,
    order,
    cards: Object.fromEntries(
      cards.map((c) => [
        c.id,
        {
          id: c.id,
          title: `Trabajo ${c.id}`,
          type: "implementation",
          state: c.state ?? "done",
          owner: c.owner === undefined ? `e-owner-${c.id}` : c.owner,
          reviewer: c.reviewer === undefined ? `e-rev-${c.id}` : c.reviewer,
          requiredCapabilities: ["javascript"],
          scope: { mayTouch: ["src/**"], forbidden: [] },
          acceptance: c.acceptance ?? ["funciona"],
          gate: "npm test",
          attempts: 1,
          rejections: 0,
          dependsOn: [],
          result: "",
        },
      ]),
    ),
    budget: {
      cardsUsed: order.length,
      maxCards: 20,
      agentCallsUsed: 5,
      maxAgentCalls: 40,
      spawnsUsed: 2,
      maxSpawnsTotal: 20,
    },
    halt: null,
    sessions: {},
    pendingGates: [],
  }
  await fs.writeFile(path.join(dir, "state.json"), JSON.stringify(state, null, 2))

  const roster =
    opciones.roster ??
    Object.fromEntries(
      cards.flatMap((c) => [
        [
          c.owner ?? `e-owner-${c.id}`,
          {
            id: c.owner ?? `e-owner-${c.id}`,
            role: "dev",
            displayName: "Dev",
            state: "working",
            currentCard: c.id,
            capabilities: ["javascript"],
            source: { kind: "agency-agents", division: "engineering" },
          },
        ],
        [
          c.reviewer ?? `e-rev-${c.id}`,
          {
            id: c.reviewer ?? `e-rev-${c.id}`,
            role: "critico",
            displayName: "Critico",
            state: "working",
            currentCard: null,
            capabilities: ["review"],
            source: { kind: "factory" },
          },
        ],
      ]),
    )
  await fs.writeFile(
    path.join(dir, "roster.json"),
    JSON.stringify({ version: 2, runId: "run-test", agents: roster, updatedAt: "" }, null, 2),
  )

  for (const [cardId, gates] of Object.entries(opciones.gates ?? {})) {
    const d = path.join(dir, "artifacts", cardId)
    await fs.mkdir(d, { recursive: true })
    await fs.writeFile(path.join(d, "gates.md"), gates)
    await fs.writeFile(path.join(d, "handoff.md"), "# handoff\n")
  }

  for (const [cardId, nodes] of Object.entries(opciones.evidencia ?? {})) {
    await fs.writeFile(
      path.join(dir, "evidence", `${cardId}.json`),
      JSON.stringify({ cardId, nodes }, null, 2),
    )
  }
}

const GATES_PASA = `# Gate

| # | Fase | Comando | Resultado | Detalle |
|---|------|---------|-----------|---------|
| 1 | build | \`npm run build\` | PASS | exit 0 |
| 2 | typecheck | \`tsc\` | NA | el proyecto no tiene type checker configurado |
| 3 | test | \`npm test\` | PASS | exit 0 en 1200ms |
`

const GATES_FALLA = `# Gate

| # | Fase | Comando | Resultado | Detalle |
|---|------|---------|-----------|---------|
| 1 | test | \`npm test\` | FAIL | exit 1 |
`

describe("Diagnostico: corrida sana", () => {
  it("no reporta fallas cuando todo esta en orden", async () => {
    await escribirCorrida(
      [{ id: "T-00", acceptance: ["existe el archivo", "el test pasa"] }],
      {
        gates: { "T-00": GATES_PASA },
        evidencia: {
          "T-00": [
            { requirement: "existe el archivo", requirementIndex: 0 },
            { requirement: "el test pasa", requirementIndex: 1 },
          ],
        },
      },
    )

    const r = await diagnose(tmp)
    expect(r.error).toBeUndefined()
    expect(r.fallas).toBe(0)
    expect(r.cardsDone).toBe(1)
    expect(r.cardsTotal).toBe(1)
  })
})

describe("Diagnostico: detecta las roturas", () => {
  it("una card cerrada sin gates en PASS", async () => {
    await escribirCorrida([{ id: "T-00" }], {
      gates: { "T-00": GATES_FALLA },
      evidencia: { "T-00": [{ requirement: "funciona", requirementIndex: 0 }] },
    })

    const r = await diagnose(tmp)
    expect(r.fallas).toBeGreaterThan(0)
  })

  it("una card cerrada sin evidencia para un criterio", async () => {
    await escribirCorrida(
      [{ id: "T-00", acceptance: ["criterio uno", "criterio dos"] }],
      {
        gates: { "T-00": GATES_PASA },
        // Solo evidencia para el primer criterio.
        evidencia: { "T-00": [{ requirement: "criterio uno", requirementIndex: 0 }] },
      },
    )

    const r = await diagnose(tmp)
    expect(r.fallas).toBeGreaterThan(0)
  })

  it("una card sin evidencia ninguna", async () => {
    await escribirCorrida([{ id: "T-00", acceptance: ["criterio uno"] }], {
      gates: { "T-00": GATES_PASA },
    })

    const r = await diagnose(tmp)
    expect(r.fallas).toBeGreaterThan(0)
  })

  it("el owner que se aprueba a si mismo", async () => {
    await escribirCorrida([{ id: "T-00", owner: "e-mismo", reviewer: "e-mismo" }], {
      gates: { "T-00": GATES_PASA },
      evidencia: { "T-00": [{ requirement: "funciona", requirementIndex: 0 }] },
      roster: { "e-mismo": { id: "e-mismo", role: "dev" } },
    })

    const r = await diagnose(tmp)
    expect(r.fallas).toBeGreaterThan(0)
  })

  it("el owner que no existe en el roster (fantasma)", async () => {
    await escribirCorrida([{ id: "T-00", owner: "e-fantasma", reviewer: "e-rev" }], {
      gates: { "T-00": GATES_PASA },
      evidencia: { "T-00": [{ requirement: "funciona", requirementIndex: 0 }] },
      // El roster no tiene a e-fantasma.
      roster: { "e-rev": { id: "e-rev", role: "critico" } },
    })

    const r = await diagnose(tmp)
    expect(r.fallas).toBeGreaterThan(0)
  })

  it("una card que nunca empezo (sin owner) es aviso, no falla", async () => {
    await escribirCorrida(
      [{ id: "T-00", state: "todo", owner: null, reviewer: null }],
      { gates: {}, evidencia: {} },
    )

    const r = await diagnose(tmp)
    // No es una rotura del invariante: la card recien empieza.
    expect(r.fallas).toBe(0)
  })

  it("el presupuesto excedido", async () => {
    await escribirCorrida([{ id: "T-00" }], {
      gates: { "T-00": GATES_PASA },
      evidencia: { "T-00": [{ requirement: "funciona", requirementIndex: 0 }] },
    })

    // Se pisa el presupuesto a mano.
    const p = path.join(tmp, ".oficina", "state.json")
    const st = JSON.parse(await fs.readFile(p, "utf8"))
    st.budget.cardsUsed = 99
    await fs.writeFile(p, JSON.stringify(st, null, 2))

    const r = await diagnose(tmp)
    expect(r.fallas).toBeGreaterThan(0)
  })
})

describe("Diagnostico: sin corrida", () => {
  it("reporta que no hay corrida en vez de romperse", async () => {
    const r = await diagnose(tmp)
    expect(r.error).toBe("sin-corrida")
    expect(r.fallas).toBe(1)
  })
})
