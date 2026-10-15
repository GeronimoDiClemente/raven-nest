// Team Memory Layer 1, Parte 5 — la fuga que este test existe para cerrar: `handlePull`
// pasa de "sólo mis filas" a "mis filas, más las scope='team' de un proyecto compartido con
// un equipo del que soy miembro activo". El caso decisivo es que la unión de las DOS
// condiciones tiene que evaluarse por FILA, no por proyecto — una fila 'personal' o
// 'project' en un proyecto YA compartido nunca puede viajar, sólo 'team'.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'
import { handlePull } from '../src/pull'

const pool = getPool()
const RUN = randomUUID().slice(0, 8)
const SYNC = (id: string) => `${RUN}-${id}`
const PROJECT = (label: string) => `pts-${RUN}-${label}`

type Account = { deviceId: string; userId: string; plan: string }

async function seedAccount(label: string, plan: string): Promise<Account> {
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, $2)`, [userId, plan])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, $3, $4)`,
    [deviceId, userId, label, `hash-${deviceId}`]
  )
  return { deviceId, userId, plan }
}

async function seedMembership(userId: string, teamId: string, status = 'active'): Promise<void> {
  await pool.query(
    `insert into team_memberships (user_id, team_id, team_name, role, status)
     values ($1, $2, 'Equipo de prueba', 'member', $3)`,
    [userId, teamId, status]
  )
}

function mutation(
  seq: number,
  syncId: string,
  projectKey: string,
  scope: string,
  extra: Record<string, unknown> = {}
) {
  return {
    seq,
    sync_id: syncId,
    op: 'upsert' as const,
    payload: {
      sync_id: syncId,
      project_key: projectKey,
      project_display_name: projectKey,
      scope,
      type: 'decision',
      topic_key: null,
      title: syncId,
      content: 'body',
      tags: [],
      lamport: 1,
      updated_at: Date.now(),
      created_at: Date.now(),
      ...extra,
    },
  }
}

let userA: Account
let userB: Account
let userC: Account
let teamId: string
let projectA: string

beforeAll(async () => {
  await migrate(pool)
  // Los tres necesitan plan 'team' (TEAM_SCOPE_PLANS) para que un push scope:'team' no
  // rebote por plan antes siquiera de llegar al gate de sharing — el test quiere ejercitar
  // el filtro de MEMBRESÍA/PROYECTO del pull, no el gate de plan de push.ts.
  userA = await seedAccount('userA', 'team')
  userB = await seedAccount('userB', 'team')
  userC = await seedAccount('userC', 'team')
  teamId = randomUUID()
  // A y B son miembros activos del mismo equipo. C, deliberadamente, no tiene NINGUNA fila
  // en team_memberships — ni de este equipo ni de ningún otro.
  await seedMembership(userA.userId, teamId)
  await seedMembership(userB.userId, teamId)

  projectA = PROJECT('a')

  // Fila 1: scope='personal' de A en su propio proyecto.
  await handlePush(pool, userA, {
    mutations: [mutation(1, SYNC('a-personal'), projectA, 'personal')],
  })
  // Fila 2: scope='project' de A, mismo proyecto.
  await handlePush(pool, userA, {
    mutations: [mutation(2, SYNC('a-project'), projectA, 'project')],
  })

  // El proyecto de A se comparte con el equipo RECIÉN ACÁ — después de las dos filas de
  // arriba, para que quede probado que compartir el proyecto no las arrastra a ellas
  // también, sólo habilita que una fila NUEVA con scope='team' pueda existir (push.ts,
  // Parte 4, exige team_id seteado antes de aceptar scope:'team').
  await pool.query('update projects set team_id = $1 where user_id = $2 and project_key = $3', [
    teamId, userA.userId, projectA,
  ])

  // Fila 3: scope='team' de A, mismo proyecto — ya compartido, así que push.ts la acepta.
  await handlePush(pool, userA, {
    mutations: [mutation(3, SYNC('a-team'), projectA, 'team')],
  })

  // Fila 4: scope='team' de B, pero en el PROPIO proyecto de B, que B nunca comparte
  // (team_id se queda NULL). Sirve para confirmar que scope='team' por sí solo no alcanza
  // sin que el PROYECTO esté compartido — la fuga simétrica a la de la fila 1/2.
  const projectB = PROJECT('b')
  await pool.query(
    `insert into projects (user_id, project_key, display_name) values ($1, $2, $2)
     on conflict (user_id, project_key) do nothing`,
    [userB.userId, projectB]
  )
  await pool.query(
    `insert into observations (
       sync_id, project_id, project_seq, scope, type, title, content, tags, lamport,
       client_updated_at, client_created_at, deleted, author_id
     )
     select $1, id, 1, 'team', 'decision', $1, 'body', '[]'::jsonb, 1, now(), now(), false, $2
       from projects where user_id = $2 and project_key = $3`,
    [SYNC('b-team-unshared'), userB.userId, projectB]
  )
})

