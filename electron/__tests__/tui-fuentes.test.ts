// Las fuentes de datos de la TUI, con clientes falsos que registran las llamadas.
import { describe, it, expect, vi } from 'vitest'
import { crearFuenteDelPaquete, type DependenciasDeFuente } from '../tui-del-paquete/fuente-del-paquete'
import { crearFuenteDelDaemon } from '../tui-del-paquete/fuente-del-daemon'
import { ErrorDeEscritura } from '../tui-del-paquete/fuente'
import type { DecisionDeBase } from '../base-para-el-paquete'
import { SyncDelMcp } from '../sync-del-mcp'
import { alAbrirConSync } from '../sync-del-paquete-tras-escribir'
import { leerDetalle } from '../tui-del-paquete/fuente-comun'

interface Llamada { donde: 'daemon' | 'local'; method: string; params: any }

function armar(opts: {
  base: DecisionDeBase
  nest: Array<{ socket: string; token: string } | null>
  responder?: (donde: 'daemon' | 'local', method: string, n: number) => unknown
  existe?: boolean
  sinNest?: { modo: 'nest'; path: string } | { modo: 'propia'; path: string; nueva: boolean }
  /** Reemplaza el cliente local falso (para probar el sync al cerrar). */
  local?: DependenciasDeFuente['crearLocal']
  tope?: number
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
    ...(opts.tope !== undefined ? { topeDeSyncAlCerrarMs: opts.tope } : {}),
    crearLocal: opts.local ?? ((b: { path: string }) => {
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
    }),
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
    expect(await fuente.obtener('a')).toEqual({ item, pendingLinks: ['x'], resolvedLinks: [], mencionadaEn: [] })
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

describe('cerrar la fuente del paquete con un push en la fila', () => {
  /**
   * Un local como el de verdad: cada `memory.save` encola un push en un `SyncDelMcp` real
   * (el `onMutation`), y `close` cierra la "base": un push que llega después falla como el de
   * verdad, con "database is not open".
   */
  function localConSync(push: () => Promise<void>) {
    const eventos: string[] = []
    let abierta = true
    const sync = new SyncDelMcp({
      pull: async () => {},
      push: async () => {
        if (!abierta) throw new Error('The database connection is not open')
        await push()
        if (!abierta) throw new Error('The database connection is not open')
        eventos.push('push')
      },
      stop: () => {},
    }, true)
    const crear: DependenciasDeFuente['crearLocal'] = () => ({
      call: async (method: string) => { if (method === 'memory.save') sync.trasEscribir(); return { ok: true } },
      close: () => { abierta = false; eventos.push('close') },
      esperarSync: () => sync.enCurso(),
    })
    return { crear, eventos }
  }

  it('crear una memoria y salir enseguida: el push termina antes de cerrar la base', async () => {
    let soltar: () => void = () => {}
    const { crear, eventos } = localConSync(() => new Promise<void>((r) => { soltar = r }))
    const { fuente } = armar({ base: propia, nest: [null], local: crear })
    await fuente.guardar(memoria)
    const cerrando = fuente.cerrar()
    await new Promise((r) => setTimeout(r, 20))
    expect(eventos).toEqual([]) // la base sigue abierta mientras el push vuela
    soltar()
    await cerrando
    expect(eventos).toEqual(['push', 'close'])
  })

  it('un push que nunca termina no cuelga la salida: se cierra al tope', async () => {
    const { crear, eventos } = localConSync(() => new Promise<void>(() => {}))
    const { fuente } = armar({ base: propia, nest: [null], local: crear, tope: 50 })
    await fuente.guardar(memoria)
    const t0 = Date.now()
    await fuente.cerrar()
    expect(Date.now() - t0).toBeGreaterThanOrEqual(45)
    expect(eventos).toEqual(['close'])
  })

  it('el tope por defecto es de 5 segundos', async () => {
    vi.useFakeTimers()
    try {
      const { crear, eventos } = localConSync(() => new Promise<void>(() => {}))
      const { fuente } = armar({ base: propia, nest: [null], local: crear })
      await fuente.guardar(memoria)
      let cerro = false
      void Promise.resolve(fuente.cerrar()).then(() => { cerro = true })
      await vi.advanceTimersByTimeAsync(4_900)
      expect(cerro).toBe(false)
      await vi.advanceTimersByTimeAsync(200)
      expect(cerro).toBe(true)
      expect(eventos).toEqual(['close'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('sin nada en la fila, cerrar no espera', async () => {
    const { crear, eventos } = localConSync(async () => {})
    const { fuente } = armar({ base: propia, nest: [null], local: crear, tope: 10_000 })
    await fuente.recientes({ todos: false, limite: 5 }).catch(() => {})
    const t0 = Date.now()
    await fuente.cerrar()
    expect(Date.now() - t0).toBeLessThan(1_000)
    expect(eventos).toEqual(['close'])
  })

  it('alAbrirConSync sobre una base que no es la propia: enCurso resuelve enseguida', async () => {
    const a = alAbrirConSync({ modo: 'nest', path: '/x/nest.db' })
    expect(a({} as never)).toBeUndefined()
    await expect(a.enCurso()).resolves.toBeUndefined()
  })
})

describe('leerDetalle contra un daemon de un Nest más viejo', () => {
  it('sin resolvedLinks ni pendingLinks devuelve listas vacías', async () => {
    const item = { syncId: 'a', title: 'T', type: 'decision', content: 'see [[Other]]', topicKey: null, tags: [], updatedAt: 1, originAi: null, gitBranch: null }
    const d = await leerDetalle({ call: async () => ({ item }) }, '/tmp/r', 'a')
    // Ni scope ni revisiones: el detalle no inventa propiedades que el daemon no mandó.
    expect(d).toEqual({ item, resolvedLinks: [], pendingLinks: [], mencionadaEn: [] })
  })

  it('los backlinks son sólo los vecinos entrantes por wikilink, y las propiedades pasan tal cual', async () => {
    const item = { syncId: 'a', title: 'T', type: 'decision', content: '', topicKey: null, tags: [], updatedAt: 1, originAi: null, gitBranch: null }
    const neighbors = [
      { syncId: 'b', title: 'Cita a T', topicKey: null, direction: 'incoming', via: 'wikilink' },
      { syncId: 'c', title: 'T cita a esta', topicKey: null, direction: 'outgoing', via: 'wikilink' },
      { syncId: 'd', title: 'Conectada a mano', topicKey: null, direction: 'both', via: 'manual' },
    ]
    const d = await leerDetalle({ call: async () => ({ item, neighbors, scope: 'team', revisionCount: 3 }) }, '/tmp/r', 'a')
    expect(d).toMatchObject({ mencionadaEn: [{ syncId: 'b', title: 'Cita a T' }], scope: 'team', revisiones: 3 })
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
