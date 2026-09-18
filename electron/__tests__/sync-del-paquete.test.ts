import { describe, it, expect, vi } from 'vitest'
import { sincronizarUnaVez, type Sincronizador } from '../sync-del-paquete'
import type { MemoryDaemon } from '../memory-daemon'

/**
 * La premisa del módulo, fijada por el compilador: el daemon REAL cumple `Sincronizador`.
 *
 * Va como `import type` para que no arrastre `better-sqlite3` al test. Si mañana cambia una
 * firma de `pull`, `push` o `getStatus`, esto no compila — que es exactamente lo que tiene
 * que pasar, porque el paquete portátil se apoya en que son la misma cosa.
 */
const _elDaemonCumple: (d: MemoryDaemon) => Sincronizador = (d) => d
void _elDaemonCumple

function fake(over: Partial<Sincronizador> = {}, llamadas: string[] = []): Sincronizador {
  return {
    pull: vi.fn(async () => { llamadas.push('pull') }),
    push: vi.fn(async () => { llamadas.push('push') }),
    getStatus: () => 'idle',
    getStatusDetail: () => undefined,
    ...over,
  }
}

describe('sincronizarUnaVez', () => {
  it('baja primero y sube DESPUÉS', async () => {
    // El orden no es estético: este proceso se muere apenas termina. Si subiera primero, las
    // mutaciones que genera el merge del pull se quedarían en la cola sin que nadie las
    // empuje hasta la próxima corrida, que puede ser dentro de días.
    const llamadas: string[] = []
    await sincronizarUnaVez(fake({}, llamadas), { hayCuenta: true })
    expect(llamadas).toEqual(['pull', 'push'])
  })

  it('si el pull falla, SUBE igual', async () => {
    // Lo que puede perderse es el trabajo local. Un pull que falla por red no es razón para
    // dejar las mutaciones locales sin intentar salir.
    const llamadas: string[] = []
    const s = fake({ pull: vi.fn(async () => { throw new Error('sin red') }) }, llamadas)
    const r = await sincronizarUnaVez(s, { hayCuenta: true })
    expect(llamadas).toEqual(['push'])
    expect(r.bajoError).toBe('sin red')
    expect(r.subio).toBe(true)
  })

  it('si el push falla lo dice, y no se traga el error', async () => {
    const s = fake({ push: vi.fn(async () => { throw new Error('419') }) })
    const r = await sincronizarUnaVez(s, { hayCuenta: true })
    expect(r.subio).toBe(false)
    expect(r.subioError).toBe('419')
  })

  it('sin cuenta no toca la red y lo dice', async () => {
    const s = fake()
    const r = await sincronizarUnaVez(s, { hayCuenta: false })
    expect(r.estado).toBe('sin-cuenta')
    expect(s.pull).not.toHaveBeenCalled()
    expect(s.push).not.toHaveBeenCalled()
  })

  it('si otro proceso tiene el candado, lo informa con ese motivo', async () => {
    // Es el caso de Nest abierto en la misma máquina. No es un error: las escrituras
    // locales quedaron encoladas y las empuja quien tenga el candado.
    const s = fake({ getStatus: () => 'paused', getStatusDetail: () => 'lock_held' })
    const r = await sincronizarUnaVez(s, { hayCuenta: true })
    expect(r.estado).toBe('otro-sincroniza')
  })

  it('una pausa por otro motivo no se confunde con el candado', async () => {
    const s = fake({ getStatus: () => 'paused', getStatusDetail: () => 'needs_key' })
    const r = await sincronizarUnaVez(s, { hayCuenta: true })
    expect(r.estado).toBe('pausado')
    expect(r.detalle).toBe('needs_key')
  })

  it('el camino feliz informa que sincronizó', async () => {
    const r = await sincronizarUnaVez(fake(), { hayCuenta: true })
    expect(r).toMatchObject({ estado: 'sincronizado', bajo: true, subio: true })
  })

  it('un error del daemon se informa con su detalle', async () => {
    const s = fake({ getStatus: () => 'error', getStatusDetail: () => 'auth' })
    const r = await sincronizarUnaVez(s, { hayCuenta: true })
    expect(r).toMatchObject({ estado: 'error', detalle: 'auth' })
  })
})
