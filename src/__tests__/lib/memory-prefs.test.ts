import { describe, it, expect } from 'vitest'
import {
  DEFAULT_MEMORY_PREFS, FILTROS_POR_DEFECTO, conFiltros, normalizarFiltros, normalizarMemoryPrefs,
} from '../../lib/memory-prefs'

describe('normalizarMemoryPrefs', () => {
  it('sin nada guardado da los defaults', () => {
    expect(normalizarMemoryPrefs(undefined)).toEqual(DEFAULT_MEMORY_PREFS)
    expect(normalizarMemoryPrefs('basura')).toEqual(DEFAULT_MEMORY_PREFS)
  })

  it('un campo que no estaba guardado sale del default (merge de campos nuevos)', () => {
    const p = normalizarMemoryPrefs({ editor: { livePreview: false } })
    expect(p.editor).toEqual({ ...DEFAULT_MEMORY_PREFS.editor, livePreview: false })
    expect(p.graph).toEqual(DEFAULT_MEMORY_PREFS.graph)
  })

  it('un tipo roto vuelve al default de ese campo', () => {
    const p = normalizarMemoryPrefs({ editor: { livePreview: 'yes', fontSize: 40 }, graph: { labels: 'nunca', animate: 0 } })
    expect(p.editor.livePreview).toBe(true)
    expect(p.editor.fontSize).toBe(13)
    expect(p.graph.labels).toBe('zoom')
    expect(p.graph.animate).toBe(true)
  })

  it('el tamaño de letra sólo acepta 12–18 enteros', () => {
    expect(normalizarMemoryPrefs({ editor: { fontSize: 16 } }).editor.fontSize).toBe(16)
    expect(normalizarMemoryPrefs({ editor: { fontSize: 15.5 } }).editor.fontSize).toBe(13)
    expect(normalizarMemoryPrefs({ editor: { fontSize: 11 } }).editor.fontSize).toBe(13)
  })

  it('sin filtros guardados no inventa unos', () => {
    expect(normalizarMemoryPrefs({ graph: { remember: true } }).graph.filtros).toBeUndefined()
  })

  it('no comparte objetos con los defaults', () => {
    const p = normalizarMemoryPrefs(undefined)
    p.editor.fontSize = 18
    expect(DEFAULT_MEMORY_PREFS.editor.fontSize).toBe(13)
  })
})

describe('normalizarFiltros', () => {
  it('conserva unos filtros válidos', () => {
    const f = { colorBy: 'project', hideOrphans: false, tiposOcultos: ['gotcha'], escalaDeNodo: 1.5, distanciaDeLinks: 80, inferidas: false }
    expect(normalizarFiltros(f)).toEqual(f)
  })
  it('cada campo roto cae a su default; lo que no es objeto se descarta', () => {
    expect(normalizarFiltros({ colorBy: 'rojo', escalaDeNodo: 5, distanciaDeLinks: 'x', tiposOcultos: [1, 'bug'] }))
      .toEqual({ ...FILTROS_POR_DEFECTO, tiposOcultos: ['bug'] })
    expect(normalizarFiltros(null)).toBeUndefined()
    expect(normalizarFiltros([])).toBeUndefined()
  })
})

describe('conFiltros', () => {
  it('pone y saca los filtros sin tocar lo demás', () => {
    const con = conFiltros(DEFAULT_MEMORY_PREFS, FILTROS_POR_DEFECTO)
    expect(con.graph.filtros).toEqual(FILTROS_POR_DEFECTO)
    expect(con.graph.labels).toBe('zoom')
    const sin = conFiltros(con, undefined)
    expect('filtros' in sin.graph).toBe(false)
  })
})
