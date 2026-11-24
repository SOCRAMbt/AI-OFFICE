import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import {
  appendEntry,
  loadMemory,
  memorySummary,
  recordGateOutcome,
  recordFailureFingerprint,
} from "../src/core/memory.js"

let tmp: string
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-memory-"))
})
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe("appendEntry: rotación FIFO con tope 150 líneas", () => {
  it("nunca excede 150 líneas; las entradas viejas se van primero", async () => {
    for (let i = 0; i < 165; i++) {
      await appendEntry(tmp, { kind: "close", ref: `T-${String(i).padStart(3, "0")}`, outcome: "done", detail: `iter ${i}` })
    }
    const lines = await loadMemory(tmp)
    expect(lines.length).toBeLessThanOrEqual(150)
    const joined = lines.join("\n")
    expect(joined).not.toContain("iter 0")
    expect(joined).toContain("iter 164")
  })

  it("el primer write crea el archivo y la memoria arranca vacía si no existe", async () => {
    expect(await loadMemory(tmp)).toEqual([])
  })
})

describe("recordGateOutcome: registra solo fases fallidas, comprimido", () => {
  it("escribe una línea por cada fase fail o not_run, ninguna por pass", async () => {
    await recordGateOutcome(tmp, "T-01", [
      { phase: "build", outcome: "pass", exitCode: 0, output: "ok" },
      { phase: "test", outcome: "fail", exitCode: 1, output: "Tests 2 failed" },
      { phase: "lint", outcome: "not_run", exitCode: null, output: "no lint script" },
    ])
    const lines = await loadMemory(tmp)
    expect(lines).toHaveLength(2)
    expect(lines.join("\n")).toContain("T-01")
    expect(lines.join("\n")).toContain("test:fail")
    expect(lines.join("\n")).toContain("not_run")
    expect(lines.join("\n")).not.toContain("build")
  })
})

describe("memorySummary: resumen acotado para briefings", () => {
  it("devuelve como mucho N líneas + encabezado", async () => {
    for (let i = 0; i < 20; i++) {
      await appendEntry(tmp, { kind: "close", ref: `T-${i}`, outcome: "done", detail: `d${i}` })
    }
    const s = await memorySummary(tmp, 8)
    const lines = s.split("\n").filter((l) => l.trim())
    expect(lines.length).toBeLessThanOrEqual(9)
    expect(s).toContain("lecciones")
  })
})

describe("recordFailureFingerprint: mantiene la historia de errores recurrentes", () => {
  it("guarda el fingerprint para reconocer el mismo error la próxima corrida", async () => {
    await recordFailureFingerprint(tmp, "T-02", "abc1234567890def", "Tests 2 failed")
    const lines = await loadMemory(tmp)
    expect(lines.join("\n")).toContain("abc1234567890def")
    expect(lines.join("\n")).toContain("T-02")
  })
})
