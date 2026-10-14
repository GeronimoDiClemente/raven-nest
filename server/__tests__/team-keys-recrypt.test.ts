import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { recryptTeamObservations } from '../src/team-keys-recrypt'

const pool = getPool()
let teamId: string, otroTeamId: string
let leaderId: string, memberId: string
let leaderDevice: string, memberDevice: string
let projectLeader: number, projectMember: number, projectOtroEquipo: number

beforeAll(async () => { await migrate(pool) })

beforeEach(async () => {
  teamId = randomUUID()
  otroTeamId = randomUUID()
  leaderId = randomUUID()
  memberId = randomUUID()
  leaderDevice = randomUUID()
  memberDevice = randomUUID()
  for (const id of [leaderId, memberId]) await pool.query('insert into users (id) values ($1)', [id])
  await pool.query(
    `insert into team_memberships (user_id, team_id, team_name, role, status)
     values ($1, $2, 'Equipo', 'leader', 'active'), ($3, $2, 'Equipo', 'member', 'active')`,
    [leaderId, teamId, memberId]
  )
  for (const [devId, userId] of [[leaderDevice, leaderId], [memberDevice, memberId]] as const) {
    await pool.query('insert into devices (id, user_id, name, token_hash) values ($1, $2, $3, $4)',
      [devId, userId, 'pc', 'hash-' + devId])
  }

  const proj = async (userId: string, key: string, teamFila: string | null) => {
    const { rows } = await pool.query(
      `insert into projects (user_id, project_key, display_name, team_id)
       values ($1, $2, 'p', $3) returning id`,
      [userId, key, teamFila]
    )
    return Number(rows[0].id)
  }
  projectLeader = await proj(leaderId, 'repo-x', teamId)
  projectMember = await proj(memberId, 'repo-x', teamId)
  projectOtroEquipo = await proj(leaderId, 'repo-y', otroTeamId)
})

async function obs(syncId: string, projectId: number, scope: string, author: string) {
  await pool.query(
    `insert into observations
       (sync_id, project_id, project_seq, scope, type, title, content, author_id, lamport,
        client_updated_at, client_created_at, deleted)
     values ($1, $2, 1, $3, 'decision', 'en claro', 'contenido en claro', $4, 1, now(), now(), false)`,
    [syncId, projectId, scope, author]
  )
  // Mantiene seq_counter en sync con el project_seq=1 hardcodeado arriba. Sin esto, un
  // proyecto recién creado en este fixture (seq_counter en 0 por default) deja que
  // `allocateSeqRange`, adentro de recrypt, devuelva el mismo 1 que esta fila ya tiene —
  // la comparación "después > antes" coincidiría por la misma razón, de nuevo, por la que
  // compararla contra un número fijo coincidía antes (ver el comentario del test de abajo).
  await pool.query('update projects set seq_counter = greatest(seq_counter, 1) where id = $1', [projectId])
}

