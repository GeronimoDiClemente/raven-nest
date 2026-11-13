// El centinela `NEST_MEMORY_TUI_CMD`: un pane que corre la TUI de memoria con el Electron de
// Nest en modo Node. No es un pane de AI: recibe sólo el socket y el token del daemon, no se
// registra en `memoryPanes` (no hay bridge que esperar) y no provisiona nada.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'

const spawnMock = vi.fn()
vi.mock('node-pty', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}))

import { PtyManager, type PtyMemoryIntegration } from '../pty-manager'
import { NEST_MEMORY_TUI_CMD } from '../../src/types'
import { SHELL, SHELL_ARGS } from '../platform'
import { comandoDeLaTui, familiaDeShell } from '../comando-de-la-tui'

function fakePty() {
  return {
    pid: 1234,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: () => {},
    onExit: () => {},
  }
}

describe('PtyManager — el pane de la TUI de memoria', () => {
  let dir: string
  const TUI = { execPath: '/Apps/Nest.app/Contents/MacOS/Nest', scriptPath: '/Apps/Nest.app/dist-electron/memory-tui.js' }

  function integracion(overrides: Partial<PtyMemoryIntegration> = {}): PtyMemoryIntegration {
    return {
      socketPath: '/tmp/nest-memory-test.sock',
      authToken: 'test-token-value',
      isEnabled: () => true,
      ensureProvisioned: vi.fn(() => ({ args: [], env: {} })),
      tui: TUI,
      ...overrides,
    }
  }

  beforeEach(() => {
    dir = makeTmpDir('raven-pty-tui-')
    spawnMock.mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
    cleanupTmp(dir)
  })

  it('el centinela inyecta socket y token, no registra memoryPanes y escribe el comando de la TUI', async () => {
    const fake = fakePty()
    spawnMock.mockReturnValue(fake)
    const mem = integracion()
    const manager = new PtyManager(mem)
    // Heredadas de un Nest lanzado desde el pane de otro Nest: no pasan al pane de la TUI.
    vi.stubEnv('NEST_MEMORY_ACCOUNT', 'claude:Otro')
    vi.stubEnv('NEST_MEMORY_PANE', 'pane-viejo')
    vi.stubEnv('ELECTRON_RUN_AS_NODE', '1')

    // Un shell de WSL que llega igual: se ignora, WSL no puede correr el exe con ese path.
    const r = await manager.create('pane-tui', NEST_MEMORY_TUI_CMD, '', dir, { bin: 'wsl.exe', args: ['-d', 'Ubuntu'] })
    expect(r).toEqual({ ok: true })

    const [bin, args, opts] = spawnMock.mock.calls[0]
    expect(bin).toBe(SHELL)
    expect(args).toEqual(SHELL_ARGS)
    expect(opts.env.NEST_MEMORY_SOCKET).toBe('/tmp/nest-memory-test.sock')
    expect(opts.env.NEST_MEMORY_TOKEN).toBe('test-token-value')
    // Sólo esas dos: ni cuenta, ni AI, ni pane (el bridge no espera a este pane).
    for (const k of ['NEST_MEMORY_ACCOUNT', 'NEST_MEMORY_AI', 'NEST_MEMORY_PANE', 'NEST_MEMORY_ENABLED']) {
      expect(opts.env[k]).toBeUndefined()
    }
    // La variable va en el comando, no en el env del shell del pane.
    expect(opts.env.ELECTRON_RUN_AS_NODE).toBeUndefined()

    expect(manager.panesWithMemory()).toEqual([])
    expect(mem.ensureProvisioned).not.toHaveBeenCalled()

    vi.advanceTimersByTime(6000)
    expect(fake.write).toHaveBeenCalledWith(`${comandoDeLaTui(TUI.execPath, TUI.scriptPath, familiaDeShell(SHELL))}\r`)
  })

  it('no redirige HOME aunque llegue un accountDir', async () => {
    spawnMock.mockReturnValue(fakePty())
    const manager = new PtyManager(integracion())
    const accountDir = join(dir, 'accounts', 'claude', 'Bautista')
    await manager.create('pane-tui', NEST_MEMORY_TUI_CMD, accountDir, dir)
    expect(spawnMock.mock.calls[0][2].env.HOME).toBe(process.env.HOME)
  })

  it('sin tui en la integración, create devuelve el error', async () => {
    const manager = new PtyManager(integracion({ tui: undefined }))
    const r = await manager.create('pane-tui', NEST_MEMORY_TUI_CMD, '', dir)
    expect(r).toEqual({ ok: false, error: 'Memory is not available in this build' })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('sin integración de memoria, create devuelve el mismo error', async () => {
    const manager = new PtyManager()
    const r = await manager.create('pane-tui', NEST_MEMORY_TUI_CMD, '', dir)
    expect(r).toEqual({ ok: false, error: 'Memory is not available in this build' })
    expect(spawnMock).not.toHaveBeenCalled()
  })
})
