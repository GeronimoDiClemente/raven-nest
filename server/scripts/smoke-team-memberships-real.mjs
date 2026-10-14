#!/usr/bin/env node
// Smoke REAL de Team Memory Layer 1, Parte 2 — lo que `e2e/13-equipo-dos-cuentas.spec.ts`
// dice explícitamente que NO cubre (ver su encabezado): el espejo `team_memberships` se
// siembra ahí por SQL directo, nunca ejercitando `registerDevice()` con un JWT de Supabase
// de verdad. Este script sí lo hace, de punta a punta:
//
//   1. Dos usuarios REALES en Supabase Auth (local), uno owner de un team, el otro invitado
//      por email ANTES de existir (dispara el trigger `on_new_user_link_invites` de
//      `supabase/migrations/002_teams.sql`, el mismo camino que un invite real).
//   2. Un JWT real de cada uno (password grant, HS256 firmado con el `JWT_SECRET` local).
//   3. `POST /v1/devices` contra el servicio Node real — el mismo endpoint que llama
//      `electron/main.ts` vía `memory:registerDevice`, nunca `mint-device-token.mjs`.
//   4. Confirma `team_memberships` en la base del servicio Y repite la consulta exacta de
//      `useTeam.refresh()` (vía PostgREST, con el JWT de cada uno) para probar que el selector
//      de `ShareProjectCard` vería el team correcto — sin levantar Electron.
//
// Requiere, los dos arriba y corriendo:
//   npx supabase start                 (este repo — usa sus 30+ migraciones reales)
//   docker start nest-memory-pg        (o el run de server/README.md si no existe)
//
// Uso: node server/scripts/smoke-team-memberships-real.mjs

import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url))
const TSX_CLI = fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url))

function assert(cond, msg) {
  if (!cond) throw new Error(`FALLÓ: ${msg}`)
}

function estadoLocalDeSupabase() {
  // `shell: true` en Windows porque `npx` resuelve a un `.cmd`, y `execFileSync` sin shell
  // no sabe ejecutar `.cmd` directamente (EINVAL).
  const out = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
    encoding: 'utf8', cwd: process.cwd(), shell: process.platform === 'win32',
  })
  const vars = {}
  for (const m of out.matchAll(/^([A-Z_]+)="(.*)"$/gm)) vars[m[1]] = m[2]
  assert(vars.API_URL && vars.ANON_KEY && vars.SERVICE_ROLE_KEY && vars.JWT_SECRET && vars.DB_URL,
    '`npx supabase start` no está corriendo en este worktree (faltan claves en el status)')
  return vars
}

