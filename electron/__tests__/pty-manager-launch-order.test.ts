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
  const dataCbs: Array<(d: string) => void> = []
  return {
    pid: 1234,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: (cb: (d: string) => void) => { dataCbs.push(cb) },
    onExit: () => {},
    emitir: (d: string) => { for (const cb of dataCbs) cb(d) },
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
    fake.emitir('banner del agente')
    vi.advanceTimersByTime(1500)
    vi.advanceTimersByTime(500)
    expect(fake.write.mock.calls.map((c) => c[0])).toEqual([
      'claude\r',
      'You are a worker agent\n=== TASK ===\ncreate hello.txt',
      'segunda',
    ])
    // Ya arrancado, va directo.
    m.write('p1', '\r')
    expect(fake.write).toHaveBeenLastCalledWith('\r')
  })

  // Lo que vio Gero en la prueba real: la tarea y el Enter salían pegados al comando, el agente
  // los leía de un saque al arrancar como un pegado y la tarea quedaba escrita sin enviar.
  it('la cola espera a que el agente dibuje y se quede quieto, y el Enter va aparte', async () => {
    const fake = fakePty()
    spawnMock.mockReturnValue(fake)
    const m = new PtyManager()
    await m.create('p1', 'claude', ACCOUNT, dir)
    m.write('p1', 'tarea')
    m.write('p1', '\r')
    vi.advanceTimersByTime(600)
    expect(fake.write.mock.calls.map((c) => c[0])).toEqual(['claude\r'])
    fake.emitir('arrancando…')
    vi.advanceTimersByTime(1000)
    fake.emitir('todavía dibujando')
    vi.advanceTimersByTime(1000)
    expect(fake.write.mock.calls.map((c) => c[0])).toEqual(['claude\r'])
    vi.advanceTimersByTime(500)
    expect(fake.write.mock.calls.map((c) => c[0])).toEqual(['claude\r', 'tarea'])
    m.write('p1', 'tercero') // llega durante el goteo: va detrás, no se adelanta
    vi.advanceTimersByTime(499)
    expect(fake.write.mock.calls.map((c) => c[0])).toEqual(['claude\r', 'tarea'])
    vi.advanceTimersByTime(1)
    expect(fake.write.mock.calls.map((c) => c[0])).toEqual(['claude\r', 'tarea', '\r'])
    vi.advanceTimersByTime(500)
    expect(fake.write.mock.calls.map((c) => c[0])).toEqual(['claude\r', 'tarea', '\r', 'tercero'])
  })

  it('con el diálogo de confianza en pantalla no se escribe nada hasta que la persona lo conteste', async () => {
    const fake = fakePty()
    spawnMock.mockReturnValue(fake)
    const m = new PtyManager()
    await m.create('p1', 'claude', ACCOUNT, dir)
    m.write('p1', 'tarea')
    m.write('p1', '\r')
    vi.advanceTimersByTime(600)
    fake.emitir('Do you trust the files in this folder?\r\n❯ 1. Yes, proceed')
    vi.advanceTimersByTime(30_000)
    expect(fake.write.mock.calls.map((c) => c[0])).toEqual(['claude\r'])
    fake.emitir('Claude Code ❯ ') // la persona aceptó y el agente redibujó
    vi.advanceTimersByTime(2000)
    expect(fake.write.mock.calls.map((c) => c[0])).toEqual(['claude\r', 'tarea', '\r'])
  })

  it('un agente que no dibuja nada igual recibe la cola a los 10 s', async () => {
    const fake = fakePty()
    spawnMock.mockReturnValue(fake)
    const m = new PtyManager()
    await m.create('p1', 'claude', ACCOUNT, dir)
    m.write('p1', 'tarea')
    vi.advanceTimersByTime(600 + 9_000)
    expect(fake.write.mock.calls.map((c) => c[0])).toEqual(['claude\r'])
    vi.advanceTimersByTime(1_000)
    expect(fake.write.mock.calls.map((c) => c[0])).toEqual(['claude\r', 'tarea'])
  })

  it('un pane que muere esperando al agente descarta lo encolado', async () => {
    const fake = fakePty()
    spawnMock.mockReturnValue(fake)
    const m = new PtyManager()
    await m.create('p1', 'claude', ACCOUNT, dir)
    m.write('p1', 'tarea')
    vi.advanceTimersByTime(600)
    fake.emitir('banner')
    m.kill('p1')
    vi.advanceTimersByTime(20_000)
    expect(fake.write.mock.calls.map((c) => c[0])).toEqual(['claude\r'])
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
