/**
 * Renombra las referencias de repo en todo el paquete.
 *
 * El repo se renombro de `El-ltimoTPP` a `AI-OFFICE`. Los links del README
 * son absolutos (en npm los relativos dan 404), asi que hay que actualizarlos
 * a mano o quedan apuntando al nombre viejo.
 *
 * UTF-8 explicito: en Windows, `Set-Content` sin `-Encoding UTF8` + `Get-Content`
 * doble-codifica y rompe los acentos.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const VIEJO = "El-ltimoTPP"
const NUEVO = "AI-OFFICE"

const base = fileURLToPath(new URL("..", import.meta.url))
const archivos = ["README.md", "package.json", "scripts/fix-readme-links.mjs"].map((p) =>
  path.join(base, p),
)

let total = 0
for (const file of archivos) {
  const antes = fs.readFileSync(file, "utf8")
  const despues = antes.split(VIEJO).join(NUEVO)
  const n = antes.split(VIEJO).length - 1
  if (n > 0) {
    fs.writeFileSync(file, despues, "utf8")
    console.log(`  ${path.basename(file)}: ${n} referencias actualizadas`)
    total += n
  }
}
console.log(`Total: ${total}`)
