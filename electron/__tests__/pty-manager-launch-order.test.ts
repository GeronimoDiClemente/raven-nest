// Lo que se escribe en un pane de agente ANTES de que Nest tipee el comando del agente en el
// shell va DESPUÉS del comando. Sin esto, el `initialInput` de un worker (que el renderer
// escribe al primer output del pane, o sea el prompt del shell, ~450 ms) le ganaba al comando
// (500 ms) y el shell ejecutaba cada línea del preámbulo y de la tarea como un comando
// (`zsh: command not found: You`): el agente nunca recibía la tarea. Lo cazó el e2e 20.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'

const spawnMock = vi.fn()
vi.mock('node-pty', () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }))

import { PtyManager } from '../pty-manager'

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

describe('PtyManager — orden del comando de arranque', () => {
  let dir: string
  let ACCOUNT = ''

  beforeEach(() => {
    dir = makeTmpDir('raven-pty-launch-')
    ACCOUNT = join(dir, '.raven-nest', 'accounts', 'claude', 'main')
    spawnMock.mockReset()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    cleanupTmp(dir)
  })

  it('lo escrito antes del comando del agente sale después del comando, en orden', async () => {
    const fake = fakePty()
    spawnMock.mockReturnValue(fake)
    const m = new PtyManager()
    await m.create('p1', 'claude', ACCOUNT, dir)
    m.write('p1', 'You are a worker agent\n=== TASK ===\ncreate hello.txt')
    m.writeInternal('p1', 'segunda')
    expect(fake.write).not.toHaveBeenCalled() // el shell no ve la tarea
    vi.advanceTimersByTime(600)
    expect(fake.write.mock.calls.map((c) => c[0])).toEqual([
      'claude\r',
      'You are a worker agent\n=== TASK ===\ncreate hello.txt',
      'segunda',
    ])
    // Ya arrancado, va directo.
    m.write('p1', '\r')
    expect(fake.write).toHaveBeenLastCalledWith('\r')
  })

  it('lo que tipea la persona antes del arranque igual emite input', async () => {
    spawnMock.mockReturnValue(fakePty())
    const m = new PtyManager()
    const input = vi.fn()
    m.on('input', input)
    await m.create('p1', 'claude', ACCOUNT, dir)
    m.write('p1', 'x', { fromUser: true })
    expect(input).toHaveBeenCalledWith('p1', 'x')
  })

  it('un shell sin comando escribe directo', async () => {
    const fake = fakePty()
    spawnMock.mockReturnValue(fake)
    const m = new PtyManager()
    await m.create('sh', '', '', dir)
    m.write('sh', 'ls\r')
    expect(fake.write).toHaveBeenCalledWith('ls\r')
  })

  it('un pane que muere antes del arranque descarta lo encolado', async () => {
    const fake = fakePty()
    spawnMock.mockReturnValue(fake)
    const m = new PtyManager()
    await m.create('p1', 'claude', ACCOUNT, dir)
    m.write('p1', 'tarea')
    m.kill('p1')
    vi.advanceTimersByTime(600)
    expect(fake.write).not.toHaveBeenCalled()
  })
})
