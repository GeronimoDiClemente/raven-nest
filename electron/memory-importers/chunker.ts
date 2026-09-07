// Markdown chunker shared by the CLAUDE.md/AGENTS.md/GEMINI.md importer(s) — pure,
// dependency-free, so it is directly unit-testable per
// docs/nest-memory-architecture.md §5.2/§9 ("Vitest unit tests on ... the markdown
// chunker — no DB needed; these are the highest-risk-per-line code in the system").
//
// Splits on `##` / `###` headings. Each chunk becomes one observation candidate.
// A whole-file import is deliberately avoided — a 3000-line CLAUDE.md as one memory is
// useless for retrieval (§5.2).

const MIN_CHUNK_LENGTH = 40

export interface MarkdownChunk {
  headingPath: string // e.g. "Git & worktrees > Worktree commits"
  title: string // the heading text itself
  content: string
  topicKey: string
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s/-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

interface RawSection {
  level: number
  heading: string
  lines: string[]
}

/**
 * Splits markdown on `##`/`###` headings (level 2 and 3 — `#` h1 is treated as a
 * document title, not a section boundary, and `####`+ stays inside its parent chunk to
 * avoid over-fragmenting nested detail).
 */
function splitSections(markdown: string): RawSection[] {
  const lines = markdown.split(/\r?\n/)
  const sections: RawSection[] = []
  let current: RawSection | null = null

  for (const line of lines) {
    const match = line.match(/^(##|###)\s+(.+?)\s*$/)
    if (match) {
      if (current) sections.push(current)
      current = { level: match[1].length, heading: match[2].trim(), lines: [] }
    } else if (current) {
      current.lines.push(line)
    }
    // Content before the first ##/### heading (e.g. under a lone `#` title) is
    // intentionally dropped — it's front matter, not a retrievable chunk.
  }
  if (current) sections.push(current)
  return sections
}

export function chunkMarkdown(markdown: string, sourceLabel: string): MarkdownChunk[] {
  const sections = splitSections(markdown)
  const chunks: MarkdownChunk[] = []
  const headingStack: string[] = []

  for (const section of sections) {
    // Maintain a heading path stack so a level-3 heading nests under its most recent
    // level-2 ancestor (e.g. "Git & worktrees > Worktree commits").
    while (headingStack.length >= section.level - 1) headingStack.pop()
    headingStack.push(section.heading)
    const headingPath = headingStack.join(' > ')

    const content = section.lines.join('\n').trim()
    if (content.length < MIN_CHUNK_LENGTH) continue

    chunks.push({
      headingPath,
      title: section.heading,
      content,
      topicKey: `imported/${sourceLabel}/${slugify(headingPath)}`,
    })
  }

  return chunks
}

/**
 * Una nota de memoria de Claude Code — `{accountDir}/.claude/projects/<slug>/memory/*.md` —
 * es **un hecho por archivo**, con frontmatter YAML, no un documento largo para cortar.
 * `chunkMarkdown` está pensado para lo otro (un CLAUDE.md de 3000 líneas) y corta en `##`:
 * medido en la Mac del 2026-09-03, **60 de los 63 archivos reales no tienen un solo `##`**,
 * así que devolvía cero para casi todos y el import traía nada.
 *
 * Acá el archivo entero es una memoria. `description` es el título (es literalmente para lo
 * que está en ese formato), `name` el topic key — estable aunque se renombre el archivo — y
 * el frontmatter no viaja en el contenido, que es metadata y no memoria.
 */
export function chunkMemoryNote(raw: string, sourceLabel: string, fileName: string): MarkdownChunk[] {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  const cuerpo = (frontmatter ? raw.slice(frontmatter[0].length) : raw).trim()
  if (cuerpo.length < MIN_CHUNK_LENGTH) return []

  // Sólo las dos claves de primer nivel que nos importan. Nada de un parser de YAML: el
  // formato lo escribe la misma herramienta siempre, y un valor multilínea acá sería un
  // título de varias líneas, que no queremos igual.
  const leer = (clave: string): string | null => {
    if (!frontmatter) return null
    const m = new RegExp(`^${clave}:[ \\t]*(.+)$`, 'm').exec(frontmatter[1])
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : null
  }

  const name = leer('name')
  const description = leer('description')
  // Sin frontmatter, el nombre del archivo es lo único que describe la nota — mejor eso que
  // tirar el contenido.
  const base = fileName.replace(/\.md$/i, '')
  const title = description || name || base
  const topicSeed = name || base

  return [{
    headingPath: title,
    title,
    content: cuerpo,
    topicKey: `${sourceLabel}/${slugify(topicSeed)}`,
  }]
}
