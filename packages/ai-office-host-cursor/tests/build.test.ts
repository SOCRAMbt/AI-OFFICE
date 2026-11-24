import { describe, it, vi } from 'vitest'
import { execSync } from 'node:child_process'
vi.setConfig({ testTimeout: 120000 })

describe('CursorAdapter build & typecheck', () => {
  it('builds successfully', () => {
    execSync('npm run build', { cwd: process.cwd(), stdio: 'pipe' })
  })
  it('typechecks successfully', () => {
    execSync('npm run typecheck', { cwd: process.cwd(), stdio: 'pipe' })
  })
})
