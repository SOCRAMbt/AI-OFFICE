/**
 * Dashboard visual: arranque automatico del servidor + apertura del
 * navegador.
 *
 * ## Como funciona
 *
 * El plugin no quiere ser quien sirva HTTP: el dashboard corre como proceso
 * `detached`, asi que sobrevive al cierre de OpenCode y una segunda sesion
 * encuentra al primero por un health-check (no hay dos servidores para el
 * mismo `.oficina/`).
 *
 * El servidor escribe `<officeDir>/dashboard.json` al escuchar; ahi quedan la
 * URL y el puerto reales (puede haber negociado otro puerto si el 7333
 * estaba ocupado por otro proyecto). El plugin lo lee para abrir el
 * navegador.
 */

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { logger } from "./log.js"

const log = logger("oficina:dashboard")

export interface DashboardInfo {
  /** URL completa: `http://localhost:7333` */
  url: string
  port: number
}

/** El dir `dashboard/` del paquete (o del repo, si corre desde el codigo). */
function dashboardDir(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url))
  // dist/core/dashboard.js → root del paquete; src/core/dashboard.ts → root
  // del repo. La misma formula sirve para los dos.
  const root = path.resolve(here, "../..")
  const candidates = [path.join(root, "dashboard"), path.join(root, "src", "dashboard")]
  return candidates.find((c) => existsSync(path.join(c, "server.mjs")))
}

/** Abre una URL en el navegador del sistema (cross-platform, sin deps). */
export function openBrowser(url: string): void {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1):\d+(\/.*)?$/.test(url)) {
    log.warn("url inválida para abrir el navegador", { url })
    return
  }
  try {
    const stdio = { detached: true, stdio: "ignore", windowsHide: true } as const
    let child
    if (process.platform === "win32") {
      child = spawn("cmd", ["/c", "start", "", url], stdio)
    } else if (process.platform === "darwin") {
      child = spawn("open", [url], stdio)
    } else {
      child = spawn("xdg-open", [url], stdio)
    }
    child.on("error", (err) => {
      log.warn("error al abrir el navegador", { url, error: String(err) })
    })
    child.unref()
  } catch (err) {
    log.warn("no se pudo abrir el navegador", { url, error: String(err) })
  }
}

/** Lee `<officeDir>/dashboard.json`, que el servidor escribe al escuchar. */
export async function readDashboardInfo(officeDir: string): Promise<DashboardInfo | undefined> {
  try {
    const raw = await readFile(path.join(officeDir, "dashboard.json"), "utf8")
    const info = JSON.parse(raw) as DashboardInfo
    if (info?.url && info?.port) return info
  } catch {
    /* sin dashboard corriendo */
  }
  return undefined
}

/** Health-check: el servidor responde `/api/state` en 1.2s? */
async function alive(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/state`, { signal: AbortSignal.timeout(1200) })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Garantiza que el dashboard este corriendo para `officeDir`.
 * Idempotente: si ya corre, devuelve la info sin tocar nada.
 */
export async function startDashboard(
  projectRoot: string,
  officeDir: string,
  opts: { port?: number } = {},
): Promise<DashboardInfo | undefined> {
  const dir = dashboardDir()
  if (!dir) {
    log.debug("dashboard no empaquetado en esta instalacion")
    return undefined
  }

  // 1. Ya hay un servidor para esta oficina?
  const info = await readDashboardInfo(officeDir)
  if (info && (await alive(info.url))) return info

  // 2. Info rancia (server muerto): limpiar y arrancar uno nuevo.
  const args = [path.join(dir, "server.mjs"), "--oficina", officeDir, "--no-open"]
  if (opts.port) args.push("--port", String(opts.port))
  try {
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      cwd: projectRoot,
    })
    child.unref()
  } catch (err) {
    log.warn("no se pudo arrancar el dashboard", { error: String(err) })
    return undefined
  }

  // 3. Esperar el handshake del servidor (dashboard.json).
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 150))
    const fresh = await readDashboardInfo(officeDir)
    if (fresh && (await alive(fresh.url))) return fresh
  }
  log.warn("el dashboard no respondio despues de arrancar", { officeDir })
  return undefined
}
