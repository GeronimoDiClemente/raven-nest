// Follow-up del handoff 2026-10-15: "no hay contador en la UI de memorias de equipo retenidas
// esperando autorización". El gate de `doPush` las marca `team_key_missing` y quedaban
// invisibles: la máquina sin autorizar no tenía forma de saber que tenía algo sin subir.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MemoryStore } from '../memory-store'
import { TEAM_KEY_HOLD_REASONS } from '../memory-daemon'

let dir: string
let store: MemoryStore
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nest-store-retenidas-'))
  store = new MemoryStore(join(dir, 'memory.db'))
  store.ensureProject({ projectKey: 'proj-a', displayName: 'a' })
  store.ensureProject({ projectKey: 'proj-b', displayName: 'b' })
  store.setLocalTeamId('proj-a', 'team-1')
  store.setLocalTeamId('proj-b', 'team-2')
})
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

const guardar = (projectKey: string, scope: 'team' | 'personal', title: string) => store.save({
  projectKey, scope, type: 'decision', title, content: `cuerpo de ${title}`, source: 'mcp',
})

const retener = (reason: string) => {
  store.blockMutations(store.pendingMutations().map((m) => ({ seq: m.seq, reason })))
}

describe('heldTeamMutationCount', () => {
  it('cuenta sólo las retenidas por clave de equipo, y sólo las de ESE equipo', () => {
    guardar('proj-a', 'team', 'uno')
    guardar('proj-a', 'team', 'dos')
    guardar('proj-b', 'team', 'de otro equipo')
    retener('team_key_missing')
    guardar('proj-a', 'team', 'retenida por cuota')
    retener('quota_exceeded')
    guardar('proj-a', 'team', 'todavía pendiente, no retenida')

    expect(store.heldTeamMutationCount('team-1', TEAM_KEY_HOLD_REASONS)).toBe(2)
    expect(store.heldTeamMutationCount('team-2', TEAM_KEY_HOLD_REASONS)).toBe(1)
  })

  it('también cuenta las que rechazó el servidor con team_encryption_required', () => {
    guardar('proj-a', 'team', 'rechazada')
    retener('team_encryption_required')
    expect(store.heldTeamMutationCount('team-1', TEAM_KEY_HOLD_REASONS)).toBe(1)
  })

  it('al liberarlas el contador vuelve a 0', () => {
    guardar('proj-a', 'team', 'uno')
    retener('team_key_missing')
    store.unblockMutations([...TEAM_KEY_HOLD_REASONS])
    expect(store.heldTeamMutationCount('team-1', TEAM_KEY_HOLD_REASONS)).toBe(0)
  })
})
