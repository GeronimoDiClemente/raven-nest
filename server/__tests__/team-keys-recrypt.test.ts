import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { randomUUID, createHash } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { recryptTeamObservations, listRecryptPending } from '../src/team-keys-recrypt'

// Task 15 (C2): recrypt exige probar la maestra de equipo. El servidor guarda el SHA-256 de la
// prueba al activar (`team_keys.verifier`) y compara contra eso.
const PRUEBA = 'prueba-derivada-de-la-maestra-de-equipo'
const VERIFICADOR = createHash('sha256').update(PRUEBA, 'utf8').digest('hex')

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
  await pool.query('insert into team_keys (team_id, activated_by, verifier) values ($1, $2, $3)', [teamId, leaderId, VERIFICADOR])
  projectLeader = await proj(leaderId, 'repo-x', teamId)
  projectMember = await proj(memberId, 'repo-x', teamId)
  projectOtroEquipo = await proj(leaderId, 'repo-y', otroTeamId)
})

async function obs(syncId: string, projectId: number, scope: string, author: string) {
  // El seq sale del contador del proyecto, igual que en push.ts, y el contador avanza en la
  // misma sentencia. Antes era `project_seq = 1` fijo más un `greatest(seq_counter, 1)`: con
  // una sola fila por proyecto alcanzaba, pero la segunda chocaba con
  // `unique (project_id, project_seq)` — los tests de lo pendiente (Task 15) meten varias.
  // Sigue garantizando lo que el fixture viejo cuidaba: `allocateSeqRange`, adentro de
  // recrypt, devuelve un seq MAYOR que el de la fila (ver el comentario del test de abajo).
  const { rows } = await pool.query(
    'update projects set seq_counter = seq_counter + 1 where id = $1 returning seq_counter', [projectId]
  )
  await pool.query(
    `insert into observations
       (sync_id, project_id, project_seq, scope, type, title, content, author_id, lamport,
        client_updated_at, client_created_at, deleted)
     values ($1, $2, $5, $3, 'decision', 'en claro', 'contenido en claro', $4, 1, now(), now(), false)`,
    [syncId, projectId, scope, author, Number(rows[0].seq_counter)]
  )
}

describe('recryptTeamObservations', () => {
  it('rechaza con 403 a quien no es leader', async () => {
    const res = await recryptTeamObservations(pool, { deviceId: memberDevice, userId: memberId }, teamId, {
      proof: PRUEBA,
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
      proof: PRUEBA,
      items: [{
        sync_id: syncId, title: 'nmc1:xxx', content: 'nmc1:yyy', tags: [],
        content_hash: 'nmc1:hhh', origin_account: 'nmc1:aaa', lamport: 1,
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
      proof: PRUEBA,
      items: [{ sync_id: syncId, title: 'nmc1:a', content: 'nmc1:b', tags: [], content_hash: null, origin_account: 'nmc1:mmm', lamport: 1 }],
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
      proof: PRUEBA,
      items: [{ sync_id: syncId, title: 'nmc1:HACKEADO', content: 'nmc1:x', tags: [], content_hash: null, origin_account: null, lamport: 1 }],
    })
    expect(res.ok && res.rejected).toEqual([{ sync_id: syncId, error: 'not_found_in_team' }])
    const { rows } = await pool.query('select title from observations where sync_id = $1', [syncId])
    expect(rows[0].title).toBe('en claro')
  })

  it('REVIEW FOCUS: rechaza un sync_id de scope personal del propio proyecto, sin tocarlo', async () => {
    const syncId = randomUUID()
    await obs(syncId, projectLeader, 'personal', leaderId)
    const res = await recryptTeamObservations(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      proof: PRUEBA,
      items: [{ sync_id: syncId, title: 'nmc1:HACKEADO', content: 'nmc1:x', tags: [], content_hash: null, origin_account: null, lamport: 1 }],
    })
    expect(res.ok && res.rejected).toEqual([{ sync_id: syncId, error: 'not_found_in_team' }])
    const { rows } = await pool.query('select title from observations where sync_id = $1', [syncId])
    expect(rows[0].title).toBe('en claro')
  })

  it('un sync_id inexistente se rechaza individualmente, no aborta el lote', async () => {
    const syncIdReal = randomUUID()
    await obs(syncIdReal, projectLeader, 'team', leaderId)
    const res = await recryptTeamObservations(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      proof: PRUEBA,
      items: [
        { sync_id: 'no-existe', title: 'nmc1:x', content: 'nmc1:y', tags: [], content_hash: null, origin_account: null, lamport: 1 },
        { sync_id: syncIdReal, title: 'nmc1:a', content: 'nmc1:b', tags: [], content_hash: null, origin_account: null, lamport: 1 },
      ],
    })
    expect(res.ok && res.applied).toEqual([syncIdReal])
    expect(res.ok && res.rejected).toEqual([{ sync_id: 'no-existe', error: 'not_found_in_team' }])
  })

  it('nunca toca scope, type ni author_id de la fila', async () => {
    const syncId = randomUUID()
    await obs(syncId, projectLeader, 'team', leaderId)
    await recryptTeamObservations(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      proof: PRUEBA,
      items: [{ sync_id: syncId, title: 'nmc1:x', content: 'nmc1:y', tags: [], content_hash: null, origin_account: null, lamport: 1 }],
    })
    const { rows } = await pool.query('select scope, type, author_id from observations where sync_id = $1', [syncId])
    expect(rows[0]).toEqual({ scope: 'team', type: 'decision', author_id: leaderId })
  })
})

