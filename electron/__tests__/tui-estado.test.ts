import { describe, it, expect } from 'vitest'
import {
  estadoInicial, reducir, segmentosDeContenido, columnas,
  type EstadoDeLaTui, type Accion, type DetalleDeMemoria,
} from '../tui-del-paquete/estado'
import type { ObservationSummary } from '../memory-protocol'

const obs = (syncId: string, title = syncId): ObservationSummary => ({
  syncId, title, content: '', type: 'note' as ObservationSummary['type'], topicKey: null, tags: [],
  updatedAt: 1, originAi: null, gitBranch: null,
})
const tecla = (input: string, key: Record<string, boolean> = {}): Accion => ({ tipo: 'tecla', input, key })
const detalleDe = (syncId: string, links: DetalleDeMemoria['resolvedLinks'] = []): DetalleDeMemoria => ({
  item: obs(syncId), resolvedLinks: links, pendingLinks: [],
})
const conLista = (n = 3): EstadoDeLaTui => ({
  ...estadoInicial(), cargando: false, lista: Array.from({ length: n }, (_, i) => obs(`s${i + 1}`)),
})
const paso = (e: EstadoDeLaTui, ...as: Accion[]) => {
  let estado = e
  let efectos: ReturnType<typeof reducir>['efectos'] = []
  for (const a of as) ({ estado, efectos } = reducir(estado, a))
  return { estado, efectos }
}

describe('navegación y detalle', () => {
  it('⏎ sobre la fila 2 apila el detalle y pide abrirlo', () => {
    const { estado, efectos } = paso(conLista(), tecla('j'), tecla('', { return: true }))
    expect(estado.pila).toEqual([{ tipo: 'detalle', syncId: 's2', linkEnfocado: null, scroll: 0 }])
    expect(efectos).toEqual([{ tipo: 'abrir', syncId: 's2' }])
  })

  it('⏎ sobre un link resuelto apila otra vista; Esc vuelve a la memoria anterior, no a la lista', () => {
    const links = [{ name: 'B', syncId: 's9' }]
    let e = paso(conLista(), tecla('', { return: true })).estado
    e = paso(e, { tipo: 'detalle-cargado', detalle: detalleDe('s1', links) }).estado
    e = paso(e, tecla('', { tab: true })).estado
    expect(e.pila[0]!.linkEnfocado).toBe(0)
    const r = paso(e, tecla('', { return: true }))
    expect(r.estado.pila.map((v) => v.syncId)).toEqual(['s1', 's9'])
    expect(r.efectos).toEqual([{ tipo: 'abrir', syncId: 's9' }])
    const volver = paso(r.estado, tecla('', { escape: true }))
    expect(volver.estado.pila.map((v) => v.syncId)).toEqual(['s1'])
    expect(volver.efectos).toEqual([{ tipo: 'abrir', syncId: 's1' }])
    const lista = paso(volver.estado, tecla('', { escape: true }))
    expect(lista.estado.pila).toEqual([])
  })

  it('Tab y Shift+Tab recorren sólo los links con syncId y dan la vuelta', () => {
    const links = [
      { name: 'A', syncId: 'a' }, { name: 'hueco', syncId: null }, { name: 'C', syncId: 'c' },
    ]
    let e = paso(conLista(), tecla('', { return: true })).estado
    e = paso(e, { tipo: 'detalle-cargado', detalle: detalleDe('s1', links) }).estado
    const foco = (x: EstadoDeLaTui) => x.pila[0]!.linkEnfocado
    e = paso(e, tecla('', { tab: true })).estado; expect(foco(e)).toBe(0)
    e = paso(e, tecla('', { tab: true })).estado; expect(foco(e)).toBe(2)
    e = paso(e, tecla('', { tab: true })).estado; expect(foco(e)).toBe(0)
    e = paso(e, tecla('', { tab: true, shift: true })).estado; expect(foco(e)).toBe(2)
    e = paso(e, tecla('', { tab: true, shift: true })).estado; expect(foco(e)).toBe(0)
  })

  it('1–4 y Tab cambian de pestaña y piden su carga; dentro del detalle no', () => {
    const e = conLista()
    expect(paso(e, tecla('3')).estado.pestana).toBe('status')
    expect(paso(e, tecla('3')).efectos).toEqual([{ tipo: 'cargar-status' }])
    expect(paso(e, tecla('4')).efectos).toEqual([{ tipo: 'cargar-doctor' }])
    expect(paso(e, tecla('', { tab: true })).estado.pestana).toBe('search')
    const det = paso(e, tecla('', { return: true })).estado
    expect(paso(det, tecla('3')).estado.pestana).toBe('recent')
  })

  it('g alterna el alcance en Recent; / salta a Search', () => {
    const r = paso(conLista(), tecla('g'))
    expect(r.estado.todosLosProyectos).toBe(true)
    expect(r.efectos).toEqual([{ tipo: 'cargar-recientes', todos: true }])
    expect(paso(conLista(), tecla('/')).estado.pestana).toBe('search')
  })

  it('el cursor se mantiene dentro de la lista', () => {
    const e = paso(conLista(2), tecla('k'), tecla('j'), tecla('j'), tecla('j')).estado
    expect(e.cursor).toBe(1)
  })

  it('un detalle que llega de otra memoria (viejo) se ignora', () => {
    const e = paso(conLista(), tecla('', { return: true }), { tipo: 'detalle-cargado', detalle: detalleDe('otro') }).estado
    expect(e.detalle).toBeNull()
  })

  it('n, e y d sobre una lista vacía no hacen nada; n crea igual', () => {
    const vacio = { ...estadoInicial(), cargando: false }
    expect(paso(vacio, tecla('e')).efectos).toEqual([])
    expect(paso(vacio, tecla('d')).estado.confirmando).toBeNull()
    expect(paso(vacio, tecla('n')).efectos).toEqual([{ tipo: 'editar', syncId: null }])
  })

  it('q y Ctrl+C salen', () => {
    expect(paso(conLista(), tecla('q')).efectos).toEqual([{ tipo: 'salir' }])
    expect(paso(conLista(), tecla('c', { ctrl: true })).efectos).toEqual([{ tipo: 'salir' }])
  })

  it('? muestra y oculta la ayuda', () => {
    const e = paso(conLista(), tecla('?')).estado
    expect(e.ayuda).toBe(true)
    expect(paso(e, tecla('?')).estado.ayuda).toBe(false)
  })
})

