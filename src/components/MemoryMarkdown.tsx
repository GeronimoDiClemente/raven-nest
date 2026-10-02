// El contenido de una memoria, leído como Markdown y con los `[[links]]` navegables.
//
// Un parser propio y chico en vez de una librería, a propósito: lo que guardan los agentes
// es un subconjunto acotado (encabezados, listas, negrita, código, alguna tabla), y el
// resultado son elementos de React — nunca HTML crudo. Una memoria la puede escribir
// cualquier agente o venir de la máquina de otro miembro del equipo, así que un
// `dangerouslySetInnerHTML` acá sería una puerta de entrada, por más sanitizado que esté.
//
// Sólo `[[...]]` linkea, como en Obsidian. La negrita es negrita y nada más (decidido el
// 2026-10-02: linkear cualquier negrita que coincida con un título daba falsos positivos).
import type { ReactNode } from 'react'

interface Props {
  text: string
  /** La resolución que hizo main (`links` del detalle). Ausente = un main viejo que no la
   *  manda: los `[[...]]` quedan como texto antes que inventar un destino. */
  links?: Array<{ name: string; syncId: string | null }>
  onOpen: (syncId: string) => void
}

type Resolver = (nombre: string) => string | null | undefined

type Bloque =
  | { tipo: 'codigo'; texto: string }
  | { tipo: 'titulo'; nivel: number; texto: string }
  | { tipo: 'lista'; ordenada: boolean; items: Array<{ texto: string; nivel: number }> }
  | { tipo: 'cita'; lineas: string[] }
  | { tipo: 'regla' }
  | { tipo: 'parrafo'; lineas: string[] }

const FENCE = /^\s*```/
const TITULO = /^(#{1,6})\s+(.*)$/
const ITEM = /^(\s*)(?:[-*+]|(\d+)[.)])\s+(.*)$/
const CITA = /^\s*>\s?(.*)$/
const REGLA = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
// Una tabla se deja como texto monoespaciado: alinear columnas a mano ya es lo que hizo
// quien la escribió, y armar un <table> para 340px de ancho no gana nada.
const TABLA = /^\s*\|/

export function parsearBloques(texto: string): Bloque[] {
  const lineas = texto.replace(/\r\n?/g, '\n').split('\n')
  const bloques: Bloque[] = []
  let i = 0

  // El frontmatter (`aliases:` y compañía) va al principio y se muestra como código: es
  // metadata, y leído como Markdown el `---` de cierre se volvería un título.
  if (lineas[0]?.trim() === '---') {
    const cierre = lineas.findIndex((l, j) => j > 0 && l.trim() === '---')
    if (cierre > 0) {
      bloques.push({ tipo: 'codigo', texto: lineas.slice(0, cierre + 1).join('\n') })
      i = cierre + 1
    }
  }

  while (i < lineas.length) {
    const linea = lineas[i]!
    if (!linea.trim()) { i++; continue }

    if (FENCE.test(linea)) {
      // Un fence sin cerrar sigue hasta el final, igual que en `parsearWikilinks`.
      const cuerpo: string[] = []
      i++
      while (i < lineas.length && !FENCE.test(lineas[i]!)) cuerpo.push(lineas[i++]!)
      i++
      bloques.push({ tipo: 'codigo', texto: cuerpo.join('\n') })
      continue
    }

    if (TABLA.test(linea)) {
      const filas: string[] = []
      while (i < lineas.length && TABLA.test(lineas[i]!)) filas.push(lineas[i++]!.trim())
      bloques.push({ tipo: 'codigo', texto: filas.join('\n') })
      continue
    }

    const titulo = TITULO.exec(linea)
    if (titulo) {
      bloques.push({ tipo: 'titulo', nivel: titulo[1]!.length, texto: titulo[2]!.trim() })
      i++
      continue
    }

    if (REGLA.test(linea)) { bloques.push({ tipo: 'regla' }); i++; continue }

    const item = ITEM.exec(linea)
    if (item) {
      const ordenada = item[2] !== undefined
      const items: Array<{ texto: string; nivel: number }> = []
      while (i < lineas.length) {
        const m = ITEM.exec(lineas[i]!)
        if (!m || (m[2] !== undefined) !== ordenada) break
        items.push({ texto: m[3]!, nivel: Math.min(Math.floor(m[1]!.replace(/\t/g, '  ').length / 2), 4) })
        i++
      }
      bloques.push({ tipo: 'lista', ordenada, items })
      continue
    }

    if (CITA.test(linea)) {
      const citadas: string[] = []
      while (i < lineas.length && CITA.test(lineas[i]!)) citadas.push(CITA.exec(lineas[i++]!)![1]!)
      bloques.push({ tipo: 'cita', lineas: citadas })
      continue
    }

    // Párrafo: hasta una línea vacía o hasta que empiece otro bloque.
    const parrafo: string[] = []
    while (i < lineas.length) {
      const l = lineas[i]!
      if (!l.trim() || FENCE.test(l) || TABLA.test(l) || TITULO.test(l) || REGLA.test(l) || ITEM.test(l) || CITA.test(l)) break
      parrafo.push(l)
      i++
    }
    bloques.push({ tipo: 'parrafo', lineas: parrafo })
  }
  return bloques
}

// El orden de las alternativas es la precedencia: el código primero, porque adentro de un
// backtick nada es un link ni una negrita (`[[ -f x ]]` es bash).
const INLINE = new RegExp(
  [
    '`([^`\\n]+)`',                       // 1: código
    '!?\\[\\[([^\\[\\]]+?)\\]\\]',        // 2: wikilink (y el embed, que acá es un link)
    '\\*\\*(.+?)\\*\\*',                   // 3: negrita
    '__(.+?)__',                           // 4: negrita
    '\\[([^\\]\\n]+)\\]\\(([^)\\s]+)\\)',  // 5, 6: link de Markdown
    '\\*([^*\\s][^*\\n]*?)\\*',            // 7: itálica
    '(?<![\\w])_([^_\\s][^_\\n]*?)_(?![\\w])', // 8: itálica — `snake_case` no lo es
  ].join('|'),
  'g',
)

