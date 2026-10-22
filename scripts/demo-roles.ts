/**
 * Demo: cómo resuelve la oficina los roles con el catálogo real.
 *
 *   npx tsx scripts/demo-roles.mjs
 */
import { scanCatalog, buildPanel } from "../src/core/catalog.ts"
import { createFicha } from "../src/core/factory.ts"
import { buildBriefing, renderBriefing } from "../src/core/briefing.ts"
import path from "node:path"
import os from "node:os"

const root = path.join(process.env.HOME ?? process.env.USERPROFILE ?? "", "agency-agents")
console.log(`Escaneando ${root} ...\n`)
const catalog = await scanCatalog({ root })
console.log(`Catálogo: ${catalog.length} agentes en ${new Set(catalog.map((a) => a.division)).size} divisiones\n`)

const OBJETIVOS = [
  ["Implementar un formulario de login en React con validación y accesibilidad", ["react", "form", "validation", "accessibility", "frontend"]],
  ["Revisar la seguridad de un endpoint de API y detectar inyecciones SQL", ["api", "security", "sql", "injection", "review"]],
  ["Migrar una base de datos Postgres a un esquema con partitioning", ["postgres", "database", "migration", "schema", "partitioning"]],
  ["Diseñar un pipeline de datos que ingiere eventos y los agrega por hora", ["data", "pipeline", "etl", "streaming", "analytics"]],
  ["Escribir tests end-to-end con Playwright para un flujo de checkout", ["playwright", "e2e", "testing", "checkout", "browser"]],
  ["Un agente que de verdad sepa de GIS y cartografía", ["gis", "geospatial", "cartography", "mapping"]],
  ["Configurar CI/CD con Docker y despliegue en Kubernetes", ["cicd", "docker", "kubernetes", "deployment", "devops"]],
  ["Redactar la documentación de la API con ejemplos de request y response", ["api", "documentation", "openapi", "examples", "reference"]],
]

for (const [objetivo, capabilities] of OBJETIVOS) {
  const panel = buildPanel(catalog, capabilities, { maxComplements: 2 })

  console.log("═".repeat(80))
  console.log(`OBJETIVO: ${objetivo}`)
  console.log(`PIDE:     ${capabilities.join(", ")}`)
  console.log("─".repeat(80))

  if (!panel.primary) {
    console.log("  (sin match)")
    console.log()
    continue
  }

  const p = panel.primary
  console.log(`  PRIMARIO    ${(p.coverage * 100).toFixed(0)}%  ${p.agent.division}/${p.agent.slug}`)
  console.log(`              "${p.agent.displayName}"`)
  if (p.agent.missions.length > 0) {
    console.log(`              misiones: ${p.agent.missions.slice(0, 2).join(" | ")}`)
  }
  console.log(`              cubre:   ${p.matched.join(", ") || "—"}`)

  for (const c of panel.complements) {
    console.log(`  + COMPLEM. ${(c.coverage * 100).toFixed(0)}%  ${c.agent.division}/${c.agent.slug}`)
    console.log(`              "${c.agent.displayName}"`)
    console.log(`              aporta:  ${c.matched.filter((m) => !p.matched.includes(m)).join(", ") || "—"}`)
  }

  if (panel.uncovered.length > 0) {
    console.log(`  SIN CUBRIR: ${panel.uncovered.join(", ")}`)
  }
  console.log()
}

// Briefing completo del panel del primer objetivo.
console.log("═".repeat(80))
console.log("BRIEFING COMPLETO (agente primario del primer objetivo)")
console.log("═".repeat(80))

const [objetivo, capabilities] = OBJETIVOS[0]
const panel = buildPanel(catalog, capabilities)
const top = panel.primary!

const ficha = createFicha({
  role: top.agent.slug,
  displayName: top.agent.displayName,
  capabilities: top.agent.capabilities.slice(0, 12),
  objective,
})

const briefing = buildBriefing({
  ficha,
  card: {
    id: "T-02",
    title: "Componente de login con validación",
    type: "implementation",
    state: "todo",
    owner: ficha.id,
    reviewer: "e-critico",
    requiredCapabilities: capabilities,
    scope: { mayTouch: ["src/auth/**"], forbidden: ["src/server/**"] },
    acceptance: [
      "El formulario valida email y contraseña en el cliente",
      "Los errores se anuncian con aria-live",
      "Tiene test de render y de teclado",
    ],
    gate: "npm test en verde y lint sin errores nuevos",
    dependsOn: [],
    attempts: 0,
    rejections: 0,
    artifacts: "",
    result: null,
    helpRequests: [],
    helpHops: 0,
  },
  objective,
  knownDecisions: ["El proyecto usa React 18 con Vite y sin librería de forms"],
  knownConstraints: ["No se pueden agregar dependencias nuevas"],
  builtPieces: ["src/components/Button.tsx", "src/lib/validators.ts"],
  knownTraps: ["src/auth/legacy.js está muerto: lo usa scripts/migrate.sh"],
  openQuestions: ["Falta decidir si el error de red muestra retry o cambia el form"],
  peers: [],
  coordinatorId: "integrator",
})

console.log(renderBriefing(briefing))
