import { describe, it, expect } from 'vitest'
import { chunkMarkdown, chunkMemoryNote, slugify } from '../memory-importers/chunker'

describe('slugify', () => {
  it('lowercases, trims, and dashes spaces', () => {
    expect(slugify('Git & worktrees')).toBe('git-worktrees')
  })

  it('collapses repeated separators and strips leading/trailing dashes', () => {
    expect(slugify('  Foo   Bar  ')).toBe('foo-bar')
  })

  it('preserves the ">" path separator as text but strips other punctuation', () => {
    const slug = slugify('Git & worktrees > Worktree commits')
    expect(slug).not.toContain('&')
    expect(slug).toContain('worktree-commits')
  })
})

describe('chunkMarkdown', () => {
  it('splits on ## and ### headings into separate chunks', () => {
    const md = `# Title\n\nIntro text (dropped).\n\n## Section A\nContent for section A that is long enough to pass the minimum length threshold.\n\n## Section B\nContent for section B that is also long enough to pass the minimum length threshold.\n`
    const chunks = chunkMarkdown(md, 'claude-md')
    expect(chunks).toHaveLength(2)
    expect(chunks[0].title).toBe('Section A')
    expect(chunks[1].title).toBe('Section B')
  })

  it('drops content before the first ## / ### heading', () => {
    const md = `# Title\n\nSome long enough intro paragraph that should not become a chunk at all here.\n\n## Real section\nThis is real content that is long enough to be kept as a chunk in the output.\n`
    const chunks = chunkMarkdown(md, 'claude-md')
    expect(chunks).toHaveLength(1)
    expect(chunks[0].title).toBe('Real section')
  })

  it('skips chunks shorter than 40 chars', () => {
    const md = `## Tiny\nToo short.\n\n## Big enough\nThis chunk has plenty of content to clear the forty character minimum easily.\n`
    const chunks = chunkMarkdown(md, 'claude-md')
    expect(chunks).toHaveLength(1)
    expect(chunks[0].title).toBe('Big enough')
  })

  it('nests level-3 headings under their most recent level-2 ancestor in the heading path', () => {
    const md = `## Parent Section\nParent content that is long enough to pass the forty character minimum here.\n\n### Child Section\nChild content that is also long enough to pass the forty character minimum here.\n`
    const chunks = chunkMarkdown(md, 'claude-md')
    expect(chunks[1].headingPath).toBe('Parent Section > Child Section')
  })

  it('generates topic_key as imported/{source}/{slug(heading path)}', () => {
    const md = `## Release process\nThis section explains the full release process in enough detail to pass length.\n`
    const chunks = chunkMarkdown(md, 'claude-md')
    expect(chunks[0].topicKey).toBe('imported/claude-md/release-process')
  })

  it('a new level-2 heading resets the nesting stack (siblings do not inherit a stale child)', () => {
    const md = `## A\nContent A is long enough to pass the forty character minimum threshold here.\n\n### A-child\nContent A child is long enough to pass the forty character minimum threshold.\n\n## B\nContent B is long enough to pass the forty character minimum threshold here too.\n`
    const chunks = chunkMarkdown(md, 'claude-md')
    const bChunk = chunks.find((c) => c.title === 'B')
    expect(bChunk?.headingPath).toBe('B')
  })

  it('returns an empty array for markdown with no ##/### headings', () => {
    expect(chunkMarkdown('# Just a title\n\nAnd a paragraph.', 'claude-md')).toEqual([])
  })
})

// Una memoria de Claude Code NO es un documento largo que haya que cortar: es UN hecho por
// archivo, con frontmatter YAML. Medido en la Mac del 2026-09-03: de los 63 archivos reales
// bajo `.claude/projects/<slug>/memory/`, **60 no tienen un solo `##`**, así que
// `chunkMarkdown` devolvía cero para casi todos. Arreglar la carpeta que se escanea era la
// mitad del bug; esta es la otra.
describe('chunkMemoryNote — una memoria por archivo', () => {
  const NOTA = `---
name: asignaciones-e2e-estado
description: Dónde quedó el testing E2E de asignaciones especiales
metadata:
  type: project
---

Testing del form de asignaciones especiales en el sandbox. Pausado, retomar el lunes.

**Hecho:**
- Redirect de mails de reserva.
- Fase 3: aprobar dispara la reserva por API.
`

  it('toma el archivo entero como una sola memoria', () => {
    const chunks = chunkMemoryNote(NOTA, 'claude-memory', 'asignaciones-e2e-estado.md')
    expect(chunks.length).toBe(1)
  })

  it('usa la description como titulo, que es para lo que esta', () => {
    const [c] = chunkMemoryNote(NOTA, 'claude-memory', 'asignaciones-e2e-estado.md')
    expect(c.title).toBe('Dónde quedó el testing E2E de asignaciones especiales')
  })

  it('el topicKey sale del name, que es estable aunque se renombre el archivo', () => {
    const [c] = chunkMemoryNote(NOTA, 'claude-memory', 'otro-nombre.md')
    expect(c.topicKey).toContain('asignaciones-e2e-estado')
  })

  it('el frontmatter no viaja en el contenido: es metadata, no memoria', () => {
    const [c] = chunkMemoryNote(NOTA, 'claude-memory', 'x.md')
    expect(c.content).not.toContain('metadata:')
    expect(c.content).not.toContain('---')
    expect(c.content).toContain('Testing del form')
  })

  it('sin description cae al name como titulo', () => {
    const sinDesc = '---\nname: solo-nombre\n---\n\nUn cuerpo lo bastante largo como para no ser descartado por corto.\n'
    const [c] = chunkMemoryNote(sinDesc, 'claude-memory', 'x.md')
    expect(c.title).toBe('solo-nombre')
  })

  it('sin frontmatter usa el nombre del archivo, en vez de tirar el contenido', () => {
    const plano = 'Una nota sin frontmatter, con cuerpo suficiente para pasar el minimo de longitud.\n'
    const [c] = chunkMemoryNote(plano, 'claude-memory', 'nota-suelta.md')
    expect(c.title).toBe('nota-suelta')
    expect(c.content).toContain('sin frontmatter')
  })

  it('un archivo vacio o casi vacio no genera memoria', () => {
    expect(chunkMemoryNote('', 'claude-memory', 'x.md')).toEqual([])
    expect(chunkMemoryNote('---\nname: n\n---\n\ncorto\n', 'claude-memory', 'x.md')).toEqual([])
  })
})
