import { describe, it, expect } from 'vitest'
import { queryThreadIndexBranches } from '../integrations/team-thread-index-query'
import type { MemoryRecord } from '../integrations/memory-port'

function record(over: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    syncId: 'obs-aaaaaaaaaaaaaaaa',
    projectKey: 'proj1111aaaaaaaa',
    scope: 'team',
    topicKey: null,
    type: 'handoff',
    title: 'Un handoff',
    content: 'Cuerpo del handoff.',
    tags: [],
    source: 'hook',
    originAi: 'claude',
    originAccount: 'Gero Personal',
    gitBranch: 'feat/sidebar-tabs',
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

const CONFIG = {
  projectKey: 'proj1111aaaaaaaa',
  includedTypes: ['handoff', 'decision'] as MemoryRecord['type'][],
  branchStates: { 'feat/sidebar-tabs': 'activa' as const },
}

describe('queryThreadIndexBranches', () => {
  it('agrupa por rama y arma una fila por slug', () => {
    const rows = queryThreadIndexBranches(
      [
        record({ syncId: 'obs-1', createdAt: 1000 }),
        record({ syncId: 'obs-2', createdAt: 2000, authorDisplay: 'Bauti' }),
      ],
      CONFIG,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      slug: 'feat-sidebar-tabs',
      branch: 'feat/sidebar-tabs',
      estado: 'activa',
      ultimoAutor: 'Bauti', // la entrada mas nueva gana
      ultimaEntrada: 2000,
      entradas: 2,
    })
  })

  it('EL GUARDIA: mismo filtro que planTeamThread — scope, proyecto y tipo', () => {
    const rows = queryThreadIndexBranches(
      [
        record({ syncId: 'obs-personal', scope: 'personal' }),
        record({ syncId: 'obs-otro-proyecto', projectKey: 'otro' }),
        record({ syncId: 'obs-tipo-fuera', type: 'preference' }),
        record({ syncId: 'obs-borrado', deleted: true }),
        record({ syncId: 'obs-superseded', supersededBy: 'obs-2' }),
      ],
      CONFIG,
    )
    expect(rows).toHaveLength(0)
  })

  it('rama sin estado conocido cae en sin-worktree', () => {
    const rows = queryThreadIndexBranches(
      [record({ gitBranch: 'feat/otra-rama' })],
      { ...CONFIG, branchStates: {} },
    )
    expect(rows[0].estado).toBe('sin-worktree')
  })

  it('filas sin rama van a general', () => {
    const rows = queryThreadIndexBranches([record({ gitBranch: null })], CONFIG)
    expect(rows[0]).toMatchObject({ slug: 'general', branch: 'general', estado: 'sin-worktree' })
  })
})
