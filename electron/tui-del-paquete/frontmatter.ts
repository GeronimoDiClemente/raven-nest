// El archivo temporal que la TUI abre en $EDITOR al crear o editar una memoria:
// frontmatter (title / type / tags) + cuerpo en Markdown. Puro: sin disco ni dependencias.
// Formato en docs/superpowers/specs/2026-11-02-tui-de-memory-design.md §2.
// Sin librería de YAML: son tres claves y la lista de tags va en una línea.

import { TIPOS, type ObservationType } from '../memory-protocol'

export interface MemoriaEscrita {
  title: string
  type: ObservationType
  tags: string[]
  content: string
}

export const AYUDA_DE_NUEVA =
  '<!-- Write the memory here. Markdown and [[wikilinks]] work. This comment is discarded. -->'

const SIN_FRONTMATTER = 'Missing frontmatter (--- … ---) at the top'

function citarTitulo(titulo: string): string {
  const plano = titulo.replace(/\s*[\r\n]+\s*/g, ' ')
  const necesita =
    /[:#[]/.test(plano) || plano.startsWith('"') || plano.startsWith("'") || plano !== plano.trim()
  if (!necesita) return plano
  return '"' + plano.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

function descitarTitulo(valor: string): string {
  const v = valor.trim()
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\(["\\])/g, '$1')
  }
  return v
}

function armar(titulo: string, type: ObservationType, tags: string[], cuerpo: string): string {
  const t = titulo === '' ? 'title:' : `title: ${citarTitulo(titulo)}`
  return `---\n${t}\ntype: ${type}\ntags: [${tags.join(', ')}]\n---\n${cuerpo}\n`
}

export function serializarMemoria(m: MemoriaEscrita): string {
  return armar(m.title, m.type, m.tags, m.content)
}

export function plantillaDeNueva(): string {
  return armar('', 'decision', [], AYUDA_DE_NUEVA)
}

export function parsearMemoria(
  texto: string,
): { ok: true; memoria: MemoriaEscrita } | { ok: false; error: string } {
  const lineas = texto.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
  let i = 0
  while (i < lineas.length && lineas[i].trim() === '') i++
  if (i >= lineas.length || lineas[i].trim() !== '---') return { ok: false, error: SIN_FRONTMATTER }
  const inicio = i + 1
  let fin = -1
  for (let j = inicio; j < lineas.length; j++) {
    if (lineas[j].trim() === '---') {
      fin = j
      break
    }
  }
  if (fin === -1) return { ok: false, error: SIN_FRONTMATTER }

  const claves = new Map<string, string>()
  for (const linea of lineas.slice(inicio, fin)) {
    const m = /^([A-Za-z_][\w-]*)\s*:(.*)$/.exec(linea)
    if (m) claves.set(m[1].toLowerCase(), m[2])
  }

  const title = descitarTitulo(claves.get('title') ?? '')
  if (title === '') return { ok: false, error: "title can't be empty" }

  const tipo = (claves.get('type') ?? '').trim()
  if (!(TIPOS as readonly string[]).includes(tipo)) {
    return { ok: false, error: `Unknown type "${tipo}". Use one of: ${TIPOS.join(', ')}` }
  }

  let tags: string[] = []
  const crudo = claves.get('tags')?.trim()
  if (crudo !== undefined && crudo !== '') {
    const l = /^\[(.*)\]$/.exec(crudo)
    if (!l) return { ok: false, error: 'tags must be a list like [a, b]' }
    tags = l[1]
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t !== '')
  }

  let content = lineas.slice(fin + 1).join('\n').trim()
  if (content === AYUDA_DE_NUEVA) content = ''
  else content = content.split(AYUDA_DE_NUEVA).join('').trim()

  return { ok: true, memoria: { title, type: tipo as ObservationType, tags, content } }
}
