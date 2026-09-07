import { describe, it, expect } from 'vitest'
import { renderNote, parseNote, scrubSourceRef, vaultContentHash, VAULT_VERSION } from '../integrations/vault-note'
import type { MemoryRecord } from '../integrations/memory-port'

function baseRecord(over: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    syncId: 'obs-3f9a12c7d4e5b6a78901234567890abc',
    projectKey: '3f9a12c7d4e5b6a7',
    scope: 'personal',
    topicKey: null,
    type: 'bugfix',
    title: 'Webhook de Stripe rechazado por JWT',
    content: 'El body.',
    tags: ['stripe', 'webhook'],
    source: 'pty',
    originAi: 'claude',
    originAccount: 'Gero Personal',
    gitBranch: 'feat/integrations',
    authorDisplay: 'Gero',
    sourceRef: 'graph:run-8812:rev-security:0',
    contentHash: 'deadbeef',
    revisionCount: 3,
    duplicateCount: 0,
    createdAt: Date.parse('2026-08-24T18:03:11.402Z'),
    updatedAt: Date.parse('2026-08-26T11:22:40.918Z'),
    deleted: false,
    supersededBy: null,
    ...over,
  }
}

const noContext = { projectDisplayName: 'raven-nest', supersededByAlias: null, supersedesAliases: [] }

describe('vaultContentHash', () => {
  it('matches a fixed vector against memory-store.ts\'s contentHash formula (sha256(title.trim().toLowerCase()+"\\n"+content.trim().toLowerCase()))', () => {
    // Vector computed independently against the exact same formula in memory-store.ts:
    // sha256("hello world\nsome body text")
    expect(vaultContentHash('Hello World', '  Some Body Text  ')).toBe(
      'fd8f13b610abed4d8c1a4e38a5c7fe9c561b7c811146336f0681adf6b52acc92'
    )
  })

  it('null content hashes the same as empty content', () => {
    expect(vaultContentHash('Title', null)).toBe(vaultContentHash('Title', ''))
  })
})

describe('scrubSourceRef', () => {
  it('reduces a Windows absolute path to its basename', () => {
    expect(scrubSourceRef('claude-md:C:\\Users\\gerod\\Dev\\clientes\\acme-bank\\CLAUDE.md#imported/x')).toBe(
      'claude-md:CLAUDE.md#imported/x'
    )
  })

  it('reduces a POSIX absolute path to its basename', () => {
    expect(scrubSourceRef('claude-md:/home/gero/dev/clientes/acme-bank/CLAUDE.md#imported/y')).toBe(
      'claude-md:CLAUDE.md#imported/y'
    )
  })

  it('leaves a bridge sourceRef with no path segment byte-identical', () => {
    expect(scrubSourceRef('graph:run-8812:rev-security:0')).toBe('graph:run-8812:rev-security:0')
    expect(scrubSourceRef('ci:org/repo:main:https://ci.example/run/1')).toBe('ci:org/repo:main:https://ci.example/run/1')
  })

  it('is a no-op on a string with no colon at all', () => {
    expect(scrubSourceRef('no-colon-here')).toBe('no-colon-here')
  })
})

describe('renderNote / parseNote round-trip', () => {
  it('round-trips a title with embedded quotes', () => {
    const record = baseRecord({ title: 'She said "hello" to it' })
    const note = renderNote(record, noContext)
    const parsed = parseNote(note)
    expect(parsed?.frontmatter.title).toBe('She said "hello" to it')
  })

  it('round-trips content that itself starts with ---', () => {
    const record = baseRecord({ content: '---\nnot frontmatter, just text' })
    const note = renderNote(record, noContext)
    const parsed = parseNote(note)
    expect(parsed?.body).toContain('---\nnot frontmatter, just text')
  })

  it('round-trips empty tags', () => {
    const record = baseRecord({ tags: [] })
    const parsed = parseNote(renderNote(record, noContext))
    expect(parsed?.frontmatter.tags).toEqual([])
  })

  it('round-trips a null topic_key', () => {
    const record = baseRecord({ topicKey: null })
    const parsed = parseNote(renderNote(record, noContext))
    expect(parsed?.frontmatter.topic_key).toBeNull()
  })

  it('null content never throws — body keeps the h1 heading with nothing under it', () => {
    const record = baseRecord({ content: null })
    expect(() => renderNote(record, noContext)).not.toThrow()
    const note = renderNote(record, noContext)
    const parsed = parseNote(note)
    expect(parsed?.body.trim()).toBe(`# ${record.title}`)
  })

  it('the h1 heading is the title, never a ## (so the note produces zero chunks for the markdown chunker)', () => {
    const note = renderNote(baseRecord(), noContext)
    const bodyStart = note.split('---\n')[2] ?? note
    expect(bodyStart).toMatch(/^\n?# Webhook de Stripe/)
    expect(bodyStart).not.toMatch(/^##/m)
  })

  it('emits supersededBy and supersedes as frontmatter wikilinks', () => {
    const record = baseRecord()
    const ctx = { projectDisplayName: 'raven-nest', supersededByAlias: 'obs-winner', supersedesAliases: ['obs-loser-a', 'obs-loser-b'] }
    const parsed = parseNote(renderNote(record, ctx))
    expect(parsed?.frontmatter.superseded_by).toBe('[[obs-winner]]')
    expect(parsed?.frontmatter.supersedes).toEqual(['[[obs-loser-a]]', '[[obs-loser-b]]'])
  })

  it('null superseded_by and empty supersedes for an active, non-superseding row', () => {
    const parsed = parseNote(renderNote(baseRecord(), noContext))
    expect(parsed?.frontmatter.superseded_by).toBeNull()
    expect(parsed?.frontmatter.supersedes).toEqual([])
  })

  it('stamps nest_generated: true and the current nest_vault_version', () => {
    const parsed = parseNote(renderNote(baseRecord(), noContext))
    expect(parsed?.frontmatter.nest_generated).toBe(true)
    expect(parsed?.frontmatter.nest_vault_version).toBe(VAULT_VERSION)
  })

  it('parseNote returns null for text with no frontmatter block', () => {
    expect(parseNote('just some plain markdown, no frontmatter')).toBeNull()
  })

  it('content is verbatim in the body, never re-redacted or reformatted', () => {
    const record = baseRecord({ content: 'raw content with a fake token=abc123 in it' })
    const parsed = parseNote(renderNote(record, noContext))
    expect(parsed?.body).toContain('raw content with a fake token=abc123 in it')
  })
})
