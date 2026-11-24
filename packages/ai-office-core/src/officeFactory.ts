/**
 * OfficeFactory: una oficina por directorio de trabajo (ventana).
 *
 * ## Por qué existe
 *
 * El plugin v2 instanciaba UNA `Office` en el plugin-load time, atada al
 * directorio de quien cargó el plugin. Todas las ventanas de OpenCode
 * compartían ese raíz. Con agentes zombies stale, dos ventanas nunca podían
 * tener su propia oficina: la herramienta funcionaba «en un solo directorio».
 *
 * Además, `tools/index.ts` creaba oficinas "alternativas" con `new Office()`
 * sin `spawner` ni `client` — podían leer estado pero jamás arrancar
 * sesiones (todo «despacho» materializa fichas pero el agente no llega a vivir).
 *
 * La Factory fija ambos:
 *   1) cachea una Office por `path.resolve(cwd)` — una por directorio de la
 *      ventana/sesión, aisladas entre sí pero con limites y spawner compartidos,
 *   2) propaga el host adapter del host a TODAS las oficinas (no solo la base).
 */
import path from "node:path"
import { Office, type OfficeOptions } from "./office.js"
import type { CatalogAgent } from "./types.js"
import type { CommandRunner } from "./gates.js"
import type { Limits } from "./types.js"
import type { HostAdapter } from "./host/HostAdapter.js"

export interface HostConfig {
  limits?: Limits
  /** @deprecated Use host instead */
  spawner?: OfficeOptions["spawner"]
  /** @deprecated Use host instead */
  client?: OfficeOptions["client"]
  /** Host adapter for platform-specific operations (NEW) */
  host?: HostAdapter
  agencyRoot?: string
  catalog?: CatalogAgent[]
  runner?: CommandRunner
  clock?: () => number
}

export class OfficeFactory {
  private readonly cache = new Map<string, Office>()
  private readonly hostConfig: HostConfig

  constructor(host: HostConfig = {}) {
    this.hostConfig = host
  }

  /** Oficina para `dir`. Cachea por ruta resuelta. */
  get(dir: string): Office {
    if (!dir || typeof dir !== "string" || dir.trim().length === 0) {
      throw new Error("OfficeFactory.get: directorio vacío o inválido")
    }
    const key = path.resolve(dir.trim())
    let off = this.cache.get(key)
    if (!off) {
      off = new Office({ cwd: key, ...this.hostConfig })
      this.cache.set(key, off)
    }
    return off
  }

  /** Directorio raíz para la oficina "base" del plugin (arranque). */
  getPrimary(defaultDir: string): Office {
    return this.get(defaultDir)
  }

  /** Sets the host adapter for all cached offices. */
  setHost(host: HostAdapter): void {
    ;(this.hostConfig as { host?: HostAdapter }).host = host
    for (const office of this.cache.values()) {
      office.setHost(host)
    }
  }

  /** Cantidad de oficinas vivas (telemetría/debug). */
  size(): number {
    return this.cache.size
  }
}