function inline(texto: string, resolver: Resolver, onOpen: (id: string) => void, clave = ''): ReactNode[] {
  const nodos: ReactNode[] = []
  let ultimo = 0
  let n = 0
  for (const m of texto.matchAll(INLINE)) {
    const inicio = m.index!
    if (inicio > ultimo) nodos.push(texto.slice(ultimo, inicio))
    const k = `${clave}.${n++}`
    if (m[1] !== undefined) {
      nodos.push(<code key={k} className="rounded-sm bg-muted px-1 font-mono text-fs-xs">{m[1]}</code>)
    } else if (m[2] !== undefined) {
      nodos.push(<Wikilink key={k} crudo={m[2]} original={m[0]} resolver={resolver} onOpen={onOpen} />)
    } else if (m[3] !== undefined || m[4] !== undefined) {
      nodos.push(<strong key={k} className="font-semibold">{inline(m[3] ?? m[4]!, resolver, onOpen, k)}</strong>)
    } else if (m[5] !== undefined) {
      // Un link a la web no se abre desde acá: el texto queda, y la URL se ve al pasar por
      // encima. Abrir URLs que escribió un agente no es algo para hacer con un click suelto.
      nodos.push(<span key={k} title={m[6]} className="underline decoration-dotted underline-offset-2">{m[5]}</span>)
    } else {
      nodos.push(<em key={k}>{inline(m[7] ?? m[8]!, resolver, onOpen, k)}</em>)
    }
    ultimo = inicio + m[0].length
  }
  if (ultimo < texto.length) nodos.push(texto.slice(ultimo))
  return nodos
}

