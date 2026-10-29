/**
 * Pruebas de recuperacion.
 *
 * Cada test simula una interrupcion en un momento critico y verifica que la
 * oficina puede **detectar** la incoherencia (y a veces repararla sola).
 *
 * Los escenarios salen del review:
 *   - Un proceso muere justo despues de modificar un archivo, pero antes de
 *     registrar su entrega.
 *   - El sistema se reinicia durante una transicion de estado.
 *   - Una tarea queda bloqueada por una dependencia que nunca se resuelve.
 *   - Una reanudacion automatica repite una operacion que ya tuvo efectos.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { Office } from "../src/core/office.js"
import { reconcile, inferCardStateFromDisk } from "../src/core/recovery.js"
import { DEFAULT_LIMITS, type OfficeState, StateCorruptionError } from "../src/core/types.js"

let tmp: string
let office: Office

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-recovery-"))
  await fs.writeFile(path.join(tmp, "package.json"), JSON.stringify({ name: "x", scripts: { test: "true" } }))
  office = new Office({ cwd: tmp, limits: DEFAULT_LIMITS })
  await office.init()
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

/** Crea una corrida de una card. */
async function planOneCard(): Promise<OfficeState> {
  const state = await office.loadState("Objetivo de prueba")
  await office.savePlan(state, [
    {
      title: "Trabajo",
      type: "implementation",
      requiredCapabilities: ["react"],
      scope: { mayTouch: ["src/**"], forbidden: [] },
      acceptance: ["funciona"],
      gate: "npm test",
    },
  ])
  return office.loadState("Objetivo de prueba")
}

/**
 * Registra un agente en el roster.
 *
 * ## Por qué hace falta
 *
 * Una card con `owner` apunta a un agente. Si ese agente no esta en el
 * roster, la card esta "trabajando" con alguien que no existe: nadie la
 * va a terminar y nadie lo va a notar.
 *
 * Los tests que declaraban un owner sin registrarlo describian, sin
 * querer, una corrida rota. Ahora la reconciliacion lo detecta — y el
 * fixture tiene que ser honesto.
 */
async function registerAgent(state: OfficeState, id = "e-trabajador"): Promise<void> {
  const roster = await office.loadRoster(state.runId)
  roster.agents[id] = {
    id,
    role: "frontend-developer",
    displayName: "Frontend",
    state: "working",
    capabilities: ["react"],
    fichaPath: "",
    currentCard: "T-00",
    lease: null,
    idleSince: null,
    canAccept: false,
    helpGiven: 0,
    helpReceived: 0,
    helpedPeers: [],
    lastHeartbeat: new Date().toISOString(),
    source: { kind: "factory" },
  }
  await office.saveRoster(roster)
}

describe("Reconciliacion: entregas perdidas", () => {
  it("detecta una card en review sin handoff (el agente murio al entregar)", async () => {
    const state = await planOneCard()
    state.cards["T-00"]!.state = "review"
    await office.saveState(state)

    const report = await reconcile(office, { autoRepair: false })
    const issue = report.issues.find((i) => i.kind === "review-without-artifacts")
    expect(issue).toBeDefined()
    expect(issue!.cardId).toBe("T-00")
    expect(report.healthy).toBe(true) // es warning, no critico
  })

  it("detecta una card en review sin evidencia", async () => {
    const state = await planOneCard()
    state.cards["T-00"]!.state = "review"
    await office.saveState(state)
    await fs.mkdir(path.join(tmp, ".oficina", "artifacts", "T-00"), { recursive: true })
    await fs.writeFile(path.join(tmp, ".oficina", "artifacts", "T-00", "handoff.md"), "hecho")

    const report = await reconcile(office, { autoRepair: false })
    expect(report.issues.some((i) => i.kind === "review-without-evidence")).toBe(true)
  })

  it("infiere que la entrega existe en disco aunque la card no la registre", async () => {
    await planOneCard()
    const dir = path.join(tmp, ".oficina", "artifacts", "T-00")
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, "handoff.md"), "hecho")
    await fs.writeFile(path.join(dir, "evidence.md"), "npm test: 3 passed")

    expect(await inferCardStateFromDisk(office, "T-00")).toBe("deliverable")
  })

  it("una card sin artefactos es unknown", async () => {
    await planOneCard()
    expect(await inferCardStateFromDisk(office, "T-00")).toBe("unknown")
  })
})

