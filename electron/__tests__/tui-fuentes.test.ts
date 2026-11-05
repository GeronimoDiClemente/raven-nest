// Las fuentes de datos de la TUI, con clientes falsos que registran las llamadas.
import { describe, it, expect } from 'vitest'
import { crearFuenteDelPaquete, type DependenciasDeFuente } from '../tui-del-paquete/fuente-del-paquete'
import { crearFuenteDelDaemon } from '../tui-del-paquete/fuente-del-daemon'
import { ErrorDeEscritura } from '../tui-del-paquete/fuente'
import type { DecisionDeBase } from '../base-para-el-paquete'

interface Llamada { donde: 'daemon' | 'local'; method: string; params: any }

function armar(opts: {
  base: DecisionDeBase
  nest: Array<{ socket: string; token: string } | null>
  responder?: (donde: 'daemon' | 'local', method: string, n: number) => unknown
  existe?: boolean
  sinNest?: { modo: 'nest'; path: string } | { modo: 'propia'; path: string; nueva: boolean }
}) {
  const llamadas: Llamada[] = []
  let creadosLocal = 0
  const basesLocales: string[] = []
  let nBusquedas = 0
  const deps: DependenciasDeFuente = {
    base: opts.base,
    cwd: '/tmp/un-repo',
    existe: () => opts.existe ?? true,
    baseSinNest: () => opts.sinNest ?? ({ modo: 'propia', path: '/x/memory.db', nueva: false } as const),
    buscarNest: async () => opts.nest[Math.min(nBusquedas++, opts.nest.length - 1)],
    crearDaemon: () => ({
      call: async (method: string, params: unknown) => {
        llamadas.push({ donde: 'daemon', method, params })
        const r = opts.responder?.('daemon', method, llamadas.length)
        if (r instanceof Error) throw r
        return r ?? { ok: true }
      },
    }),
    crearLocal: (b: { path: string }) => {
      creadosLocal++
      basesLocales.push(b.path)
      return {
        call: async (method: string, params: unknown) => {
          llamadas.push({ donde: 'local', method, params })
          const r = opts.responder?.('local', method, llamadas.length)
          if (r instanceof Error) throw r
          return r ?? { ok: true }
        },
        close: () => {},
      }
    },
    leerStatus: async () => { throw new Error('no usado') },
    leerDoctor: async () => { throw new Error('no usado') },
  }
  return { fuente: crearFuenteDelPaquete(deps), llamadas, creados: () => creadosLocal, basesLocales }
}

const memoria = { title: 'T', type: 'decision' as const, tags: ['a'], content: 'C' }
const propia: DecisionDeBase = { modo: 'propia', path: '/x/memory.db', nueva: false }
const nest = { socket: 's', token: 't' }

describe('fuente del paquete', () => {
  it('leer con base propia nueva no crea el local', async () => {
    const { fuente, creados } = armar({ base: { modo: 'propia', path: '/x/m.db', nueva: true }, nest: [null], existe: false })
    expect(await fuente.recientes({ todos: true, limite: 10 })).toEqual([])
    expect(await fuente.buscar('q', 10)).toEqual([])
    expect(creados()).toBe(0)
  })

  it('guardar re-busca a Nest: la primera va al local, y la segunda, con Nest vivo, al daemon', async () => {
    const { fuente, llamadas } = armar({ base: propia, nest: [null, nest] })
    await fuente.guardar(memoria)
    await fuente.guardar(memoria)
    expect(llamadas.map((l) => l.donde)).toEqual(['local', 'daemon'])
  })

  it('si el daemon da ECONNREFUSED al guardar, reintenta en el local una sola vez', async () => {
    const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    const { fuente, llamadas } = armar({
      base: propia, nest: [nest],
      responder: (donde) => (donde === 'daemon' ? err : { ok: true }),
    })
    await fuente.guardar(memoria)
    expect(llamadas.map((l) => l.donde)).toEqual(['daemon', 'local'])
  })

  it('si el local también falla tras el reintento, no sigue intentando', async () => {
    const err = Object.assign(new Error('x'), { code: 'EPIPE' })
    const { fuente, llamadas } = armar({
      base: propia, nest: [nest],
      responder: (donde) => (donde === 'daemon' ? err : new Error('database is locked')),
    })
    await expect(fuente.guardar(memoria)).rejects.toThrow('database is locked')
    expect(llamadas).toHaveLength(2)
  })

  it('un error de candado del local es ErrorDeEscritura con el mensaje original', async () => {
    const { fuente } = armar({ base: propia, nest: [null], responder: () => new Error('sync lock held by another process') })
    const p = fuente.guardar(memoria)
    await expect(p).rejects.toBeInstanceOf(ErrorDeEscritura)
    await expect(p).rejects.toThrow('sync lock held by another process')
  })

  it('actualizar sobre una superseded tira ErrorDeEscritura y no reintenta', async () => {
    const { fuente, llamadas } = armar({
      base: propia, nest: [nest],
      responder: () => ({ updated: false, reason: 'superseded' }),
    })
    const p = fuente.actualizar('id1', memoria)
    await expect(p).rejects.toBeInstanceOf(ErrorDeEscritura)
    await expect(p).rejects.toThrow('This memory changed elsewhere (superseded). Your text is kept.')
    expect(llamadas).toHaveLength(1)
  })

  it('actualizar con unchanged no es error, y manda title, content, tags y type', async () => {
    const { fuente, llamadas } = armar({ base: propia, nest: [null], responder: () => ({ updated: false, reason: 'unchanged' }) })
    await fuente.actualizar('id1', memoria)
    expect(llamadas[0].params).toEqual({ cwd: '/tmp/un-repo', syncId: 'id1', title: 'T', content: 'C', tags: ['a'], type: 'decision' })
  })

  it("guardar manda source: 'ui', el cwd y los cuatro campos", async () => {
    const { fuente, llamadas } = armar({ base: propia, nest: [null] })
    await fuente.guardar(memoria)
    expect(llamadas[0]).toMatchObject({
      method: 'memory.save',
      params: { cwd: '/tmp/un-repo', source: 'ui', title: 'T', content: 'C', type: 'decision', tags: ['a'] },
    })
  })

  it('un ok:false del daemon (mensaje cualquiera) es ErrorDeEscritura y no reintenta', async () => {
    const { fuente, llamadas } = armar({ base: propia, nest: [nest], responder: (d) => (d === 'daemon' ? new Error('read-only') : {}) })
    await expect(fuente.guardar(memoria)).rejects.toBeInstanceOf(ErrorDeEscritura)
    expect(llamadas).toHaveLength(1)
  })

  it('leer con base daemon va al daemon, y obtener devuelve el detalle o null', async () => {
    const item = { syncId: 'a', title: 't' }
    const { fuente, llamadas } = armar({
      base: { modo: 'daemon', socket: 's', token: 't' }, nest: [nest],
      responder: (_d, m) => (m === 'memory.get' ? { item, neighbors: [], pendingLinks: ['x'], resolvedLinks: [] } : { items: [] }),
    })
    expect(await fuente.obtener('a')).toEqual({ item, pendingLinks: ['x'], resolvedLinks: [] })
    await fuente.recientes({ todos: true, limite: 5 })
    expect(llamadas.every((l) => l.donde === 'daemon')).toBe(true)
    expect(llamadas[1].params).toMatchObject({ allProjects: true, limit: 5 })
  })
})

