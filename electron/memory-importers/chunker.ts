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
