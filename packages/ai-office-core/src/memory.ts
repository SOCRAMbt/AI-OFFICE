/**
 * Memoria episódica del proyecto: `.oficina/memory.md`.
 *
 * La oficina repetía los mismos errores entre corridas y no sabía que los
 * gates de una card ya se habían caído por lo mismo la vez pasada. La memoria
 * episódica es la lista de errores recurrentes, gates fallidos y patrones
 * aplicados, condensada en menos de 150 líneas.
 *
 * Reglas (en código, no en disciplina):
 *
 * - El archivo nunca excede 150 líneas. Si una entrada nueva lo supera, se
 *   descartan las entradas más viejas (FIFO).
 * - Solo hechos deterministas: resultado de gates, fingerprint de fallos,
 *   cierres de cards. Nada de prosa generada por el modelo.
 * - Se escribe bajo un lock propio (`wx`) para evitar collisiones de dos
 *   cards terminando a la vez.
 * - Se inyecta en cada dispatch nuevo (y en `/api/memory` del dashboard).
 *   La rotación es real: la próxima corrida lee la versión corta.
 */
import path from "node:path"
import fs from "node:fs/promises"
import { withWxLock } from "./atomic.js"
import { ensureDir, nowIso, readText, writeAtomic } from "./fsx.js"

const MAX_LINES = 150

export type MemoryEntryKind = "gate" | "failure" | "close" | "lesson"

export interface MemoryEntry {
  kind: MemoryEntryKind
  /** Card related (T-03) o global (run). */
  ref: string
  outcome: string
  detail: string
  at?: string
}

function memoryPath(officeDir: string): string {
  return path.join(officeDir, "memory.md")
}

/** Lee la memoria cruda. Devuelve [] si no existe. */
export async function loadMemory(officeDir: string): Promise<string[]> {
  const text = await readText(memoryPath(officeDir))
  if (!text) return []
  return text.split("\n").filter((l) => l.trim().length > 0)
}

/** Recorta la memoria a las últimas MAX_LINES líneas. */
async function rotate(officeDir: string): Promise<void> {
  const lines = await loadMemory(officeDir)
  if (lines.length <= MAX_LINES) return
  const kept = lines.slice(lines.length - MAX_LINES)
  await writeAtomic(memoryPath(officeDir), kept.join("\n") + "\n")
}

/** Agrega una entrada bajo lock propio. */
export async function appendEntry(officeDir: string, entry: MemoryEntry): Promise<void> {
  await ensureDir(officeDir)
  const at = entry.at ?? nowIso()
  const detail = entry.detail.replace(/\|/g, "/").replace(/\n/g, " ").slice(0, 160)
  const line = `- [${at}] ${entry.kind} | ${entry.ref} | ${entry.outcome} | ${detail}`
  await withWxLock(path.join(officeDir, ".memory.lock"), async () => {
    const lines = await loadMemory(officeDir)
    lines.push(line)
    const kept = lines.slice(-MAX_LINES)
    await writeAtomic(memoryPath(officeDir), kept.join("\n") + "\n")
  })
}

/** Registra el resultado de los gates de una card (máx. una línea por fase fallida). */
export async function recordGateOutcome(
  officeDir: string,
  cardId: string,
  gates: Array<{ phase: string; outcome: string; exitCode?: number | null; output?: string }>,
): Promise<void> {
  for (const g of gates) {
    if (g.outcome === "fail" || g.outcome === "not_run") {
      await appendEntry(officeDir, {
        kind: "gate",
        ref: cardId,
        outcome: `${g.phase}:${g.outcome}`,
        detail: (g.output ?? "").slice(0, 160).replace(/\s+/g, " "),
      })
    }
  }
}

/** Registra un fingerprint de fallo recurrente. */
export async function recordFailureFingerprint(
  officeDir: string,
  cardId: string,
  fingerprint: string,
  reason: string,
): Promise<void> {
  await appendEntry(officeDir, {
    kind: "failure",
    ref: cardId,
    outcome: `fingerprint:${fingerprint}`,
    detail: reason.slice(0, 160),
  })
}

/** Registra el cierre de una card (agent performance). */
export async function recordClose(officeDir: string, cardId: string, agentId: string): Promise<void> {
  await appendEntry(officeDir, {
    kind: "close",
    ref: cardId,
    outcome: "done",
    detail: `owner agent:${agentId}`,
  })
}

/** Resumen compacto (8 líneas) para inyectar en briefings y prompts. */
export async function memorySummary(officeDir: string, maxLines = 8): Promise<string> {
  const lines = await loadMemory(officeDir)
  if (lines.length === 0) return ""
  const kept = lines.slice(-maxLines)
  return [
    `Resumen de las últimas ${kept.length} lecciones del proyecto:`,
    ...kept,
  ].join("\n")
}
