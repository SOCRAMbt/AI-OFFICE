/**
 * Inserta el bloque de hechos generados en un documento.
 *
 *     npx tsx scripts/insert-facts-block.ts docs/QUE-ES.md "Título de la sección"
 *
 * Es un helper de una vez: despues, `sync-docs.ts` mantiene el bloque al
 * dia.
 */

import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  computeFacts,
  renderFactsBlock,
  FACTS_BEGIN,
  FACTS_END,
} from "../src/core/docsync.ts"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

async function main() {
  const target = process.argv[2]
  if (!target) {
    console.error("uso: insert-facts-block.ts <archivo>")
    process.exit(1)
  }

  const file = path.resolve(projectRoot, target)
  const content = await fs.readFile(file, "utf8")

  if (content.includes(FACTS_BEGIN)) {
    console.log(`${target}: ya tiene el bloque`)
    return
  }

  const facts = await computeFacts({ projectRoot })
  const block = `${FACTS_BEGIN}\n${renderFactsBlock(facts)}\n${FACTS_END}`

  // Se inserta después de la primera línea de título.
  const lines = content.split("\n")
  const titulo = lines.findIndex((l) => l.startsWith("# "))
  const insertAt = titulo === -1 ? 0 : titulo + 1

  lines.splice(insertAt, 0, "", block, "")
  await fs.writeFile(file, lines.join("\n"), "utf8")
  console.log(`${target}: bloque insertado`)
}

main().catch((err) => {
  console.error("FALLO:", err)
  process.exit(1)
})
