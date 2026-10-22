import { Office } from "../src/core/office.ts"
import { resolveScopeCard } from "../src/hooks/scopeGuard.ts"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-dbg-"))
await fs.writeFile(path.join(tmp, "package.json"), JSON.stringify({ name: "demo", scripts: { test: "true" } }))
await fs.mkdir(path.join(tmp, "src"), { recursive: true })
await fs.mkdir(path.join(tmp, "lib"), { recursive: true })

const office = new Office({ cwd: tmp })
await office.init()

const state = await office.loadState("Objetivo")
await office.savePlan(state, [
  {
    title: "Trabajo",
    type: "implementation",
    requiredCapabilities: ["react"],
    scope: { mayTouch: ["src/**"], forbidden: ["lib/**"] },
    acceptance: ["ok"],
    gate: "npm test",
  },
])

const fresh = await office.loadState("Objetivo")
const claimed = await office.claimCard(fresh, "e-trabajador", "T-00", "ses-1")
console.log("claimed:", JSON.stringify(claimed))

const after = await office.loadState("Objetivo")
console.log("sessions:", JSON.stringify(after.sessions))
console.log("card owner:", after.cards["T-00"]?.owner, "state:", after.cards["T-00"]?.state)

const card = await resolveScopeCard(after, "ses-1", { enforce: true })
console.log("resolveScopeCard ->", card ? `card ${card.id} mayTouch=${JSON.stringify(card.scope.mayTouch)}` : "UNDEFINED")

await fs.rm(tmp, { recursive: true, force: true })
