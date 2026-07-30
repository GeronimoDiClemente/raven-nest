import { describe, it, expect } from 'vitest'
import { chunkMarkdown, slugify } from '../memory-importers/chunker'

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
