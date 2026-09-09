// Spec §8.2.3: el import de volumen nunca llego al servidor. Esto empuja 900 mutaciones en
// los lotes de 200 que memory-daemon.ts usa de verdad (pendingMutations(limit = 200)) y
// verifica que llegan todas y que el upsert por sync_id no duplica.
//
// ⚠️ ESCRITO EL 2026-09-09 Y TODAVIA NO EJECUTADO: el Postgres local (Docker) no estaba
// levantado en la maquina donde se escribio. El primero que lo corra con Docker arriba, que
// lo mire de verdad antes de darlo por bueno.
import { describe, it, expect, beforeAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'
import { handlePull } from '../src/pull'

const pool = getPool()
const RUN = randomUUID().slice(0, 8)
const BATCH = 200
const TOTAL = 900

let auth: { deviceId: string; userId: string; plan: string }

beforeAll(async () => {
  await migrate(pool)
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query("insert into users (id, plan) values ($1, 'pro')", [userId])
  await pool.query(
    "insert into devices (id, user_id, name, token_hash) values ($1, $2, 'import-volume', $3)",
    [deviceId, userId, 'hash-' + deviceId]
  )
  auth = { deviceId, userId, plan: 'pro' }
})

const mut = (seq: number, syncId: string, p: string) => ({
  seq, sync_id: syncId, op: 'upsert' as const,
  payload: {
    sync_id: syncId, project_key: p, project_display_name: p, scope: 'personal',
    type: 'decision', topic_key: null, title: syncId, content: 'body', tags: ['import'],
    lamport: 1, updated_at: Date.now(), created_at: Date.now(),
  },
})

describe('import de volumen contra el servidor (spec §8.2.3)', () => {
  it('sube 900 observaciones en lotes de 200 y las devuelve todas por pull', async () => {
    const project = 'import-vol-' + RUN

    for (let offset = 0; offset < TOTAL; offset += BATCH) {
      const mutations = []
      for (let i = offset; i < Math.min(offset + BATCH, TOTAL); i++) {
        mutations.push(mut(1000 + i, RUN + '-obs-' + i, project))
      }
      const res = await handlePush(pool, auth, { mutations })
      const applied = res.results.filter((r) => r.outcome === 'applied').length
      expect(applied).toBe(mutations.length)
    }

    // El pull pagina: se acumula hasta que deja de devolver filas.
    let cursors: Record<string, number> = { [project]: 0 }
    const seen = new Set<string>()
    for (let page = 0; page < 20; page++) {
      const res = await handlePull(pool, auth, { cursors, limit: 500 })
      if (res.rows.length === 0) break
      for (const row of res.rows) seen.add(row.sync_id)
      cursors = res.cursors as Record<string, number>
    }

    expect(seen.size).toBe(TOTAL)
  })

  it('reimportar el mismo lote hace upsert por sync_id, no duplica', async () => {
    const project = 'import-dup-' + RUN
    const mutations = Array.from({ length: 50 }, (_, i) => mut(5000 + i, RUN + '-dup-' + i, project))

    await handlePush(pool, auth, { mutations })
    await handlePush(pool, auth, { mutations })

    const { rows } = await pool.query(
      'select count(*)::int as c from observations where project_key = $1',
      [project]
    )
    expect(rows[0].c).toBe(50)
  })
})
