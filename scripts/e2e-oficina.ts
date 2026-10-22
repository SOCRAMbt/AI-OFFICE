/**
 * Prueba end-to-end del flujo completo de la OFICINA.
 *
 * Simula lo que pasa cuando el usuario da un objetivo:
 *
 *   1. ElCommander divide el objetivo en cards.
 *   2. El dispatch resuelve los roles desde el catálogo REAL de agency-agents.
 *   3. Se materializan los agentes con su briefing.
 *   4. Se arrancan los subagentes (con un cliente SDK simulado).
 *   5. Los agentes se hablan por el bus.
 *   6. La mesa muestra quién está en qué.
 *   7. Un agente pide ayuda; otro responde.
 *   8. Cuando un agente termina, queda libre y puede reclamar otra card.
 *
 *   npx tsx scripts/e2e-oficina.ts
 */

import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { Office } from "../src/core/office.ts"
import { dispatchOffice } from "../src/core/dispatch.ts"
import { snapshotMesa, renderMesa } from "../src/core/mesa.ts"
import { CHANNELS } from "../src/core/bus.ts"
import { DEFAULT_LIMITS } from "../src/core/types.ts"

const ok = (label: string) => console.log(`  \u2713 ${label}`)
const info = (label: string, value: string) => console.log(`    ${label}: ${value}`)

