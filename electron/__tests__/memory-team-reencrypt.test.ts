// electron/__tests__/memory-team-reencrypt.test.ts
import { describe, it, expect, vi } from 'vitest'
import { generateMasterKey, deriveKeys } from '../memory-crypto'
import { runTeamRecrypt } from '../memory-team-reencrypt'

describe('runTeamRecrypt', () => {
  it('cifra cada fila con la clave de equipo y la manda al endpoint en un solo lote', async () => {
    const master = generateMasterKey()
    const llamadas: unknown[] = []
    const fetchImpl = (vi.fn(async (url: string, init: RequestInit) => {
      llamadas.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ ok: true, applied: ['a', 'b'], rejected: [] }), { status: 200 })
    })) as unknown as typeof fetch
    const res = await runTeamRecrypt(
      { baseUrl: 'http://x', token: 't', deviceId: 'd', fetchImpl },
      'team-1',
      master,
      [
        { syncId: 'a', title: 'Uno', content: 'contenido uno', tags: ['x'], contentHash: 'hash-uno', originAccount: 'gero@example.com' },
        { syncId: 'b', title: 'Dos', content: null, tags: [], contentHash: null, originAccount: null },
      ]
    )
    expect(res).toEqual({ total: 2, applied: 2, rejected: 0 })
    const body = llamadas[0] as { team_id: string; items: Array<{ sync_id: string; title: string; content: string | null; content_hash: string | null; origin_account: string | null }> }
    expect(body.team_id).toBe('team-1')
    expect(body.items).toHaveLength(2)
    expect(body.items[0].title).toMatch(/^nmc1:/)
    expect(body.items[0].content_hash).toMatch(/^nmc1:/)
    expect(body.items[0].origin_account).toMatch(/^nmc1:/) // el email no viaja en claro
    expect(body.items[1].content).toBeNull() // un content null (tombstone) no se cifra, viaja tal cual
    expect(body.items[1].content_hash).toBeNull()
    expect(body.items[1].origin_account).toBeNull()
  })

  it('reporta progreso y cuenta los rejected del servidor', async () => {
    const master = generateMasterKey()
    const fetchImpl = (vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, applied: ['a'], rejected: [{ sync_id: 'b', error: 'not_found_in_team' }] }), { status: 200 }))) as unknown as typeof fetch
    const progreso: Array<{ total: number; done: number }> = []
    const res = await runTeamRecrypt(
      { baseUrl: 'http://x', token: 't', deviceId: 'd', fetchImpl },
      'team-1', master,
      [
        { syncId: 'a', title: 'A', content: 'x', tags: [], contentHash: null, originAccount: null },
        { syncId: 'b', title: 'B', content: 'y', tags: [], contentHash: null, originAccount: null },
      ],
      (p) => progreso.push(p)
    )
    expect(res).toEqual({ total: 2, applied: 1, rejected: 1 })
    expect(progreso.at(-1)).toEqual({ total: 2, done: 2 })
  })
})
