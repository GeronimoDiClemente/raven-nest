// Inyección de la orquestación en los panes de agente: token + socket en el env y los args que
// registran el shim. Independiente de Memories (estos tests no llaman setMemoryIntegration).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'

const spawnMock = vi.fn()
vi.mock('node-pty', () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }))

import { PtyManager } from '../pty-manager'
import { PaneTokenRegistry } from '../orchestration/pane-tokens'
import { NEST_MEMORY_TUI_CMD } from '../../src/types'

function fakePty() {
  const exitCbs: Array<(e: { exitCode: number }) => void> = []
  return {
    pid: 1234,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: () => {},
    onExit: (cb: (e: { exitCode: number }) => void) => { exitCbs.push(cb) },
    fireExit: (exitCode = 0) => exitCbs.forEach((cb) => cb({ exitCode })),
  }
}

describe('PtyManager — orquestación', () => {
  let dir: string
  let tokens: PaneTokenRegistry
  let launchArgs: ReturnType<typeof vi.fn<(bin: string) => string[]>>
  let ACCOUNT = ''

  function manager(): PtyManager {
    const m = new PtyManager()
    m.setOrchestration({ socketPath: '/tmp/nest-orch.sock', tokens, launchArgs })
    return m
  }

  beforeEach(() => {
    dir = makeTmpDir('raven-pty-orch-')
    ACCOUNT = join(dir, '.raven-nest', 'accounts', 'claude', 'main')
    spawnMock.mockReset()
    tokens = new PaneTokenRegistry()
    launchArgs = vi.fn<(bin: string) => string[]>((bin) => (bin === 'claude' ? ['--mcp-config', '/cfg/orchestration-mcp.json'] : []))
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
    cleanupTmp(dir)
  })

  it('pane de claude recibe NEST_ORCH_TOKEN con memory deshabilitado', async () => {
    const fake = fakePty()
    spawnMock.mockReturnValue(fake)
    const m = manager() // sin setMemoryIntegration
    await m.create('p1', 'claude --model x', ACCOUNT, dir)
    const env = spawnMock.mock.calls[0][2].env
    expect(env.NEST_ORCH_SOCKET).toBe('/tmp/nest-orch.sock')
    expect(tokens.resolve(env.NEST_ORCH_TOKEN)).toBe('p1')
    vi.advanceTimersByTime(600)
    expect(fake.write).toHaveBeenCalledWith('claude --mcp-config "/cfg/orchestration-mcp.json" --model x\r')
  })

  it('los args de codex con un path con espacios van citados', async () => {
    const fake = fakePty()
    spawnMock.mockReturnValue(fake)
    launchArgs.mockImplementation(() => ['-c', "mcp_servers.nest_orchestration.command='/Apps/My Nest/Nest'"])
    await manager().create('p1', 'codex', join(dir, '.raven-nest', 'accounts', 'codex', 'main'), dir)
    vi.advanceTimersByTime(600)
    expect(fake.write).toHaveBeenCalledWith(`codex -c "mcp_servers.nest_orchestration.command='/Apps/My Nest/Nest'"\r`)
  })

  it('pane de shell no recibe token', async () => {
    spawnMock.mockReturnValue(fakePty())
    // Heredado de un Nest lanzado desde un pane de otro Nest: tampoco pasa.
    vi.stubEnv('NEST_ORCH_TOKEN', 'viejo')
    vi.stubEnv('NEST_ORCH_SOCKET', '/viejo.sock')
    await manager().create('sh', '', '', dir)
    await manager().create('tui', NEST_MEMORY_TUI_CMD, '', dir)
    for (const call of spawnMock.mock.calls) {
      expect(call[2].env.NEST_ORCH_TOKEN).toBeUndefined()
      expect(call[2].env.NEST_ORCH_SOCKET).toBeUndefined()
    }
    expect(launchArgs).not.toHaveBeenCalled()
  })

  it('exit revoca el token', async () => {
    const fake = fakePty()
    spawnMock.mockReturnValue(fake)
    const m = manager()
    await m.create('p1', 'claude', ACCOUNT, dir)
    const token = spawnMock.mock.calls[0][2].env.NEST_ORCH_TOKEN
    expect(tokens.resolve(token)).toBe('p1')
    fake.fireExit()
    expect(tokens.resolve(token)).toBeNull()
    expect(m.paneInfo('p1')).toBeUndefined()
  })

  it('kill revoca el token', async () => {
    spawnMock.mockReturnValue(fakePty())
    const m = manager()
    await m.create('p1', 'claude', ACCOUNT, dir)
    const token = spawnMock.mock.calls[0][2].env.NEST_ORCH_TOKEN
    m.kill('p1')
    expect(tokens.resolve(token)).toBeNull()
    expect(m.paneInfo('p1')).toBeUndefined()
  })

  it('paneInfo guarda el cmd original', async () => {
    spawnMock.mockReturnValue(fakePty())
    const m = manager()
    await m.create('p1', 'claude --model x', ACCOUNT, dir)
    expect(m.paneInfo('p1')).toEqual({ paneId: 'p1', cmd: 'claude --model x', accountDir: ACCOUNT, aiType: 'claude', cwd: dir })
    expect(m.paneInfo('nope')).toBeUndefined()
  })

  it('pty:write emite input y writeInternal no', async () => {
    const fake = fakePty()
    spawnMock.mockReturnValue(fake)
    const m = manager()
    await m.create('p1', 'claude', ACCOUNT, dir)
    // Con el agente ya arrancado (antes, lo escrito se encola detrás del comando:
    // pty-manager-launch-order.test.ts).
    vi.advanceTimersByTime(600)
    const seen: Array<[string, string]> = []
    m.on('input', (paneId: string, data: string) => seen.push([paneId, data]))
    m.write('p1', 'a', { fromUser: true })
    m.writeInternal('p1', 'b')
    m.write('p1', 'c')
    expect(seen).toEqual([['p1', 'a']])
    expect(fake.write.mock.calls.map((c) => c[0]).slice(-3)).toEqual(['a', 'b', 'c'])
  })
})
