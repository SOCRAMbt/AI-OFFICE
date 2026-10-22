/**
 * Benchmark de seleccion de agentes.
 *
 *     npx tsx benchmarks/selection/run.ts
 *
 * ## Que pregunta
 *
 * "El matching textual, ¿elige bien al agente?" Y, sobre todo: **¿el
 * matching sofisticado justifica su complejidad frente a algo más simple?**
 *
 * Por eso el benchmark compara tres strategias sobre las mismas tareas:
 *
 * 1. **Completo**: el matcher de la oficina (identidad curada, sinónimos
 *    por capability, lematizacion, focus de mision, afinidad de division).
 * 2. **Solo nombre**: overlap de tokens del nombre del rol. Lo más simple
 *    que se puede hacer.
 * 3. **Keywords**: bolsa de tokens con los pesos antiguos (40/35/20/5).
 *    Es el matcher que tenia la v1, con los mismos pesos.
 *
 * ## Como se lee el resultado
 *
 * - Si el completo no le gana al de keywords, **la complejidad no se
 *   justifica** y hay que simplificar.
 * - Si el completo gana, el margen dice cuanto vale.
 * - Los fallos se muestran: un benchmark que solo reporta el promedio
 *   esconde justo lo que hay que arreglar.
 *
 * Las expectativas son roles REALES del catalogo. Si el matcher no los
 * encuentra, es un hallazgo del benchmark, no un test roto.
 */

import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { scanCatalog, rankCandidates, capabilityTokens, canonicalConcepts } from "../../src/core/catalog.ts"
import type { CatalogAgent } from "../../src/core/types.ts"

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, "..", "..")

interface Task {
  id: string
  objetivo: string
  capabilities: string[]
  esperados: string[]
}

interface Strategy {
  name: string
  description: string
  rank: (catalog: CatalogAgent[], capabilities: string[]) => string[]
}

/* ────────────────────────────────────────────────────────────────────────────
 * Baseline 1: solo el nombre
 * ──────────────────────────────────────────────────────────────────────────── */

const soloNombre: Strategy = {
  name: "solo-nombre",
  description: "Overlap de tokens entre el nombre del rol y las capabilities pedidas.",
  rank(catalog, capabilities) {
    const objetivo = new Set(capabilityTokens(capabilities.join(" ")))
    return catalog
      .map((agent) => {
        const nombre = new Set(capabilityTokens(`${agent.slug} ${agent.displayName}`))
        let hits = 0
        for (const token of objetivo) if (nombre.has(token)) hits += 1
        return { slug: agent.slug, score: objetivo.size > 0 ? hits / objetivo.size : 0 }
      })
      .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))
      .map((x) => x.slug)
  },
}

/* ────────────────────────────────────────────────────────────────────────────
 * Baseline 2: keywords (los pesos de la v1)
 * ──────────────────────────────────────────────────────────────────────────── */

const keywords: Strategy = {
  name: "keywords",
  description: "Bolsa de tokens con los pesos antiguos: nombre 40, misión literal 35, concepto 20, cuerpo 5.",
  rank(catalog, capabilities) {
    const objetivoRaw = new Set(capabilityTokens(capabilities.join(" ")))
    const objetivoCanon = canonicalConcepts(capabilities.join(" "))
    return catalog
      .map((agent) => {
        const nombre = capabilityTokens(`${agent.slug} ${agent.displayName}`)
        const misionRaw = new Set<string>()
        const misionCanon = new Set<string>()
        for (const m of agent.missions) {
          for (const t of capabilityTokens(m)) misionRaw.add(t)
          for (const t of canonicalConcepts(m)) misionCanon.add(t)
        }
        const cuerpo = canonicalConcepts(agent.searchText)

        const overlap = (want: Set<string>, have: Set<string>): number => {
          if (want.size === 0) return 0
          let hits = 0
          for (const t of want) if (have.has(t)) hits += 1
          return hits / want.size
        }

        const score =
          overlap(objetivoRaw, new Set(nombre)) * 0.4 +
          overlap(objetivoRaw, misionRaw) * 0.35 +
          overlap(objetivoCanon, misionCanon) * 0.2 +
          overlap(objetivoCanon, cuerpo) * 0.05

        return { slug: agent.slug, score }
      })
      .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))
      .map((x) => x.slug)
  },
}

/* ────────────────────────────────────────────────────────────────────────────
 * El matcher real
 * ──────────────────────────────────────────────────────────────────────────── */

const completo: Strategy = {
  name: "completo",
  description:
    "El matcher de la oficina: identidad curada (slug + nombre + description + vibe), " +
    "sinónimos por capability, lematización, focus de misión y afinidad de división.",
  rank(catalog, capabilities) {
    return rankCandidates(catalog, capabilities, 10).map((m) => m.agent.slug)
  },
}

/* ────────────────────────────────────────────────────────────────────────────
 * Metricas
 * ──────────────────────────────────────────────────────────────────────────── */

interface StrategyResult {
  name: string
  hit1: number
  hit3: number
  hit5: number
  mrr: number
  fallos: { task: string; esperado: string[]; obtenido: string[] }[]
}