describe('Search', () => {
  const enSearch = () => paso(conLista(), tecla('/')).estado

  it('escribir pide una búsqueda a 150 ms con la consulta completa, y escribir de nuevo la reemplaza', () => {
    const a = paso(enSearch(), tecla('f'), tecla('o'))
    expect(a.estado.consulta).toBe('fo')
    expect(a.efectos).toEqual([{ tipo: 'buscar', consulta: 'fo', enMs: 150 }])
    const b = paso(a.estado, tecla('', { backspace: true }))
    expect(b.efectos).toEqual([{ tipo: 'buscar', consulta: 'f', enMs: 150 }])
  })

  it('q en Search escribe la letra; q en Recent sale', () => {
    const s = paso(enSearch(), tecla('q'), tecla('n'), tecla('g'), tecla('1'))
    expect(s.estado.consulta).toBe('qng1')
    expect(s.estado.pestana).toBe('search')
    expect(s.efectos.some((x) => x.tipo === 'salir')).toBe(false)
    expect(paso(conLista(), tecla('q')).efectos).toEqual([{ tipo: 'salir' }])
  })

  it('⏎ abre el resultado seleccionado', () => {
    const e = paso(enSearch(), { tipo: 'lista-cargada', lista: [obs('x')], de: { pestana: 'search', consulta: '' } }, tecla('', { return: true }))
    expect(e.efectos).toEqual([{ tipo: 'abrir', syncId: 'x' }])
  })
})

