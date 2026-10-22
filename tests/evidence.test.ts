/**
 * Tests del Requirement-to-Evidence Graph.
 *
 * El módulo es puro y determinista: no hay IO, no hay reloj interno. Los
 * tests fijan el reloj con un valor constante justamente para que cualquier
 * regresión que introduzca `Date.now()` se note en vez de pasar por casualidad.
 */

import { describe, it, expect } from "vitest"
import {
  buildRequirementNodes,
  addEvidence,
  buildEvidenceGraph,
  renderEvidenceGraph,
  evidenceFromArtifact,
  evidenceFromTest,
  evidenceFromGate,
  evidenceFromInspection,
  evidenceFromAudit,
  evidenceFromExternal,
  canCloseCard,
  DEFAULT_REQUIRED_LEVEL,
  DEFAULT_RECORDED_AT,
  type EvidenceCard,
  type EvidenceGraph,
  type EvidenceNode,
} from "../src/core/evidence.js"

/** Reloj fijo: 2023-11-14T22:13:20.000Z. */
const FIXED_CLOCK = () => 1_700_000_000_000
const FIXED_AT = "2023-11-14T22:13:20.000Z"

/** Card mínima con tres criterios de aceptación. */
function makeCard(overrides: Partial<EvidenceCard> = {}): EvidenceCard {
  return {
    id: "T-00",
    acceptance: [
      "El login valida credenciales contra el backend",
      "La sesión expira a los 30 minutos de inactividad",
      "El botón de salida aparece en la esquina superior derecha",
    ],
    ...overrides,
  }
}

