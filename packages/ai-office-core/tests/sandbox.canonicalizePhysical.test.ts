import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "node:fs/promises"
import fsSync from "node:fs"
import path from "node:path"
import os from "node:os"
import { canonicalizePhysical, canonicalizeLexical } from "../src/sandbox.js"

describe("canonicalizePhysical — ENOENT vs EPERM distinction", () => {
  let tmpDir: string
  let projectRoot: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-canonicalize-"))
    projectRoot = await fs.mkdtemp(path.join(tmpDir, "project-"))
  })

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  })

  it("should throw on broken symlink in middle of path (not silently go up)", async () => {
    // Create: projectRoot/realDir -> realDir exists
    // Create: projectRoot/linkDir -> symlink to /nonexistent/path
    // Create: projectRoot/linkDir/file.txt (target of canonicalizePhysical)
    
    const realDir = path.join(projectRoot, "realDir")
    await fs.mkdir(realDir, { recursive: true })
    
    const brokenLinkDir = path.join(projectRoot, "linkDir")
    await fs.symlink("/nonexistent/path/does/not/exist", brokenLinkDir)
    
    const targetFile = path.join(brokenLinkDir, "file.txt")
    
    // canonicalizePhysical should throw on broken symlink (not silently go up)
    await expect(canonicalizePhysical(targetFile)).rejects.toThrow()
  })

  it("should throw EPERM when ancestor directory has no permissions", async () => {
    // Skip on Windows where EPERM behavior differs
    if (process.platform === "win32") {
      return
    }
    
    const restrictedDir = path.join(projectRoot, "restricted")
    await fs.mkdir(restrictedDir, { recursive: true })
    
    const subDir = path.join(restrictedDir, "subdir")
    await fs.mkdir(subDir, { recursive: true })
    
    const targetFile = path.join(subDir, "file.txt")
    
    // Remove read permissions from parent directory
    await fs.chmod(restrictedDir, 0o000)
    
    try {
      // canonicalizePhysical should throw EPERM (not silently go up)
      await expect(canonicalizePhysical(targetFile)).rejects.toThrow()
      
      try {
        await canonicalizePhysical(targetFile)
      } catch (err: any) {
        expect(err.code).toBe("EACCES") // or EPERM depending on OS
      }
    } finally {
      // Restore permissions for cleanup
      await fs.chmod(restrictedDir, 0o755).catch(() => {})
    }
  })

  it("should resolve path with .. that escapes (validation done at higher level)", async () => {
    // canonicalizePhysical does not validate project root escape.
    // That validation is done in resolveTarget/checkScope.
    // This test verifies canonicalizePhysical resolves the path physically.
    const escapePath = path.join(projectRoot, "..", "outside")
    
    // Should resolve without throwing (the path exists after resolution)
    // Note: the parent directory of projectRoot exists, so this resolves
    const result = await canonicalizePhysical(escapePath)
    expect(result).toContain("outside")
  })

  it("should resolve NTFS alternate data stream on Windows (validation done at higher level)", async () => {
    if (process.platform !== "win32") {
      return // Skip on non-Windows
    }
    
    // canonicalizePhysical does not validate NTFS streams.
    // That validation is done in resolveTarget.
    // This test verifies canonicalizePhysical resolves the path.
    const streamPath = `C:\\foo:stream`
    
    // Should resolve without throwing (validation happens at higher level)
    // Note: this may fail if C:\foo doesn't exist, which is expected behavior
    try {
      const result = await canonicalizePhysical(streamPath)
      expect(typeof result).toBe("string")
    } catch (err: any) {
      // Expected to fail if path doesn't exist - that's correct behavior
      expect(err.code).toBe("ENOENT")
    }
  })

  it("should still resolve valid paths with non-existent tail", async () => {
    const existingDir = path.join(projectRoot, "existing")
    await fs.mkdir(existingDir, { recursive: true })
    
    const targetFile = path.join(existingDir, "newfile.txt")
    
    const result = await canonicalizePhysical(targetFile)
    
    expect(result).toContain("existing")
    expect(result).toContain("newfile.txt")
  })

  it("should handle symlink to valid directory correctly", async () => {
    const realDir = path.join(projectRoot, "realTarget")
    await fs.mkdir(realDir, { recursive: true })
    await fs.writeFile(path.join(realDir, "file.txt"), "content")
    
    const linkDir = path.join(projectRoot, "linkToTarget")
    await fs.symlink(realDir, linkDir, "dir")
    
    const targetFile = path.join(linkDir, "file.txt")
    
    const result = await canonicalizePhysical(targetFile)
    
    expect(result).toContain("realTarget")
    expect(result).toContain("file.txt")
  })

  it("should distinguish from canonicalizeLexical behavior on broken symlink", async () => {
    const realDir = path.join(projectRoot, "realDir2")
    await fs.mkdir(realDir, { recursive: true })
    
    const brokenLink = path.join(projectRoot, "brokenLink")
    await fs.symlink("/nonexistent/target", brokenLink)
    
    const targetFile = path.join(brokenLink, "file.txt")
    
    // canonicalizePhysical should throw
    await expect(canonicalizePhysical(targetFile)).rejects.toThrow()
    
    // canonicalizeLexical should resolve (doesn't follow symlinks)
    const lexicalResult = await canonicalizeLexical(targetFile)
    expect(lexicalResult).toContain("brokenLink")
  })
})