describe("Reconciliacion: invariantes vulnerados", () => {
  it("detecta una card en done sin gates.md como CRITICO", async () => {
    const state = await planOneCard()
    state.cards["T-00"]!.state = "done"
    await office.saveState(state)

    const report = await reconcile(office, { autoRepair: false })
    const issue = report.issues.find((i) => i.kind === "done-without-gate")
    expect(issue).toBeDefined()
    expect(issue!.severity).toBe("critical")
    expect(report.healthy).toBe(false)
  })

  it("detecta una card en progreso sin owner como CRITICO", async () => {
    const state = await planOneCard()
    state.cards["T-00"]!.state = "in_progress"
    state.cards["T-00"]!.owner = null
    await office.saveState(state)

    const report = await reconcile(office, { autoRepair: false })
    const issue = report.issues.find((i) => i.kind === "card-in-progress-without-owner")
    expect(issue).toBeDefined()
    expect(issue!.severity).toBe("critical")
  })

  it("detecta una card bloqueada por una dependencia que no se resuelve", async () => {
    const state = await office.loadState("Objetivo")
    await office.savePlan(state, [
      {
        title: "Base",
        type: "implementation",
        requiredCapabilities: ["react"],
        scope: { mayTouch: ["src/**"], forbidden: [] },
        acceptance: ["funciona"],
        gate: "npm test",
      },
      {
        title: "Depende de la base",
        type: "implementation",
        requiredCapabilities: ["react"],
        scope: { mayTouch: ["src/**"], forbidden: [] },
        acceptance: ["funciona"],
        gate: "npm test",
        dependsOn: ["T-00"],
      },
    ])
    const after = await office.loadState("Objetivo")
    expect(after.cards["T-01"]).toBeDefined()
    after.cards["T-01"]!.state = "blocked"
    await office.saveState(after)

    const report = await reconcile(office, { autoRepair: false })
    expect(report.issues.some((i) => i.kind === "blocked-by-unresolvable-dependency")).toBe(true)
  })
})

describe("Reconciliacion: huerfanos", () => {
  it("detecta artefactos de una card que no existe", async () => {
    await planOneCard()
    const dir = path.join(tmp, ".oficina", "artifacts", "T-99")
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, "handoff.md"), "fantasma")

    const report = await reconcile(office, { autoRepair: false })
    expect(report.issues.some((i) => i.kind === "orphaned-artifact")).toBe(true)
  })

  it("detecta un lease de una card que no existe", async () => {
    await planOneCard()
    await office.leases.acquire("T-99", "e-fantasma")

    const report = await reconcile(office, { autoRepair: false })
    expect(report.issues.some((i) => i.kind === "stale-lease")).toBe(true)
  })

  it("libera un lease huerfano cuando autoRepair esta activo", async () => {
    await planOneCard()
    await office.leases.acquire("T-99", "e-fantasma")

    const report = await reconcile(office, { autoRepair: true })
    expect(report.issues.find((i) => i.kind === "stale-lease")!.repaired).toBe(true)
  })

  it("no repara nada en dryRun", async () => {
    await planOneCard()
    await office.leases.acquire("T-99", "e-fantasma")

    const report = await reconcile(office, { autoRepair: true, dryRun: true })
    expect(report.issues.find((i) => i.kind === "stale-lease")!.repaired).toBe(false)
  })

  it("libera al agente que sigue working sobre una card terminada", async () => {
    const state = await planOneCard()
    const roster = await office.loadRoster(state.runId)
    roster.agents["e-trabajador"] = {
      id: "e-trabajador",
      role: "frontend-developer",
      displayName: "Frontend",
      state: "working",
      capabilities: ["react"],
      fichaPath: "",
      currentCard: "T-00",
      lease: null,
      idleSince: null,
      canAccept: false,
      helpGiven: 0,
      helpReceived: 0,
      helpedPeers: [],
      lastHeartbeat: new Date().toISOString(),
      source: { kind: "factory" },
    }
    await office.saveRoster(roster)
    state.cards["T-00"]!.state = "done"
    await office.saveState(state)

    const report = await reconcile(office, { autoRepair: true })
    const issue = report.issues.find((i) => i.kind === "agent-still-working-on-done-card")
    expect(issue).toBeDefined()
    expect(issue!.repaired).toBe(true)

    const after = await office.loadRoster(state.runId)
    expect(after.agents["e-trabajador"]!.state).toBe("idle_available")
    expect(after.agents["e-trabajador"]!.currentCard).toBeNull()
  })
})

