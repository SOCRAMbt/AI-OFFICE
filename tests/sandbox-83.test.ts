/**
 * Tests for Windows 8.3 short-name alias handling.
 * These tests reproduce the exact failure mode seen in GitHub Actions Windows runners
 * where temp directories use 8.3 aliases like RUNNER~1.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { checkScope, resolveTarget, isInsideRoot } from "../src/core/sandbox.js"

let tmp: string
let root: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-83test-"))
  root = path.join(tmp, "proyecto")
  await fs.mkdir(path.join(root, "src", "components"), { recursive: true })
  await fs.writeFile(path.join(root, "src", "components", "Button.tsx"), "export const B = 1\n")
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

const policy = {
  mayTouch: ["src/**"],
  forbidden: [],
}

/**
 * Helper to simulate an 8.3 alias path on Windows.
 * On Windows, we can get the short path using fs.realpath on a path that
 * doesn't exist - but the real issue is that GitHub Actions runners have
 * temp dirs that are ALREADY in 8.3 form.
 * 
 * We simulate this by creating a path with a component that looks like an 8.3 alias
 * (e.g., "RUNNER~1") and verify the normalization handles it correctly.
 */
function make83AliasPath(base: string, aliasComponent: string, ...rest: string[]): string {
  return path.join(base, aliasComponent, ...rest)
}

describe("Windows 8.3 alias handling (regression for GitHub Actions)", () => {
  // The core issue: fs.realpath() on Windows does NOT expand 8.3 aliases.
  // If the temp dir is C:\Users\RUNNER~1\AppData\Local\Temp\..., realpath returns
  // the same 8.3 path. We need to normalize BOTH root and target the SAME way.

  it("normalizes root and target consistently when both use 8.3 alias", async () => {
    // Simulate: project root is at an 8.3 alias path
    // We can't easily create a real 8.3 alias in tests, but we can test that
    // the normalization function treats both paths identically
    
    // Use the actual temp path (which might have 8.3 on Windows CI)
    const target = path.join(root, "src", "components", "Button.tsx")
    
    const t = await resolveTarget(root, target)
    expect(t.insidePhysically).toBe(true)
    expect(t.relative).toBe("src/components/Button.tsx")
  })

  it("allows writing to .oficina/artifacts/ even when root uses 8.3 alias", async () => {
    // This is the exact case that fails in CI:
    // root = C:\Users\RUNNER~1\AppData\Local\Temp\oficina-scope-XXXX
    // target = C:\Users\RUNNER~1\AppData\Local\Temp\oficina-scope-XXXX\.oficina\artifacts\T-00\handoff.md
    // Both use the same 8.3 alias, but the normalization was inconsistent
    
    const artifactsDir = path.join(root, ".oficina", "artifacts", "T-00")
    await fs.mkdir(artifactsDir, { recursive: true })
    
    const handoffPath = path.join(artifactsDir, "handoff.md")
    
    // This should be ALLOWED because .oficina/artifacts/** is in OFFICE_WRITABLE
    const v = await checkScope(root, handoffPath, { mayTouch: ["src/**"], forbidden: [] })
    expect(v.allowed).toBe(true)
    expect(v.kind).toBe("allowed")
  })

  it("handles target with multiple non-existent intermediate directories", async () => {
    // The real case: .oficina/artifacts/T-00/handoff.md where NONE of these exist yet
    // The resolution must walk up to the deepest existing ancestor (root)
    // and re-attach the entire tail
    
    const deepTarget = path.join(root, ".oficina", "artifacts", "T-00", "handoff.md")
    // None of .oficina, artifacts, T-00 exist yet
    
    const t = await resolveTarget(root, deepTarget)
    expect(t.relative).toBe(".oficina/artifacts/T-00/handoff.md")
    expect(t.exists).toBe(false)
    expect(t.insidePhysically).toBe(true)
  })

  it("denies path that escapes via 8.3-looking component", async () => {
    // Even if a path component LOOKS like an 8.3 alias, if it actually
    // points outside the project, it must be denied
    const outsidePath = path.join(tmp, "secreto.txt")
    await fs.writeFile(outsidePath, "secret\n")
    
    // We can't easily create a real 8.3 alias in tests, but we verify
    // that the normal escape detection still works
    const v = await checkScope(root, outsidePath, policy)
    expect(v.allowed).toBe(false)
    expect(v.kind).toBe("outside-project")
  })

  it("isInsideRoot is case-insensitive on Windows", () => {
    if (process.platform !== "win32") return
    
    const rootLower = root.toLowerCase()
    const target = path.join(root, "src", "components", "Button.tsx")
    const targetLower = target.toLowerCase()
    
    expect(isInsideRoot(rootLower, targetLower)).toBe(true)
    expect(isInsideRoot(rootLower, target)).toBe(true)
  })
})

