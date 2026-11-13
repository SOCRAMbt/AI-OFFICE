/**
 * Dashboard: tests de integración HTTP contra el server real (node server.mjs).
 *
 * Lanza el servidor como proceso hijo contra un .oficina temporal de fixture,
 * y comprueba el contrato de /api/state,/api/memory,/api/artifacts (traversal),
 * /api/gates y la cabecera SSE. Sin mocks del servidor.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { spawn, type ChildProcess } from "node:child_process"

let tmp: string
let child: ChildProcess | undefined
let port: number

async function waitForServer(url: string, tries = 50): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url)
      if (r.ok) return
    } catch {
      // todavía no escucha
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error("server no arrancó en tiempo")
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-dashboard-"))
  const offDir = path.join(tmp, ".oficina")
  await fs.mkdir(path.join(offDir, "bus", "peer"), { recursive: true })
  await fs.mkdir(path.join(offDir, "artifacts", "T-00"), { recursive: true })
  await fs.writeFile(
    path.join(offDir, "state.json"),
    JSON.stringify({
      runId: "run-test",
      objective: "fixture objective",
      status: "running",
      mode: "lite",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      cards: {
        "T-00": {
          id: "T-00", title: "fixture card", type: "testing", state: "done", owner: "e-1", reviewer: "e-2",
          requiredCapabilities: [], scope: { mayTouch: ["**"], forbidden: [] }, acceptance: ["ok"], gate: "npm test",
          dependsOn: [], attempts: 1, rejections: 0, artifacts: ".oficina/artifacts/T-00", result: "done",
          helpRequests: [], helpHops: 0,
        },
      },
      order: ["T-00"],
      decisions: [],
      escalations: [],
      context: { decisions: [], constraints: [], pieces: [], traps: [], open: [] },
      iteration: 0,
      pendingGates: [], sessionMarker: 0, sessions: {},
    }),
  )
  await fs.writeFile(
    path.join(offDir, "roster.json"),
    JSON.stringify({
      version: 2, runId: "run-test", updatedAt: new Date().toISOString(),
      agents: {
        "e-1": {
          id: "e-1", role: "developer", displayName: "Dev", state: "working", capabilities: ["testing"],
          fichaPath: "", currentCard: "T-00", lease: null, idleSince: null, canAccept: false,
          helpGiven: 0, helpReceived: 0, helpedPeers: [], canDelegate: true,
          lastHeartbeat: new Date().toISOString(), source: { kind: "factory" },
        },
      },
    }),
  )
  await fs.writeFile(path.join(offDir, "memory.md"), "- [2026-11-13T00:00:00.000Z] close | T-00 | done | owner agent:e-1\n")
  await fs.writeFile(
    path.join(offDir, "bus", "peer", "0001-m-test.json"),
    JSON.stringify({ id: "m-test", kind: "NOTICE", from: "e-1", to: ["integrator"], subject: "ping", body: {}, seq: 1 }),
  )
  await fs.writeFile(
    path.join(offDir, "artifacts", "T-00", "gates.md"),
    ["| # | Fase | Comando | Resultado | Detalle |", "|---|---|---|---|", "| 1 | Build | npm run build | PASS | exit 0 |", "| 4 | Tests | npm test | FAIL | 2 failed |"].join("\n"),
  )

  port = 4300 + Math.floor(Math.random() * 200)
  child = spawn(process.execPath, [path.resolve(process.cwd(), "dashboard", "server.mjs"), "--oficina", path.join(tmp, ".oficina"), "--no-open", "--port", String(port)], { stdio: "ignore" })
  await waitForServer(`http://127.0.0.1:${port}/api/state`)
})

afterEach(async () => {
  if (child) {
    child.kill("SIGTERM")
    child = undefined
  }
  await fs.rm(tmp, { recursive: true, force: true })
})

describe("Dashboard server: contrato HTTP", () => {
  it("/api/state devuelve objetivo, modo, cards, agents y bus", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/state`)
    expect(res.status).toBe(200)
    const data = await res.json() as Record<string, unknown>
    expect(data.objective).toBe("fixture objective")
    expect(data.mode).toBe("lite")
    expect(Object.keys(data.cards as object)).toContain("T-00")
    expect(Object.keys(data.agents as object)).toContain("e-1")
    expect(Array.isArray(data.bus)).toBe(true)
    expect((data.bus as unknown[]).length).toBeGreaterThan(0)
  })

  it("/api/memory devuelve el markdown de la memoria", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/memory`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain("close | T-00")
  })

  it("/api/artifacts rechaza cards con caracteres inseguros", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/artifacts?card=../../etc`)
    expect([400, 404]).toContain(res.status)
  })

  it("/api/gates agrega el conteo de gates por card", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/gates`)
    expect(res.status).toBe(200)
    const data = await res.json() as { cards: Array<{ cardId: string; gates: Array<{ phase: string; status: string }> }> }
    const t00 = data.cards.find((c) => c.cardId === "T-00")
    expect(t00).toBeDefined()
    expect(t00!.gates.length).toBeGreaterThanOrEqual(1)
    expect(t00!.gates.some((g) => g.status === "fail")).toBe(true)
  })

  it("/api/events responde con Content-Type SSE y cabecera retry", async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 800)
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/events`, { signal: controller.signal })
      expect(res.status).toBe(200)
      expect(res.headers.get("content-type")).toMatch(/text\/event-stream/)
      const reader = res.body?.getReader()
      const first = await reader?.read()
      const textChunk = new TextDecoder().decode(first?.value)
      expect(textChunk).toContain("retry:")
    } catch (err) {
      // abort esperado después de leer la cabecera
      expect(String(err)).toMatch(/abort/i)
    } finally {
      clearTimeout(timer)
    }
  })
})
