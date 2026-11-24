/**
 * Guard de empaquetado: lo que sube a npm es superficie pública.
 *
 * En v3.1.2 y v3.1.3 se colaron `dist/v2.js.bak` y `dist/tools/index.js.bak`
 * al tarball (restos del dist local: el campo `files` incluye `dist/` entero).
 * Sin secretos adentro, pero es superficie basura y el patrón se repite.
 *
 * Este test corre `npm pack --dry-run` y falla si el tarball contiene
 * cualquier archivo prohibido. Está en la suite, y la suite corre en
 * `prepublishOnly` → un publish con basura se aborta solo.
 */

import { describe, it, expect } from "vitest"
import { execSync } from "node:child_process"
import path from "node:path"

/** Patrones prohibidos en el path relativo dentro del tarball. */
const FORBIDDEN: Array<[string, RegExp]> = [
  ["archivos .bak con código stale", /\.(bak|orig|rej)$/],
  [".env y variantes", /(^|\/)\.env($|\.)/],
  [".npmrc (puede contener tokens)", /(^|\/)\.npmrc$/],
  ["estado de la oficina (.oficina/)", /(^|\/)\.oficina\//],
  ["directorio .git embebido", /(^|\/)\.git\//],
  ["claves privadas", /\.pem$|id_rsa|id_ed25519|\.pfx$|\.p12$/],
  ["reportes de auditoría internos", /^AUDIT_|^FIX_DESIGN/],
  ["reportes de test/cobertura", /(^|\/)(coverage|\.nyc_output)\//],
  ["logs", /\.log$/],
]

interface PackedFile {
  path: string
  size: number
  mode: number
}

describe("Empaquetado npm: superficie pública limpia", () => {
  it(
    "el tarball no contiene archivos prohibidos (.bak, .env, .oficina, auditorías, claves)",
    { timeout: 120_000 },
    async () => {
      const root = process.cwd()
      const out = execSync("npm pack --dry-run --json", { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      const parsed = JSON.parse(out) as Array<{ files?: PackedFile[] }>
      const files = (parsed[0]?.files ?? []).map((f) => f.path.split(path.sep).join("/"))

      expect(files.length).toBeGreaterThan(0)

      const violations: string[] = []
      for (const [label, pattern] of FORBIDDEN) {
        for (const file of files) {
          if (pattern.test(file)) violations.push(`[${label}] ${file}`)
        }
      }

      expect(violations).toEqual([])
    },
  )

  it("el tarball no excede un tamaño razonable (< 3 MB)", { timeout: 120_000 }, async () => {
    const root = process.cwd()
    const out = execSync("npm pack --dry-run --json", { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    const parsed = JSON.parse(out) as Array<{ unpackedSize?: number }>
    // 3.1.x ronda 2.7 MB descomprimido; un salto grande (assets o snapshots
    // nuevos) es señal de que algo que no debía entró al paquete.
    expect(parsed[0]?.unpackedSize ?? 0).toBeLessThan(3 * 1024 * 1024)
  })
})