function Wikilink({ crudo, original, resolver, onOpen }: {
  crudo: string
  original: string
  resolver: Resolver
  onOpen: (id: string) => void
}) {
  // Mismo corte que `parsearWikilinks` en electron/wikilinks.ts: el destino es lo que va
  // antes del `|` (alias) y del `#` (sección). Lo que se MUESTRA es el alias si hay.
  const [antesDelAlias, alias] = crudo.split('|') as [string, string | undefined]
  const destino = antesDelAlias.split('#')[0]!.trim()
  const visible = (alias ?? antesDelAlias).trim()
  const id = resolver(destino)

  if (id === undefined) return <>{original}</>
  if (id === null) {
    return (
      <span
        // Subrayado y no `border-b`: sin preflight, `border-dashed` pinta los cuatro lados
        // con el ancho por default del navegador y queda una caja punteada.
        className="text-muted-foreground underline decoration-dashed decoration-muted-foreground underline-offset-2"
        title="Not written yet — a memory links here, but nobody wrote it"
      >
        {visible}
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(id)}
      // El reset va explícito: sin preflight un <button> trae borde, fondo, relleno y su
      // propia tipografía, y adentro de un renglón se ve como una caja.
      className="cursor-pointer border-0 bg-transparent p-0 [font-family:inherit] [font-size:inherit] [line-height:inherit] font-medium text-foreground underline decoration-muted-foreground underline-offset-2 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {visible}
    </button>
  )
}

export default function MemoryMarkdown({ text, links, onOpen }: Props) {
  const porNombre = links ? new Map(links.map((l) => [l.name.trim().toLowerCase(), l.syncId])) : null
  const resolver: Resolver = (nombre) => {
    if (!porNombre) return undefined
    const id = porNombre.get(nombre.trim().toLowerCase())
    // Un nombre que main no listó (no debería pasar: los dos usan el mismo parser) se trata
    // como hueco, no como texto: el usuario igual ve que ahí hay un link.
    return id === undefined ? null : id
  }
  const conLinks = (t: string, k: string) => inline(t, resolver, onOpen, k)

  return (
    <div className="flex flex-col gap-2 break-words text-fs-sm leading-relaxed text-foreground">
      {parsearBloques(text).map((b, i) => {
        const k = String(i)
        switch (b.tipo) {
          case 'codigo':
            return (
              <pre key={k} className="overflow-x-auto whitespace-pre-wrap rounded-sm bg-muted px-2 py-1.5 font-mono text-fs-xs">
                {b.texto}
              </pre>
            )
          case 'titulo': {
            const Tag = (`h${Math.min(b.nivel + 2, 6)}`) as 'h3' | 'h4' | 'h5' | 'h6'
            return <Tag key={k} className="mt-1 text-fs font-semibold">{conLinks(b.texto, k)}</Tag>
          }
          case 'lista': {
            const Lista = b.ordenada ? 'ol' : 'ul'
            return (
              <Lista key={k} className={`flex flex-col gap-0.5 pl-4 ${b.ordenada ? 'list-decimal' : 'list-disc'}`}>
                {b.items.map((it, j) => (
                  <li key={j} style={it.nivel ? { marginLeft: `${it.nivel}rem` } : undefined}>
                    {conLinks(it.texto, `${k}.${j}`)}
                  </li>
                ))}
              </Lista>
            )
          }
          case 'cita':
            return (
              <blockquote key={k} className="border-l-2 border-border pl-2 text-muted-foreground">
                {b.lineas.map((l, j) => <p key={j}>{conLinks(l, `${k}.${j}`)}</p>)}
              </blockquote>
            )
          case 'regla':
            return <hr key={k} className="border-border" />
          case 'parrafo':
            // Los saltos simples se respetan: las memorias se escriben línea a línea, y
            // juntarlas en un párrafo corrido (lo que haría Markdown estricto) las aplasta.
            return (
              <p key={k}>
                {b.lineas.map((l, j) => (
                  <span key={j}>{j > 0 && <br />}{conLinks(l, `${k}.${j}`)}</span>
                ))}
              </p>
            )
        }
      })}
    </div>
  )
}
