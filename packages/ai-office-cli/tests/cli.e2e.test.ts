import { describe, it, expect, beforeAll } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const packageRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const cliEntry = path.join(packageRoot, 'dist', 'index.js')

async function cli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [cliEntry, ...args], { cwd: packageRoot })
    return { stdout, stderr, code: 0 }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 }
  }
}

beforeAll(async () => {
  try {
    await fs.access(cliEntry)
  } catch {
    await run(process.execPath, [path.join(packageRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.build.json'], {
      cwd: packageRoot,
      timeout: 300_000,
    })
  }
}, 300_000)

describe('CLI E2E (smoke)', () => {
  it('build compiles the CLI', async () => {
    await run(process.execPath, [path.join(packageRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.build.json'], {
      cwd: packageRoot,
      timeout: 300_000,
    })
    await expect(fs.access(cliEntry)).resolves.toBeUndefined()
  })

  it('help prints usage', async () => {
    const { stdout, code } = await cli(['--help'])
    expect(code).toBe(0)
    expect(stdout).toContain('AI-OFFICE')
  })

  it('version prints the version number', async () => {
    const { stdout, code } = await cli(['--version'])
    expect(code).toBe(0)
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/)
  })
})