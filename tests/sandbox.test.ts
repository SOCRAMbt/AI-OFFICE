/**
 * Tests adversariales del sandbox.
 *
 * Cada test es un **intento de evasión** concreto. Si alguno pasa, el scope
 * no es una restricción y todo lo demás que la oficina promete es falso.
 *
 * Los vectores vienen del review de seguridad:
 *   1. Escape por `..`
 *   2. Escape por path absoluto
 *   3. Escape por symlink
 *   4. Symlink roto
 *   5. `mayTouch: ["**"]` como comodín del filesystem
 *   6. Archivos sensibles
 *   7. Diff multi-archivo (solo se chequeaba el primero)
 *   8. Shell escribiendo fuera del scope
 *   9. Interpreters embebidos
 *  10. Bytes NUL
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import {
  analyzeShellCommand,
  checkScope,
  isSensitive,
  isInsideRoot,
  matchesScope,
  resolveTarget,
} from "../src/core/sandbox.js"

let tmp: string
let root: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-sandbox-"))
  root = path.join(tmp, "proyecto")
  await fs.mkdir(path.join(root, "src", "components"), { recursive: true })
  await fs.mkdir(path.join(root, "src", "server"), { recursive: true })
  await fs.writeFile(path.join(root, "src", "components", "Button.tsx"), "export const B = 1\n")
  await fs.writeFile(path.join(root, "src", "server", "api.ts"), "export const a = 1\n")
  await fs.writeFile(path.join(root, "README.md"), "# demo\n")
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

const policy = {
  mayTouch: ["src/components/**", "README.md"],
  forbidden: ["src/server/**"],
}

describe("Contención en el root", () => {
  it("un path dentro del root esta adentro", () => {
    expect(isInsideRoot(root, path.join(root, "src"))).toBe(true)
    expect(isInsideRoot(root, root)).toBe(true)
  })

  it("un path hermano con prefijo comun NO esta adentro", () => {
    // El caso clasico: "/proj" no contiene "/proj-evil".
    expect(isInsideRoot(root, `${root}-evil`)).toBe(false)
    expect(isInsideRoot(root, path.join(tmp, "otro"))).toBe(false)
  })

  it("un path padre NO esta adentro", () => {
    expect(isInsideRoot(root, path.dirname(root))).toBe(false)
  })
})

describe("Escape por `..`", () => {
  it("rechaza un path relativo que sube del proyecto", async () => {
    const v = await checkScope(root, "../fuera.txt", policy)
    expect(v.allowed).toBe(false)
    expect(v.kind).toBe("outside-project")
  })

  it("rechaza aunque mayTouch sea `**`", async () => {
    // El bug original: `**` matcheaba cualquier string.
    const v = await checkScope(root, "../../etc/passwd", { mayTouch: ["**"], forbidden: [] })
    expect(v.allowed).toBe(false)
    expect(v.kind).toBe("outside-project")
  })

  it("rechaza `..` embebido en medio del path", async () => {
    const v = await checkScope(root, "src/../../../fuera.txt", policy)
    expect(v.allowed).toBe(false)
  })
})

describe("Paths absolutos", () => {
  it("rechaza un absoluto fuera del proyecto", async () => {
    const v = await checkScope(root, path.join(tmp, "fuera.txt"), policy)
    expect(v.allowed).toBe(false)
    expect(v.kind).toBe("outside-project")
  })

  it("rechaza un absoluto del sistema", async () => {
    const v = await checkScope(root, "/etc/passwd", { mayTouch: ["**"], forbidden: [] })
    expect(v.allowed).toBe(false)
  })

  it("acepta un absoluto DENTRO del proyecto", async () => {
    const v = await checkScope(root, path.join(root, "src", "components", "Button.tsx"), policy)
    expect(v.allowed).toBe(true)
  })
})

describe("Escape por symlink", () => {
  it("rechaza un symlink que apunta afuera del proyecto", async () => {
    const fuera = path.join(tmp, "secreto.txt")
    await fs.writeFile(fuera, "clave\n")
    await fs.symlink(fuera, path.join(root, "src", "components", "link.ts"))

    const v = await checkScope(root, "src/components/link.ts", policy)
    expect(v.allowed).toBe(false)
    expect(v.kind).toBe("symlink-escape")
    expect(v.symlinks.length).toBeGreaterThan(0)
  })

  it("rechaza un symlink a un DIRECTORIO fuera", async () => {
    const fueraDir = path.join(tmp, "fuera")
    await fs.mkdir(fueraDir)
    await fs.symlink(fueraDir, path.join(root, "src", "components", "linkdir"))

    const v = await checkScope(root, "src/components/linkdir/nuevo.ts", policy)
    expect(v.allowed).toBe(false)
    expect(v.kind).toBe("symlink-escape")
  })

  it("rechaza un symlink roto (no sabemos a donde apunta)", async () => {
    await fs.symlink(path.join(tmp, "no-existe-este"), path.join(root, "src", "components", "roto.ts"))
    const v = await checkScope(root, "src/components/roto.ts", policy)
    expect(v.allowed).toBe(false)
  })

  it("acepta un symlink que apunta DENTRO del proyecto y evalua el path real", async () => {
    // `alias.ts` -> `Button.tsx`. Ambos estan en el scope, asi que pasa.
    await fs.symlink(path.join(root, "src", "components", "Button.tsx"), path.join(root, "src", "components", "alias.ts"))
    const v = await checkScope(root, "src/components/alias.ts", policy)
    expect(v.allowed).toBe(true)
  })

  it("el scope se evalua contra el path REAL, no contra el alias", async () => {
    // `alias.ts` vive en `src/components/` (dentro del scope) pero apunta a
    // `src/server/api.ts`, que esta en forbidden. Escribir por el alias
    // debe rechazarse: el scope es del path real.
    await fs.symlink(path.join(root, "src", "server", "api.ts"), path.join(root, "src", "components", "alias.ts"))
    const v = await checkScope(root, "src/components/alias.ts", policy)
    expect(v.allowed).toBe(false)
    // Y el motivo es el del path real, no el del alias.
    expect(v.relative).toBe("src/server/api.ts")
  })
})

describe("Resolucion real", () => {
  it("resuelve el path real de un archivo existente", async () => {
    const t = await resolveTarget(root, "src/components/Button.tsx")
    expect(t.relative).toBe("src/components/Button.tsx")
    expect(t.insidePhysically).toBe(true)
    expect(t.exists).toBe(true)
  })

  it("resuelve tambien un archivo que todavia no existe", async () => {
    const t = await resolveTarget(root, "src/components/Nuevo.tsx")
    expect(t.relative).toBe("src/components/Nuevo.tsx")
    expect(t.exists).toBe(false)
    expect(t.insidePhysically).toBe(true)
  })

  it("marca como fuera un path que sale del root", async () => {
    const t = await resolveTarget(root, "../fuera.txt")
    expect(t.insideLexically).toBe(false)
    expect(t.insidePhysically).toBe(false)
  })
})

describe("Archivos sensibles", () => {
  it("detecta .env, .npmrc, .git y claves", () => {
    expect(isSensitive(".env")).toBe(true)
    expect(isSensitive("src/.env.local")).toBe(true)
    expect(isSensitive(".npmrc")).toBe(true)
    expect(isSensitive(".git/config")).toBe(true)
    expect(isSensitive("deploy/id_rsa")).toBe(true)
    expect(isSensitive("certs/server.pem")).toBe(true)
    expect(isSensitive("home/.ssh/id_rsa")).toBe(true)
  })

  it("NO marca los templates inocuos", () => {
    expect(isSensitive(".env.example")).toBe(false)
    expect(isSensitive("docs/.env.sample")).toBe(false)
  })

  it("bloquea un sensible aunque el scope lo permita", async () => {
    await fs.writeFile(path.join(root, ".env"), "SECRET=1\n")
    const v = await checkScope(root, ".env", { mayTouch: ["**"], forbidden: [] })
    expect(v.allowed).toBe(false)
    expect(v.kind).toBe("sensitive")
  })

  it("bloquea .git/config aunque el scope lo permita", async () => {
    await fs.mkdir(path.join(root, ".git"), { recursive: true })
    await fs.writeFile(path.join(root, ".git", "config"), "[core]\n")
    const v = await checkScope(root, ".git/config", { mayTouch: ["**"], forbidden: [] })
    expect(v.allowed).toBe(false)
    expect(v.kind).toBe("sensitive")
  })

  it("permite .env.example", async () => {
    await fs.writeFile(path.join(root, ".env.example"), "SECRET=\n")
    const v = await checkScope(root, ".env.example", { mayTouch: ["**"], forbidden: [] })
    expect(v.allowed).toBe(true)
  })
})

describe("Forbidden y mayTouch", () => {
  it("forbidden gana sobre mayTouch", async () => {
    const v = await checkScope(root, "src/server/api.ts", { mayTouch: ["src/**"], forbidden: ["src/server/**"] })
    expect(v.allowed).toBe(false)
    expect(v.kind).toBe("forbidden")
  })

  it("fuera del scope se rechaza", async () => {
    const v = await checkScope(root, "README.md", policy)
    expect(v.allowed).toBe(true)
    const v2 = await checkScope(root, "src/components/Button.tsx", policy)
    expect(v2.allowed).toBe(true)
    const v3 = await checkScope(root, "otro/archivo.ts", policy)
    expect(v3.allowed).toBe(false)
    expect(v3.kind).toBe("out-of-scope")
  })

  it("`mayTouch: []` no autoriza nada", async () => {
    const v = await checkScope(root, "README.md", { mayTouch: [], forbidden: [] })
    expect(v.allowed).toBe(false)
  })
})

describe("Entradas invalidas", () => {
  it("rechaza una ruta vacia", async () => {
    const v = await checkScope(root, "", policy)
    expect(v.allowed).toBe(false)
    expect(v.kind).toBe("invalid")
  })

  it("rechaza un byte NUL", async () => {
    const v = await checkScope(root, "src/a\u0000b.ts", policy)
    expect(v.allowed).toBe(false)
    expect(v.kind).toBe("invalid")
  })
})

describe("Analisis de comandos de shell", () => {
  it("detecta redirecciones", () => {
    const c = analyzeShellCommand("echo hola > salida.txt")
    expect(c.some((x) => x.target === "salida.txt")).toBe(true)
  })

  it("detecta redireccion con append", () => {
    const c = analyzeShellCommand("echo hola >> logs.txt")
    expect(c.some((x) => x.target === "logs.txt")).toBe(true)
  })

  it("detecta tee", () => {
    const c = analyzeShellCommand("cat a.txt | tee b.txt")
    expect(c.some((x) => x.target === "b.txt")).toBe(true)
  })

  it("detecta cp con su destino", () => {
    const c = analyzeShellCommand("cp -r src dist")
    expect(c.some((x) => x.target === "dist" && x.op === "cp")).toBe(true)
  })

  it("detecta mv con su destino", () => {
    const c = analyzeShellCommand("mv a.txt b.txt")
    expect(c.some((x) => x.target === "b.txt")).toBe(true)
  })

  it("detecta rm", () => {
    const c = analyzeShellCommand("rm -rf build")
    expect(c.some((x) => x.target === "build")).toBe(true)
  })

  it("detecta sed -i", () => {
    const c = analyzeShellCommand("sed -i 's/a/b/' archivo.txt")
    expect(c.some((x) => x.target === "archivo.txt")).toBe(true)
  })

  it("detecta dd of=", () => {
    const c = analyzeShellCommand("dd if=/dev/zero of=dump.img bs=1M")
    expect(c.some((x) => x.target === "dump.img")).toBe(true)
  })

  it("detecta curl -o", () => {
    const c = analyzeShellCommand("curl https://x.com/f -o descargado.bin")
    expect(c.some((x) => x.target === "descargado.bin")).toBe(true)
  })

  it("detecta un path absoluto en un interpreter embebido", () => {
    const c = analyzeShellCommand(`python -c "open('/etc/passwd','w').write('x')"`)
    expect(c.some((x) => x.target.includes("etc") || x.uncertain)).toBe(true)
  })

  it("detecta un path en node -e", () => {
    const c = analyzeShellCommand(`node -e "require('fs').writeFileSync('/tmp/x','y')"`)
    expect(c.some((x) => x.target.includes("tmp") || x.uncertain)).toBe(true)
  })

  it("marca como incierto cuando no puede interpretar el target", () => {
    const c = analyzeShellCommand(`python -c "import os; os.remove('secreto')"`)
    expect(c.some((x) => x.uncertain)).toBe(true)
  })

  it("no detecta escritura en un comando de solo lectura", () => {
    const c = analyzeShellCommand("cat package.json && npm test")
    expect(c.filter((x) => !x.uncertain)).toHaveLength(0)
  })
})

describe("Glob", () => {
  it("** matchea paths anidados", () => {
    expect(matchesScope("src/components/Button.tsx", ["src/**"])).toBe(true)
    expect(matchesScope("src/components/deep/Button.tsx", ["src/**"])).toBe(true)
    expect(matchesScope("lib/x.ts", ["src/**"])).toBe(false)
  })

  it("normaliza ./ y \\", () => {
    expect(matchesScope("src/a.ts", ["./src/**"])).toBe(true)
    expect(matchesScope("src/a.ts", ["src\\**"])).toBe(true)
  })
})