describe('resultados tardíos', () => {
  const buscando = (...cs: string[]) => paso(conLista(), tecla('/'), ...cs.map((c) => tecla(c))).estado
  const deSearch = (consulta: string, ...ids: string[]): Accion =>
    ({ tipo: 'lista-cargada', lista: ids.map((i) => obs(i)), de: { pestana: 'search', consulta } })

  it('un resultado de búsqueda que llega después de Esc no llena Search', () => {
    const e = paso(buscando('a', 'b'), tecla('', { escape: true }), deSearch('ab', 'x')).estado
    expect(e.lista).toEqual([])
  })

  it('un resultado de recientes que llega tras pasar a Search se ignora', () => {
    const e = paso(conLista(), tecla('/'), { tipo: 'lista-cargada', lista: [obs('r')], de: { pestana: 'recent', todos: false } }).estado
    expect(e.lista).toEqual([])
  })

  it('el resultado de una consulta vieja, después de una nueva, se ignora', () => {
    const e = paso(buscando('a', 'b'), deSearch('ab', 'nuevo'), deSearch('a', 'viejo')).estado
    expect(e.lista.map((x) => x.syncId)).toEqual(['nuevo'])
  })

  it('recientes de otro alcance (g) se ignora', () => {
    const e = paso(conLista(), tecla('g'), { tipo: 'lista-cargada', lista: [obs('r')], de: { pestana: 'recent', todos: false } }).estado
    expect(e.lista.map((x) => x.syncId)).toEqual(['s1', 's2', 's3'])
  })
})

describe('detalle inexistente', () => {
  it('detalle null saca la vista, avisa y apaga cargando', () => {
    const e = paso(conLista(), tecla('', { return: true }), { tipo: 'detalle-cargado', detalle: null }).estado
    expect(e.pila).toEqual([])
    expect(e.cargando).toBe(false)
    expect(e.aviso?.texto).toBe('This memory no longer exists')
  })
  it('con una vista previa, vuelve a abrirla', () => {
    const links = [{ name: 'B', syncId: 's9' }]
    const r = paso(conLista(), tecla('', { return: true }), { tipo: 'detalle-cargado', detalle: detalleDe('s1', links) },
      tecla('', { tab: true }), tecla('', { return: true }), { tipo: 'detalle-cargado', detalle: null })
    expect(r.estado.pila.map((v) => v.syncId)).toEqual(['s1'])
    expect(r.efectos).toEqual([{ tipo: 'abrir', syncId: 's1' }])
  })
})

describe('borrar', () => {
  it('d pide confirmación; y borra; cualquier otra tecla cancela', () => {
    const pide = paso(conLista(), tecla('d'))
    expect(pide.estado.confirmando).toEqual({ syncId: 's1', titulo: 's1' })
    const si = paso(pide.estado, tecla('y'))
    expect(si.efectos).toEqual([{ tipo: 'borrar', syncId: 's1' }])
    expect(si.estado.confirmando).toBeNull()
    const no = paso(pide.estado, tecla('x'))
    expect(no.efectos).toEqual([])
    expect(no.estado.confirmando).toBeNull()
  })
})

describe('editor', () => {
  it('un error de editor ofrece reabrir o descartar', () => {
    const e = paso(conLista(), { tipo: 'error-de-editor', mensaje: 'boom', archivo: '/tmp/x.md' }).estado
    expect(paso(e, tecla('r')).efectos).toEqual([{ tipo: 'reabrir-editor', archivo: '/tmp/x.md' }])
    expect(paso(e, tecla('d')).estado.errorDeEditor).toBeNull()
  })
})

describe('segmentosDeContenido y columnas', () => {
  it('no marca un link dentro de un bloque de código', () => {
    const segs = segmentosDeContenido('```\n[[B]]\n```\n[[B]]', [{ name: 'b', syncId: 'sb' }])
    const conLink = segs.filter((s) => s.link)
    expect(conLink).toHaveLength(1)
    expect(conLink[0]).toEqual({ texto: '[[B]]', link: { indice: 0, syncId: 'sb' } })
    expect(segs.map((s) => s.texto).join('')).toBe('```\n[[B]]\n```\n[[B]]')
    expect(segs[0]!.link).toBeUndefined()
  })

  it('alias y sección apuntan al destino; un hueco conserva syncId null', () => {
    const segs = segmentosDeContenido('ver [[a|x]] y [[Z#s]].', [
      { name: 'a', syncId: 'sa' }, { name: 'Z', syncId: null },
    ])
    expect(segs.filter((s) => s.link).map((s) => s.link)).toEqual([
      { indice: 0, syncId: 'sa' }, { indice: 1, syncId: null },
    ])
  })

  it('columnas', () => {
    expect(columnas(59).conFecha).toBe(false)
    expect(columnas(60).conFecha).toBe(true)
    expect(columnas(39).demasiadoAngosta).toBe(true)
    expect(columnas(40).demasiadoAngosta).toBe(false)
  })
})
