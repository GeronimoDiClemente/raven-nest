// Task 14 (spec §9.4), defensa en profundidad: aunque un cliente se equivoque (viejo, o con
// `projects.team_id` local desactualizado), el servicio NO guarda texto en claro para un
// equipo con `team_keys`. Reversible: el cliente la retiene hasta tener la clave.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'

const pool = getPool()
const RUN = randomUUID().slice(0, 8)
const SYNC = (id: string) => `${RUN}-${id}`
let auth: { deviceId: string; userId: string; plan: string }
const equipoCifrado = randomUUID()
const equipoEnClaro = randomUUID()
const projCifrado = `pte-${RUN}-cifrado`
const projEnClaro = `pte-${RUN}-claro`

function mutation(seq: number, syncId: string, projectKey: string, scope: string, extra: Record<string, unknown> = {}) {
  return {
    seq, sync_id: syncId, op: 'upsert' as const,
    payload: {
      sync_id: syncId, project_key: projectKey, project_display_name: projectKey, scope,
      type: 'decision', topic_key: null, title: 'titulo en claro', content: 'cuerpo en claro',
      tags: [], lamport: 1, updated_at: Date.now(), created_at: Date.now(), ...extra,
    },
  }
}

beforeAll(async () => {
  await migrate(pool)
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'team')`, [userId])
  await pool.query(`insert into devices (id, user_id, name, token_hash) values ($1, $2, 'd', $3)`, [deviceId, userId, `hash-${deviceId}`])
  auth = { deviceId, userId, plan: 'team' }
  for (const t of [equipoCifrado, equipoEnClaro]) {
    await pool.query(
      `insert into team_memberships (user_id, team_id, team_name, role, status) values ($1, $2, 'e', 'leader', 'active')`,
      [userId, t]
    )
  }
  await pool.query('insert into team_keys (team_id, activated_by) values ($1, $2)', [equipoCifrado, userId])
  await pool.query(
    `insert into projects (user_id, project_key, display_name, team_id) values ($1, $2, $2, $3), ($1, $4, $4, $5)`,
    [userId, projCifrado, equipoCifrado, projEnClaro, equipoEnClaro]
  )
})

afterAll(async () => { await pool.end() })

describe('push — team_encryption_required (Task 14)', () => {
  it('una fila team EN CLARO a un equipo que cifra se rechaza y no se guarda', async () => {
    const res = await handlePush(pool, auth, { mutations: [mutation(1, SYNC('claro'), projCifrado, 'team')] })
    expect(res.results[0]).toMatchObject({ outcome: 'rejected', error: 'team_encryption_required' })
    const { rows } = await pool.query('select 1 from observations where sync_id = $1', [SYNC('claro')])
    expect(rows).toHaveLength(0)
  })

  it('tags en claro también cuentan como texto en claro', async () => {
    const res = await handlePush(pool, auth, { mutations: [mutation(2, SYNC('tags'), projCifrado, 'team', {
      title: 'nmc1:AAAA', content: 'nmc1:BBBB', tags: ['secreto'],
    })] })
    expect(res.results[0]).toMatchObject({ outcome: 'rejected', error: 'team_encryption_required' })
  })

  it('la misma fila sellada (nmc1:) se aplica', async () => {
    const res = await handlePush(pool, auth, { mutations: [mutation(3, SYNC('sellada'), projCifrado, 'team', {
      title: 'nmc1:AAAA', content: 'nmc1:BBBB', tags: ['nmc1:CCCC'],
    })] })
    expect(res.results[0]).toMatchObject({ outcome: 'applied' })
  })

  it('una fila PERSONAL en el mismo proyecto no se mira (la cubre el gate personal del cliente)', async () => {
    const res = await handlePush(pool, auth, { mutations: [mutation(4, SYNC('personal'), projCifrado, 'personal')] })
    expect(res.results[0]).toMatchObject({ outcome: 'applied' })
  })

  it('un equipo SIN cifrado sigue aceptando team en claro, como hoy', async () => {
    const res = await handlePush(pool, auth, { mutations: [mutation(5, SYNC('equipo-claro'), projEnClaro, 'team')] })
    expect(res.results[0]).toMatchObject({ outcome: 'applied' })
  })
})
