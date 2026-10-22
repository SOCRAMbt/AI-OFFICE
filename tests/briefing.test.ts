import { describe, it, expect } from "vitest"
import {
  buildBriefing,
  renderBriefing,
  renderBriefingPrompt,
  BRIEFING_SECTIONS,
  type BriefingContext,
} from "../src/core/briefing.js"
import type { Card, Ficha } from "../src/core/types.js"

function makeFicha(overrides: Partial<Ficha> = {}): Ficha {
  return {
    id: "e-frontend",
    role: "frontend-developer",
    displayName: "Frontend Developer",
    source: {
      kind: "agency-agents",
      division: "engineering",
      path: "engineering/frontend-developer.md",
      vibe: "Pixel obsessive.",
      missions: ["Build Accessible Components"],
    },
    capabilities: ["react", "css", "accessibility"],
    tools: ["read", "edit", "write"],
    scope: { mayTouch: ["src/components/**"], forbidden: ["src/server/**"] },
    canDelegate: true,
    delegateBudget: 2,
    peers: ["e-qa"],
    mustNot: ["no aprobar tu propio trabajo"],
    onFinish: "idle-join",
    escalateTo: "integrator",
    ...overrides,
  }
}

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: "T-02",
    title: "Implementar el componente de login",
    type: "implementation",
    state: "todo",
    owner: "e-frontend",
    reviewer: "e-critico",
    requiredCapabilities: ["react"],
    scope: { mayTouch: ["src/components/**"], forbidden: ["src/server/**"] },
    acceptance: ["El componente renderiza", "Tiene test de accesibilidad"],
    gate: "npm test en verde",
    dependsOn: [],
    attempts: 0,
    rejections: 0,
    artifacts: ".oficina/artifacts/T-02",
    result: null,
    helpRequests: [],
    helpHops: 0,
    ...overrides,
  }
}

function makeContext(overrides: Partial<BriefingContext> = {}): BriefingContext {
  return {
    ficha: makeFicha(),
    card: makeCard(),
    objective: "Agregar login",
    knownDecisions: ["Se usa React 18 con Vite"],
    knownConstraints: ["No se pueden agregar dependencias"],
    builtPieces: ["src/components/Button.tsx"],
    knownTraps: ["src/server/session.ts está muerto, no borrar"],
    openQuestions: ["Falta decidir si el login hace redirect o abre modal"],
    peers: [
      {
        id: "e-qa",
        role: "qa-engineer",
        displayName: "QA",
        state: "idle_available",
        capabilities: ["testing", "playwright"],
        fichaPath: "",
        currentCard: null,
        lease: null,
        idleSince: null,
        canAccept: true,
        helpGiven: 0,
        helpReceived: 0,
        helpedPeers: [],
        lastHeartbeat: new Date().toISOString(),
        source: { kind: "factory" },
      },
    ],
    coordinatorId: "integrator",
    ...overrides,
  }
}

describe("Estructura del briefing", () => {
  it("tiene 10 secciones con orden fijo y único", () => {
    expect(BRIEFING_SECTIONS).toHaveLength(10)
    const orders = BRIEFING_SECTIONS.map((s) => s.order)
    expect(orders).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(new Set(BRIEFING_SECTIONS.map((s) => s.id)).size).toBe(10)
  })

  it("todas las secciones son requeridas: ese es el mínimo", () => {
    expect(BRIEFING_SECTIONS.every((s) => s.required)).toBe(true)
  })

  it("el orden va de lo estable a lo cambiante", () => {
    const ids = BRIEFING_SECTIONS.map((s) => s.id)
    expect(ids.indexOf("identidad")).toBeLessThan(ids.indexOf("mision"))
    expect(ids.indexOf("mision")).toBeLessThan(ids.indexOf("contexto-conocido"))
    expect(ids.indexOf("contexto-conocido")).toBeLessThan(ids.indexOf("territorio"))
    expect(ids.indexOf("territorio")).toBeLessThan(ids.indexOf("protocolo"))
    expect(ids.indexOf("protocolo")).toBeLessThan(ids.indexOf("calidad"))
    expect(ids.indexOf("calidad")).toBeLessThan(ids.indexOf("exito"))
  })
})

