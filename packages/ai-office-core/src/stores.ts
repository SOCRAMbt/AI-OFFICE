/**
 * Almacenes de evidencia y de costo.
 *
 * Viven en archivos aparte del `state.json` a proposito:
 *
 * - **Evidencia**: es un grafo que crece con cada aporte. Meterlo en el
 *   estado principal lo convertiria en un documento gigante que se
 *   reescribe entero en cada cambio, y lo perdiéramos en cada escritura.
 *   Ademas, la evidencia es *derivada* del trabajo: sobrevive a que el
 *   estado cambie de forma.
 * - **Costo**: es un ledger de append. Se actualiza en cada mensaje del
 *   modelo, y no tiene nada que ver con el plan de cards.
 *
 * Los dos se escriben con `writeJsonAtomic`, asi que un crash a mitad de
 * escritura no deja un JSON partido.
 */

import path from "node:path"
import fs from "node:fs/promises"
import { readJson, writeJsonAtomic } from "./fsx.js"
import { withLock } from "./atomic.js"
import { safeId } from "./ids.js"
import {
  buildEvidenceGraph,
  canCloseCard,
  type EvidenceGraph,
  type EvidenceNode,
  type EvidenceOptions,
  type VerificationLevel,
} from "./evidence.js"
import type { Card, OfficeState } from "./types.js"
import { logger } from "./log.js"

const log = logger("oficina:stores")

/* ────────────────────────────────────────────────────────────────────────────
 * Evidencia
 * ──────────────────────────────────────────────────────────────────────────── */

export interface EvidenceStoreOptions {
  /** Cuantos criterios de aceptación son obligatorios. */
  mandatoryCount?: number
  /** Nivel de verificación mínimo para poder cerrar. */
  requiredLevel?: VerificationLevel
}

export class EvidenceStore {
  constructor(
    private readonly dir: string,
    private readonly options: EvidenceStoreOptions = {},
  ) {}

  private file(cardId: string): string {
    const safe = safeId(cardId)
    if (!safe) throw new Error(`[oficina] cardId no seguro: "${cardId}"`)
    return path.join(this.dir, `${safe}.json`)
  }

  /** Lee los nodos de evidencia de una card. */
  async nodes(cardId: string): Promise<EvidenceNode[]> {
    const result = await readJson<{ nodes?: EvidenceNode[] }>(this.file(cardId))
    if (!result.ok || !result.value) return []
    return Array.isArray(result.value.nodes) ? result.value.nodes : []
  }

  /** Guarda los nodos de evidencia de una card. */
  async save(cardId: string, nodes: EvidenceNode[]): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    await writeJsonAtomic(this.file(cardId), { version: 1, cardId, nodes })
  }

  /** Agrega un nodo de evidencia, deduplicando por id. */
  async add(cardId: string, node: EvidenceNode): Promise<EvidenceNode[]> {
    const filePath = this.file(cardId)
    return withLock(`${filePath}.lock`, async () => {
      const nodes = await this.nodes(cardId)
      const index = nodes.findIndex((n) => n.id === node.id)
      if (index >= 0) nodes[index] = node
      else nodes.push(node)
      await this.save(cardId, nodes)
      return nodes
    })
  }

  /** Construye el grafo de una card. */
  async graph(card: Card): Promise<EvidenceGraph> {
    const nodes = await this.nodes(card.id)
    return buildEvidenceGraph(card, nodes, {
      mandatoryCount: this.options.mandatoryCount,
      requiredLevel: this.options.requiredLevel,
    })
  }

  /** ¿Se puede cerrar la card con la evidencia actual? */
  async canClose(card: Card): Promise<{ ok: boolean; reason: string }> {
    const graph = await this.graph(card)
    return canCloseCard(graph, {
      requiredLevel: this.options.requiredLevel,
      requireAcceptance: true,
    })
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Integracion
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Crea el store de evidencia de una corrida.
 *
 * Se separa del `Office` para no mezclarlo con la logica de cards: son
 * concerns distintos.
 */
export function createStores(
  officeDir: string,
  state: OfficeState,
  options: EvidenceStoreOptions = {},
): { evidence: EvidenceStore } {
  const evidence = new EvidenceStore(path.join(officeDir, "evidence"), options)
  log.debug("stores creados", { runId: state.runId })
  return { evidence }
}

/** Opciones de evidencia derivadas de un nodo. */
export function evidenceOptions(
  recordedBy: string,
  requirementIndex?: number,
  extra: Partial<EvidenceOptions> = {},
): EvidenceOptions {
  return { recordedBy, requirementIndex, ...extra }
}