afterAll(async () => {
  await pool.end()
})

describe('handlePull — Team Memory Layer 1, Parte 5 (pull team-scoped)', () => {
  it("el pull de B sobre el proyecto de A trae EXACTAMENTE la fila scope='team' de A, cero más", async () => {
    const res = await handlePull(pool, { deviceId: userB.deviceId, userId: userB.userId, plan: userB.plan }, {
      cursors: { [projectA]: 0 },
      limit: 500,
    })

    const syncIds = res.rows.map((r) => r.sync_id)
    expect(syncIds).toEqual([SYNC('a-team')])
    expect(res.rows[0].scope).toBe('team')
    // El SELECT original no traía author_id (solo author_display) — toda fila pulled
    // quedaba con author_user_id=null del lado cliente, indistinguible de "sin dueño"
    // (countUnclaimedRows/Task 2). Sin este campo, B recibe la fila de A pero no puede
    // saber que es de A, no de B.
    expect(res.rows[0].author_id).toBe(userA.userId)

    // Negativo explícito: ninguna de las dos filas no-team viaja, aunque el proyecto ya
    // esté compartido con el equipo del que B es miembro.
    expect(syncIds).not.toContain(SYNC('a-personal'))
    expect(syncIds).not.toContain(SYNC('a-project'))
  })

  it('el pull de A sobre su propio proyecto sigue viendo las 3 filas propias, como siempre', async () => {
    const res = await handlePull(pool, { deviceId: userA.deviceId, userId: userA.userId, plan: userA.plan }, {
      cursors: { [projectA]: 0 },
      limit: 500,
    })

    const syncIds = res.rows.map((r) => r.sync_id).sort()
    expect(syncIds).toEqual(
      [SYNC('a-personal'), SYNC('a-project'), SYNC('a-team')].sort()
    )
  })

  it('un tercer usuario C, que NO es miembro del equipo, no ve nada del proyecto de A — ni siquiera la fila team', async () => {
    const res = await handlePull(pool, { deviceId: userC.deviceId, userId: userC.userId, plan: userC.plan }, {
      cursors: { [projectA]: 0 },
      limit: 500,
    })

    expect(res.rows).toEqual([])
  })

  it("scope='team' sin que el PROYECTO esté compartido no viaja a nadie — ni siquiera al propio dueño la ve un tercero", async () => {
    // B es miembro activo del equipo, pero su propio proyecto (con la fila scope='team')
    // nunca se compartió (team_id sigue NULL) — así que ni siquiera A, que sí conoce el
    // team, puede pedirlo: el project_key de B no está en NINGÚN cursor de A ni de nadie
    // más, y aunque lo estuviera, `p.team_id in (...)` no matchea contra NULL.
    const projectB = PROJECT('b')
    const res = await handlePull(pool, { deviceId: userA.deviceId, userId: userA.userId, plan: userA.plan }, {
      cursors: { [projectB]: 0 },
      limit: 500,
    })

    expect(res.rows).toEqual([])
  })
})

