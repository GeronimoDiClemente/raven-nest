import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'

const spawnMock = vi.fn()
vi.mock('node-pty', () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }))

function fakePty() {
  return { pid: 1, write: vi.fn(), resize: vi.fn(), kill: vi.fn(), onData: () => {}, onExit: () => {} }
}

const HOME_REAL = '/Users/real-home'

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

  async function pathDelPane(plataforma: 'darwin' | 'linux', conCuenta: boolean): Promise<string[]> {
    vi.resetModules()
    vi.doMock('../platform', async () => {
      const real = await vi.importActual<typeof import('../platform')>('../platform')
      return { ...real, isMac: plataforma === 'darwin', isLinux: plataforma === 'linux', isWin: false }
    })
    const { PtyManager } = await import('../pty-manager')
    const m = new PtyManager()
    if (conCuenta) await m.create('p1', 'claude', account, dir)
    else await m.create('p1', '', '', dir)
    const env = spawnMock.mock.calls[0][2].env as Record<string, string>
    return env.PATH.split(':')
  }

  it('Mac, pane de agente: accountDir/.local/bin va antes del .local/bin del HOME real', async () => {
    const p = await pathDelPane('darwin', true)
    const iCuenta = p.indexOf(`${account}/.local/bin`)
    const iReal = p.indexOf(`${HOME_REAL}/.local/bin`)
    expect(iCuenta).toBeGreaterThanOrEqual(0)
    expect(iReal).toBeGreaterThan(iCuenta)
  })

  it('Mac, terminal común: el PATH no incluye accountDir', async () => {
    const p = await pathDelPane('darwin', false)
    expect(p).toContain(`${HOME_REAL}/.local/bin`)
    expect(p.some((e) => e.includes('.raven-nest'))).toBe(false)
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
