import { scanCatalog } from "../src/core/catalog.ts"
import path from "node:path"
import os from "node:os"

const root = path.join(process.env.HOME ?? process.env.USERPROFILE ?? "", "agency-agents")
const c = await scanCatalog({ root })
const por = new Map<string, string[]>()
for (const a of c) {
  if (!por.has(a.division)) por.set(a.division, [])
  por.get(a.division)!.push(a.slug)
}
for (const d of [
  "testing",
  "gis",
  "design",
  "marketing",
  "finance",
  "healthcare",
  "product",
  "research",
  "support",
  "specialized",
  "engineering",
]) {
  console.log(`\n${d}:`)
  console.log("  " + (por.get(d) ?? []).join(", "))
}