describe('recryptTeamObservations', () => {
  it('rechaza con 403 a quien no es leader', async () => {
    const res = await recryptTeamObservations(pool, { deviceId: memberDevice, userId: memberId }, teamId, {
      items: [],
    })
    expect(res).toEqual({ ok: false, status: 403, error: 'leader_required' })
  })

  it('re-cifra una fila de equipo del propio proyecto del leader', async () => {
    const syncId = randomUUID()
    await obs(syncId, projectLeader, 'team', leaderId)
    // El seq ORIGINAL, antes de recrypt — el fixture de `obs()` lo hardcodea en 1, que es
    // ADEMÁS lo que `allocateSeqRange` devolvería para un project_id recién creado (su
    // `seq_counter` arranca en 0 por default). Comparar contra un número fijo coincidía por
    // casualidad; comparar contra el valor capturado ANTES es lo único que prueba el bump
    // de verdad, sin importar de qué `seq_counter` parta el proyecto.
    const antes = (await pool.query('select project_seq from observations where sync_id = $1', [syncId])).rows[0].project_seq
    const res = await recryptTeamObservations(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      items: [{
        sync_id: syncId, title: 'nmc1:xxx', content: 'nmc1:yyy', tags: [],
        content_hash: 'nmc1:hhh', origin_account: 'nmc1:aaa',
      }],
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.applied).toEqual([syncId])
      expect(res.rejected).toEqual([])
    }
    const { rows } = await pool.query(
      'select title, content, project_seq, content_hash, origin_account from observations where sync_id = $1',
      [syncId]
    )
    expect(rows[0].title).toBe('nmc1:xxx')
    expect(rows[0].content).toBe('nmc1:yyy')
    expect(Number(rows[0].project_seq)).toBeGreaterThan(Number(antes)) // bump: el pull lo tiene que ver de nuevo
    // El mismo gap que señaló el review: sin esto, content_hash y origin_account (el email de
    // quien guardó la memoria, electron/memory-envelope.ts) quedaban en claro para siempre en
    // las filas migradas retroactivamente, aunque title/content ya se re-cifraran.
    expect(rows[0].content_hash).toBe('nmc1:hhh')
    expect(rows[0].origin_account).toBe('nmc1:aaa')
  })

  it('re-cifra una fila de equipo subida por OTRO autor (el member), es el punto central de este task', async () => {
    const syncId = randomUUID()
    await obs(syncId, projectMember, 'team', memberId)
    const res = await recryptTeamObservations(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      items: [{ sync_id: syncId, title: 'nmc1:a', content: 'nmc1:b', tags: [], content_hash: null, origin_account: 'nmc1:mmm' }],
    })
    expect(res.ok && res.applied).toEqual([syncId])
    const { rows } = await pool.query(
      'select title, author_id, content_hash, origin_account from observations where sync_id = $1',
      [syncId]
    )
    expect(rows[0].title).toBe('nmc1:a')
    expect(rows[0].author_id).toBe(memberId) // la autoría NUNCA cambia
    expect(rows[0].content_hash).toBeNull()
    expect(rows[0].origin_account).toBe('nmc1:mmm')
  })

  it('REVIEW FOCUS: rechaza un sync_id de OTRO equipo, sin tocarlo', async () => {
    const syncId = randomUUID()
    await obs(syncId, projectOtroEquipo, 'team', leaderId)
    const res = await recryptTeamObservations(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      items: [{ sync_id: syncId, title: 'nmc1:HACKEADO', content: 'nmc1:x', tags: [], content_hash: null, origin_account: null }],
    })
    expect(res.ok && res.rejected).toEqual([{ sync_id: syncId, error: 'not_found_in_team' }])
    const { rows } = await pool.query('select title from observations where sync_id = $1', [syncId])
    expect(rows[0].title).toBe('en claro')
  })

  it('REVIEW FOCUS: rechaza un sync_id de scope personal del propio proyecto, sin tocarlo', async () => {
    const syncId = randomUUID()
    await obs(syncId, projectLeader, 'personal', leaderId)
    const res = await recryptTeamObservations(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      items: [{ sync_id: syncId, title: 'nmc1:HACKEADO', content: 'nmc1:x', tags: [], content_hash: null, origin_account: null }],
    })
    expect(res.ok && res.rejected).toEqual([{ sync_id: syncId, error: 'not_found_in_team' }])
    const { rows } = await pool.query('select title from observations where sync_id = $1', [syncId])
    expect(rows[0].title).toBe('en claro')
  })

  it('un sync_id inexistente se rechaza individualmente, no aborta el lote', async () => {
    const syncIdReal = randomUUID()
    await obs(syncIdReal, projectLeader, 'team', leaderId)
    const res = await recryptTeamObservations(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      items: [
        { sync_id: 'no-existe', title: 'nmc1:x', content: 'nmc1:y', tags: [], content_hash: null, origin_account: null },
        { sync_id: syncIdReal, title: 'nmc1:a', content: 'nmc1:b', tags: [], content_hash: null, origin_account: null },
      ],
    })
    expect(res.ok && res.applied).toEqual([syncIdReal])
    expect(res.ok && res.rejected).toEqual([{ sync_id: 'no-existe', error: 'not_found_in_team' }])
  })

  it('nunca toca scope, type ni author_id de la fila', async () => {
    const syncId = randomUUID()
    await obs(syncId, projectLeader, 'team', leaderId)
    await recryptTeamObservations(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      items: [{ sync_id: syncId, title: 'nmc1:x', content: 'nmc1:y', tags: [], content_hash: null, origin_account: null }],
    })
    const { rows } = await pool.query('select scope, type, author_id from observations where sync_id = $1', [syncId])
    expect(rows[0]).toEqual({ scope: 'team', type: 'decision', author_id: leaderId })
  })
})
