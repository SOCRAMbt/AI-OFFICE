/**
 * Sincroniza las cifras de la documentacion con el codigo real.
 *
 *     npx tsx scripts/sync-docs.ts           # actualiza
 *     npx tsx scripts/sync-docs.ts --check   # falla si hay drift (lo usa el CI)
 *
 * ## Por que el CI tiene que fallar
 *
 * Un numero escrito a mano se desactualiza sin que nadie se entere. El
 * unico modo de que la documentacion diga la verdad es que **verificarlo
 * sea automatico**: si el codigo cambio y la doc no, el build falla.
 *
 * Eso es lo que hace `--check`: recalcula los hechos, los compara con lo
 * que dice la documentacion y sale con codigo 1 si hay diferencia.
 */

import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  computeFacts,
  renderFactsBlock,
  replaceFactsBlock,
  findFactsBlock,
  readCatalogSnapshot,
  writeCatalogSnapshot,
  FACTS_BEGIN,
  FACTS_END,
} from "../src/core/docsync.ts"

// `import.meta.url.pathname` en Windows devuelve "/C:/ruta/..." y
// `path.resolve` lo convierte en "C:\C:\ruta\...". `fileURLToPath` lo
// resuelve bien en las dos plataformas.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** Archivos que llevan el bloque generado. */
const TARGETS = ["README.md", "docs/QUE-ES.md"]

async function main() {
  const check = process.argv.includes("--check")

  // El snapshot del catalogo es la versionada: el build usa esa, para que
  // el CI pueda verificar sin tener el repo de agency-agents a mano.
  const snapshot = await readCatalogSnapshot(projectRoot)

  const facts = await computeFacts({ projectRoot, catalogSnapshot: snapshot })
  const block = `${FACTS_BEGIN}\n${renderFactsBlock(facts)}\n${FACTS_END}`

  let drifted = 0
  for (const relative of TARGETS) {
    const file = path.join(projectRoot, relative)
    let content: string
    try {
      content = await fs.readFile(file, "utf8")
    } catch {
      console.log(`  ${relative}: no existe, se omite`)
      continue
    }

    if (!findFactsBlock(content)) {
      console.log(`  ${relative}: SIN bloque generado (${FACTS_BEGIN})`)
      drifted += 1
      continue
    }

    const updated = replaceFactsBlock(content, block)
    if (updated === content) {
      console.log(`  ${relative}: al dia`)
      continue
    }

    if (check) {
      console.log(`  ${relative}: DESINCRONIZADO`)
      drifted += 1
    } else {
      await fs.writeFile(file, updated, "utf8")
      console.log(`  ${relative}: actualizado`)
    }
  }

  // ── Refresco del snapshot del catalogo ──
  //
  // El snapshot es la version que el CI verifica. Refrescarlo es un acto
  // explicito: si el repo de agency-agents esta a mano y las cifras
  // cambiaron, se reescanea. Si no cambio, no se toca el archivo (para no
  // generar ruido en el diff con un timestamp).
  if (!check) {
    const { defaultAgencyRoot, readGitCommit } = await import("../src/core/docsync.ts")
    const root = defaultAgencyRoot()
    if (root) {
      const { scanCatalog } = await import("../src/core/catalog.ts")
      try {
        const agents = await scanCatalog({ root })
        const divisions = [...new Set(agents.map((a) => a.division))].sort()
        const refreshed = {
          agents: agents.length,
          divisions: divisions.length,
          divisionList: divisions,
          source: "agency-agents",
          generatedAt: new Date().toISOString(),
          sourceCommit: await readGitCommit(root),
        }
        const anterior = await readCatalogSnapshot(projectRoot)
        const cambio =
          !anterior ||
          anterior.agents !== refreshed.agents ||
          anterior.divisions !== refreshed.divisions ||
          anterior.divisionList.join(",") !== refreshed.divisionList.join(",")
        if (cambio) {
          await writeCatalogSnapshot(projectRoot, refreshed)
          console.log(`  docs/catalog-facts.json: refrescado (${refreshed.agents} agentes)`)
        }
      } catch {
        console.log("  docs/catalog-facts.json: no se pudo reescanear el catálogo")
      }
    }
  }

  console.log("")
  console.log(`Hechos calculados:`)
  console.log(`  tools:   ${facts.tools}`)
  console.log(`  hooks:   ${facts.hooks}`)
  console.log(`  plugin:  @opencode/plugin@${facts.pluginApi.version}`)
  if (facts.catalog) {
    console.log(`  catalogo: ${facts.catalog.agents} agentes en ${facts.catalog.divisions} divisiones`)
  } else {
    console.log(`  catalogo: no disponible`)
  }

  if (check && drifted > 0) {
    console.error("")
    console.error(`La documentacion esta desincronizada del codigo (${drifted} archivo/s).`)
    console.error(`Corre: npx tsx scripts/sync-docs.ts`)
    process.exit(1)
  }

  if (!check && drifted > 0) {
    console.error("")
    console.error(`Faltan bloques generados en ${drifted} archivo/s. Agregalos a mano.`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error("FALLO:", err)
  process.exit(1)
})