describe("Reconciliacion: corrida sana", () => {
  it("una corrida consistente no reporta nada", async () => {
    const state = await planOneCard()
    state.cards["T-00"]!.state = "in_progress"
    state.cards["T-00"]!.owner = "e-trabajador"
    await office.saveState(state)
    await registerAgent(state)

    const report = await reconcile(office, { autoRepair: false })
    expect(report.issues).toHaveLength(0)
    expect(report.healthy).toBe(true)
    expect(report.summary).toContain("consistente")
  })
})

describe("Reconciliacion: el owner tiene que existir", () => {
  it("detecta una card cuyo owner no esta en el roster", async () => {
    const state = await planOneCard()
    state.cards["T-00"]!.state = "in_progress"
    state.cards["T-00"]!.owner = "e-fantasma"
    await office.saveState(state)
    // A proposito: NO se registra el agente en el roster.

    const report = await reconcile(office, { autoRepair: false })
    const issue = report.issues.find((i) => i.kind === "card-in-progress-without-owner")
    expect(issue).toBeDefined()
    expect(issue!.cardId).toBe("T-00")
    expect(issue!.severity).toBe("critical")
    // Critico significa que la corrida NO esta sana.
    expect(report.healthy).toBe(false)
  })

  it("una card sin owner no dispara la alarma", async () => {
    const state = await planOneCard()
    state.cards["T-00"]!.state = "todo"
    await office.saveState(state)

    const report = await reconcile(office, { autoRepair: false })
    expect(report.issues.find((i) => i.kind === "card-in-progress-without-owner")).toBeUndefined()
  })
})

describe("Reinicio a mitad de una transicion", () => {
  it("el estado sobrevive a un reinicio sin corromperse", async () => {
    const state = await planOneCard()
    state.cards["T-00"]!.state = "in_progress"
    state.cards["T-00"]!.owner = "e-trabajador"
    await office.saveState(state)

    // "Reinicio": otra instancia de Office lee del mismo disco.
    const otra = new Office({ cwd: tmp, limits: DEFAULT_LIMITS })
    await otra.init()
    const recargado = await otra.loadState("Objetivo de prueba")

    expect(recargado.cards["T-00"]!.state).toBe("in_progress")
    expect(recargado.cards["T-00"]!.owner).toBe("e-trabajador")
  })

  it("un JSON corrupto se pone en cuarentena y lanza StateCorruptionError", async () => {
    const state = await planOneCard()
    await office.saveState(state)
    await fs.writeFile(path.join(tmp, ".oficina", "state.json"), "{ esto no es json")

    const otra = new Office({ cwd: tmp, limits: DEFAULT_LIMITS })
    await otra.init()
    
    // Debe lanzar StateCorruptionError, no crear una corrida nueva silenciosamente
    await expect(otra.loadState("Objetivo de prueba")).rejects.toThrow(StateCorruptionError)
    
    // Verificar que el archivo corrupto fue puesto en cuarentena
    const quarantineFiles = await fs.readdir(path.join(tmp, ".oficina"))
    const corruptFiles = quarantineFiles.filter(f => f.startsWith("state.json.corrupt-"))
    expect(corruptFiles.length).toBe(1)
  })
})