async function main() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-e2e-"))
  await fs.writeFile(
    path.join(tmp, "package.json"),
    JSON.stringify({ name: "demo", scripts: { test: "true", lint: "true", build: "true" } }),
  )
  await fs.mkdir(path.join(tmp, "src", "components"), { recursive: true })
  await fs.writeFile(path.join(tmp, "src", "components", "Button.tsx"), "export const Button = () => null\n")

  const spawned: Array<{ agent: string; description: string; promptLength: number }> = []
  const office = new Office({
    cwd: tmp,
    limits: DEFAULT_LIMITS,
    client: {
      session: {
        prompt: async (args) => {
          const part = args.body.parts[0]!
          spawned.push({
            agent: part.agent,
            description: part.description,
            promptLength: part.prompt.length,
          })
          return {}
        },
      },
    },
  })
  await office.init()

  console.log("\n\u2500\u2500 1. EL COMANDANTE DIVIDE EL OBJETIVO \u2500\u2500")
  const state = await office.loadState(
    "Construir un formulario de login en React con validacion y accesibilidad, y su suite de tests",
  )
  await office.savePlan(state, [
    {
      title: "Construir el componente de login con validacion",
      type: "implementation",
      requiredCapabilities: ["react", "css", "form", "validation"],
      scope: { mayTouch: ["src/components/**"], forbidden: ["src/server/**", "**/*.env"] },
      acceptance: ["El formulario valida email y contrasena", "Los errores se anuncian"],
      gate: "npm test en verde y lint sin errores nuevos",
    },
    {
      title: "Auditar la accesibilidad del formulario",
      type: "security",
      requiredCapabilities: ["accessibility", "aria", "wcag"],
      scope: { mayTouch: ["src/components/**"], forbidden: [] },
      acceptance: ["Cero violaciones WCAG AA", "Navegacion por teclado completa"],
      gate: "npm test en verde",
    },
    {
      title: "Escribir la suite de tests del login",
      type: "testing",
      requiredCapabilities: ["playwright", "e2e", "testing"],
      scope: { mayTouch: ["test/**", "src/components/**"], forbidden: [] },
      acceptance: ["Tests de render y de teclado", "Cobertura del formulario"],
      gate: "npm test en verde",
    },
  ])
  ok(`${state.order.length} cards creadas`)
  info("cards", state.order.join(", "))

  console.log("\n\u2500\u2500 2. EL DISPATCH RESUELVE LOS ROLOS \u2500\u2500")
  const catalog = await office.catalog()
  info("catálogo", `${catalog.length} agentes de agency-agents`)

  const roster = await office.loadRoster(state.runId)
  const dispatch = await dispatchOffice(office, state, {
    projectRoot: tmp,
    catalog,
    objective: state.objective,
    maxAgents: 10,
    maxComplements: 2,
    minCoverage: DEFAULT_LIMITS.minCatalogCoverage,
    existing: Object.values(roster.agents),
  })

  for (const agent of dispatch.dispatched) {
    const rol = agent.cardId ? `card ${agent.cardId}` : "par libre"
    console.log(
      `    ${agent.isPeer ? "+" : "\u2192"} ${agent.agentName.padEnd(42)} ${rol.padEnd(12)} aporta: ${agent.contributes.join(", ") || "\u2014"}`,
    )
  }
  ok(`${dispatch.dispatched.length} agentes materializados`)
  if (dispatch.uncovered.length > 0) {
    info("sin cubrir por nadie", dispatch.uncovered.join(", "))
  }

  console.log("\n\u2500\u2500 3. LOS AGENTES ESTAN EN .opencode/agents/ \u2500\u2500")
  const agentFiles = await fs.readdir(path.join(tmp, ".opencode", "agents"))
  for (const f of agentFiles) {
    const content = await fs.readFile(path.join(tmp, ".opencode", "agents", f), "utf8")
    const hasMission = content.includes("Tu misión") || content.includes("mision")
    console.log(`    ${f.padEnd(46)} ${hasMission ? "con briefing" : "SIN BRIEFING"}`)
  }
  ok(`${agentFiles.length} archivos de agente (versionables con el repo)`)

  console.log("\n\u2500\u2500 4. LOS ARRANCA EN PARALELO \u2500\u2500")
  for (const agent of dispatch.dispatched) {
    if (agent.isPeer) continue
    await office.spawnAgent("ses-principal", agent.agentName, agent.prompt, agent.cardId ?? "")
  }
  ok(`${spawned.length} subagentes arrancados`)
  for (const s of spawned) {
    console.log(`    ${s.description.padEnd(46)} prompt de ${s.promptLength} chars`)
  }

  console.log("\n\u2500\u2500 5. LA MESA: QUIEN ESTA EN QUE \u2500\u2500")
  const mesa = await snapshotMesa(office)
  process.stdout.write(renderMesa(mesa))
  ok("mesa construida")

  console.log("\n\u2500\u2500 6. LOS AGENTES SE HABLAN POR EL BUS \u2500\u2500")
  const owner = dispatch.dispatched.find((a) => !a.isPeer)!
  const peer = dispatch.dispatched.find((a) => a.isPeer)

  const request = await office.bus.requestHelp({
    from: owner.agentId,
    to: peer ? [peer.agentId] : ["*"],
    cardId: owner.cardId ?? "T-00",
    need: "convertir el formulario a streaming SSR",
    whyMe: "tengo el contexto del componente pero no el del server",
  })
  ok(`HELP_REQUEST publicado (${request.id})`)

  const answer = await office.bus.respondHelp({
    from: peer!.agentId,
    to: [owner.agentId],
    cardId: owner.cardId ?? "T-00",
    kind: "HELP_ACCEPT",
    body: { scope: "src/server/**", deadline: "cuando termine mi card" },
    inReplyTo: request.id,
  })
  ok(`HELP_ACCEPT publicado (${answer.id})`)

  const received = await office.bus.receive(owner.agentId, [CHANNELS.peer])
  ok(`${received.length} mensajes recibidos por el owner`)

  console.log("\n\u2500\u2500 7. AL TERMINAR, QUEDA LIBRE Y RECLAMA \u2500\u2500")
  const after = await office.loadRoster(state.runId)
  const freed = after.agents[owner.agentId]!
  freed.currentCard = null
  freed.state = "idle_available"
  freed.canAccept = true
  await office.saveRoster(after)

  const state2 = await office.loadState()
  const free = state2.order
    .map((id) => state2.cards[id]!)
    .find((c) => c.state === "todo" && !c.owner)
  if (free) {
    const claimed = await office.claimCard(state2, owner.agentId, free.id)
    ok(claimed.ok ? `reclamó ${free.id} proactivamente` : `no pudo reclamar: ${claimed.reason}`)
  } else {
    info("sin cards libres para reclamar", "—")
  }

  const mesaFinal = await snapshotMesa(office)
  ok(`mesa final: ${mesaFinal.trabajando.length} trabajando, ${mesaFinal.libres.length} libres`)

  console.log("\n\u2500\u2500 8. ARTEFACTOS EN DISCO \u2500\u2500")
  const artifacts = await fs.readdir(path.join(tmp, ".oficina"))
  console.log(`    .oficina/: ${artifacts.join(", ")}`)
  const busFiles = await fs.readdir(path.join(tmp, ".oficina", "bus", "peer"))
  ok(`${busFiles.length} mensajes en el canal peer`)

  await fs.rm(tmp, { recursive: true, force: true })
  console.log("\n\u2713 Flujo completo verificado\n")
}

main().catch((err) => {
  console.error("FALLO:", err)
  process.exit(1)
})
