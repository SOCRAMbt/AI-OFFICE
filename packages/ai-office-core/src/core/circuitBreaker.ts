/**
 * Circuit Breaker: anti-bucle para cards que fallan igual una y otra vez.
 *
 * El síntoma que motiva esto: una card caía de review a rework, el agente
 * reintentaba, volvía a fallar por lo mismo, y la auto-continuación lo seguía
 * respawnando hasta agotar tokens. Retry (3 golpes) no alcanza: hay que
 * detectar el error repetido.
 *
 * La regla, en código:
 *
 *   - fingerprint = sha256(mensaje normalizado SIN paths, números, hashes ni
 *     timestamps, más el exit code). Dos “Tests 3 failed” distintos de
 *     distintos caminos tienen el mismo fingerprint.
 *   - 3 fallos idénticos consecutivos → BLOCKED_ESCALATED (terminal).
 *   - 5 intentos totales acumulados → BLOCKED_ESCALATED (terminal).
 *
 * Al bloquearse: se libera el lease bajo `withRunLock`, se registra la causa
 * raíz y el historial de intentos en `artifacts/<id>/blocked.md`, y el resto
 * del DAG continúa — la corrida no se detiene por una card.
 */
import { createHash } from "node:crypto"
import type { Card } from "./types.js"
import { nowIso } from "./fsx.js"

export const MAX_CONSECUTIVE_IDENTICAL = 3
export const MAX_TOTAL_FAILURES = 5

/** Fingerprint determinista de un error. Normaliza antes de hashear. */
export function fingerprint(message: string, exitCode?: number | string | null): string {
  let s = (message ?? "").toLowerCase()
  // Paths absolutas de Windows y POSIX → placeholder (mismo error en otra máquina = mismo fingerprint).
  s = s.replace(/[a-z]:\\users\\[^\s'"]+/gi, "<winpath>")
  s = s.replace(/c:\\[^\s'"]+/gi, "<winpath>")
  s = s.replace(/(?:^|[\s('"`])\/[^\s'"]+/g, " <path>")
  // Strings literales → placeholder.
  s = s.replace(/"[^"]*"/g, "<str>").replace(/'[^']*'/g, "<str>")
  // Hashes largos → placeholder (SHAs, ids de corrida, tokens).
  s = s.replace(/\b[0-9a-f]{7,40}\b/g, "<hash>")
  // OJO: no normalizar secuencias de dígitos — "fix 1", "fix 2" son intentos
  // distintos. Se normalizan sólo el exit code y lo obviamente variable arriba.
  // Colapsar espacios.
  s = s.replace(/\s+/g, " ").trim()
  return createHash("sha256").update(`${s}|exit:${exitCode ?? ""}`).digest("hex").slice(0, 16)
}

export interface AttemptVerdict {
  /** ¿La card debe bloquearse? */
  blocked: boolean
  /** Intentos idénticos consecutivos con el mismo fingerprint. */
  consecutive: number
  /** Intentos totales acumulados de la card. */
  total: number
  fingerprint: string
}

/** Registra un fallo en la card y decide si bloquear. No muta el estado externo. */
export function recordFailure(
  card: Card,
  message: string,
  exitCode?: number | string | null,
): { card: Card; verdict: AttemptVerdict } {
  const fp = fingerprint(message, exitCode)
  const entry = { at: nowIso(), fingerprint: fp, message: message.slice(0, 200) }
  const history = [...(card.failureHistory ?? []), entry].slice(-20)
  const next = { ...card, failureHistory: history }

  let consecutive = 0
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]!.fingerprint === fp) consecutive++
    else break
  }
  const total = history.length
  return {
    card: next,
    verdict: {
      blocked: consecutive >= MAX_CONSECUTIVE_IDENTICAL || total >= MAX_TOTAL_FAILURES,
      consecutive,
      total,
      fingerprint: fp,
    },
  }
}

/** Texto de causa raíz para el artefacto blocked.md. */
export function blockReason(consecutive: number, total: number): string {
  if (total >= MAX_TOTAL_FAILURES) {
    return `Circuit breaker: ${total} intentos totales (líder de maxAttemptsPerCard=${MAX_TOTAL_FAILURES})`
  }
  return `Circuit breaker: ${consecutive} fallos idénticos consecutivos (fingerprint repetido; mismo error tres veces seguidas)`
}
