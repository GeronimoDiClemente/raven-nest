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

/**
 * La carpeta que queda cuando un proyecto cambia de nombre.
 *
 * La carpeta sale de `remoteSlug || displayName || projectKey`, así que renombrar el proyecto
 * es renombrar la carpeta: las notas se mudan y la vieja queda con un `_index.md` que lista
 * archivos que ya no están.
 *
 * Antes esto no pasaba nunca porque `ensureProject()` era insert-only y un nombre congelado
 * en el hash se quedaba congelado. Al arreglar eso (2026-09-13) el renombre se volvió posible
 * y con él la carpeta fantasma — en la carpeta que el usuario abre con Obsidian, que es
 * justo donde la basura se ve.
 */
describe('carpetas que quedan de un nombre anterior', () => {
  const memoria = (syncId: string, projectKey: string) => ({
    syncId, projectKey, title: 'Una decisión', content: 'cuerpo', type: 'decision' as const,
    scope: 'personal' as const, tags: [], topicKey: null, supersededBy: null, deleted: false,
    contentHash: 'h-' + syncId, createdAt: 1, updatedAt: 1, revisionCount: 1, duplicateCount: 0,
    source: 'mcp' as const, sourceRef: null, originAi: null, originAccount: null, gitBranch: null,
    authorDisplay: null,
  })

  it('el índice de la carpeta vieja se marca para borrar', () => {
    const plan = planVault({
      records: [memoria('obs-1', 'proj1')],
      projects: [{ projectKey: 'proj1', displayName: 'raven-nest', enrolled: true, remoteSlug: null }],
      // El manifiesto dice que la vez pasada esto vivía en la carpeta del hash.
      manifest: { entries: { 'obs-1': { filePath: 'proj1--proj1/una-decision--obs-1.md', sourceHash: 'viejo', fileHash: 'x' } } },
      config: { includeSuperseded: true, includeTeamScope: true },
      onDiskHashes: {},
    })

    const carpetaNueva = plan.indexWrites[0].filePath.split('/')[0]
    expect(carpetaNueva).toContain('raven-nest')
    expect(plan.indexDeletes).toHaveLength(1)
    expect(plan.indexDeletes[0].filePath).toBe('proj1--proj1/_index.md')
    expect(plan.indexDeletes[0].folder).toBe('proj1--proj1')
  })

  it('sin renombre no borra nada', () => {
    const plan = planVault({
      records: [memoria('obs-1', 'proj1')],
      projects: [{ projectKey: 'proj1', displayName: 'raven-nest', enrolled: true, remoteSlug: null }],
      manifest: { entries: { 'obs-1': { filePath: 'raven-nest--proj1/una-decision--obs-1.md', sourceHash: 'h-obs-1', fileHash: 'x' } } },
      config: { includeSuperseded: true, includeTeamScope: true },
      onDiskHashes: {},
    })
    expect(plan.indexDeletes).toEqual([])
  })

  it('un manifiesto vacío no inventa borrados', () => {
    const plan = planVault({
      records: [memoria('obs-1', 'proj1')],
      projects: [{ projectKey: 'proj1', displayName: 'raven-nest', enrolled: true, remoteSlug: null }],
      manifest: { entries: {} },
      config: { includeSuperseded: true, includeTeamScope: true },
      onDiskHashes: {},
    })
    expect(plan.indexDeletes).toEqual([])
  })
})

/**
 * Las memorias de equipo van a `_team/` (decisión V-1 de la spec).
 *
 * Espejarlas es lo correcto —si no, el vault deja de ser "toda mi memoria" justo para el tier
 * que paga— pero mezclarlas con las tuyas sería peor que no espejarlas: el zip de "mi
 * memoria" pasaría a tener texto de tus compañeros, con su nombre adentro, sin que se note al
 * mirar la carpeta.
 */
describe('las memorias de equipo viven aparte', () => {
  const deEquipo = {
    syncId: 'obs-team', projectKey: 'proj1', title: 'Lo que decidió el equipo',
    content: 'cuerpo', type: 'decision' as const, scope: 'team' as const, tags: [],
    topicKey: null, supersededBy: null, deleted: false, contentHash: 'h', createdAt: 1,
    updatedAt: 1, revisionCount: 1, duplicateCount: 0, source: 'mcp' as const, sourceRef: null,
    originAi: null, originAccount: null, gitBranch: null, authorDisplay: 'Bauti',
  }
  const base = {
    projects: [{ projectKey: 'proj1', displayName: 'nest', enrolled: true, remoteSlug: null }],
    manifest: { entries: {} },
    onDiskHashes: {},
  }

  it('van a _team/, no mezcladas con las tuyas', () => {
    const plan = planVault({
      ...base, records: [deEquipo],
      config: { includeSuperseded: true, includeTeamScope: true },
    })
    expect(plan.writes).toHaveLength(1)
    expect(plan.writes[0].filePath).toContain('/_team/')
  })

  it('con el espejo de equipo apagado, no se escriben', () => {
    const plan = planVault({
      ...base, records: [deEquipo],
      config: { includeSuperseded: true, includeTeamScope: false },
    })
    expect(plan.writes).toEqual([])
  })

  // `_superseded/` gana: una memoria reemplazada es historia, y la del equipo también.
  it('una de equipo ya reemplazada va a _superseded/, no a _team/', () => {
    const plan = planVault({
      ...base, records: [{ ...deEquipo, supersededBy: 'obs-nueva' }],
      config: { includeSuperseded: true, includeTeamScope: true },
    })
    expect(plan.writes[0].filePath).toContain('/_superseded/')
    expect(plan.writes[0].filePath).not.toContain('/_team/')
  })
})
