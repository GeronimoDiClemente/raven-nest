import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'

const pool = getPool()
const RUN = randomUUID().slice(0, 8)
const SYNC = (id: string) => `${RUN}-${id}`
const PROJECT = `quota-${RUN}`

let auth: { deviceId: string; userId: string; plan: string }

// `op` es parametro y no una constante: el helper hardcodeaba `'upsert'`, y por eso la
// excepcion del delete -- la garantia mas dura de la spec sobre la cuota -- no tenia como
// testearse desde aca.
const mut = (
  seq: number,
  syncId: string,
  content: string,
  op: 'upsert' | 'delete' = 'upsert'
) => ({
  seq,
  sync_id: syncId,
  op,
  payload: {
    sync_id: syncId,
    project_key: PROJECT,
    project_display_name: PROJECT,
    scope: 'personal',
    type: 'decision',
    topic_key: null,
    title: 'a title',
    content,
    tags: [],
    lamport: 1,
    updated_at: Date.now(),
    created_at: Date.now(),
  },
})

beforeAll(async () => {
  await migrate(pool)
  const userId = randomUUID()
  const deviceId = randomUUID()
  // `free` para que el techo sean 100 MB y no haga falta escribir un giga en un test.
  await pool.query(`insert into users (id, plan) values ($1, 'free')`, [userId])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'quota', $3)`,
    [deviceId, userId, `hash-${deviceId}`]
  )
  auth = { deviceId, userId, plan: 'free' }
})

// Esta suite escribe ~100 MB reales contra la base de test, que persiste entre corridas y
// es compartida con el resto de los archivos de test. Sin esta limpieza cada corrida deja
// 100 MB más para siempre. Sólo borra lo que ESTA suite creó (scoped por auth.userId /
// auth.deviceId), nunca datos de otras suites. Orden: observaciones -> proyecto -> device
// -> usuario, el mismo orden en el que las FK apuntan (aunque el cascade de `projects` ya
// se llevaría las observaciones solo, borrarlas explícito deja la intención clara y no
// depende de que ese cascade se mantenga).
afterAll(async () => {
  await pool.query(
    `delete from observations o using projects p
      where o.project_id = p.id and p.user_id = $1`,
    [auth.userId]
  )
  await pool.query(`delete from projects where user_id = $1`, [auth.userId])
  await pool.query(`delete from devices where id = $1`, [auth.deviceId])
  await pool.query(`delete from users where id = $1`, [auth.userId])
  await pool.end()
})

// La misma suma que usa `push.ts` para decidir `quota_exceeded`, leida desde el test.
async function usedBytes(): Promise<number> {
  const { rows } = await pool.query(
    `select coalesce(sum(octet_length(coalesce(o.content, ''))), 0)::bigint as used
       from observations o join projects p on p.id = o.project_id
      where p.user_id = $1`,
    [auth.userId]
  )
  return Number(rows[0].used)
}

describe('push — la cuota de bytes frena la escritura', () => {
  it('acepta mientras haya lugar', async () => {
    const res = await handlePush(pool, auth, { mutations: [mut(1, SYNC('chica'), 'hola')] })
    expect(res.results[0].outcome).toBe('applied')
  })

  it('rechaza con quota_exceeded cuando el usuario ya paso su techo', async () => {
    // Llenar los 100 MB de Free con observaciones de 1 MB (el tope por observacion).
    const relleno = 'x'.repeat(1024 * 1024)
    for (let i = 0; i < 100; i++) {
      await handlePush(pool, auth, { mutations: [mut(100 + i, SYNC(`relleno-${i}`), relleno)] })
    }

    const res = await handlePush(pool, auth, { mutations: [mut(999, SYNC('tarde'), 'hola')] })
    expect(res.results[0]).toMatchObject({ outcome: 'rejected', error: 'quota_exceeded' })
  }, 120_000)

  // Lo que el producto promete: llegar al techo no le cuesta al usuario NADA de lo que ya
  // tenia guardado.
  it('no borra nada de lo que ya estaba para hacer lugar', async () => {
    const { rows } = await pool.query(
      `select count(*)::int as n from observations o
         join projects p on p.id = o.project_id
        where p.user_id = $1 and o.deleted = false`,
      [auth.userId]
    )
    expect(rows[0].n).toBeGreaterThanOrEqual(100)
  })

  // La otra mitad de esa promesa, y la garantia mas dura de la spec: la cuota llena nunca
  // ENCIERRA al usuario. Un `op: 'delete'` pasa aunque no quede lugar, porque borrar es lo
  // unico que puede bajar el uso — si tambien se frenara, el usuario quedaria sin ninguna
  // forma de recuperar espacio, con la sincronizacion muerta para siempre.
  //
  // Va ultimo a proposito: baja el uso del usuario, asi que correr antes del test de arriba
  // le sacaria una observacion de las que ese cuenta.
  it('deja pasar un delete con la cuota llena, y el uso baja', async () => {
    // Sigue llena: el rechazo de una escritura nueva es la premisa del caso.
    const nueva = await handlePush(pool, auth, {
      mutations: [mut(900, SYNC('sigue-llena'), 'hola')],
    })
    expect(nueva.results[0]).toMatchObject({ outcome: 'rejected', error: 'quota_exceeded' })

    const antes = await usedBytes()
    const res = await handlePush(pool, auth, {
      mutations: [mut(901, SYNC('relleno-0'), '', 'delete')],
    })
    expect(res.results[0].outcome).toBe('applied')

    // No alcanza con que el delete se acepte: tiene que LIBERAR. Un tombstone que dejara el
    // contenido puesto seria una via muerta igual que el rechazo.
    const despues = await usedBytes()
    expect(despues).toBeLessThan(antes)
    expect(antes - despues).toBeGreaterThanOrEqual(1024 * 1024)
  }, 30_000)
})