async function crearUsuario(sb, email, password) {
  const res = await fetch(`${sb.API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: sb.SERVICE_ROLE_KEY,
      Authorization: `Bearer ${sb.SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  const body = await res.json()
  assert(res.ok, `admin/users ${email}: ${res.status} ${JSON.stringify(body)}`)
  return { id: body.id, email }
}

async function login(sb, email, password) {
  const res = await fetch(`${sb.API_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: sb.ANON_KEY },
    body: JSON.stringify({ email, password }),
  })
  const body = await res.json()
  assert(res.ok, `login ${email}: ${res.status} ${JSON.stringify(body)}`)
  return body.access_token
}

/** La MISMA consulta que `useTeam.refresh()` hace vía supabase-js, pero cruda por PostgREST
 * con el JWT real — así confirma lo que el selector de ShareProjectCard vería, sin Electron. */
async function teamsQueVeElUsuario(sb, jwt) {
  const headers = { apikey: sb.ANON_KEY, Authorization: `Bearer ${jwt}` }
  const memberships = await fetch(
    `${sb.API_URL}/rest/v1/team_members?select=team_id&status=eq.active`,
    { headers }
  ).then((r) => r.json())
  const teamIds = memberships.map((m) => m.team_id)
  if (teamIds.length === 0) return []
  const ids = teamIds.map((id) => `"${id}"`).join(',')
  return fetch(`${sb.API_URL}/rest/v1/teams?select=*&id=in.(${ids})`, { headers }).then((r) => r.json())
}

async function main() {
  const sb = estadoLocalDeSupabase()
  const marca = Date.now()
  const passwordA = `SmokeA!${marca}`
  const passwordB = `SmokeB!${marca}`
  const emailA = `smoke-autor-${marca}@e2e.test`
  const emailB = `smoke-companero-${marca}@e2e.test`

  const dbSupabase = new pg.Pool({ connectionString: sb.DB_URL })
  const dbServicio = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:nestmem@127.0.0.1:55432/nest_memory' })

  let server = null
  try {
    // ── 1. Usuario A, team, e invitación a B ANTES de que B exista ──────────────────────
    const a = await crearUsuario(sb, emailA, passwordA)
    const teamId = randomUUID()
    await dbSupabase.query(
      `insert into teams (id, name, owner_id) values ($1, $2, $3)`,
      [teamId, `Equipo smoke ${marca}`, a.id]
    )
    await dbSupabase.query(
      `insert into team_members (team_id, user_id, email, role, status, invited_by, accepted_at)
       values ($1, $2, $3, 'leader', 'active', $2, now())`,
      [teamId, a.id, emailA]
    )
    const { rows: invite } = await dbSupabase.query(
      `insert into team_members (team_id, user_id, email, role, status, invited_by)
       values ($1, null, $2, 'member', 'pending', $3) returning id`,
      [teamId, emailB, a.id]
    )
    const inviteId = invite[0].id

    // ── 2. Usuario B se "registra" — migración 013: el trigger sólo LINKEA el user_id, no
    //      auto-acepta más (fix de seguridad: nadie queda adentro de un team sin consentir).
    //      B tiene que aceptar la invitación explícitamente, como hace `useTeam.acceptInvite()`.
    const b = await crearUsuario(sb, emailB, passwordB)
    const { rows: linkeado } = await dbSupabase.query(
      `select status, user_id from team_members where id = $1`, [inviteId]
    )
    assert(linkeado[0]?.user_id === b.id && linkeado[0]?.status === 'pending',
      `el trigger de la migración 013 no linkeó a B como pending: ${JSON.stringify(linkeado[0])}`)

    // ── 3. JWT real de cada uno ──────────────────────────────────────────────────────────
    const jwtA = await login(sb, emailA, passwordA)
    const jwtB = await login(sb, emailB, passwordB)

    // B acepta el invite por el mismo RPC que llama el botón "Accept" en la UI.
    const aceptar = await fetch(`${sb.API_URL}/rest/v1/rpc/accept_invite`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: sb.ANON_KEY, Authorization: `Bearer ${jwtB}` },
      body: JSON.stringify({ p_member_id: inviteId }),
    })
    assert(aceptar.ok, `accept_invite: ${aceptar.status} ${await aceptar.text()}`)
    const { rows: activo } = await dbSupabase.query(`select status from team_members where id = $1`, [inviteId])
    assert(activo[0]?.status === 'active', `accept_invite no dejó status=active: ${JSON.stringify(activo[0])}`)

    // ── 4. Pre-allowlistear en la base del SERVICIO (lo que hace beta-testers.mjs en prod,
    //      ahí sembrado con el user_id REAL de Supabase) ─────────────────────────────────
    for (const u of [a, b]) {
      await dbServicio.query(
        `insert into users (id, email, plan) values ($1, $2, 'team')
         on conflict (id) do update set email = excluded.email`,
        [u.id, u.email]
      )
      await dbServicio.query(
        `insert into allowlist (user_id, note) values ($1, 'smoke-team-memberships-real') on conflict (user_id) do nothing`,
        [u.id]
      )
    }

    // ── 5. Servidor real con la MISMA config que vería en prod contra Supabase local ────
    const port = 8099
    server = spawn(process.execPath, [TSX_CLI, 'src/index.ts'], {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        PORT: String(port),
        DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://postgres:nestmem@127.0.0.1:55432/nest_memory',
        SUPABASE_URL: sb.API_URL,
        SUPABASE_ANON_KEY: sb.ANON_KEY,
        SUPABASE_JWT_SECRET: sb.JWT_SECRET,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let listo = false
    server.stdout.on('data', (d) => { if (d.toString().includes('listening')) listo = true })
    const desde = Date.now()
    while (!listo && Date.now() - desde < 15_000) await new Promise((r) => setTimeout(r, 200))
    assert(listo, 'el servicio no levantó en 15s')

    // ── 6. POST /v1/devices REAL, con el JWT de cada uno — esto es lo que nunca se probó ─
    for (const [who, jwt] of [['A', jwtA], ['B', jwtB]]) {
      const res = await fetch(`http://127.0.0.1:${port}/v1/devices`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ name: `smoke-${who}` }),
      })
      const body = await res.json()
      assert(res.status === 201, `/v1/devices para ${who}: ${res.status} ${JSON.stringify(body)}`)
    }

    // ── 7. team_memberships en la base del SERVICIO, poblado por el fetch real a Supabase ─
    for (const [who, u] of [['A', a], ['B', b]]) {
      const { rows } = await dbServicio.query(
        `select team_id, team_name, role, status from team_memberships where user_id = $1`, [u.id]
      )
      assert(rows.length === 1, `team_memberships de ${who}: esperaba 1 fila, hubo ${rows.length}`)
      assert(rows[0].team_id === teamId, `team_memberships de ${who} tiene el team_id equivocado`)
      assert(rows[0].team_name === `Equipo smoke ${marca}`, `team_name no llegó: ${rows[0].team_name}`)
      assert(rows[0].status === 'active', `status no es active: ${rows[0].status}`)
      console.log(`✓ team_memberships[${who}] = ${JSON.stringify(rows[0])}`)
    }

    // ── 8. Lo que vería el selector de ShareProjectCard — misma consulta que useTeam() ───
    for (const [who, jwt] of [['A', jwtA], ['B', jwtB]]) {
      const teams = await teamsQueVeElUsuario(sb, jwt)
      assert(teams.length === 1 && teams[0].id === teamId,
        `useTeam() para ${who} no ve el team esperado: ${JSON.stringify(teams)}`)
      console.log(`✓ useTeam()[${who}] vería: ${teams[0].name}`)
    }

    console.log('\nPASA — team_memberships real + lo que vería ShareProjectCard, de punta a punta.')
  } finally {
    if (server) { try { process.kill(server.pid, 'SIGKILL') } catch {} }
    await dbSupabase.end()
    await dbServicio.end()
  }
}

main().catch((err) => { console.error(err.message); process.exit(1) })
