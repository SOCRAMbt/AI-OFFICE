import { describe, it, vi } from 'vitest'
vi.setConfig({ testTimeout: 120000 })
import { execSync } from 'node:child_process'

describe('GrokAdapter build & typecheck', () => {
  it('builds successfully', () => {
    execSync('npm run build', { cwd: process.cwd(), stdio: 'pipe' })
  })
  it('typechecks successfully', () => {
    execSync('npm run typecheck', { cwd: process.cwd(), stdio: 'pipe' })
  })
})
