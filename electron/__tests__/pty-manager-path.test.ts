import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'
import type { PtyMemoryIntegration } from '../pty-manager'
import { NEST_MEMORY_TUI_CMD } from '../../src/types'

const spawnMock = vi.fn()
vi.mock('node-pty', () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }))

function fakePty() {
  return { pid: 1, write: vi.fn(), resize: vi.fn(), kill: vi.fn(), onData: () => {}, onExit: () => {} }
}

const HOME_REAL = '/Users/real-home'

const PATH_MAC_COMUN = [
  `${HOME_REAL}/.local/bin`,
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
]

describe('PtyManager — PATH del pane', () => {
  let dir: string
  let account: string
  const envOriginal = { HOME: process.env.HOME, PATH: process.env.PATH }

  beforeEach(() => {
    dir = makeTmpDir('raven-pty-path-')
    account = join(dir, '.raven-nest', 'accounts', 'claude', 'main')
    spawnMock.mockReset()
    spawnMock.mockReturnValue(fakePty())
    process.env.HOME = HOME_REAL
    process.env.PATH = '/usr/bin:/bin'
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.doUnmock('../platform')
    vi.resetModules()
    process.env.HOME = envOriginal.HOME
    process.env.PATH = envOriginal.PATH
    cleanupTmp(dir)
  })

  async function pathDelPane(
    plataforma: 'darwin' | 'linux',
    conCuenta: boolean,
    opciones: { cuenta?: string; cmd?: string; memory?: PtyMemoryIntegration } = {},
  ): Promise<string[]> {
    vi.resetModules()
    vi.doMock('../platform', async () => {
      const real = await vi.importActual<typeof import('../platform')>('../platform')
      return { ...real, isMac: plataforma === 'darwin', isLinux: plataforma === 'linux', isWin: false }
    })
    const { PtyManager } = await import('../pty-manager')
    const m = new PtyManager(opciones.memory)
    if (conCuenta) await m.create('p1', opciones.cmd ?? 'claude', opciones.cuenta ?? account, dir)
    else await m.create('p1', '', '', dir)
    const env = spawnMock.mock.calls[0][2].env as Record<string, string>
    return env.PATH.split(':')
  }

  it('Mac, pane de agente: accountDir/.local/bin está y, al no estar antes, queda antes del .local/bin del HOME real', async () => {
    const p = await pathDelPane('darwin', true)
    const iCuenta = p.indexOf(`${account}/.local/bin`)
    const iReal = p.indexOf(`${HOME_REAL}/.local/bin`)
    expect(iCuenta).toBeGreaterThanOrEqual(0)
    expect(iReal).toBeGreaterThan(iCuenta)
  })

  it('Mac, terminal común: el PATH no incluye accountDir', async () => {
    const p = await pathDelPane('darwin', false)
    expect(p).toEqual(PATH_MAC_COMUN)
  })

  it('Mac: un accountDir con ":" no inyecta nada y el resto del PATH queda igual', async () => {
    const conDosPuntos = join(dir, 'foo:bar')
    const p = await pathDelPane('darwin', true, { cuenta: conDosPuntos })
    expect(p).toEqual(PATH_MAC_COMUN)
  })

  it('Mac: si HOME ya es accountDir, .local/bin aparece una sola vez', async () => {
    process.env.HOME = account
    const p = await pathDelPane('darwin', true)
    expect(p.filter((e) => e === `${account}/.local/bin`)).toHaveLength(1)
  })

  it('Mac, pane de la TUI de memoria con accountDir: no inyecta accountDir', async () => {
    const memory: PtyMemoryIntegration = {
      socketPath: '/tmp/s.sock',
      authToken: 't',
      isEnabled: () => true,
      ensureProvisioned: vi.fn(() => ({ args: [], env: {} })),
      tui: { execPath: '/Apps/Nest', scriptPath: '/Apps/tui.js' },
    }
    const p = await pathDelPane('darwin', true, { cmd: NEST_MEMORY_TUI_CMD, memory })
    expect(p).toEqual(PATH_MAC_COMUN)
  })

  it('Mac: no duplica accountDir/.local/bin si ya estaba en el PATH', async () => {
    process.env.PATH = `/usr/bin:${account}/.local/bin:/bin`
    const p = await pathDelPane('darwin', true)
    expect(p.filter((e) => e === `${account}/.local/bin`)).toHaveLength(1)
  })

  it('Linux, pane de agente: el PATH no cambia', async () => {
    const p = await pathDelPane('linux', true)
    expect(p).toEqual(['/usr/bin', '/bin'])
  })
})
