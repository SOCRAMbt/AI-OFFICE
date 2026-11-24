import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import path from "node:path"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Find the repo root by looking for package.json with overrides
 * Continues past workspace packages to find the root package.json
 */
function findRepoRoot(startDir: string): string {
  let current = startDir
  let foundOverrides = false
  let rootPkg: any = null
  while (current !== path.parse(current).root) {
    const pkgPath = resolve(current, "package.json")
    try {
      const content = readFileSync(pkgPath, "utf8")
      const pkg = JSON.parse(content)
      if (pkg.overrides) {
        foundOverrides = true
        rootPkg = pkg
        // Continue up to find the ROOT package.json (the one with workspaces)
        if (pkg.workspaces) {
          return current
        }
      }
    } catch {
      // Not found, continue up
    }
    if (foundOverrides && rootPkg && !rootPkg.workspaces) {
      // We found overrides but no workspaces, keep going up to find root
    }
    current = path.dirname(current)
  }
  // Fallback to current working directory
  return process.cwd()
}

const projectRoot = findRepoRoot(__dirname)

/**
 * Test for CRIT-02: Transitive dependency vulnerabilities audit
 * 
 * This test verifies that package.json has the correct overrides to address
 * transitive dependency vulnerabilities. The actual npm audit is run in CI
 * due to execution time constraints.
 */

describe("Transitive Dependencies Audit (CRIT-02)", () => {
  it("should have zod >= 4.6.6 (fix for GHSA-mrhx-c7xc-m3w5)", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(projectRoot, "package.json"), "utf8")
    )
    
    const zodVersion = packageJson.dependencies?.zod || packageJson.devDependencies?.zod
    expect(zodVersion).toBeDefined()
    
    // Parse version range (e.g., "^4.6.7" -> 4.6.7)
    const versionMatch = zodVersion?.match(/[\d.]+/)
    const version = versionMatch ? versionMatch[0] : "0.0.0"
    const [major, minor, patch] = version.split(".").map(Number)
    
    // Should be >= 4.6.6
    expect(major).toBeGreaterThanOrEqual(4)
    if (major === 4) {
      expect(minor).toBeGreaterThanOrEqual(6)
      if (minor === 6) {
        expect(patch).toBeGreaterThanOrEqual(6)
      }
    }
  })

  it("should have overrides for transitive dependency vulnerabilities", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(projectRoot, "package.json"), "utf8")
    )
    
    const overrides = packageJson.overrides || {}
    
    // Key overrides for transitive vulnerabilities (CRIT-02)
    expect(overrides.zod).toBeDefined()
    expect(overrides.glob).toBeDefined()
    expect(overrides.minimatch).toBeDefined()
    expect(overrides.rimraf).toBeDefined()
    expect(overrides.cacache).toBeDefined()
    expect(overrides["make-fetch-happen"]).toBeDefined()
    expect(overrides.pacote).toBeDefined()
    expect(overrides.sigstore).toBeDefined()
    expect(overrides["tuf-js"]).toBeDefined()
    
    // Verify version ranges are safe
    expect(overrides.zod).toMatch(/^[\^~]?4\.6\.[7-9]|5\./)
    expect(overrides.glob).toMatch(/^[\^~]?1[0-9]\./)
    expect(overrides.minimatch).toMatch(/^[\^~]?9\./)
  })

  it("should document devDependencies exceptions in SECURITY.md", () => {
    const securityMd = readFileSync(resolve(projectRoot, "SECURITY.md"), "utf8")
    
    // Should document known exceptions for devDependencies (in Spanish)
    // Case-insensitive match for the key phrases
    expect(securityMd.toLowerCase()).toContain("dependencias de desarrollo")
    expect(securityMd.toLowerCase()).toContain("riesgo residual conocido")
  })
})