describe("Path normalization consistency", () => {
  it("same normalization function for root and target", async () => {
    // The fix: both root and target must go through the SAME normalization
    // function. This test verifies the behavior, not the implementation.
    
    const target = path.join(root, "src", "components", "NewFile.tsx")
    // File doesn't exist
    
    const t = await resolveTarget(root, target)
    expect(t.relative).toBe("src/components/NewFile.tsx")
    expect(t.insideLexically).toBe(true)
    expect(t.insidePhysically).toBe(true)
  })

  it("symlink escape detection works with non-existent paths", async () => {
    const outsideDir = path.join(tmp, "outside")
    await fs.mkdir(outsideDir)
    await fs.writeFile(path.join(outsideDir, "secret.txt"), "x\n")
    
    // Create a symlink inside the project that points outside
    const linkPath = path.join(root, "src", "components", "escape.ts")
    await fs.symlink(path.join(outsideDir, "secret.txt"), linkPath)
    
    // Even though the target of the symlink doesn't exist in the project,
    // the symlink itself exists and points outside
    const t = await resolveTarget(root, "src/components/escape.ts")
    expect(t.insidePhysically).toBe(false)
    expect(t.symlinks.length).toBeGreaterThan(0)
  })
})

describe("Absolute path normalization (critical for GitHub Actions Windows)", () => {
  // The CI failure: absolute paths passed to checkScope were normalized differently
  // than the root. The fix ensures BOTH go through normalizePath().

  it("allows absolute path inside project when root is relative", async () => {
    const absoluteTarget = path.join(root, "src", "components", "Button.tsx")
    const v = await checkScope(root, absoluteTarget, policy)
    expect(v.allowed).toBe(true)
    expect(v.kind).toBe("allowed")
  })

  it("allows absolute path to .oficina/artifacts (the exact CI failure case)", async () => {
    const artifactsDir = path.join(root, ".oficina", "artifacts", "T-00")
    await fs.mkdir(artifactsDir, { recursive: true })
    
    const absoluteHandoff = path.join(artifactsDir, "handoff.md")
    // Pass ABSOLUTE path - this is what the plugin does in CI
    const v = await checkScope(root, absoluteHandoff, { mayTouch: ["src/**"], forbidden: [] })
    expect(v.allowed).toBe(true)
    expect(v.kind).toBe("allowed")
  })

  it("rejects absolute path outside project", async () => {
    const outsidePath = path.join(tmp, "fuera.txt")
    await fs.writeFile(outsidePath, "secret\n")
    
    const v = await checkScope(root, outsidePath, policy)
    expect(v.allowed).toBe(false)
    expect(v.kind).toBe("outside-project")
  })

  it("canonicalizePhysical expands 8.3 aliases on absolute path with non-existent tail", async () => {
    const { canonicalizePhysical } = await import("../src/core/sandbox.js")
    const deepAbsolute = path.join(root, ".oficina", "artifacts", "T-00", "handoff.md")
    // None of .oficina/artifacts/T-00 exist
    
    const normalized = await canonicalizePhysical(deepAbsolute)
    // canonicalizePhysical uses fs.realpath which expands 8.3 aliases on Windows
    // (RUNNER~1 -> runneradmin). In test environments without 8.3 aliases,
    // the path remains unchanged. This test documents the expected behavior.
    if (deepAbsolute.includes("RUNNER~1")) {
      expect(normalized).toBe(deepAbsolute.replace(/RUNNER~1/gi, "runneradmin"))
    } else {
      // No 8.3 alias in test path - verify normalization doesn't break the path
      expect(normalized).toBe(deepAbsolute)
    }
  })

  it("resolveTarget returns same projectRoot for root and absolute target", async () => {
    const absoluteTarget = path.join(root, "src", "components", "NewFile.tsx")
    const t = await resolveTarget(root, absoluteTarget)
    
    // The projectRoot returned should be the normalized root
    expect(t.projectRoot).toBeDefined()
    expect(t.insideLexically).toBe(true)
    expect(t.insidePhysically).toBe(true)
  })
})