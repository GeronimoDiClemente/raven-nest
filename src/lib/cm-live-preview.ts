// Live preview como el de Obsidian, sobre CodeMirror 6. El documento es SIEMPRE el Markdown
// tal cual: acá sólo se decide cómo se ve. Fuera de la línea del cursor se ocultan las
// marcas (`**`, `#`, `` ` ``, `[[`/`]]`); en la línea del cursor se muestran para editar.
//
// Seguridad: todo es `Decoration.mark/line/replace` con clases y atributos fijos. Ningún
// pedazo del contenido llega al DOM como HTML (misma regla que tenía MemoryMarkdown: una
// memoria la puede escribir cualquier agente o venir de otra máquina del equipo).
import { syntaxTree } from '@codemirror/language'
import { RangeSetBuilder, StateEffect, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'

export type EstadoDeLink = { syncId: string } | 'pendiente' | 'desconocido'
export type Resolver = (nombre: string) => EstadoDeLink
export interface MarcaLP { from: number; to: number; ocultar: boolean; clase?: string; wikilink?: string }

export const refrescarLivePreview = StateEffect.define<null>()

const MARCAS_INLINE = new Set(['EmphasisMark', 'CodeMark', 'StrikethroughMark'])
const CLASE_INLINE: Record<string, string> = { StrongEmphasis: 'cm-lp-strong', Emphasis: 'cm-lp-em', InlineCode: 'cm-lp-code' }
const NODOS_DE_CODIGO = new Set(['InlineCode', 'FencedCode', 'CodeBlock'])

export function nombreDeWikilink(crudo: string): string {
  return crudo.split('|')[0].split('#')[0].trim()
}

export function lineasActivas(state: EditorState): Set<number> {
  const out = new Set<number>()
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number, b = state.doc.lineAt(r.to).number
    for (let i = a; i <= b; i++) out.add(i)
  }
  return out
}

/** `enfocado: false` = el editor no tiene el foco: como en Obsidian, no hay línea "en
 *  edición" y se ve todo renderizado, también la línea donde quedó el cursor. CM6 siempre
 *  tiene una selección (arranca en 0), así que sin esto la primera línea de una nota recién
 *  abierta mostraría la sintaxis cruda y sus links no se podrían clickear. */