/** Atajo: grafo vacío de la card de prueba. */
function emptyGraph(overrides: Partial<EvidenceGraph> = {}): EvidenceGraph {
  const card = makeCard()
  return {
    cardId: card.id,
    requirements: buildRequirementNodes(card),
    missingMandatory: [],
    complete: false,
    minLevel: 0,
    summary: "",
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────────

describe("buildRequirementNodes", () => {
  it("crea un nodo por criterio de aceptación, en orden", () => {
    const nodes = buildRequirementNodes(makeCard())
    expect(nodes).toHaveLength(3)
    expect(nodes.map((n) => n.index)).toEqual([0, 1, 2])
    expect(nodes[0]!.requirement).toBe("El login valida credenciales contra el backend")
    expect(nodes[0]!.id).toBe("req-t-00-0")
    expect(nodes[0]!.cardId).toBe("T-00")
  })

  it("empieza sin evidencia, nivel 0 y estado unsatisfied", () => {
    const [first] = buildRequirementNodes(makeCard())
    expect(first!.evidence).toEqual([])
    expect(first!.reachedLevel).toBe(0)
    expect(first!.status).toBe("unsatisfied")
    expect(first!.risks).toEqual([])
  })

  it("marca los primeros 2 criterios como obligatorios y el resto no", () => {
    const nodes = buildRequirementNodes(makeCard())
    expect(nodes.map((n) => n.mandatory)).toEqual([true, true, false])
  })

  it("respeta mandatoryCount configurable", () => {
    const nodes = buildRequirementNodes(makeCard(), { mandatoryCount: 1 })
    expect(nodes.map((n) => n.mandatory)).toEqual([true, false, false])

    const todos = buildRequirementNodes(makeCard(), { mandatoryCount: 9 })
    expect(todos.every((n) => n.mandatory)).toBe(true)
  })

  it("respeta mandatoryIndexes explícitos, que ganan sobre mandatoryCount", () => {
    const nodes = buildRequirementNodes(makeCard(), { mandatoryIndexes: [2] })
    expect(nodes.map((n) => n.mandatory)).toEqual([false, false, true])
  })

  it("es determinista: dos llamadas dan el mismo resultado", () => {
    expect(buildRequirementNodes(makeCard())).toEqual(buildRequirementNodes(makeCard()))
  })
})

describe("addEvidence", () => {
  it("vincula la evidencia al requisito con el texto exacto", () => {
    const card = makeCard()
    const graph = addEvidence(
      emptyGraph(),
      evidenceFromTest("tests/login.test.ts", card.id, card.acceptance[0]!, {
        requirementIndex: 0,
        recordedAt: FIXED_AT,
      }),
    )
    expect(graph.requirements[0]!.evidence).toHaveLength(1)
    expect(graph.requirements[0]!.evidence[0]!.ref).toBe("tests/login.test.ts")
    expect(graph.requirements[1]!.evidence).toHaveLength(0)
  })

  it("vincula por índice cuando el texto no coincide y deja el riesgo visible", () => {
    const card = makeCard()
    const graph = addEvidence(
      emptyGraph(),
      evidenceFromTest("tests/otro.test.ts", card.id, "un texto que no es un criterio", {
        requirementIndex: 1,
        recordedAt: FIXED_AT,
      }),
    )
    expect(graph.requirements[1]!.evidence).toHaveLength(1)
    expect(graph.requirements[1]!.risks.join(" ")).toContain("no es el texto del criterio")
  })

  it("no muta el grafo recibido", () => {
    const before = emptyGraph()
    const after = addEvidence(
      before,
      evidenceFromTest("tests/login.test.ts", "T-00", "El login valida credenciales contra el backend", {
        requirementIndex: 0,
        recordedAt: FIXED_AT,
      }),
    )
    expect(before.requirements[0]!.evidence).toHaveLength(0)
    expect(after.requirements[0]!.evidence).toHaveLength(1)
  })

  it("sincroniza el flag mandatory de la evidencia con el del requisito", () => {
    const card = makeCard()
    const graph = addEvidence(
      emptyGraph(),
      evidenceFromTest("tests/x.test.ts", card.id, card.acceptance[2]!, {
        requirementIndex: 2,
        mandatory: true, // el dato viene mal: el requisito NO es obligatorio
        recordedAt: FIXED_AT,
      }),
    )
    expect(graph.requirements[2]!.evidence[0]!.mandatory).toBe(false)
  })

  it("deja la evidencia sin vincular en orphanedEvidence", () => {
    const graph = addEvidence(
      emptyGraph(),
      evidenceFromTest("tests/x.test.ts", "T-00", "criterio inexistente", {
        requirementIndex: 99,
        recordedAt: FIXED_AT,
      }),
    )
    expect(graph.orphanedEvidence).toHaveLength(1)
    expect(graph.requirements.every((r) => r.evidence.length === 0)).toBe(true)
  })
})

describe("Niveles y estado", () => {
  it("el nivel alcanzado sube con la evidencia: 0 -> 1 -> 2", () => {
    const card = makeCard()
    let graph = emptyGraph()
    expect(graph.requirements[0]!.reachedLevel).toBe(0)

    graph = addEvidence(
      graph,
      evidenceFromGate({ phase: "build", outcome: "pass" }, card.id, card.acceptance[0]!, {
        requirementIndex: 0,
        recordedAt: FIXED_AT,
      }),
    )
    expect(graph.requirements[0]!.reachedLevel).toBe(1)

    graph = addEvidence(
      graph,
      evidenceFromTest("tests/login.test.ts", card.id, card.acceptance[0]!, {
        requirementIndex: 0,
        recordedAt: FIXED_AT,
      }),
    )
    expect(graph.requirements[0]!.reachedLevel).toBe(2)
  })

  it("status unsatisfied cuando no hay evidencia", () => {
    const graph = emptyGraph()
    expect(graph.requirements[0]!.status).toBe("unsatisfied")
  })

  it("status partial cuando la evidencia no alcanza el nivel exigido", () => {
    const card = makeCard()
    const graph = addEvidence(
      emptyGraph(),
      evidenceFromGate({ phase: "build", outcome: "pass" }, card.id, card.acceptance[0]!, {
        requirementIndex: 0,
        recordedAt: FIXED_AT,
      }),
    )
    expect(graph.requirements[0]!.reachedLevel).toBe(1)
    expect(graph.requirements[0]!.status).toBe("partial")
  })

  it("status satisfied cuando la evidencia alcanza el nivel exigido", () => {
    const card = makeCard()
    const graph = addEvidence(
      emptyGraph(),
      evidenceFromTest("tests/login.test.ts", card.id, card.acceptance[0]!, {
        requirementIndex: 0,
        recordedAt: FIXED_AT,
      }),
    )
    expect(graph.requirements[0]!.status).toBe("satisfied")
  })

  it("una evidencia fallida no suma al nivel alcanzado y queda como riesgo", () => {
    const card = makeCard()
    const graph = addEvidence(
      emptyGraph(),
      evidenceFromGate({ phase: "test", outcome: "fail", detail: "1 test roto" }, card.id, card.acceptance[0]!, {
        requirementIndex: 0,
        recordedAt: FIXED_AT,
      }),
    )
    expect(graph.requirements[0]!.reachedLevel).toBe(0)
    expect(graph.requirements[0]!.status).toBe("unsatisfied")
    expect(graph.requirements[0]!.risks.join(" ")).toContain("documenta un fallo")
  })

  it("minLevel es el nivel más bajo entre los requisitos obligatorios", () => {
    const card = makeCard()
    let graph = emptyGraph()
    graph = addEvidence(
      graph,
      evidenceFromTest("tests/login.test.ts", card.id, card.acceptance[0]!, {
        requirementIndex: 0,
        recordedAt: FIXED_AT,
      }),
    )
    graph = addEvidence(
      graph,
      evidenceFromGate({ phase: "build", outcome: "pass" }, card.id, card.acceptance[1]!, {
        requirementIndex: 1,
        recordedAt: FIXED_AT,
      }),
    )
    expect(graph.minLevel).toBe(1)
  })

  it("minLevel es 0 si un obligatorio no tiene evidencia", () => {
    expect(emptyGraph().minLevel).toBe(0)
  })
})

describe("missingMandatory y complete", () => {
  it("detecta los requisitos obligatorios sin evidencia suficiente", () => {
    const card = makeCard()
    const graph = buildEvidenceGraph(
      card,
      [
        evidenceFromTest("tests/login.test.ts", card.id, card.acceptance[0]!, {
          requirementIndex: 0,
          recordedAt: FIXED_AT,
        }),
      ],
      { recordedAt: FIXED_AT },
    )
    expect(graph.missingMandatory).toEqual(["La sesión expira a los 30 minutos de inactividad"])
    expect(graph.complete).toBe(false)
  })

  it("complete es false cuando falta un obligatorio", () => {
    expect(emptyGraph().complete).toBe(false)
  })

  it("complete es true cuando todos los obligatorios están satisfied", () => {
    const card = makeCard()
    const graph = buildEvidenceGraph(
      card,
      [
        evidenceFromTest("tests/login.test.ts", card.id, card.acceptance[0]!, {
          requirementIndex: 0,
          recordedAt: FIXED_AT,
        }),
        evidenceFromTest("tests/session.test.ts", card.id, card.acceptance[1]!, {
          requirementIndex: 1,
          recordedAt: FIXED_AT,
        }),
      ],
      { recordedAt: FIXED_AT },
    )
    expect(graph.missingMandatory).toEqual([])
    expect(graph.complete).toBe(true)
    expect(graph.minLevel).toBe(2)
  })

  it("un requisito obligatorio con evidencia solo estática sigue faltando", () => {
    const card = makeCard()
    const graph = buildEvidenceGraph(
      card,
      [
        evidenceFromGate({ phase: "build", outcome: "pass" }, card.id, card.acceptance[0]!, {
          requirementIndex: 0,
          recordedAt: FIXED_AT,
        }),
      ],
      { recordedAt: FIXED_AT },
    )
    expect(graph.missingMandatory).toHaveLength(2)
    expect(graph.complete).toBe(false)
  })
})

describe("canCloseCard", () => {
  it("rechaza cuando falta evidencia obligatoria y dice qué falta", () => {
    const card = makeCard()
    const graph = buildEvidenceGraph(
      card,
      [
        evidenceFromTest("tests/login.test.ts", card.id, card.acceptance[0]!, {
          requirementIndex: 0,
          recordedAt: FIXED_AT,
        }),
      ],
      { recordedAt: FIXED_AT },
    )
    const verdict = canCloseCard(graph)
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toContain("La sesión expira a los 30 minutos de inactividad")
    expect(verdict.reason).toContain("Falta evidencia suficiente")
  })

  it("acepta cuando todo lo obligatorio tiene evidencia suficiente", () => {
    const card = makeCard()
    const graph = buildEvidenceGraph(
      card,
      [
        evidenceFromTest("tests/login.test.ts", card.id, card.acceptance[0]!, {
          requirementIndex: 0,
          recordedAt: FIXED_AT,
        }),
        evidenceFromTest("tests/session.test.ts", card.id, card.acceptance[1]!, {
          requirementIndex: 1,
          recordedAt: FIXED_AT,
        }),
      ],
      { recordedAt: FIXED_AT },
    )
    const verdict = canCloseCard(graph)
    expect(verdict.ok).toBe(true)
    expect(verdict.reason).toContain("evidencia suficiente")
  })

  it("rechaza si el nivel de la evidencia es insuficiente", () => {
    const card = makeCard()
    const graph = buildEvidenceGraph(
      card,
      [
        evidenceFromGate({ phase: "build", outcome: "pass" }, card.id, card.acceptance[0]!, {
          requirementIndex: 0,
          recordedAt: FIXED_AT,
        }),
        evidenceFromGate({ phase: "build", outcome: "pass" }, card.id, card.acceptance[1]!, {
          requirementIndex: 1,
          recordedAt: FIXED_AT,
        }),
      ],
      { recordedAt: FIXED_AT, requiredLevel: 3 },
    )
    const verdict = canCloseCard(graph)
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toMatch(/nivel/i)
  })

  it("rechaza cuando se exige un nivel más estricto que el del grafo", () => {
    const card = makeCard()
    const graph = buildEvidenceGraph(
      card,
      [
        evidenceFromTest("tests/login.test.ts", card.id, card.acceptance[0]!, {
          requirementIndex: 0,
          recordedAt: FIXED_AT,
        }),
        evidenceFromTest("tests/session.test.ts", card.id, card.acceptance[1]!, {
          requirementIndex: 1,
          recordedAt: FIXED_AT,
        }),
      ],
      { recordedAt: FIXED_AT },
    )
    expect(canCloseCard(graph).ok).toBe(true)
    const strict = canCloseCard(graph, { requiredLevel: 4 })
    expect(strict.ok).toBe(false)
    expect(strict.reason).toContain("4")
  })

  it("rechaza una card sin criterios de aceptación", () => {
    const graph = buildEvidenceGraph({ id: "T-99", acceptance: [] }, [])
    const verdict = canCloseCard(graph)
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toContain("criterios de aceptación")
  })

  it("permite cerrar una card sin criterios si el evaluador lo autoriza", () => {
    const graph = buildEvidenceGraph({ id: "T-99", acceptance: [] }, [])
    expect(canCloseCard(graph, { requireAcceptance: false }).ok).toBe(true)
  })
})

describe("Constructores de evidencia", () => {
  const card = makeCard()
  const req = card.acceptance[0]!

  it("evidenceFromArtifact construye un nodo artifact de nivel 2", () => {
    const node = evidenceFromArtifact(".oficina/artifacts/T-00/handoff.md", card.id, req, {
      requirementIndex: 0,
      recordedAt: FIXED_AT,
      recordedBy: "agent-1",
    })
    expect(node.kind).toBe("artifact")
    expect(node.level).toBe(2)
    expect(node.ref).toBe(".oficina/artifacts/T-00/handoff.md")
    expect(node.cardId).toBe("T-00")
    expect(node.recordedBy).toBe("agent-1")
    expect(node.recordedAt).toBe(FIXED_AT)
  })

  it("evidenceFromTest construye un nodo test de nivel 2", () => {
    const node = evidenceFromTest("tests/login.test.ts", card.id, req, {
      requirementIndex: 0,
      recordedAt: FIXED_AT,
    })
    expect(node.kind).toBe("test")
    expect(node.level).toBe(2)
    expect(node.ref).toBe("tests/login.test.ts")
  })

  it("un artefacto nunca puede subir de nivel 2, aunque se pida nivel 4", () => {
    const node = evidenceFromArtifact("handoff.md", card.id, req, { level: 4, recordedAt: FIXED_AT })
    expect(node.level).toBe(2)
  })

  it("evidenceFromGate: la fase de tests da nivel 2", () => {
    const node = evidenceFromGate({ phase: "test", outcome: "pass" }, card.id, req, {
      requirementIndex: 0,
      recordedAt: FIXED_AT,
    })
    expect(node.kind).toBe("gate")
    expect(node.level).toBe(2)
    expect(node.passed).toBe(true)
  })

  it("evidenceFromGate: la fase de build da nivel 1", () => {
    const node = evidenceFromGate({ phase: "build", outcome: "pass" }, card.id, req, {
      requirementIndex: 0,
      recordedAt: FIXED_AT,
    })
    expect(node.level).toBe(1)
    expect(node.ref).toBe("gate:build")
  })

  it("evidenceFromGate: un gate fallido queda como evidencia fallida", () => {
    const node = evidenceFromGate({ phase: "typecheck", outcome: "fail" }, card.id, req, {
      requirementIndex: 0,
      recordedAt: FIXED_AT,
    })
    expect(node.passed).toBe(false)
  })

  it("evidenceFromGate: de un gate completo cita la fase de tests", () => {
    const node = evidenceFromGate(
      {
        passed: true,
        technical: [
          { phase: "build", outcome: "pass" },
          { phase: "test", outcome: "pass" },
        ],
      },
      card.id,
      req,
      { requirementIndex: 0, recordedAt: FIXED_AT },
    )
    expect(node.level).toBe(2)
    expect(node.ref).toBe("gate:test")
  })

  it("una inspección manual es nivel 3", () => {
    const node = evidenceFromInspection("inspección del visor de logs", card.id, req, {
      requirementIndex: 0,
      owner: "agent-1",
      recordedAt: FIXED_AT,
    })
    expect(node.kind).toBe("inspection")
    expect(node.level).toBe(3)
  })

  it("una auditoría con reviewer distinto del owner es nivel 4", () => {
    const node = evidenceFromInspection("revisión del revisor", card.id, req, {
      requirementIndex: 0,
      owner: "agent-1",
      reviewer: "agent-2",
      recordedAt: FIXED_AT,
    })
    expect(node.level).toBe(4)
  })

  it("evidenceFromAudit exige owner y reviewer distintos", () => {
    expect(() =>
      evidenceFromAudit("revisión", card.id, req, { owner: "agent-1", reviewer: "agent-1" }),
    ).toThrow(/reviewer/)
    expect(() => evidenceFromAudit("revisión", card.id, req, {})).toThrow(/owner/)
  })

  it("la evidencia externa arranca en nivel 1", () => {
    const node = evidenceFromExternal("https://example.com/captura.png", card.id, req, {
      requirementIndex: 0,
      recordedAt: FIXED_AT,
    })
    expect(node.kind).toBe("external")
    expect(node.level).toBe(1)
  })
})

describe("renderEvidenceGraph", () => {
  it("produce markdown con los requisitos listados", () => {
    const card = makeCard()
    const graph = buildEvidenceGraph(
      card,
      [
        evidenceFromTest("tests/login.test.ts", card.id, card.acceptance[0]!, {
          requirementIndex: 0,
          recordedAt: FIXED_AT,
        }),
      ],
      { recordedAt: FIXED_AT },
    )
    const md = renderEvidenceGraph(graph)
    expect(md).toContain("# Grafo de evidencia — T-00")
    expect(md).toContain("El login valida credenciales contra el backend")
    expect(md).toContain("La sesión expira a los 30 minutos de inactividad")
    expect(md).toContain("| # | Requisito | Obligatorio | Estado | Nivel | Evidencia |")
    expect(md).toContain("tests/login.test.ts")
    expect(md).toContain("**Estado:** INCOMPLETO")
    expect(md).toContain("## Requisitos obligatorios pendientes")
  })

  it("lista la evidencia sin vincular", () => {
    const card = makeCard()
    const graph = buildEvidenceGraph(
      card,
      [evidenceFromTest("tests/x.test.ts", card.id, "criterio inexistente", { requirementIndex: 42 })],
      { recordedAt: FIXED_AT },
    )
    expect(renderEvidenceGraph(graph)).toContain("## Evidencia sin vincular")
  })
})

describe("Determinismo", () => {
  it("dos llamadas con el mismo clock dan el mismo resultado", () => {
    const card = makeCard()
    const evidence: EvidenceNode[] = [
      evidenceFromTest("tests/login.test.ts", card.id, card.acceptance[0]!, {
        requirementIndex: 0,
        recordedBy: "agent-1",
        clock: FIXED_CLOCK,
      }),
      evidenceFromGate({ phase: "test", outcome: "pass" }, card.id, card.acceptance[1]!, {
        requirementIndex: 1,
        recordedBy: "agent-2",
        clock: FIXED_CLOCK,
      }),
    ]
    const a = buildEvidenceGraph(card, evidence, { clock: FIXED_CLOCK })
    const b = buildEvidenceGraph(card, evidence, { clock: FIXED_CLOCK })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(a.requirements[0]!.evidence[0]!.recordedAt).toBe(FIXED_AT)
  })

  it("sin reloj inyectado usa el epoch fijo, no la hora del sistema", () => {
    const node = evidenceFromTest("tests/login.test.ts", "T-00", "req")
    expect(node.recordedAt).toBe(DEFAULT_RECORDED_AT)
  })

  it("los ids de evidencia son estables y distintos por requisito", () => {
    const card = makeCard()
    const a = evidenceFromTest("tests/login.test.ts", card.id, card.acceptance[0]!, { requirementIndex: 0 })
    const b = evidenceFromTest("tests/login.test.ts", card.id, card.acceptance[1]!, { requirementIndex: 1 })
    expect(a.id).not.toBe(b.id)
    expect(a.id).toBe(evidenceFromTest("tests/login.test.ts", card.id, card.acceptance[0]!, { requirementIndex: 0 }).id)
  })

  it("el nivel exigido por defecto es 2", () => {
    expect(DEFAULT_REQUIRED_LEVEL).toBe(2)
    expect(emptyGraph().requiredLevel).toBeUndefined()
  })
})