function evaluate(strategy: Strategy, tasks: Task[], catalog: CatalogAgent[]): StrategyResult {
  let hit1 = 0
  let hit3 = 0
  let hit5 = 0
  let mrr = 0
  const fallos: StrategyResult["fallos"] = []

  for (const task of tasks) {
    const ranking = strategy.rank(catalog, task.capabilities)
    const esperado = new Set(task.esperados)
    const top5 = ranking.slice(0, 5)

    const pos = top5.findIndex((slug) => esperado.has(slug))
    if (pos === 0) hit1 += 1
    if (pos !== -1 && pos < 3) hit3 += 1
    if (pos !== -1 && pos < 5) hit5 += 1
    if (pos !== -1) mrr += 1 / (pos + 1)

    if (pos === -1) {
      fallos.push({ task: task.id, esperado: task.esperados, obtenido: top5.slice(0, 3) })
    }
  }

  const n = tasks.length
  return {
    name: strategy.name,
    hit1: hit1 / n,
    hit3: hit3 / n,
    hit5: hit5 / n,
    mrr: mrr / n,
    fallos,
  }
}

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`
}

/* ────────────────────────────────────────────────────────────────────────────
 * Main
 * ──────────────────────────────────────────────────────────────────────────── */

async function main() {
  const raw = await fs.readFile(path.join(here, "tasks.json"), "utf8")
  const parsed = JSON.parse(raw) as { tasks: Task[] }
  const tasks = parsed.tasks

  const agencyRoot = process.env.AGENCY_ROOT ?? path.join(
    process.env.HOME ?? process.env.USERPROFILE ?? "",
    "agency-agents",
  )
  const catalog = await scanCatalog({ root: agencyRoot })

  console.log("")
  console.log("BENCHMARK DE SELECCIÓN DE AGENTES")
  console.log("=".repeat(72))
  console.log(`catálogo: ${catalog.length} agentes`)
  console.log(`tareas:   ${tasks.length}`)
  console.log("")

  const estrategias = [completo, keywords, soloNombre]
  const resultados = estrategias.map((s) => evaluate(s, tasks, catalog))

  console.log("Estrategia      hit@1   hit@3   hit@5   MRR")
  console.log("-".repeat(72))
  for (const r of resultados) {
    const marca = r.name === "completo" ? "*" : " "
    console.log(
      `${marca} ${r.name.padEnd(14)} ${pct(r.hit1).padStart(5)}   ${pct(r.hit3).padStart(5)}   ` +
        `${pct(r.hit5).padStart(5)}   ${r.mrr.toFixed(3)}`,
    )
  }
  console.log("")

  const completoRes = resultados.find((r) => r.name === "completo")!
  const keywordsRes = resultados.find((r) => r.name === "keywords")!
  const nombreRes = resultados.find((r) => r.name === "solo-nombre")!

  console.log("LECTURA")
  console.log("-".repeat(72))
  const deltaMrr = completoRes.mrr - keywordsRes.mrr
  if (completoRes.hit1 > keywordsRes.hit1) {
    console.log(
      `El matcher completo le gana a keywords en hit@1 (${pct(completoRes.hit1)} vs ${pct(keywordsRes.hit1)}). ` +
        `La complejidad se justifica.`,
    )
  } else if (completoRes.hit1 === keywordsRes.hit1) {
    console.log(
      `Empate en hit@1 con keywords (${pct(completoRes.hit1)}). ` +
        `El delta de MRR es ${deltaMrr >= 0 ? "+" : ""}${deltaMrr.toFixed(3)}: ` +
        `el completo ordena mejor, pero no encuentra mas.`,
    )
  } else {
    console.log(
      `El matcher completo es PEOR que keywords en hit@1 (${pct(completoRes.hit1)} vs ${pct(keywordsRes.hit1)}). ` +
        `La complejidad no se justifica: hay que simplificar.`,
    )
  }
  console.log(
    `Contra "solo el nombre": hit@1 ${pct(nombreRes.hit1)} -> ${pct(completoRes.hit1)}. ` +
      `Eso es lo que aporta leer la description y el vibe del agente.`,
  )
  console.log("")

  console.log("FALLOS DEL MATCHER COMPLETO")
  console.log("-".repeat(72))
  if (completoRes.fallos.length === 0) {
    console.log("  ninguno")
  } else {
    for (const f of completoRes.fallos) {
      console.log(`  ${f.task}`)
      console.log(`    esperaba: ${f.esperado.join(", ")}`)
      console.log(`    obtuvo:   ${f.obtenido.join(", ")}`)
    }
  }
  console.log("")

  await fs.writeFile(
    path.join(here, "RESULTADOS.md"),
    [
      "# Resultados del benchmark de selección",
      "",
      `Generado: ${new Date().toISOString()}`,
      "",
      `Catálogo: ${catalog.length} agentes · ${tasks.length} tareas`,
      "",
      "| Estrategia | hit@1 | hit@3 | hit@5 | MRR |",
      "|---|---|---|---|---|",
      ...resultados.map(
        (r) => `| ${r.name} | ${pct(r.hit1)} | ${pct(r.hit3)} | ${pct(r.hit5)} | ${r.mrr.toFixed(3)} |`,
      ),
      "",
      "## Fallos del matcher completo",
      "",
      ...(completoRes.fallos.length === 0
        ? ["Ninguno."]
        : completoRes.fallos.flatMap((f) => [
            `- **${f.task}** — esperaba ${f.esperado.join(", ")}; obtuvo ${f.obtenido.join(", ")}`,
          ])),
      "",
    ].join("\n"),
    "utf8",
  )
  console.log("Resultados escritos en benchmarks/selection/RESULTADOS.md")
}

main().catch((err) => {
  console.error("FALLO:", err)
  process.exit(1)
})