export function marcasDeLivePreview(state: EditorState, resolver: Resolver, enfocado = true): MarcaLP[] {
  const activas = enfocado ? lineasActivas(state) : new Set<number>()
  const enActiva = (pos: number) => activas.has(state.doc.lineAt(pos).number)
  const marcas: MarcaLP[] = []
  const codigo: Array<[number, number]> = []
  // Decoración de línea en el INICIO de cada línea del rango, sin repetir línea+clase.
  const vistas = new Set<string>()
  const lineas = (desde: number, hasta: number, clase: string) => {
    for (let i = state.doc.lineAt(desde).number; i <= state.doc.lineAt(hasta).number; i++) {
      const pos = state.doc.line(i).from
      const k = `${pos}|${clase}`
      if (vistas.has(k)) continue
      vistas.add(k)
      marcas.push({ from: pos, to: pos, ocultar: false, clase })
    }
  }

  syntaxTree(state).iterate({
    enter: (n) => {
      if (NODOS_DE_CODIGO.has(n.name)) codigo.push([n.from, n.to])
      const h = /^ATXHeading(\d)$/.exec(n.name)
      if (h) lineas(n.from, n.to, `cm-lp-h${h[1]}`)
      // Setext: el texto lleva la clase; la línea de subrayado (===/---) es la última.
      const sx = /^SetextHeading(\d)$/.exec(n.name)
      if (sx) {
        const ult = state.doc.lineAt(n.to).number
        const fin = Math.max(state.doc.lineAt(n.from).number, ult - 1)
        lineas(n.from, state.doc.line(fin).to, `cm-lp-h${sx[1]}`)
      }
      if (n.name === 'FencedCode') lineas(n.from, n.to, 'cm-lp-codeblock')
      if (n.name === 'Blockquote') lineas(n.from, n.to, 'cm-lp-quote')
      // Listas (spec §5): la marca (`-`, `*`, `1.`) queda a la vista pero atenuada, como en
      // Obsidian — es lo que dice que es una lista, y editarla no pide entrar a la línea.
      if (n.name === 'ListMark') marcas.push({ from: n.from, to: n.to, ocultar: false, clase: 'cm-lp-listmark' })
      // Citas: el `>` se oculta fuera de la línea activa; el borde izquierdo ya dice que es
      // una cita.
      if (n.name === 'QuoteMark' && !enActiva(n.from)) {
        const fin = state.sliceDoc(n.to, n.to + 1) === ' ' ? n.to + 1 : n.to
        marcas.push({ from: n.from, to: fin, ocultar: true })
      }
      // Separador: fuera de la línea activa, la línea se dibuja como una regla fina y los
      // `---` se ocultan. En la línea activa se ven para editarlos.
      if (n.name === 'HorizontalRule' && !enActiva(n.from)) {
        lineas(n.from, n.from, 'cm-lp-hr')
        marcas.push({ from: n.from, to: n.to, ocultar: true })
      }
      if (CLASE_INLINE[n.name]) marcas.push({ from: n.from, to: n.to, ocultar: false, clase: CLASE_INLINE[n.name] })
      if (n.name === 'HeaderMark' && !enActiva(n.from)) {
        // El `#` y el espacio que lo sigue.
        const fin = state.sliceDoc(n.to, n.to + 1) === ' ' ? n.to + 1 : n.to
        marcas.push({ from: n.from, to: fin, ocultar: true })
      }
      if (MARCAS_INLINE.has(n.name) && !enActiva(n.from)) {
        // Las marcas de un bloque de código cercado (```) no se ocultan: sin ellas no se ve
        // dónde empieza y termina el bloque.
        const padre = n.node.parent?.name
        if (padre !== 'FencedCode') marcas.push({ from: n.from, to: n.to, ocultar: true })
      }
    },
  })

  const enCodigo = (pos: number) => codigo.some(([a, b]) => pos >= a && pos < b)
  const texto = state.doc.toString()
  const re = /\[\[([^[\]\n]+?)\]\]/g
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    const from = m.index, to = from + m[0].length
    if (enCodigo(from)) continue
    const nombre = nombreDeWikilink(m[1])
    const estado = resolver(nombre)
    const clase = estado === 'pendiente' ? 'cm-lp-wikilink cm-lp-wikilink-pendiente' : 'cm-lp-wikilink'
    marcas.push({ from: from + 2, to: to - 2, ocultar: false, clase, wikilink: nombre })
    if (!enActiva(from)) {
      marcas.push({ from, to: from + 2, ocultar: true })
      marcas.push({ from: to - 2, to, ocultar: true })
    }
  }
  return marcas
}

export function decorar(state: EditorState, resolver: Resolver, enfocado = true): DecorationSet {
  const decos: Array<{ from: number; to: number; deco: Decoration }> = []
  for (const m of marcasDeLivePreview(state, resolver, enfocado)) {
    if (m.ocultar) decos.push({ from: m.from, to: m.to, deco: Decoration.replace({}) })
    else if (m.from === m.to && m.clase) decos.push({ from: m.from, to: m.from, deco: Decoration.line({ class: m.clase }) })
    else if (m.clase) {
      decos.push({
        from: m.from,
        to: m.to,
        deco: Decoration.mark({ class: m.clase, attributes: m.wikilink ? { 'data-wikilink': m.wikilink } : undefined }),
      })
    }
  }
  // RangeSetBuilder exige orden por posición y luego por startSide (las líneas van primero).
  decos.sort((a, b) => a.from - b.from || a.deco.startSide - b.deco.startSide)
  const b = new RangeSetBuilder<Decoration>()
  for (const d of decos) b.add(d.from, d.to, d.deco)
  return b.finish()
}

