import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CursorAdapter } from '../src/CursorAdapter.js'

describe('CursorAdapter', () => {
  let adapter: CursorAdapter
  let mockVscode: any

  beforeEach(async () => {
    adapter = new CursorAdapter()
    mockVscode = {
      window: {
        createTerminal: vi.fn().mockReturnValue({ sendText: vi.fn(), show: vi.fn(), dispose: vi.fn() }),
        showInformationMessage: vi.fn().mockResolvedValue(undefined),
        showErrorMessage: vi.fn().mockResolvedValue(undefined),
        showWarningMessage: vi.fn().mockResolvedValue(undefined),
        withProgress: vi.fn().mockImplementation(async (_o: any, task: any) => task({ report: vi.fn() })),
      },
      workspace: {
        workspaceFolders: [{ uri: { fsPath: '/workspace' }, name: 'ws', index: 0 }],
        fs: {
          readFile: vi.fn().mockResolvedValue(new TextEncoder().encode('file content')),
          writeFile: vi.fn().mockResolvedValue(undefined),
          stat: vi.fn().mockResolvedValue({ type: 1, size: 10, ctime: 1, mtime: 1 }),
          createDirectory: vi.fn().mockResolvedValue(undefined),
        },
        openTextDocument: vi.fn().mockResolvedValue({ uri: { fsPath: '/workspace/f.ts' }, getText: () => 'x' }),
        saveTextDocument: vi.fn().mockResolvedValue(true),
      },
      commands: {
        executeCommand: vi.fn().mockResolvedValue(undefined),
        registerCommand: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      },
      extensions: { getExtension: vi.fn().mockReturnValue({ exports: {} }) },
      env: { machineId: 'machine-1' },
      chat: {
        startSession: vi.fn().mockResolvedValue({ id: 'chat-sess-1' }),
        sendMessage: vi.fn().mockResolvedValue({ text: 'reply' }),
      },
    }
    adapter.setVSCodeAPI(mockVscode)
    await adapter.initialize({ projectRoot: '/workspace' })
  })

  it('creates a session', async () => {
    const session = await adapter.createSession({ title: 'Test Session' })
    expect(session).toBeDefined()
    expect(session.id).toContain('cursor-session')
    expect(session.title).toBe('Test Session')
  })

  it('prompts a session', async () => {
    const result = await adapter.promptSession('sess-1', 'Hello')
    expect(result).toBeDefined()
    expect(result.status).toBe('active')
    expect(result.text).toBe('reply')
  })

  it('returns available tools', () => {
    const tools = adapter.getAvailableTools()
    expect(Array.isArray(tools)).toBe(true)
    expect(tools.length).toBeGreaterThan(0)
    expect(tools[0]).toHaveProperty('name')
  })

  it('checks scope allowed inside workspace', async () => {
    const result = await adapter.checkScope('src/file.ts', 'write')
    expect(result).toBeDefined()
    expect(typeof result.allowed).toBe('boolean')
  })

  it('checks scope rejects sensitive file', async () => {
    const result = await adapter.checkScope('.env', 'read')
    expect(result.allowed).toBe(false)
  })

  it('spawns a subagent', async () => {
    const sub = await adapter.spawnSubagent({ name: 'agent', description: 'd', systemPrompt: 'sp', prompt: 'p', parentSessionId: 'p-1' })
    expect(sub).toBeDefined()
    expect(sub.sessionId).toBe('chat-sess-1')
    expect(sub.name).toBe('agent')
  })

  it('gets subagent result', async () => {
    const r = await adapter.getSubagentResult('sub-1')
    expect(r).toBeDefined()
    expect(r.success).toBe(true)
  })

  it('gets and sets model', () => {
    const m = adapter.getModel()
    expect(m).toBeDefined()
    adapter.setModel({ id: 'm2', provider: 'cursor' } as any)
    expect(adapter.getModel().id).toBe('m2')
  })

  it('reads a file', async () => {
    const content = await adapter.readFile('file.ts')
    expect(content).toBe('file content')
  })

  it('writes a file', async () => {
    await adapter.writeFile('out.ts', 'hello')
    expect(mockVscode.workspace.fs.writeFile).toHaveBeenCalled()
  })

  it('executes a command', async () => {
    const res = await adapter.execCommand('echo', ['hi'])
    expect(res).toBeDefined()
    expect(res.exitCode).toBe(0)
  })

  it('shuts down', async () => {
    await adapter.shutdown()
    expect(adapter.getVSCodeAPI()).toBeNull()
  })
})
