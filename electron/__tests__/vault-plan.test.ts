import { describe, it, expect } from 'vitest'
import { planVault, emptyManifest, type VaultManifest, type VaultConfig } from '../integrations/vault-plan'
import type { MemoryProject, MemoryRecord } from '../integrations/memory-port'

function record(over: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    syncId: 'obs-aaaaaaaaaaaaaaaa',
    projectKey: 'proj1111aaaaaaaa',
    scope: 'personal',
    topicKey: null,
    type: 'bugfix',
    title: 'Some fact',
    content: 'Some body',
    tags: [],
    source: 'pty',
    originAi: 'claude',
    originAccount: 'Gero Personal',
    gitBranch: 'main',
    authorDisplay: 'Gero',
    sourceRef: null,
    contentHash: 'hash-v1',
    revisionCount: 0,
    duplicateCount: 0,
    createdAt: 1000,
    updatedAt: 1000,
    deleted: false,
    supersededBy: null,
    ...over,
  }
}

const PROJECT: MemoryProject = {
  projectKey: 'proj1111aaaaaaaa',
  displayName: 'raven-nest',
  remoteSlug: 'github.com/org/raven-nest',
  enrolled: true,
}

const CONFIG: VaultConfig = { includeSuperseded: true, includeTeamScope: true }

function plan(records: MemoryRecord[], opts: { manifest?: VaultManifest; projects?: MemoryProject[]; config?: VaultConfig; onDiskHashes?: Record<string, string> } = {}) {
  return planVault({
    records,
    projects: opts.projects ?? [PROJECT],
    manifest: opts.manifest ?? emptyManifest(),
    config: opts.config ?? CONFIG,
    onDiskHashes: opts.onDiskHashes ?? {},
  })
}

