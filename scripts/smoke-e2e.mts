/**
 * SMOKE E2E: reproduce la corrida real que destapó los 4 huecos.
 * Sin host mock: solo el motor, verificando cada garantía en orden.
 */
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-smoke-e2e-"))
await fs.writeFile(path.join(tmp, "package.json"), JSON.stringify({ name: "demo", scripts: { build: "true", lint: "true", test: "true", typecheck: "true" } }))

const { Office } = await import("../src/core/office.js")
const { buildTools } = await import("../src/tools/index.js")
const { CHANNELS } = await import("../src/core/bus.js")

let ok = 0
let fail = 0
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { ok++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`) }
}

const office = new Office({ cwd: tmp })
await office.init()
const tools = buildTools(office) as Record<string, { execute: (a: unknown, c: unknown) => Promise<{ title: string; output: string; metadata?: Record<string, unknown> }> }>

// ── 1. PLAN con el roster vacío (la condición exacta de la corrida real) ──
console.log("\n[1] PLAN con roster vacío → reviewers quedan null (estado real pre-fix)")
const commanderCtx = { sessionID: "ses-commander", agent: "commander-test", directory: tmp, messageID: "m0" }
const planResult = await tools.oficina_plan!.execute({
  objective: "Lanzar demo de agencia con research + veredicto",
  cards: [
    { title: "Research staffing", type: "implementation", requiredCapabilities: ["react"], scope: { mayTouch: ["research/**"], forbidden: [] }, acceptance: ["3 canales con primer paso ejecutable"], gate: "npm test" },
    { title: "Veredicto pre-call", type: "design", requiredCapabilities: ["react"], scope: { mayTouch: ["research/**"], forbidden: [] }, acceptance: ["top-3 nichos"], gate: "npm test" },
  ],
}, commanderCtx)
check("plan aceptado", planResult.output.includes("T-00") && planResult.output.includes("T-01"), planResult.output.slice(0, 120))
const st0 = await office.loadState()
check("plan con roster vacío deja reviewers null (el hueco pre-dispatch es real)", Object.values(st0.cards).every((c) => c.reviewer === null))

// ── 2. DISPATCH con integrador autenticado ──
console.log("\n[2] DISPATCH: identidad + canDelegate + reviewers asignados + spawn sin host")
const { ficha: integrator } = await office.resolveFicha({ role: "integrator", capabilities: ["coordination"], canDelegate: true })
await office.deploy(integrator)
const dispatchCtx = { sessionID: "ses-commander", agent: integrator.id, directory: tmp, messageID: "m1" }
const dispatchResult = await tools.oficina_dispatch!.execute({ agentId: integrator.id, maxAgents: 4, maxComplements: 1, spawn: true }, dispatchCtx)
check("dispatch autorizado (canDelegate de la ficha)", !dispatchResult.output.includes("No autorizado"))
check("spawn sin host se REPORTA como fallido (no silencio)", dispatchResult.output.includes("Spawn falló"), dispatchResult.output.slice(0, 200))
const st1 = await office.loadState()
const ownersAssigned = Object.values(st1.cards).every((c) => c.owner)
check("todas las cards tienen owner", ownersAssigned, JSON.stringify(Object.values(st1.cards).map((c) => [c.id, c.owner])))
check("reviewers asignados DENTRO del dispatch (sin ventana con reviewer null)", Object.values(st1.cards).every((c) => c.reviewer !== null), JSON.stringify(Object.values(st1.cards).map((c) => [c.id, c.reviewer])))

// ── 3. ASSIGN REVIEWERS es idempotente (segunda llamada no rompe nada) ──
console.log("\n[3] ASSIGN REVIEWERS: idempotente sobre estado ya ruteado")
const reviewers = await office.assignReviewers(st1)
const st2 = await office.loadState()
check("todos los reviewers siguen asignados", Object.values(st2.cards).every((c) => c.reviewer !== null), JSON.stringify(reviewers))
check("ningún reviewer es su propio owner", Object.values(st2.cards).every((c) => c.reviewer !== c.owner))
check("segunda pasada no reasigna (idempotente)", reviewers.length === 0, JSON.stringify(reviewers))

// ── 4. HELP_REQUEST dirigido a un peer + el peer lo ve con oficina_next ──
console.log("\n[4] HELP_REQUEST: ida completa por el bus, visible en oficina_next")
const { ficha: peer } = await office.resolveFicha({ role: "legal-compliance", capabilities: ["compliance"], canDelegate: false })
await office.deploy(peer)
const ownerOfT00 = st2.cards["T-00"]!.owner!
const sent = await office.bus.send(CHANNELS.peer, {
  from: ownerOfT00,
  to: [peer.id],
  kind: "HELP_REQUEST",
  subject: "T-00",
  body: { need: "riesgo de compliance del demo", whyMe: "cambia el score del foso" },
})
check("HELP_REQUEST enviado con need+whyMe", Boolean(sent?.id))

// El peer (con sesión viva, como los spawneados en el fix) consulta oficina_next
const peerNext = await tools.oficina_next!.execute({ agentId: peer.id, action: "STAY_IDLE", justification: "triage inicial" }, { sessionID: "ses-peer", agent: peer.id, directory: tmp, messageID: "m2" })
check("el peer ve el HELP_REQUEST en su inbox", peerNext.output.includes("HELP_REQUEST") && peerNext.output.includes(sent!.id))

// El peer responde con HELP_ACCEPT y sustancia
const peerRespond = await tools.oficina_next!.execute({
  agentId: peer.id,
  action: "HELP_RESPOND",
  messageId: sent!.id,
  kind: "HELP_ACCEPT",
  to: [ownerOfT00],
  body: "Riesgo medio: TCPA aplica si la agencia es sender. BAA obligatorio con el CRM.",
}, { sessionID: "ses-peer", agent: peer.id, directory: tmp, messageID: "m3" })
check("respuesta HELP_ACCEPT registrada", !peerRespond.output.includes("Identidad inválida"))

// El owner ve la respuesta
const ownerInbox = await office.bus.receive(ownerOfT00, [CHANNELS.peer])
const reply = ownerInbox.find((m) => m.inReplyTo === sent!.id)
check("la respuesta llega al owner con correlación (inReplyTo)", Boolean(reply), JSON.stringify(ownerInbox.map((m) => m.kind)))

// ── 5. Antisuplantación sigue viva ──
console.log("\n[5] Seguimiento del fix de identidad: nadie opera como otro")
const impostor = await tools.oficina_bus!.execute({ action: "receive", agentId: peer.id }, { sessionID: "ses-otro", agent: ownerOfT00, directory: tmp, messageID: "m4" })
check("owner no puede leer inbox del peer", impostor.output.includes("no coincide con la sesión"))

// ── 6. Root correcto ──
console.log("\n[6] ROOT: la oficina vive en el proyecto de la sesión, no en el cwd del proceso")
check("officeDir queda dentro del proyecto", office.paths.projectRoot.startsWith(tmp), office.paths.projectRoot)

await fs.rm(tmp, { recursive: true, force: true })
console.log(`\n═══ RESULTADO: ${ok} OK / ${fail} FALLO ═══`)
process.exit(fail > 0 ? 1 : 0)