describe("Contenido del briefing", () => {
  it("se construye completo cuando hay contexto", () => {
    const briefing = buildBriefing(makeContext())
    expect(briefing.complete).toBe(true)
    expect(briefing.missing).toHaveLength(0)
    expect(briefing.sections).toHaveLength(10)
  })

  it("la identidad dice de dónde viene la especialidad", () => {
    const briefing = buildBriefing(makeContext())
    const identity = briefing.sections.find((s) => s.id === "identidad")!
    expect(identity.content).toContain("Frontend Developer")
    expect(identity.content).toContain("agency-agents")
    expect(identity.content).toContain("Pixel obsessive.")
  })

  it("la misión lista los criterios de aceptación numerados y el gate", () => {
    const briefing = buildBriefing(makeContext())
    const mission = briefing.sections.find((s) => s.id === "mision")!
    expect(mission.content).toContain("T-02")
    expect(mission.content).toContain("1. El componente renderiza")
    expect(mission.content).toContain("2. Tiene test de accesibilidad")
    expect(mission.content).toContain("npm test en verde")
  })

  it("el contexto conocido incluye decisiones, constraints, piezas y trampas", () => {
    const briefing = buildBriefing(makeContext())
    const known = briefing.sections.find((s) => s.id === "contexto-conocido")!
    expect(known.content).toContain("React 18")
    expect(known.content).toContain("No se pueden agregar dependencias")
    expect(known.content).toContain("Button.tsx")
    expect(known.content).toContain("session.ts está muerto")
  })

  it("el contexto desconocido dice a quién preguntarle", () => {
    const briefing = buildBriefing(makeContext())
    const unknown = briefing.sections.find((s) => s.id === "contexto-desconocido")!
    expect(unknown.content).toContain("redirect o abre modal")
    expect(unknown.content).toContain("e-qa")
    expect(unknown.content).toContain("qa-engineer")
  })

  it("el territorio lista lo que se puede y lo que no", () => {
    const briefing = buildBriefing(makeContext())
    const territory = briefing.sections.find((s) => s.id === "territorio")!
    expect(territory.content).toContain("src/components/**")
    expect(territory.content).toContain("src/server/**")
    expect(territory.content).toContain("no aprobar tu propio trabajo")
  })

  it("el protocolo dice cuándo pedir ayuda, delegar y escalar", () => {
    const briefing = buildBriefing(makeContext())
    const protocol = briefing.sections.find((s) => s.id === "protocolo")!
    expect(protocol.content).toContain("HELP_REQUEST")
    expect(protocol.content).toContain("SPAWN_REQUEST")
    expect(protocol.content).toContain("antes de empezar")
    expect(protocol.content).toContain("e-critico")
  })

  it("el bus explica el canal, el formato y el TTL", () => {
    const briefing = buildBriefing(makeContext())
    const bus = briefing.sections.find((s) => s.id === "bus")!
    expect(bus.content).toContain("inbox/e-frontend")
    expect(bus.content).toContain("HELP_REQUEST")
    expect(bus.content).toContain("900")
  })

  it("la calidad exige handoff Y evidencia", () => {
    const briefing = buildBriefing(makeContext())
    const quality = briefing.sections.find((s) => s.id === "calidad")!
    expect(quality.content).toContain("handoff.md")
    expect(quality.content).toContain("evidence.md")
    expect(quality.content).toContain("salida **real**")
  })

  it("los límites están marcados como código, no como criterio", () => {
    const briefing = buildBriefing(makeContext())
    const limits = briefing.sections.find((s) => s.id === "limites")!
    expect(limits.content).toContain("están en código")
    expect(limits.content).toContain("no aprobar tu propio trabajo")
  })

  it("el éxito define las tres condiciones de terminado", () => {
    const briefing = buildBriefing(makeContext())
    const success = briefing.sections.find((s) => s.id === "exito")!
    expect(success.content).toContain("criterios de aceptación")
    expect(success.content).toContain("pasa")
    expect(success.content).toContain("handoff.md")
  })
})

describe("Los 4 artefactos", () => {
  it("son ficha.md, misiones.md, protocolo.md y bus.md", () => {
    const briefing = buildBriefing(makeContext())
    expect(briefing.artifacts.map((a) => a.filename).sort()).toEqual([
      "bus.md",
      "ficha.md",
      "misiones.md",
      "protocolo.md",
    ])
  })

  it("cada artefacto tiene contenido no vacío", () => {
    const briefing = buildBriefing(makeContext())
    for (const artifact of briefing.artifacts) {
      expect(artifact.content.length).toBeGreaterThan(100)
    }
  })

  it("misiones.md contiene la misión y el contexto", () => {
    const briefing = buildBriefing(makeContext())
    const misiones = briefing.artifacts.find((a) => a.filename === "misiones.md")!
    expect(misiones.content).toContain("T-02")
    expect(misiones.content).toContain("React 18")
  })

  it("protocolo.md contiene el ciclo de trabajo y los límites", () => {
    const briefing = buildBriefing(makeContext())
    const protocolo = briefing.artifacts.find((a) => a.filename === "protocolo.md")!
    expect(protocolo.content).toContain("Ciclo de trabajo")
    expect(protocolo.content).toContain("Tu territorio")
    expect(protocolo.content).toContain("handoff.md")
  })
})

describe("Mínimo verificable", () => {
  it("marca INCOMPLETO si falta contenido en una sección requerida", () => {
    // Una ficha sin sourcePrompt no puede渲染ar la identidad completa.
    const briefing = buildBriefing(makeContext({ ficha: makeFicha({ displayName: "" }) }))
    expect(briefing.complete).toBe(false)
    expect(briefing.missing).toContain("identidad")
  })

  it("el render humano muestra el estado completo o incompleto", () => {
    const briefing = buildBriefing(makeContext())
    const md = renderBriefing(briefing)
    expect(md).toContain("completo")
    expect(md).toContain("## 1. Quién sos")
    expect(md).toContain("## 10. Cómo se mide que terminaste")
  })

  it("el prompt compacto solo incluye las secciones requeridas con contenido", () => {
    const briefing = buildBriefing(makeContext())
    const prompt = renderBriefingPrompt(briefing)
    expect(prompt).toContain("Tu misión")
    expect(prompt).toContain("T-02")
  })
})
