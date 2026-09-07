import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'
import { applyVaultPlan, computeOnDiskHashes, readManifest } from '../integrations/vault-apply'
import { planVault, emptyManifest, type VaultManifest } from '../integrations/vault-plan'
import { parseNote } from '../integrations/vault-note'
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
    tags: ['x'],
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

let dirs: string[] = []
function tmp(): string {
  const d = makeTmpDir('vault-apply-')
  dirs.push(d)
  return d
}
afterEach(() => { dirs.forEach(cleanupTmp); dirs = [] })

function findAllFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else out.push(full)
    }
  }
  walk(root)
  return out
}

describe('applyVaultPlan — end to end', () => {
  it('writes a note to disk, and re-reading it with parseNote recovers the same data', async () => {
    const root = tmp()
    const r = record()
    const p = planVault({ records: [r], projects: [PROJECT], manifest: emptyManifest(), config: { includeSuperseded: true, includeTeamScope: true }, onDiskHashes: {} })

    const { manifest } = await applyVaultPlan(root, p)

    const filePath = manifest.entries[r.syncId].filePath
    expect(existsSync(join(root, ...filePath.split('/')))).toBe(true)
    const onDisk = readFileSync(join(root, ...filePath.split('/')), 'utf8')
    const parsed = parseNote(onDisk)
    expect(parsed?.frontmatter.nest_sync_id).toBe(r.syncId)
    expect(parsed?.frontmatter.title).toBe(r.title)
    expect(parsed?.body).toContain(r.content)
  })

  it('README.md and the project _index.md are written alongside the note', async () => {
    const root = tmp()
    const r = record()
    const p = planVault({ records: [r], projects: [PROJECT], manifest: emptyManifest(), config: { includeSuperseded: true, includeTeamScope: true }, onDiskHashes: {} })
    await applyVaultPlan(root, p)
    expect(existsSync(join(root, 'README.md'))).toBe(true)
    expect(existsSync(join(root, 'raven-nest--proj1111', '_index.md'))).toBe(true)
  })

  it('leaves no .tmp files behind after a successful apply', async () => {
    const root = tmp()
    const r = record()
    const p = planVault({ records: [r], projects: [PROJECT], manifest: emptyManifest(), config: { includeSuperseded: true, includeTeamScope: true }, onDiskHashes: {} })
    await applyVaultPlan(root, p)
    expect(findAllFiles(root).some((f) => /\.[0-9a-f]{12}\.tmp$/.test(f))).toBe(false)
  })

  it('a second unchanged pass writes nothing new (readManifest/computeOnDiskHashes round-trip)', async () => {
    const root = tmp()
    const r = record()
    const p1 = planVault({ records: [r], projects: [PROJECT], manifest: emptyManifest(), config: { includeSuperseded: true, includeTeamScope: true }, onDiskHashes: {} })
    const { manifest: m1 } = await applyVaultPlan(root, p1)

    const onDiskHashes = computeOnDiskHashes(root, m1)
    const p2 = planVault({ records: [r], projects: [PROJECT], manifest: readManifest(root), config: { includeSuperseded: true, includeTeamScope: true }, onDiskHashes })
    expect(p2.writes).toHaveLength(0)
    expect(p2.moves).toHaveLength(0)
    expect(p2.conflicts).toHaveLength(0)
  })

  it('detects a hand-edit: the original edited file lands in _conflicts/, and a fresh mirror is written at the row\'s path', async () => {
    const root = tmp()
    const r = record()
    const p1 = planVault({ records: [r], projects: [PROJECT], manifest: emptyManifest(), config: { includeSuperseded: true, includeTeamScope: true }, onDiskHashes: {} })
    const { manifest: m1 } = await applyVaultPlan(root, p1)
    const filePath = m1.entries[r.syncId].filePath
    const fullPath = join(root, ...filePath.split('/'))

    // The user opens Obsidian and edits the note by hand.
    const original = readFileSync(fullPath, 'utf8')
    writeFileSync(fullPath, original.replace('Some body', 'Some body, but I added a sentence'))

    const onDiskHashes = computeOnDiskHashes(root, m1)
    const rowChanged = { ...r, content: 'Some body from the store, unrelated to the hand-edit', contentHash: 'hash-v2', updatedAt: 2000 }
    const p2 = planVault({ records: [rowChanged], projects: [PROJECT], manifest: readManifest(root), config: { includeSuperseded: true, includeTeamScope: true }, onDiskHashes })
    expect(p2.conflicts).toHaveLength(1)

    const { manifest: m2 } = await applyVaultPlan(root, p2)

    const conflictDir = join(root, ...filePath.split('/').slice(0, -1), '_conflicts')
    const conflictFiles = existsSync(conflictDir) ? readdirSync(conflictDir) : []
    expect(conflictFiles.length).toBe(1)
    const preserved = readFileSync(join(conflictDir, conflictFiles[0]), 'utf8')
    expect(preserved).toContain('Some body, but I added a sentence')

    // The fresh mirror reflects the NEW store content, at the row's canonical path.
    const freshPath = m2.entries[r.syncId].filePath
    const fresh = readFileSync(join(root, ...freshPath.split('/')), 'utf8')
    expect(fresh).toContain('Some body from the store, unrelated to the hand-edit')
  })
})
