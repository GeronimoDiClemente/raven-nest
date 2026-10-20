import { describe, it, expect, vi } from 'vitest'
import { EditorState, EditorSelection } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { CompletionContext } from '@codemirror/autocomplete'
import { decorar, marcasDeLivePreview, lineasActivas, nombreDeWikilink, type Resolver } from '../../lib/cm-live-preview'
import { fuenteDeWikilinks } from '../../lib/cm-wikilink-autocomplete'

const estado = (doc: string, cursor: number) => {
  const s = EditorState.create({ doc, selection: EditorSelection.cursor(Math.min(cursor, doc.length)), extensions: [markdown()] })
  ensureSyntaxTree(s, s.doc.length, 5000)
  return s
}
const resolver: Resolver = (n) => (n === 'Otra' ? { syncId: 's2' } : n === 'Falta' ? 'pendiente' : 'desconocido')
const ocultas = (s: EditorState) => marcasDeLivePreview(s, resolver).filter((m) => m.ocultar).map((m) => s.sliceDoc(m.from, m.to))

describe('live preview', () => {
  const doc = '## Titulo\n\nTexto **fuerte** y `code` con [[Otra]].\n\nOtra linea con [[Falta]].'
  it('fuera de la linea del cursor oculta las marcas', () => {
    const s = estado(doc, doc.length)
    const o = ocultas(s)
    expect(o).toEqual(expect.arrayContaining(['## ', '**', '`', '[[', ']]']))
  })
  it('en la linea del cursor muestra la sintaxis', () => {
    const s = estado(doc, doc.indexOf('fuerte'))
    expect(ocultas(s)).not.toContain('**')
    expect(ocultas(s)).toContain('## ')
  })
  it('marca los wikilinks con su estado', () => {
    const s = estado(doc, 0)
    const links = marcasDeLivePreview(s, resolver).filter((m) => m.wikilink)
    expect(links.map((m) => [m.wikilink, m.clase])).toEqual([
      ['Otra', 'cm-lp-wikilink'],
      ['Falta', 'cm-lp-wikilink cm-lp-wikilink-pendiente'],
    ])
  })
  it('no ve wikilinks dentro de codigo', () => {
    const s = estado('`[[Otra]]`\n\n```\n[[Otra]]\n```', 0)
    expect(marcasDeLivePreview(s, resolver).filter((m) => m.wikilink)).toEqual([])
  })
  it('contenido hostil queda como texto: ninguna marca trae HTML ni destino', () => {
    const s = estado('<img src=x onerror=alert(1)> [[javascript:alert(1)]] <script>x</script>', 999)
    for (const m of marcasDeLivePreview(s, resolver)) {
      expect(Object.keys(m).sort()).toEqual(expect.arrayContaining(['from', 'ocultar', 'to']))
      expect(JSON.stringify(m)).not.toMatch(/<|href/)
    }
  })
  it('un wikilink hostil llega como nombre crudo y nunca como href', () => {
    const s = estado('[[javascript:alert(1)]]\n\nfin', 25)
    const m = marcasDeLivePreview(s, resolver).find((x) => x.wikilink)
    expect(m?.wikilink).toBe('javascript:alert(1)')
    expect(m?.clase).toBe('cm-lp-wikilink')
    expect(resolver(m!.wikilink!)).toBe('desconocido') // no resuelve => el componente no navega
    expect(JSON.stringify(m)).not.toMatch(/href/)
    const onWikilink = vi.fn()
    onWikilink(m!.wikilink!, false)
    expect(onWikilink).toHaveBeenCalledWith('javascript:alert(1)', false)
  })
  it('nombre de un wikilink sin alias ni seccion', () => {
    expect(nombreDeWikilink('a|b')).toBe('a')
    expect(nombreDeWikilink('a#seccion')).toBe('a')
    expect(nombreDeWikilink(' a ')).toBe('a')
  })
  it('lineasActivas cubre una seleccion de varias lineas', () => {
    const s = EditorState.create({ doc: 'a\nb\nc', selection: EditorSelection.range(0, 3) })
    expect([...lineasActivas(s)].sort()).toEqual([1, 2])
  })
})


describe('autocompletado de wikilinks', () => {
  it('sugiere por alias e inserta el titulo', () => {
    const doc = 'ver [[cand'
    const s = EditorState.create({ doc, extensions: [markdown()] })
    const fuente = fuenteDeWikilinks(() => [
      { syncId: 'a', title: 'El candado', topicKey: 'auth/candado-x', aliases: ['candado'] },
      { syncId: 'b', title: 'Otra', topicKey: null },
    ])
    const r = fuente(new CompletionContext(s, doc.length, true)) as { from: number; options: Array<{ label: string; apply: string }> }
    expect(r.from).toBe(6)
    expect(r.options.map((o) => o.apply)).toEqual(['El candado]]'])
  })
  it('sin [[ antes del cursor no sugiere nada', () => {
    const s = EditorState.create({ doc: 'hola', extensions: [markdown()] })
    expect(fuenteDeWikilinks(() => [])(new CompletionContext(s, 4, true))).toBeNull()
  })
})

describe('decoraciones', () => {
  it('se arman en orden valido con lineas y marcas en la misma posicion', () => {
    const doc = '## **Titulo**\n\n> cita [[Otra]]\n\n```\ncodigo\n```\n\n**a** `b`'
    const s = estado(doc, doc.length)
    const set = decorar(s, resolver)
    let n = 0
    for (const it = set.iter(); it.value; it.next()) n++
    expect(n).toBeGreaterThan(5)
  })
})
