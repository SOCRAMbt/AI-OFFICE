import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { auditRepo, loadTraits, selectTraitsForCard } from "../src/core/traits.js"

let tmp: string
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-traits-"))
})
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe("auditRepo(): detecta el stack desde package.json, tsconfig y OS", () => {
  it("detecta typescript (strict), vitest, postgres, react y markdown", async () => {
    await fs.writeFile(
      path.join(tmp, "package.json"),
      JSON.stringify({
        name: "target",
        devDependencies: { vitest: "^1.0.0", typescript: "^5.0.0" },
        dependencies: { pg: "^8.0.0", react: "^18.0.0", "react-dom": "^18.0.0" },
      }),
    )
    await fs.writeFile(path.join(tmp, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } }))
    await fs.mkdir(path.join(tmp, "docs"), { recursive: true })

    const tags = await auditRepo(tmp)
    expect(tags).toEqual(expect.arrayContaining(["typescript", "vitest", "postgres", "react", "markdown"]))
  })

  it("agrega el tag de OS (windows en Windows, posix en POSIX)", async () => {
    await fs.writeFile(path.join(tmp, "package.json"), JSON.stringify({ name: "x", dependencies: {} }))
    const tags = await auditRepo(tmp)
    if (process.platform === "win32") expect(tags).toContain("windows")
    else expect(tags).toContain("posix")
  })

  it("repo vacío: solo el tag de OS", async () => {
    const tags = await auditRepo(tmp)
    expect(tags.length).toBe(1)
  })
})

describe("selectTraitsForCard + loadTraits", () => {
  it("selecciona traits por tags del stack o de capabilities de la card", () => {
    const ids = selectTraitsForCard(["typescript", "vitest"], ["react"])
    expect(ids).toEqual(expect.arrayContaining(["typescript-strict", "vitest-testing", "react-hooks"]))
    expect(ids).not.toContain("postgres-migrations")
  })

  it("carga bodies de los traits correspondientes desde el paquete", async () => {
    const traits = await loadTraits(tmp, ["typescript-strict"])
    expect(traits).toHaveLength(1)
    expect(traits[0]!.title).toContain("TypeScript")
    expect(traits[0]!.body).toContain("strict")
  })

  it("no carga traits sin match — solo relevantes", async () => {
    const traits = await loadTraits(tmp, ["react-hooks"])
    expect(traits).toHaveLength(1)
    expect(traits[0]!.id).toBe("react-hooks")
  })
})