async function fila(syncId: string) {
  return (await pool.query('select title, content, lamport, project_seq from observations where sync_id = $1', [syncId])).rows[0]
}

const item = (syncId: string, extra: Record<string, unknown> = {}) => ({
  sync_id: syncId, title: 'nmc1:t', content: 'nmc1:c', tags: [], content_hash: null, origin_account: null, lamport: 1, ...extra,
})

describe('recryptTeamObservations — Task 15', () => {
  let segundoLeaderId: string, segundoLeaderDevice: string
  beforeEach(async () => {
    // El atacante de C2: leader del mismo equipo, sin la maestra (spec §6, existe por diseño).
    segundoLeaderId = randomUUID()
    segundoLeaderDevice = randomUUID()
    await pool.query('insert into users (id) values ($1)', [segundoLeaderId])
    await pool.query(
      `insert into team_memberships (user_id, team_id, team_name, role, status) values ($1, $2, 'Equipo', 'leader', 'active')`,
      [segundoLeaderId, teamId]
    )
  })

  it('C2 ADVERSARIAL: un leader SIN la clave no puede re-cifrar el histórico con basura', async () => {
    const syncId = randomUUID()
    await obs(syncId, projectMember, 'team', memberId)
    for (const proof of ['inventada', VERIFICADOR, undefined]) {
      const res = await recryptTeamObservations(pool, { deviceId: segundoLeaderDevice, userId: segundoLeaderId }, teamId, {
        proof, items: [item(syncId, { title: 'nmc1:BASURA' })],
      })
      expect(res).toEqual({ ok: false, status: 403, error: 'must_hold_team_key' })
    }
    expect((await fila(syncId)).title).toBe('en claro')
  })

  it('un equipo sin team_keys no se migra: 404', async () => {
    await pool.query(
      `insert into team_memberships (user_id, team_id, team_name, role, status) values ($1, $2, 'Otro', 'leader', 'active')`,
      [leaderId, otroTeamId]
    )
    const res = await recryptTeamObservations(pool, { deviceId: leaderDevice, userId: leaderId }, otroTeamId, {
      proof: PRUEBA, items: [item(randomUUID())],
    })
    expect(res).toEqual({ ok: false, status: 404, error: 'not_activated' })
  })

  it('I1: una fila que ya está sellada se rechaza (already_sealed) y no se pisa', async () => {
    const syncId = randomUUID()
    await obs(syncId, projectMember, 'team', memberId)
    await pool.query(`update observations set title = 'nmc1:EDICION-NUEVA', content = 'nmc1:NUEVO' where sync_id = $1`, [syncId])
    const res = await recryptTeamObservations(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      proof: PRUEBA, items: [item(syncId, { title: 'nmc1:VIEJO' })],
    })
    expect(res.ok && res.rejected).toEqual([{ sync_id: syncId, error: 'already_sealed' }])
    expect((await fila(syncId)).title).toBe('nmc1:EDICION-NUEVA')
  })

  it('I1: si la fila se editó después de que el leader la leyó (lamport distinto), stale y no se pisa', async () => {
    const syncId = randomUUID()
    await obs(syncId, projectMember, 'team', memberId)
    // El member editó en claro después del último pull del leader: lamport 1 → 7.
    await pool.query(`update observations set title = 'editada', lamport = 7 where sync_id = $1`, [syncId])
    const antes = await fila(syncId)
    const res = await recryptTeamObservations(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      proof: PRUEBA, items: [item(syncId, { lamport: 1 })],
    })
    expect(res.ok && res.rejected).toEqual([{ sync_id: syncId, error: 'stale' }])
    expect(await fila(syncId)).toEqual(antes)
  })

  it('I1: un item sin lamport es inválido (el lote entero, como cualquier campo mal formado)', async () => {
    const syncId = randomUUID()
    await obs(syncId, projectLeader, 'team', leaderId)
    const { lamport: _l, ...sinLamport } = item(syncId)
    const res = await recryptTeamObservations(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      proof: PRUEBA, items: [sinLamport],
    })
    expect(res).toEqual({ ok: false, status: 400, error: 'invalid_fields' })
  })

  it('I2: un content null (tombstone) se acepta, no tira 400 al lote', async () => {
    const syncId = randomUUID()
    await obs(syncId, projectLeader, 'team', leaderId)
    await pool.query('update observations set content = null where sync_id = $1', [syncId])
    const res = await recryptTeamObservations(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      proof: PRUEBA, items: [item(syncId, { content: null })],
    })
    expect(res.ok && res.applied).toEqual([syncId])
    const f = await fila(syncId)
    expect(f.title).toBe('nmc1:t')
    expect(f.content).toBeNull()
  })

  it('el lamport de la fila no cambia: re-cifrar no es editar', async () => {
    const syncId = randomUUID()
    await obs(syncId, projectLeader, 'team', leaderId)
    await recryptTeamObservations(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {
      proof: PRUEBA, items: [item(syncId)],
    })
    expect(Number((await fila(syncId)).lamport)).toBe(1)
  })
})

