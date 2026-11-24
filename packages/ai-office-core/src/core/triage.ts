/**
 * Auto-triage: cuándo degradar a Modo Célula (`/oficina lite`).
 *
 * La oficina completa vale la pena cuando el objetivo toca varios módulos o
 * arrastra dependencias. Para una tarea chica y aislada, el protocolo una-sola-
 * card (un Ejecutor + un Revisor Cruzado) alcanza: menos latencia, menos tokens,
 * mismo owner≠reviewer.
 *
 * La regla es determinista — nada de "la IA decide":
 *
 *   tool calls con 1 card ∧ objetivo corto ∧ ≤3 criterios ∧ sin palabra de
 *   replan/migración/arquitectura → lite
 *
 * Si el usuario pasa --full, nunca degrada.
 */

export type LiteInput = {
  objective: string
  cards: Array<{ acceptance: string[]; scope?: { mayTouch?: string[] } }>
}

export function shouldUseLite(input: LiteInput): { useLite: boolean; reason: string } {
  if (input.cards.length !== 1) {
    return { useLite: false, reason: `${input.cards.length} cards: requiere modo Full` }
  }
  const objective = input.objective.trim().toLowerCase()
  if (objective.length > 140) {
    return { useLite: false, reason: "objetivo largo (>140 chars): requiere más contexto que el Modo Célula" }
  }
  const card = input.cards[0]!
  if (card.acceptance.length > 3) {
    return { useLite: false, reason: "más de 3 criterios de aceptación: no es una tarea chica" }
  }
  const needsHeavy = /refactor|refactoriz|migrat|arquita|arquitect|cross.?module|transversal|restructur|renombrar masivo|todo el monorepo|reestructura/i
  if (needsHeavy.test(objective)) {
    return { useLite: false, reason: "objetivo transversal/arquitectónico: descartado auto-degradación" }
  }
  return { useLite: true, reason: "tarea chica y aislada: Modo Célula (1 Ejecutor + 1 Revisor Cruzado)" }
}

export function normalizeModeArg(mode?: string): "full" | "lite" | "auto" {
  const m = (mode ?? "auto").toLowerCase()
  if (m === "lite") return "lite"
  if (m === "full") return "full"
  return "auto"
}
