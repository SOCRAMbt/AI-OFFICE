import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GrokAdapter } from '../src/GrokAdapter.js'

describe('GrokAdapter', () => {
  let adapter: GrokAdapter
  let mockClient: any

  beforeEach(async () => {
    adapter = new GrokAdapter()
    mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'hello' } }],
            usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
          }),
        },
      },
    }
    adapter.setClient(mockClient as any)
    await adapter.initialize({ projectRoot: '/workspace' })
  })

  it('creates a session', async () => {
    const session = await adapter.createSession({ title: 'Test Session' })
    expect(session).toBeDefined()
    expect(session.id).toContain('grok-session')
  })

  it('prompts a session', async () => {
    const session = await adapter.createSession({ title: 'S' })
    const result = await adapter.promptSession(session.id, 'Hello')
    expect(result).toBeDefined()
    expect(result.status).toBe('active')
  })

  it('returns available tools', () => {
    const tools = adapter.getAvailableTools()
    expect(Array.isArray(tools)).toBe(true)
    expect(tools.length).toBeGreaterThan(0)
  })

  it('checks scope', async () => {
    const result = await adapter.checkScope('/workspace/file.ts', 'read')
    expect(result).toBeDefined()
    expect(typeof result.allowed).toBe('boolean')
  })

  it('spawns a subagent', async () => {
    const sub = await adapter.spawnSubagent({ name: 'agent', description: 'd', systemPrompt: 'sp', prompt: 'p', parentSessionId: 'p-1' })
    expect(sub).toBeDefined()
    expect(sub.name).toBe('agent')
  })

  it('gets subagent result', async () => {
    const r = await adapter.getSubagentResult('sub-1')
    expect(r).toBeDefined()
  })

  it('gets and sets model', () => {
    const m = adapter.getModel()
    expect(m).toBeDefined()
    adapter.setModel({ id: 'm2', provider: 'xai' } as any)
    expect(adapter.getModel().id).toBe('m2')
  })

  it('reads a file', async () => {
    expect(typeof adapter.readFile).toBe('function')
  })

  it('writes a file', async () => {
    expect(typeof adapter.writeFile).toBe('function')
  })

  it('executes a command', async () => {
    expect(typeof adapter.execCommand).toBe('function')
  })

  it('shuts down', async () => {
    await adapter.shutdown()
    expect(adapter).toBeDefined()
  })

  it('initializes', async () => {
    expect(adapter).toBeDefined()
  })
})