export function livePreview(opts: { resolver: () => Resolver; onWikilink: (nombre: string, background: boolean) => void }): Extension {
  const plugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet
    constructor(view: EditorView) { this.decorations = decorar(view.state, opts.resolver(), view.hasFocus) }
    update(u: ViewUpdate) {
      const forzado = u.transactions.some((t) => t.effects.some((e) => e.is(refrescarLivePreview)))
      if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged || forzado || syntaxTree(u.state) !== syntaxTree(u.startState)) {
        this.decorations = decorar(u.state, opts.resolver(), u.view.hasFocus)
      }
    }
  }, { decorations: (v) => v.decorations })

  const click = EditorView.domEventHandlers({
    mousedown(e, view) {
      const el = (e.target as HTMLElement | null)?.closest('[data-wikilink]')
      if (!el) return false
      const pos = view.posAtDOM(el)
      // Se está editando esa línea (sólo con foco: sin foco no hay línea activa).
      if (view.hasFocus && lineasActivas(view.state).has(view.state.doc.lineAt(pos).number)) return false
      e.preventDefault()
      opts.onWikilink(el.getAttribute('data-wikilink') ?? '', e.ctrlKey || e.metaKey)
      return true
    },
  })

  // La app no tiene token de link (el acento es acromático): el wikilink se distingue por el
  // subrayado, y el pendiente por el trazo discontinuo y el color atenuado.
  //
  // `dark: true`: sin eso CodeMirror aplica sus reglas `&light` (tooltip casi blanco con el texto
  // claro de la app encima, fila elegida en azul). La app no tiene tema claro todavía; los
  // colores de abajo son todos tokens, así que el día que lo tenga esto sigue valiendo.
  const tema = EditorView.theme({
    '&': { color: 'var(--foreground)', backgroundColor: 'transparent', fontSize: 'var(--fs)' },
    // El cuerpo en la fuente de la UI: el tema base de CM pone `monospace` en el scroller.
    '.cm-scroller': { fontFamily: 'var(--font-ui)', lineHeight: '1.7' },
    '.cm-content': { fontFamily: 'inherit', lineHeight: '1.7', caretColor: 'var(--foreground)', padding: '0', minHeight: '12rem' },
    // Sin el padding de 2px/6px de CM: el cuerpo queda alineado con el título.
    '.cm-line': { padding: '0' },
    '&.cm-focused': { outline: 'none' },
    '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--foreground)' },
    '.cm-content ::selection, .cm-line::selection': { backgroundColor: 'color-mix(in srgb, var(--foreground) 22%, transparent)' },
    '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
      backgroundColor: 'color-mix(in srgb, var(--foreground) 22%, transparent)',
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--popover)',
      color: 'var(--popover-foreground)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      fontFamily: 'var(--font-ui)',
      fontSize: 'var(--fs-sm)',
      overflow: 'hidden',
    },
    // Con `.cm-tooltip` delante: el tema base de autocomplete pone `monospace` con ese mismo
    // selector, y con menos especificidad el nuestro perdía.
    '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-ui)', maxHeight: '16em' },
    '.cm-tooltip-autocomplete > ul > li': { padding: '3px 8px', color: 'var(--popover-foreground)' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'var(--accent)',
      color: 'var(--accent-foreground)',
    },
    '.cm-completionDetail': { color: 'var(--muted-foreground)', fontStyle: 'normal', marginLeft: '8px' },
    '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '600' },
    '.cm-lp-listmark': { color: 'var(--muted-foreground)' },
    '.cm-lp-hr': {
      backgroundImage: 'linear-gradient(var(--input), var(--input))',
      backgroundSize: '100% 1px',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    },
    '.cm-lp-h1': { fontSize: '1.6em', fontWeight: '600' },
    '.cm-lp-h2': { fontSize: '1.3em', fontWeight: '600' },
    '.cm-lp-h3': { fontSize: '1.15em', fontWeight: '600' },
    '.cm-lp-h4': { fontSize: '1.05em', fontWeight: '600' },
    '.cm-lp-h5': { fontWeight: '600' },
    '.cm-lp-h6': { fontWeight: '600' },
    '.cm-lp-strong': { fontWeight: '600' },
    '.cm-lp-em': { fontStyle: 'italic' },
    '.cm-lp-code': { fontFamily: 'var(--font-mono, monospace)', backgroundColor: 'var(--muted)', borderRadius: '4px', padding: '0 4px' },
    '.cm-lp-codeblock': { fontFamily: 'var(--font-mono, monospace)', backgroundColor: 'var(--muted)' },
    '.cm-lp-quote': { borderLeft: '2px solid var(--border)', paddingLeft: '10px', color: 'var(--muted-foreground)' },
    '.cm-lp-wikilink': { color: 'var(--foreground)', textDecoration: 'underline', textUnderlineOffset: '3px', cursor: 'pointer' },
    '.cm-lp-wikilink-pendiente': { color: 'var(--muted-foreground)', textDecorationStyle: 'dashed' },
  }, { dark: true })

  return [plugin, click, tema]
}