describe('listRecryptPending — C1', () => {
  it('lista lo que está en claro en CUALQUIER proyecto del equipo, con su lamport', async () => {
    const delMember = randomUUID()
    const delLeader = randomUUID()
    const sellada = randomUUID()
    const personal = randomUUID()
    const deOtroEquipo = randomUUID()
    await obs(delMember, projectMember, 'team', memberId)
    await obs(delLeader, projectLeader, 'team', leaderId)
    await obs(sellada, projectMember, 'team', memberId)
    await pool.query(`update observations set title = 'nmc1:a', content = 'nmc1:b' where sync_id = $1`, [sellada])
    await obs(personal, projectLeader, 'personal', leaderId)
    await obs(deOtroEquipo, projectOtroEquipo, 'team', leaderId)

    const res = await listRecryptPending(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {})
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.total).toBe(2)
    expect(res.items.map((i) => i.sync_id).sort()).toEqual([delMember, delLeader].sort())
    expect(res.items.every((i) => i.lamport === 1)).toBe(true)
  })

  it('una fila con título sellado pero contenido en claro sigue pendiente', async () => {
    const syncId = randomUUID()
    await obs(syncId, projectMember, 'team', memberId)
    await pool.query(`update observations set title = 'nmc1:a' where sync_id = $1`, [syncId])
    const res = await listRecryptPending(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, {})
    expect(res.ok && res.items.map((i) => i.sync_id)).toEqual([syncId])
  })

  it('pagina por sync_id con `after`', async () => {
    const ids = [randomUUID(), randomUUID(), randomUUID()].sort()
    for (const id of ids) await obs(id, projectMember, 'team', memberId)
    const p1 = await listRecryptPending(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, { limit: 2 })
    expect(p1.ok && p1.items.map((i) => i.sync_id)).toEqual(ids.slice(0, 2))
    expect(p1.ok && p1.total).toBe(3)
    const p2 = await listRecryptPending(pool, { deviceId: leaderDevice, userId: leaderId }, teamId, { after: ids[1], limit: 2 })
    expect(p2.ok && p2.items.map((i) => i.sync_id)).toEqual([ids[2]])
  })

  it('403 para un member', async () => {
    const res = await listRecryptPending(pool, { deviceId: memberDevice, userId: memberId }, teamId, {})
    expect(res).toEqual({ ok: false, status: 403, error: 'leader_required' })
  })
})