// Lo que los cuatro tests de arriba no pueden ver, porque todos piden con el cursor en 0 y
// en ninguno B tiene un proyecto propio con la misma `project_key`. En uso real B SÍ lo tiene
// (es el mismo repo clonado) y su cursor ya avanzó con sus propias memorias — y `project_seq`
// se cuenta por proyecto, así que el 3 de la fila de A y el 3 de B no son el mismo 3.
describe('handlePull — cursores de equipo separados de los propios', () => {
  const comoB = () => ({ deviceId: userB.deviceId, userId: userB.userId, plan: userB.plan })
  let sourceA: string

  beforeAll(async () => {
    // B clona el mismo repo: misma project_key, proyecto distinto, y 5 memorias propias.
    await handlePush(pool, userB, {
      mutations: [1, 2, 3, 4, 5].map((n) => mutation(100 + n, SYNC(`b-propia-${n}`), projectA, 'personal')),
    })
    const { rows } = await pool.query('select id from projects where user_id = $1 and project_key = $2', [
      userA.userId, projectA,
    ])
    sourceA = String(rows[0].id)
  })

  it('el cliente viejo (sin team_cursors) con el cursor en 5 NO recibe la fila de equipo — el defecto, fijado', async () => {
    const res = await handlePull(pool, comoB(), { cursors: { [projectA]: 5 }, limit: 500 })
    expect(res.rows).toEqual([])
    expect(res.team_cursors).toBeUndefined()
  })

  it('con team_cursors vacío y el cursor propio en 5, la fila de equipo de A llega igual', async () => {
    const res = await handlePull(pool, comoB(), { cursors: { [projectA]: 5 }, team_cursors: {}, limit: 500 })

    expect(res.rows.map((r) => r.sync_id)).toEqual([SYNC('a-team')])
    // El cursor propio no se mueve por una fila ajena…
    expect(res.cursors).toEqual({ [projectA]: 5 })
    // …y el de equipo queda en el project_seq de esa fila, contado en el proyecto de A.
    expect(res.team_cursors).toEqual({ [projectA]: { [sourceA]: 3 } })
  })

  it('devolviendo ese cursor de equipo, la misma fila no vuelve', async () => {
    const res = await handlePull(pool, comoB(), {
      cursors: { [projectA]: 5 }, team_cursors: { [projectA]: { [sourceA]: 3 } }, limit: 500,
    })
    expect(res.rows).toEqual([])
    expect(res.team_cursors).toEqual({ [projectA]: { [sourceA]: 3 } })
  })

  it('lo propio y lo ajeno vuelven juntos, cada uno contra su cursor', async () => {
    const res = await handlePull(pool, comoB(), { cursors: { [projectA]: 3 }, team_cursors: {}, limit: 500 })
    expect(res.rows.map((r) => r.sync_id).sort()).toEqual(
      [SYNC('b-propia-4'), SYNC('b-propia-5'), SYNC('a-team')].sort()
    )
    expect(res.cursors).toEqual({ [projectA]: 5 })
  })

  it('C, que no es miembro, tampoco ve nada por este camino — ni inventando el source', async () => {
    const res = await handlePull(pool, { deviceId: userC.deviceId, userId: userC.userId, plan: userC.plan }, {
      cursors: { [projectA]: 0 }, team_cursors: { [projectA]: { [sourceA]: 0 } }, limit: 500,
    })
    expect(res.rows).toEqual([])
  })

  it('las personales de A siguen sin viajar aunque el cursor de equipo esté en 0', async () => {
    const res = await handlePull(pool, comoB(), {
      cursors: { [projectA]: 99 }, team_cursors: { [projectA]: { [sourceA]: 0 } }, limit: 500,
    })
    expect(res.rows.map((r) => r.sync_id)).toEqual([SYNC('a-team')])
  })

  it('un team_cursors mal formado no rompe ni abre nada: se ignora y arranca de 0', async () => {
    const res = await handlePull(pool, comoB(), {
      cursors: { [projectA]: 99 },
      team_cursors: { [projectA]: { 'no-es-un-id': 7, [sourceA]: 'x' as unknown as number }, 'otra-key': { '1': 0 } },
      limit: 500,
    })
    expect(res.rows.map((r) => r.sync_id)).toEqual([SYNC('a-team')])
    expect(Object.keys(res.team_cursors ?? {})).toEqual([projectA])
  })
})

// Task 14 (cifrado de equipo, Problema 1): el cliente elige la clave de equipo de una fila
// bajada por ESTE campo, no por su `projects.team_id` local — que sólo existe en la máquina
// que compartió. Un compañero que nunca compartió su copia lo necesita para poder descifrar.
describe('handlePull — team_id en cada fila de scope team (Task 14)', () => {
  const comoA = () => ({ deviceId: userA.deviceId, userId: userA.userId, plan: userA.plan })
  const comoB = () => ({ deviceId: userB.deviceId, userId: userB.userId, plan: userB.plan })

  it('la fila de equipo que baja B (con team_cursors) trae el team_id del proyecto de A', async () => {
    const res = await handlePull(pool, comoB(), { cursors: { [projectA]: 0 }, team_cursors: {}, limit: 500 })
    const fila = res.rows.find((r) => r.sync_id === SYNC('a-team'))
    expect(fila?.team_id).toBe(teamId)
  })

  it('también por el camino viejo (cliente sin team_cursors)', async () => {
    const res = await handlePull(pool, comoB(), { cursors: { [projectA]: 0 }, limit: 500 })
    expect(res.rows.find((r) => r.sync_id === SYNC('a-team'))?.team_id).toBe(teamId)
  })

  it('en lo propio de A, sólo la fila team lleva el campo: personal/project no', async () => {
    const res = await handlePull(pool, comoA(), { cursors: { [projectA]: 0 }, team_cursors: {}, limit: 500 })
    const porId = new Map(res.rows.map((r) => [r.sync_id, r]))
    expect(porId.get(SYNC('a-team'))?.team_id).toBe(teamId)
    expect('team_id' in porId.get(SYNC('a-personal'))!).toBe(false)
    expect('team_id' in porId.get(SYNC('a-project'))!).toBe(false)
  })
})
