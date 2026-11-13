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
  it('sin foco no hay linea activa: todo se ve renderizado, tambien la del cursor', () => {
    const s = estado(doc, doc.indexOf('fuerte'))
    const o = marcasDeLivePreview(s, resolver, false).filter((m) => m.ocultar).map((m) => s.sliceDoc(m.from, m.to))
    expect(o).toEqual(expect.arrayContaining(['## ', '**', '`', '[[', ']]']))
    expect(o.filter((x) => x === '**')).toHaveLength(2)
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

describe('clases de linea por bloque', () => {
  const lineasCon = (s: EditorState, clase: string) =>
    marcasDeLivePreview(s, resolver).filter((m) => m.clase === clase && m.from === m.to).map((m) => s.doc.lineAt(m.from).number)
  it('un bloque de codigo de 3 lineas decora cada linea', () => {
    const s = estado('x\n\n```\na\nb\n```', 0)
    expect(lineasCon(s, 'cm-lp-codeblock')).toEqual([3, 4, 5, 6])
  })
  it('una cita de 2 lineas decora cada linea', () => {
    const s = estado('> uno\n> dos\n\nfin', 14)
    expect(lineasCon(s, 'cm-lp-quote')).toEqual([1, 2])
  })
  it('un titulo dentro de una cita se decora al inicio de la linea, una sola vez', () => {
    const s = estado('> ## Titulo', 0)
    expect(lineasCon(s, 'cm-lp-h2')).toEqual([1])
    expect(marcasDeLivePreview(s, resolver).filter((m) => m.clase === 'cm-lp-h2').map((m) => m.from)).toEqual([0])
  })
  it('un titulo setext lleva clase en su texto', () => {
    const s = estado('Titulo\n======\n\nfin', 17)
    expect(lineasCon(s, 'cm-lp-h1')).toEqual([1])
    const s2 = estado('Sub\n---\n\nfin', 11)
    expect(lineasCon(s2, 'cm-lp-h2')).toEqual([1])
  })
  it('decorar no rompe con citas, codigo y titulos anidados', () => {
    const s = estado('> ## T\n> ```\n> x\n> ```\n\nSetext\n===', 0)
    expect(() => decorar(s, resolver)).not.toThrow()
  })
})

describe('listas, citas y separadores (spec §5)', () => {
  it('la marca de una lista queda a la vista pero atenuada, tambien fuera de la linea activa', () => {
    const doc = '- uno\n* dos\n1. tres\n\nfin'
    const s = estado(doc, doc.length)
    const marcas = marcasDeLivePreview(s, resolver).filter((m) => m.clase === 'cm-lp-listmark').map((m) => s.sliceDoc(m.from, m.to))
    expect(marcas).toEqual(['-', '*', '1.'])
    expect(ocultas(s)).not.toEqual(expect.arrayContaining(['-']))
  })
  it('el > de una cita se oculta fuera de la linea activa y se ve en ella', () => {
    const doc = '> uno\n> dos\n\nfin'
    const fuera = estado(doc, doc.length)
    expect(ocultas(fuera).filter((x) => x === '> ')).toHaveLength(2)
    const dentro = estado(doc, 2)
    expect(ocultas(dentro).filter((x) => x === '> ')).toHaveLength(1)
  })
  it('un separador fuera de la linea activa es una regla fina; en ella, los guiones', () => {
    const doc = 'arriba\n\n---\n\nabajo'
    const fuera = estado(doc, doc.length)
    const hr = marcasDeLivePreview(fuera, resolver).filter((m) => m.clase === 'cm-lp-hr' && m.from === m.to)
    expect(hr.map((m) => fuera.doc.lineAt(m.from).number)).toEqual([3])
    expect(ocultas(fuera)).toContain('---')
    const dentro = estado(doc, doc.indexOf('---') + 1)
    expect(marcasDeLivePreview(dentro, resolver).some((m) => m.clase === 'cm-lp-hr')).toBe(false)
    expect(ocultas(dentro)).not.toContain('---')
  })
  it('decorar no rompe con listas, citas anidadas y separadores juntos', () => {
    const s = estado('- > cita en lista\n> - lista en cita\n\n***\n\n1. a\n   - b', 0)
    expect(() => decorar(s, resolver)).not.toThrow()
  })
})
