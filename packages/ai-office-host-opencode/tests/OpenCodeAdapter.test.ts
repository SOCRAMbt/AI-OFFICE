import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'node:path'
import { OpenCodeAdapter } from '../src/OpenCodeAdapter.js'

describe('OpenCodeAdapter', () => {
  let adapter: OpenCodeAdapter
  let mockCtx: any

  beforeEach(async () => {
    adapter = new OpenCodeAdapter()
    mockCtx = {
      session: {
        create: vi.fn().mockResolvedValue({ id: 'sess-123' }),
        prompt: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue({ model: { id: 'test-model', providerID: 'openrouter' } }),
        synthetic: vi.fn().mockResolvedValue(undefined),
      },
      tool: {
        transform: vi.fn().mockResolvedValue(undefined),
        hook: vi.fn().mockResolvedValue(undefined),
      },
      permission: {
        hook: vi.fn().mockResolvedValue(undefined),
      },
      event: {
        subscribe: vi.fn().mockReturnValue({
          [Symbol.asyncIterator]: async function* () {},
        }),
      },
      options: {},
      location: { directory: '/test' },
    }
    adapter.setContext(mockCtx)
    await adapter.initialize({ projectRoot: '/test' })
  })

  it('should create a session', async () => {
    const session = await adapter.createSession({ title: 'Test Session' })
    expect(session).toBeDefined()
    expect(session.id).toBe('sess-123')
    expect(session.title).toBe('Test Session')
    expect(mockCtx.session.create).toHaveBeenCalled()
  })

  it('should prompt a session', async () => {
    const result = await adapter.promptSession('sess-123', 'Hello world')
    expect(result).toBeDefined()
    expect(result.text).toBe('')
    expect(result.status).toBe('active')
    expect(mockCtx.session.prompt).toHaveBeenCalledWith({
      sessionID: 'sess-123',
      text: 'Hello world',
      metadata: undefined,
    })
  })

  it('should return available tools', () => {
    const tools = adapter.getAvailableTools()
    expect(Array.isArray(tools)).toBe(true)
    expect(tools.length).toBeGreaterThan(0)
    expect(tools[0]).toHaveProperty('name')
    expect(tools[0]).toHaveProperty('description')
  })

  it('should check scope (always allowed in this implementation)', async () => {
    const result = await adapter.checkScope('/test/file.ts', 'write')
    expect(result).toEqual({ allowed: true })
  })

  it('should spawn a subagent', async () => {
    const subagent = await adapter.spawnSubagent({
      name: 'test-agent',
      description: 'Test description',
      systemPrompt: 'You are a test agent',
      prompt: 'Do something',
      parentSessionId: 'parent-123',
    })
    expect(subagent).toBeDefined()
    expect(subagent.sessionId).toBe('sess-123')
    expect(subagent.name).toBe('test-agent')
    expect(subagent.status).toBe('starting')
  })

  it('should get subagent result', async () => {
    const result = await adapter.getSubagentResult('sess-456')
    expect(result).toBeDefined()
    expect(result.sessionId).toBe('sess-456')
    expect(result.success).toBe(true)
  })

  it('should get and set model', () => {
    const model = adapter.getModel()
    expect(model).toBeDefined()
    expect(model.id).toBe('default')
    expect(model.provider).toBe('openrouter')

    adapter.setModel({ id: 'new-model', provider: 'anthropic' })
    const newModel = adapter.getModel()
    expect(newModel.id).toBe('new-model')
    expect(newModel.provider).toBe('anthropic')
  })

  it('should initialize and shutdown', async () => {
    await adapter.shutdown()
    // Should not throw
  })

  it('should read and write files', async () => {
    const fs = await import('node:fs/promises')
    const tmpDir = await fs.mkdtemp('test-adapter-')
    const testFile = path.join(tmpDir, 'file.txt')
    const content = 'test content'
    await adapter.writeFile(testFile, content)
    const read = await adapter.readFile(testFile)
    expect(read).toBe(content)
    await fs.rm(tmpDir, { recursive: true })
  })

  it('should execute commands', async () => {
    const result = await adapter.execCommand('echo', ['hello'])
    expect(result).toBeDefined()
    expect(typeof result.exitCode).toBe('number')
    expect(typeof result.stdout).toBe('string')
  })
})