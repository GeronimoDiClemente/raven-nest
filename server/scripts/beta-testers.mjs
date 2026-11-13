#!/usr/bin/env node
// Quién está en la beta de la nube: la tabla `allowlist` del servicio de sync.
//
// La beta de Memories se reparte como prerelease de GitHub, y el repo es público: el
// instalador no es secreto. Lo que decide quién usa la NUBE es esta tabla — una cuenta que no
// está acá recibe `403 not_in_beta` y Memories le queda sólo local.
//
// El id es el de la cuenta de Nest (Supabase `auth.users.id`), que es el `sub` del JWT con el
// que la app se registra. Se agrega la fila de `users` si todavía no existe porque `allowlist`
// la referencia, y así el tester puede estar habilitado ANTES de su primer login. Si la fila
// ya existe no se toca: el plan que tenga es el que pagó.
//
// `remove` saca del allowlist y nada más: no borra las memorias de nadie. Para eso está el
// borrado §5.5, que lo pide el dueño.
//
// En Railway la base no tiene endpoint público, así que esto corre ADENTRO del contenedor:
//
//   railway ssh -s sync -e <staging|production> -- \
//     "cd /app && node --input-type=module - list" < scripts/beta-testers.mjs
//
// Local: DATABASE_URL=... node scripts/beta-testers.mjs list

import pg from 'pg'

const USO = `uso:
  list
  add <user-id> <email> [nota]
  remove <user-id>`

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// `node beta-testers.mjs list` y `node - list` (por stdin) dejan los dos el comando en argv[2]:
// el lugar 1 lo ocupa el path del script o el `-`.
const args = process.argv.slice(2)
const [comando, ...resto] = args

function fallar(msg, codigo = 2) {
  console.error(msg)
  process.exit(codigo)
}

if (!process.env.DATABASE_URL) fallar('Falta DATABASE_URL.')
if (!['list', 'add', 'remove'].includes(comando)) fallar(USO)

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

try {
  if (comando === 'list') {
    const { rows } = await pool.query(
      `select a.user_id, u.email, u.plan, a.note, to_char(a.created_at, 'YYYY-MM-DD') as desde,
              (select count(*) from devices d where d.user_id = a.user_id and d.revoked_at is null) as dispositivos
         from allowlist a join users u on u.id = a.user_id
        order by a.created_at`
    )
    if (rows.length === 0) console.log('El allowlist está vacío.')
    for (const r of rows) {
      console.log(`${r.user_id}  ${(r.email ?? '(sin email)').padEnd(40)} ${String(r.plan).padEnd(6)} ${String(r.dispositivos).padStart(2)} disp.  desde ${r.desde}${r.note ? `  · ${r.note}` : ''}`)
    }
  }

  if (comando === 'add') {
    const [userId, email, ...nota] = resto
    if (!userId || !UUID.test(userId) || !email || !email.includes('@')) fallar(`add necesita un user-id (uuid) y un email.\n${USO}`)
    const cliente = await pool.connect()
    try {
      await cliente.query('begin')
      await cliente.query('insert into users (id, email) values ($1, $2) on conflict (id) do nothing', [userId, email])
      const { rowCount } = await cliente.query(
        'insert into allowlist (user_id, note) values ($1, $2) on conflict (user_id) do nothing',
        [userId, nota.join(' ') || null]
      )
      await cliente.query('commit')
      console.log(rowCount === 1 ? `Agregado: ${email}` : `${email} ya estaba en el allowlist.`)
    } catch (err) {
      await cliente.query('rollback').catch(() => {})
      throw err
    } finally {
      cliente.release()
    }
  }

  if (comando === 'remove') {
    const [userId] = resto
    if (!userId || !UUID.test(userId)) fallar(`remove necesita un user-id (uuid).\n${USO}`)
    const { rowCount } = await pool.query('delete from allowlist where user_id = $1', [userId])
    console.log(rowCount === 1 ? 'Sacado del allowlist. Sus memorias siguen ahí.' : 'No estaba en el allowlist.')
  }
} catch (err) {
  fallar(`Falló: ${err instanceof Error ? err.message : String(err)}`, 1)
} finally {
  await pool.end()
}
