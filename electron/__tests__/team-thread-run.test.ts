import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { planTeamThread, DEFAULT_THREAD_TYPES } from '../integrations/team-thread-plan'
import { applyVaultPlan, readManifest, computeOnDiskHashes } from '../integrations/vault-apply'
import { TEAM_THREAD_PATHS, teamThreadRootDir } from '../integrations/team-thread-paths'
import type { MemoryRecord } from '../integrations/memory-port'

let wt: string

beforeEach(() => {
  wt = mkdtempSync(join(tmpdir(), 'tt-run-'))
})

function record(over: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    syncId: 'obs-1', projectKey: 'p1', scope: 'team', topicKey: null, type: 'handoff',
    title: 'Un handoff', content: 'Cuerpo.', tags: [], source: 'hook', originAi: 'claude',
    originAccount: 'Gero', gitBranch: 'main', authorDisplay: 'Gero', sourceRef: null,
    contentHash: 'h1', revisionCount: 0, duplicateCount: 0, createdAt: 1000, updatedAt: 1000,
    deleted: false, supersededBy: null, ...over,
  }
}

async function pasada(records: MemoryRecord[]): Promise<void> {
  const rootDir = teamThreadRootDir(wt)
  const manifest = readManifest(rootDir, TEAM_THREAD_PATHS)
  const plan = planTeamThread({
    records,
    manifest,
    config: { projectKey: 'p1', displayName: 'raven-nest', includedTypes: DEFAULT_THREAD_TYPES, branchStates: { main: 'activa' }, ultimaSync: 0 },
    onDiskHashes: computeOnDiskHashes(rootDir, manifest),
  })
  await applyVaultPlan(rootDir, plan, TEAM_THREAD_PATHS)
}

describe('el pase completo contra disco', () => {
  it('escribe el hilo dentro de .nest/team del worktree', async () => {
    await pasada([record()])

    expect(existsSync(join(wt, '.nest', 'team', '_index.md'))).toBe(true)
    expect(existsSync(join(wt, '.nest', 'team', 'ramas', 'main.md'))).toBe(true)
    expect(readFileSync(join(wt, '.nest', 'team', 'ramas', 'main.md'), 'utf8')).toContain('Gero')
  })

  it('la contabilidad NO cae en .nest-vault: esa carpeta es del vault personal', async () => {
    await pasada([record()])

    expect(existsSync(join(wt, '.nest', 'team', '.manifest.json'))).toBe(true)
    expect(existsSync(join(wt, '.nest', 'team', '.nest-vault'))).toBe(false)
  })

  it('una segunda pasada sin cambios no reescribe nada', async () => {
    await pasada([record()])
    const antes = readFileSync(join(wt, '.nest', 'team', '.manifest.json'), 'utf8')
    await pasada([record()])
    expect(readFileSync(join(wt, '.nest', 'team', '.manifest.json'), 'utf8')).toBe(antes)
  })

  it('preserva los bytes del usuario si edito la nota a mano', async () => {
    await pasada([record()])
    writeFileSync(join(wt, '.nest', 'team', 'ramas', 'main.md'), 'ESTO LO ESCRIBI YO\n')
    await pasada([record({ contentHash: 'h2', content: 'Cuerpo nuevo.' })])

    expect(readFileSync(join(wt, '.nest', 'team', 'ramas', '_conflicts', 'main.md'), 'utf8')).toContain('ESTO LO ESCRIBI YO')
    expect(readFileSync(join(wt, '.nest', 'team', 'ramas', 'main.md'), 'utf8')).toContain('Cuerpo nuevo.')
  })
})
