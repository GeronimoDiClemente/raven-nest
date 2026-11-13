import { describe, it, expect } from 'vitest'
import { sealMutationPayload, openPulledRow } from '../memory-envelope'
import { deriveKeys, generateMasterKey, isCiphertext } from '../memory-crypto'
import type { PulledRow } from '../memory-daemon'

const ctx = { keys: deriveKeys(generateMasterKey()), keyEpoch: 1 }

describe('git_branch viaja sellado', () => {
  it('se sella al subir y se abre al bajar', () => {
    const sellado = sealMutationPayload(ctx, {
      sync_id: 's1', project_key: 'p', scope: 'personal', title: 't', content: 'c', git_branch: 'feat/secreto',
    })
    expect(isCiphertext(String(sellado.git_branch))).toBe(true)

    const fila = {
      syncId: 's1', projectKey: 'p', scope: 'personal', type: 'decision', title: sellado.title as string,
      content: sellado.content as string, gitBranch: sellado.git_branch as string, tags: [],
    } as unknown as PulledRow
    const { row, undecryptable } = openPulledRow(ctx, fila)
    expect(undecryptable).toBe(false)
    expect(row.gitBranch).toBe('feat/secreto')
  })

  it('una rama ausente o null se respeta', () => {
    const sellado = sealMutationPayload(ctx, { sync_id: 's2', project_key: 'p', scope: 'personal', title: 't', git_branch: null })
    expect(sellado.git_branch).toBeNull()
  })
})