describe('fuente del paquete: seguir a Nest en los dos sentidos', () => {
  const deNest = { modo: 'nest' as const, path: '/nest/memory.db' }
  const daemon: DecisionDeBase = { modo: 'daemon', socket: 's', token: 't' }

  it('base daemon y Nest cerrado: guardar va al local sobre la base de Nest', async () => {
    const { fuente, llamadas, basesLocales } = armar({ base: daemon, nest: [null], sinNest: deNest })
    await fuente.guardar(memoria)
    expect(llamadas.map((l) => l.donde)).toEqual(['local'])
    expect(basesLocales).toEqual(['/nest/memory.db'])
  })

  it('base daemon que da ECONNREFUSED: cae al local sobre la base de Nest', async () => {
    const err = Object.assign(new Error('x'), { code: 'ECONNREFUSED' })
    const { fuente, llamadas, basesLocales } = armar({
      base: daemon, nest: [nest], sinNest: deNest, responder: (d) => (d === 'daemon' ? err : { ok: true }),
    })
    await fuente.guardar(memoria)
    expect(llamadas.map((l) => l.donde)).toEqual(['daemon', 'local'])
    expect(basesLocales).toEqual(['/nest/memory.db'])
  })

  it('tras cerrarse Nest, las lecturas dejan de ir al daemon', async () => {
    const { fuente, llamadas } = armar({ base: daemon, nest: [null], sinNest: deNest, responder: () => ({ items: [] }) })
    await fuente.guardar(memoria)
    await fuente.recientes({ todos: true, limite: 5 })
    expect(llamadas.map((l) => l.donde)).toEqual(['local', 'local'])
  })

  it('base propia y Nest abierto después: la escritura va al daemon y las lecturas la siguen', async () => {
    const { fuente, llamadas } = armar({ base: propia, nest: [nest], responder: () => ({ items: [] }) })
    await fuente.guardar(memoria)
    await fuente.recientes({ todos: false, limite: 5 })
    expect(llamadas.map((l) => l.donde)).toEqual(['daemon', 'daemon'])
  })

  it('un ok:false del daemon que dice "timed out" NO reintenta en el local', async () => {
    const { fuente, llamadas } = armar({
      base: propia, nest: [nest], responder: (d) => (d === 'daemon' ? new Error('upstream timed out') : {}),
    })
    await expect(fuente.guardar(memoria)).rejects.toBeInstanceOf(ErrorDeEscritura)
    expect(llamadas).toHaveLength(1)
  })

  it('el timeout del propio cliente del daemon sí reintenta', async () => {
    const { fuente, llamadas } = armar({
      base: propia, nest: [nest],
      responder: (d) => (d === 'daemon' ? new Error('Nest Memory daemon timed out (method=memory.save)') : {}),
    })
    await fuente.guardar(memoria)
    expect(llamadas.map((l) => l.donde)).toEqual(['daemon', 'local'])
  })
})

describe('fuente del daemon', () => {
  it('status y doctor describen a Nest como dueño, sin tocar la base', async () => {
    const f = crearFuenteDelDaemon('s', 't', '/tmp/un-repo')
    expect(f.proyecto()).toBe('un-repo')
    const s = await f.status()
    expect(s.modo).toBe('daemon')
    expect(s.resumen).toBe('Nest owns this memory')
    const d = await f.doctor()
    expect(d.filas[0]).toMatchObject({ marca: 'ok', etiqueta: 'Nest' })
    expect(d.bloqueadas).toEqual([])
    expect(d.filas.some((x) => x.marca === 'nada' && x.etiqueta === 'Blocked')).toBe(true)
  })
})
