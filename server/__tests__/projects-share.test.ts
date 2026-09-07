// Team Memory Layer 1, Parte 3 — POST /v1/projects/share. Corre contra Postgres real, mismo
// patrón que push-scope.test.ts / push-tenancy.test.ts: seedea cuentas y proyectos directo
// por SQL y llama al handler directamente (no pasa por http.ts acá).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handleShareProject } from '../src/share'

const pool = getPool()
const RUN = randomUUID().slice(0, 8)
const PROJECT = (label: string) => `share-${RUN}-${label}`

let userId: string

beforeAll(async () => {
  await migrate(pool)
  userId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'team')`, [userId])
})

afterAll(async () => {
  await pool.end()
})

async function seedProject(projectKey: string, ownerId: string): Promise<void> {
  await pool.query(
    `insert into projects (user_id, project_key, display_name) values ($1, $2, $2)
     on conflict (user_id, project_key) do nothing`,
    [ownerId, projectKey]
  )
}

async function seedMembership(uid: string, teamId: string, status = 'active'): Promise<void> {
  await pool.query(
    `insert into team_memberships (user_id, team_id, team_name, role, status)
     values ($1, $2, 'Equipo de prueba', 'member', $3)`,
    [uid, teamId, status]
  )
}

async function teamIdOf(projectKey: string, ownerId: string): Promise<string | null> {
  const { rows } = await pool.query(
    'select team_id from projects where user_id = $1 and project_key = $2',
    [ownerId, projectKey]
  )
  return rows[0]?.team_id ?? null
}

describe('handleShareProject — POST /v1/projects/share', () => {
  it('happy path: comparte el proyecto cuando el usuario es miembro activo del team y el proyecto es suyo', async () => {
    const project = PROJECT('happy')
    const teamId = randomUUID()
    await seedProject(project, userId)
    await seedMembership(userId, teamId)

    const res = await handleShareProject(pool, { userId }, { project_key: project, team_id: teamId })

    expect(res).toEqual({ ok: true })
    expect(await teamIdOf(project, userId)).toBe(teamId)
  })

  it('rechaza si no hay NINGUNA fila de team_memberships para ese usuario', async () => {
    const project = PROJECT('no-membership')
    const teamId = randomUUID()
    await seedProject(project, userId)

    const res = await handleShareProject(pool, { userId }, { project_key: project, team_id: teamId })

    expect(res).toEqual({ ok: false, status: 403, error: 'not_team_member' })
    expect(await teamIdOf(project, userId)).toBeNull()
  })

  it('rechaza si es miembro activo de OTRO team, no del team_id pedido', async () => {
    const project = PROJECT('other-team')
    const myTeam = randomUUID()
    const otherTeam = randomUUID()
    await seedProject(project, userId)
    await seedMembership(userId, myTeam)

    const res = await handleShareProject(pool, { userId }, { project_key: project, team_id: otherTeam })

    expect(res).toEqual({ ok: false, status: 403, error: 'not_team_member' })
    expect(await teamIdOf(project, userId)).toBeNull()
  })

  it("rechaza si la membresía existe pero su status no es 'active'", async () => {
    const project = PROJECT('inactive-membership')
    const teamId = randomUUID()
    await seedProject(project, userId)
    await seedMembership(userId, teamId, 'removed')

    const res = await handleShareProject(pool, { userId }, { project_key: project, team_id: teamId })

    expect(res).toEqual({ ok: false, status: 403, error: 'not_team_member' })
    expect(await teamIdOf(project, userId)).toBeNull()
  })

  it('rechaza si el proyecto no le pertenece al llamante (es de otra cuenta), sin tocarlo', async () => {
    const otroUserId = randomUUID()
    await pool.query(`insert into users (id, plan) values ($1, 'team')`, [otroUserId])
    const project = PROJECT('not-mine')
    const teamId = randomUUID()
    await seedProject(project, otroUserId)
    // El LLAMANTE sí es miembro activo del team — lo único que falta es la ownership.
    await seedMembership(userId, teamId)

    const res = await handleShareProject(pool, { userId }, { project_key: project, team_id: teamId })

    expect(res).toEqual({ ok: false, status: 404, error: 'project_not_found' })
    expect(await teamIdOf(project, otroUserId)).toBeNull()
  })

  it('rechaza si el project_key no existe en absoluto', async () => {
    const teamId = randomUUID()
    await seedMembership(userId, teamId)

    const res = await handleShareProject(pool, { userId }, {
      project_key: PROJECT('never-existed'),
      team_id: teamId,
    })

    expect(res).toEqual({ ok: false, status: 404, error: 'project_not_found' })
  })

  it('400s con project_key faltante, vacío, o sólo espacios', async () => {
    const teamId = randomUUID()
    await seedMembership(userId, teamId)

    for (const bad of [undefined, '', '   ']) {
      const res = await handleShareProject(pool, { userId }, { project_key: bad, team_id: teamId })
      expect(res).toEqual({ ok: false, status: 400, error: 'missing_project_key' })
    }
  })

  it('400s con team_id mal formado en vez de dejar que Postgres lo rechace como 500', async () => {
    const project = PROJECT('bad-team-id')
    await seedProject(project, userId)

    for (const bad of [undefined, '', 'not-a-uuid', '12345', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa']) {
      const res = await handleShareProject(pool, { userId }, { project_key: project, team_id: bad })
      expect(res).toEqual({ ok: false, status: 400, error: 'invalid_team_id' })
    }
    // Y el proyecto no quedó tocado por ninguno de esos intentos.
    expect(await teamIdOf(project, userId)).toBeNull()
  })
})