describe('planVault', () => {
  it('a new active row produces exactly one write', () => {
    const p = plan([record()])
    expect(p.writes).toHaveLength(1)
    expect(p.moves).toHaveLength(0)
    expect(p.deletes).toHaveLength(0)
    expect(p.conflicts).toHaveLength(0)
    expect(p.writes[0].filePath).toBe('raven-nest--proj1111/some-fact--aaaaaaaa.md')
  })

  it('the same row unchanged in the manifest produces zero writes', () => {
    const r = record()
    const first = plan([r])
    const manifest: VaultManifest = {
      entries: { [r.syncId]: { filePath: first.writes[0].filePath, sourceHash: first.writes[0].sourceHash, fileHash: first.writes[0].fileHash } },
    }
    const second = plan([r], { manifest, onDiskHashes: { [first.writes[0].filePath]: first.writes[0].fileHash } })
    expect(second.writes).toHaveLength(0)
    expect(second.moves).toHaveLength(0)
    expect(second.deletes).toHaveLength(0)
    expect(second.conflicts).toHaveLength(0)
  })

  it('a row that becomes superseded moves to _superseded/, and the winner is written with supersedes', () => {
    const loser = record({ syncId: 'obs-loser000000a', title: 'Old fact' })
    const first = plan([loser])
    const manifest: VaultManifest = {
      entries: { [loser.syncId]: { filePath: first.writes[0].filePath, sourceHash: first.writes[0].sourceHash, fileHash: first.writes[0].fileHash } },
    }
    const winner = record({ syncId: 'obs-winner00000a', title: 'New fact' })
    const supersededLoser = { ...loser, supersededBy: winner.syncId }

    const second = plan([winner, supersededLoser], { manifest, onDiskHashes: { [first.writes[0].filePath]: first.writes[0].fileHash } })
    expect(second.moves).toHaveLength(1)
    expect(second.moves[0].toPath).toContain('_superseded/')
    const winnerWrite = second.writes.find((w) => w.syncId === winner.syncId)
    expect(winnerWrite).toBeDefined()
    const parsedContent = winnerWrite!.content
    expect(parsedContent).toContain(`supersedes: ["[[${loser.syncId}]]"]`)
  })

  it('a tombstone (deleted=true) with a manifest entry produces one delete with reason "tombstone", never a write', () => {
    const r = record()
    const first = plan([r])
    const manifest: VaultManifest = {
      entries: { [r.syncId]: { filePath: first.writes[0].filePath, sourceHash: first.writes[0].sourceHash, fileHash: first.writes[0].fileHash } },
    }
    const tombstoned = { ...r, deleted: true, content: null }
    const second = plan([tombstoned], { manifest, onDiskHashes: { [first.writes[0].filePath]: first.writes[0].fileHash } })
    expect(second.deletes).toHaveLength(1)
    expect(second.deletes[0].reason).toBe('tombstone')
    expect(second.writes).toHaveLength(0)
  })

  it('a tombstone never seen before (no manifest entry) is a silent no-op', () => {
    const r = record({ deleted: true, content: null })
    const p = plan([r])
    expect(p.deletes).toHaveLength(0)
    expect(p.writes).toHaveLength(0)
  })

  it('a file whose on-disk hash differs from the manifest is a conflict, never a write or a delete on it', () => {
    const r = record()
    const first = plan([r])
    const manifest: VaultManifest = {
      entries: { [r.syncId]: { filePath: first.writes[0].filePath, sourceHash: first.writes[0].sourceHash, fileHash: first.writes[0].fileHash } },
    }
    const edited = { ...r, contentHash: 'hash-v2', updatedAt: 2000 }
    const second = plan([edited], { manifest, onDiskHashes: { [first.writes[0].filePath]: 'a-user-edited-this-hash' } })
    expect(second.conflicts).toHaveLength(1)
    expect(second.conflicts[0].filePath).toBe(first.writes[0].filePath)
    expect(second.writes.find((w) => w.syncId === r.syncId)).toBeUndefined()
    expect(second.deletes.find((d) => d.syncId === r.syncId)).toBeUndefined()
  })

  it('a project that goes from enrolled to disabled moves its existing files to _disabled/', () => {
    const r = record()
    const first = plan([r])
    const manifest: VaultManifest = {
      entries: { [r.syncId]: { filePath: first.writes[0].filePath, sourceHash: first.writes[0].sourceHash, fileHash: first.writes[0].fileHash } },
    }
    const disabledProject = { ...PROJECT, enrolled: false }
    const second = plan([r], { manifest, projects: [disabledProject], onDiskHashes: { [first.writes[0].filePath]: first.writes[0].fileHash } })
    expect(second.moves).toHaveLength(1)
    expect(second.moves[0].toPath.startsWith('_disabled/')).toBe(true)
    expect(second.writes).toHaveLength(0)
  })

  it('a row whose title/content still matches a secret pattern gets a warning AND is still written', () => {
    const r = record({ content: 'AWS_SECRET_ACCESS_KEY=AKIAABCDEFGHIJKLMNOP' })
    const p = plan([r])
    expect(p.writes).toHaveLength(1)
    expect(p.warnings.some((w) => w.kind === 'possible-secret' && w.syncId === r.syncId)).toBe(true)
  })

  it('content: null with deleted: false does not throw, writes an empty-body note, and warns', () => {
    const r = record({ content: null })
    expect(() => plan([r])).not.toThrow()
    const p = plan([r])
    expect(p.writes).toHaveLength(1)
    expect(p.warnings.some((w) => w.kind === 'null-content-active-row')).toBe(true)
  })

  it('a chain of three supersedes produces three files and two supersede edges, no cycles', () => {
    const v1 = record({ syncId: 'obs-v1000000000a', title: 'Fact', supersededBy: 'obs-v2000000000a' })
    const v2 = record({ syncId: 'obs-v2000000000a', title: 'Fact', supersededBy: 'obs-v3000000000a' })
    const v3 = record({ syncId: 'obs-v3000000000a', title: 'Fact', supersededBy: null })
    const p = plan([v1, v2, v3])
    expect(p.writes).toHaveLength(3)
    const w3 = p.writes.find((w) => w.syncId === v3.syncId)!
    expect(w3.content).toContain('[[obs-v2000000000a]]')
    const w2 = p.writes.find((w) => w.syncId === v2.syncId)!
    expect(w2.content).toContain('[[obs-v1000000000a]]')
    expect(w2.content).toContain('superseded_by: "[[obs-v3000000000a]]"')
    const w1 = p.writes.find((w) => w.syncId === v1.syncId)!
    expect(w1.content).toContain('superseded_by: "[[obs-v2000000000a]]"')
    expect(w1.content).not.toContain('supersedes: ["[[obs-v1000000000a]]"]') // v1 never appears as someone's supersedes target of itself
  })

  it('excluding team scope (includeTeamScope=false) deletes a previously-written team row and writes nothing new for it', () => {
    const r = record({ scope: 'team' })
    const first = plan([r])
    const manifest: VaultManifest = {
      entries: { [r.syncId]: { filePath: first.writes[0].filePath, sourceHash: first.writes[0].sourceHash, fileHash: first.writes[0].fileHash } },
    }
    const second = plan([r], { manifest, config: { includeSuperseded: true, includeTeamScope: false }, onDiskHashes: { [first.writes[0].filePath]: first.writes[0].fileHash } })
    expect(second.deletes).toHaveLength(1)
    expect(second.deletes[0].reason).toBe('excluded')
    expect(second.writes).toHaveLength(0)
  })

  it('a project with no `projects` row (only __global__ realistically) still plans using the raw key as folder', () => {
    const r = record({ projectKey: '__global__' })
    const p = plan([r], { projects: [] })
    expect(p.writes[0].filePath.startsWith('_global/')).toBe(true)
  })
})
