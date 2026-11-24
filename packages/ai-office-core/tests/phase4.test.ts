import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import {
  checkScope,
  resolveTarget,
  globToRegex,
  matchesScope,
  analyzeShellCommand,
  SENSITIVE_PATTERNS,
  OFFICE_WRITABLE,
} from "../src/core/sandbox.js"
import {
  pathsFromPatch,
  FILE_WRITE_TOOLS,
  SHELL_TOOLS,
} from "../src/hooks/scopeGuard.js"
import { safeId, safeJoin } from "../src/core/ids.js"
import { snapshotTree, diffSnapshots } from "../src/core/tripwire.js"

let tmp: string

describe("Phase 4: Sandbox Hardening, ScopeGuard & Tripwire Security", () => {
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-phase4-"))
    await fs.mkdir(path.join(tmp, "src"), { recursive: true })
    await fs.mkdir(path.join(tmp, ".oficina", "artifacts", "T-00"), { recursive: true })
    await fs.writeFile(path.join(tmp, "package.json"), "{}")
  })

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it("1. Writing to .oficina/state.json is denied even with mayTouch: ['**']", async () => {
    const verdict = await checkScope(
      tmp,
      ".oficina/state.json",
      { mayTouch: ["**"], forbidden: [] },
    )
    expect(verdict.allowed).toBe(false)
    expect(verdict.kind).toBe("forbidden")
    expect(verdict.reason).toContain("estado interno del motor (.oficina) protegido")

    const rosterVerdict = await checkScope(
      tmp,
      ".oficina/roster.json",
      { mayTouch: ["**"], forbidden: [] },
    )
    expect(rosterVerdict.allowed).toBe(false)
    expect(rosterVerdict.kind).toBe("forbidden")
    expect(rosterVerdict.reason).toContain("estado interno del motor (.oficina) protegido")
  })

  it("2. Writing to .oficina/artifacts/T-00/handoff.md is allowed", async () => {
    const verdict = await checkScope(
      tmp,
      ".oficina/artifacts/T-00/handoff.md",
      { mayTouch: ["src/**"], forbidden: [] },
    )
    expect(verdict.allowed).toBe(true)
    expect(verdict.kind).toBe("allowed")
    expect(verdict.reason).toBe("ok")

    const boardVerdict = await checkScope(
      tmp,
      ".oficina/board.md",
      { mayTouch: ["src/**"], forbidden: [] },
    )
    expect(boardVerdict.allowed).toBe(true)
    expect(boardVerdict.kind).toBe("allowed")

    const contextVerdict = await checkScope(
      tmp,
      ".oficina/context.md",
      { mayTouch: ["src/**"], forbidden: [] },
    )
    expect(contextVerdict.allowed).toBe(true)
    expect(contextVerdict.kind).toBe("allowed")
  })

  it("3. pathsFromPatch with git diff for new file (--- /dev/null) returns clean path without b/", () => {
    const patch = [
      "--- /dev/null",
      "+++ b/src/new.ts",
      "@@ -0,0 +1,3 @@",
      "+export const x = 1",
    ].join("\n")

    const paths = pathsFromPatch(patch)
    expect(paths).toEqual(["src/new.ts"])

    const patchDevNull = [
      "--- dev/null",
      "+++ b/src/another.ts",
      "@@ -0,0 +1,1 @@",
      "+test",
    ].join("\n")
    expect(pathsFromPatch(patchDevNull)).toEqual(["src/another.ts"])

    const modifyPatch = [
      "--- a/src/index.ts",
      "+++ b/src/index.ts",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
    ].join("\n")
    expect(pathsFromPatch(modifyPatch)).toEqual(["src/index.ts"])
  })

  it("4. analyzeShellCommand detects PowerShell Set-Content and does not treat x => x.id as a redirect", () => {
    // Arrow function does not trigger redirect
    const arrowCmd = `node -e "const f = (x => x.id); console.log(f({ id: 1 }))"`
    const arrowCandidates = analyzeShellCommand(arrowCmd)
    const redirects = arrowCandidates.filter((c) => c.op === "redirect")
    expect(redirects).toHaveLength(0)

    // PowerShell Set-Content with target
    const psCmd = 'Set-Content .env "SECRET=true"'
    const psCandidates = analyzeShellCommand(psCmd)
    const sc = psCandidates.find((c) => c.target === ".env")
    expect(sc).toBeDefined()
    expect(sc?.op.toLowerCase()).toBe("set-content")

    // PowerShell Add-Content and Out-File
    const addCmd = 'Add-Content -Path "notes.txt" -Value "entry"'
    expect(analyzeShellCommand(addCmd).some((c) => c.target === "notes.txt")).toBe(true)

    const outFileCmd = '"hello" | Out-File -FilePath output.log'
    expect(analyzeShellCommand(outFileCmd).some((c) => c.target === "output.log")).toBe(true)

    // PowerShell New-Item and Remove-Item
    const niCmd = 'New-Item -Path "src/temp.ts" -ItemType File'
    expect(analyzeShellCommand(niCmd).some((c) => c.target === "src/temp.ts")).toBe(true)

    const riCmd = 'Remove-Item "src/temp.ts"'
    expect(analyzeShellCommand(riCmd).some((c) => c.target === "src/temp.ts")).toBe(true)

    // PowerShell [System.IO.File]::WriteAllText
    const netCmd = '[System.IO.File]::WriteAllText("out.txt", "content")'
    expect(analyzeShellCommand(netCmd).some((c) => c.target === "out.txt")).toBe(true)

    // PowerShell Invoke-WebRequest -OutFile
    const iwrCmd = 'Invoke-WebRequest https://example.com -OutFile downloaded.zip'
    expect(analyzeShellCommand(iwrCmd).some((c) => c.target === "downloaded.zip")).toBe(true)

    // Ignores 2>&1, /dev/null, $null
    const ignoreCmd = 'npm test 2>&1 > /dev/null | Out-Null > $null'
    const ignored = analyzeShellCommand(ignoreCmd)
    expect(ignored.some((c) => c.target === "2>&1" || c.target === "/dev/null" || c.target === "$null")).toBe(false)

    // Flags interpreter with -e / -c as uncertain
    const interpCmd = 'node --no-warnings -e "process.exit(0)"'
    const interpCandidates = analyzeShellCommand(interpCmd)
    expect(interpCandidates.some((c) => c.uncertain)).toBe(true)
  })

  it("5. Windows case-insensitivity in globToRegex", () => {
    const isWindows = process.platform === "win32"
    const regex = globToRegex("src/**/*.ts")
    if (isWindows) {
      expect(regex.test("SRC/COMPONENTS/BUTTON.TS")).toBe(true)
      expect(regex.test("src/components/button.ts")).toBe(true)
      expect(matchesScope("SRC/INDEX.TS", ["src/**"])).toBe(true)
    } else {
      expect(regex.test("src/components/button.ts")).toBe(true)
    }
  })

  it("6. safeId rejects ':', trailing dots/spaces, and Windows device names", () => {
    // Colon
    expect(safeId("card:1")).toBeUndefined()
    expect(safeId("foo:bar")).toBeUndefined()

    // Trailing dots and spaces
    expect(safeId("T-00.")).toBeUndefined()
    expect(safeId("T-00..")).toBeUndefined()
    expect(safeId("T-00 ")).toBeUndefined()
    expect(safeId("card. ")).toBeUndefined()

    // Windows device names (case insensitive)
    expect(safeId("con")).toBeUndefined()
    expect(safeId("CON")).toBeUndefined()
    expect(safeId("prn")).toBeUndefined()
    expect(safeId("aux")).toBeUndefined()
    expect(safeId("nul")).toBeUndefined()
    expect(safeId("com1")).toBeUndefined()
    expect(safeId("COM9")).toBeUndefined()
    expect(safeId("lpt1")).toBeUndefined()
    expect(safeId("con.txt")).toBeUndefined()
    expect(safeId("NUL.json")).toBeUndefined()

    // Valid IDs remain safe
    expect(safeId("T-00")).toBe("T-00")
    expect(safeId("e-dev-backend")).toBe("e-dev-backend")
    expect(safeId("card_123")).toBe("card_123")

    // safeJoin uses path.join and safely combines dir and safe id
    const joined = safeJoin(tmp, "T-00", ".json")
    expect(joined).toBe(path.join(tmp, "T-00.json"))
    expect(safeJoin(tmp, "con")).toBeUndefined()
  })

  it("7. .opencode/agents/** is protected in SENSITIVE_PATTERNS", async () => {
    expect(SENSITIVE_PATTERNS).toContain("**/.opencode/agents/**")

    const verdict = await checkScope(
      tmp,
      ".opencode/agents/hacked.md",
      { mayTouch: ["**"], forbidden: [] },
    )
    expect(verdict.allowed).toBe(false)
    expect(verdict.kind).toBe("sensitive")
    expect(verdict.reason).toContain("archivo sensible")
  })

  it("8. NTFS alternate data streams (::$DATA) are rejected", async () => {
    if (process.platform === "win32") {
      const verdict = await checkScope(
        tmp,
        ".env::$DATA",
        { mayTouch: ["**"], forbidden: [] },
      )
      expect(verdict.allowed).toBe(false)
      expect(verdict.kind).toBe("invalid")

      await expect(resolveTarget(tmp, "src/index.ts:stream")).rejects.toThrow("NTFS alternate data streams")
    }
  })

  it("9. Tripwire recurses into dot-directories (.oficina, .github, etc.) and tracks symlinks", async () => {
    const dotDir = path.join(tmp, ".github")
    await fs.mkdir(dotDir, { recursive: true })
    const dotFile = path.join(dotDir, "workflows.yml")
    await fs.writeFile(dotFile, "name: CI")

    const snap1 = await snapshotTree(tmp, ["src/**"])
    expect(snap1.files.has(".github/workflows.yml")).toBe(true)

    // Modify file in .github
    await fs.writeFile(dotFile, "name: CI v2")
    const snap2 = await snapshotTree(tmp, ["src/**"])
    const diff = diffSnapshots(snap1, snap2, ["src/**"])

    const changed = diff.changes.find((c) => c.path === ".github/workflows.yml")
    expect(changed).toBeDefined()
    expect(changed?.kind).toBe("modified")
    expect(changed?.outsideScope).toBe(true)
  })

  it("10. FILE_WRITE_TOOLS and SHELL_TOOLS exported from scopeGuard are comprehensive and shared", () => {
    expect(FILE_WRITE_TOOLS.has("edit")).toBe(true)
    expect(FILE_WRITE_TOOLS.has("write")).toBe(true)
    expect(FILE_WRITE_TOOLS.has("patch")).toBe(true)
    expect(FILE_WRITE_TOOLS.has("multi_edit")).toBe(true)
    expect(FILE_WRITE_TOOLS.has("str_replace_based_edit_tool")).toBe(true)

    expect(SHELL_TOOLS.has("bash")).toBe(true)
    expect(SHELL_TOOLS.has("powershell")).toBe(true)
    expect(SHELL_TOOLS.has("powershell.exe")).toBe(true)
    expect(SHELL_TOOLS.has("cmd")).toBe(true)
  })
})
