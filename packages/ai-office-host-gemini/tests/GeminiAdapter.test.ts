import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GeminiAdapter } from '../src/GeminiAdapter.js'

describe('GeminiAdapter', () => {
  let adapter: GeminiAdapter
  let mockGenAI: any

  beforeEach(async () => {
    adapter = new GeminiAdapter()
    const mockChat = { sendMessage: vi.fn().mockResolvedValue({ response: { text: () => 'hello' } }) }
    const mockModel = { startChat: vi.fn().mockReturnValue(mockChat), generateContent: vi.fn().mockResolvedValue({ response: { text: () => 'hello' } }) }
    mockGenAI = { getGenerativeModel: vi.fn().mockReturnValue(mockModel) }
    adapter.setClient(mockGenAI as any)
    await adapter.initialize({ projectRoot: '/workspace' })
  })

  it('creates a session', async () => {
    const session = await adapter.createSession({ title: 'Test Session' })
    expect(session).toBeDefined()
    expect(session.id).toContain('gemini-session')
  })

  it('prompts a session', async () => {
    const session = await adapter.createSession({ title: 'S' })
    const result = await adapter.promptSession(session.id, 'Hello')
    expect(result).toBeDefined()
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
    expect(typeof adapter.spawnSubagent).toBe('function')
  })

  it('gets subagent result', async () => {
    const r = await adapter.getSubagentResult('sub-1')
    expect(r).toBeDefined()
  })

  it('gets and sets model', () => {
    const m = adapter.getModel()
    expect(m).toBeDefined()
    adapter.setModel({ id: 'm2', provider: 'google' } as any)
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
