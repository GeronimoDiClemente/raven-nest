import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'
import { purgeTombstones } from '../src/purge'

const pool = getPool()
const RUN = randomUUID().slice(0, 8)
const SYNC = (id: string) => `${RUN}-${id}`

let auth: { deviceId: string; userId: string; plan: string }

beforeAll(async () => {
  await migrate(pool)
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'pro')`, [userId])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'purge', $3)`,
    [deviceId, userId, `hash-${deviceId}`]
  )
  auth = { deviceId, userId, plan: 'pro' }
})
afterAll(async () => { await pool.end() })

const mutation = (
  seq: number,
  syncId: string,
  projectKey: string,
  op: 'upsert' | 'delete',
  content: string | null
) => ({
  seq,
  sync_id: syncId,
  op,
  payload: {
    sync_id: syncId, project_key: projectKey, project_display_name: projectKey,
    scope: 'personal', type: 'decision', topic_key: null, title: syncId,
    content, tags: [], lamport: 1, updated_at: Date.now(), created_at: Date.now(),
  },
})

// Simula el paso del tiempo pisando el reloj del servidor directo en la fila, ya que no
// podemos esperar 90 dias de verdad. `column` está acotada a las dos columnas de fecha que
// estos tests necesitan mover, no a input arbitrario.
async function backdate(
  syncId: string,
  column: 'server_created_at' | 'tombstoned_at',
  daysAgo: number
) {
  await pool.query(
    `update observations set ${column} = now() - ($2 || ' days')::interval where sync_id = $1`,
    [syncId, String(daysAgo)]
  )
}

describe('purgeTombstones', () => {
  // Reproduce el bug del revisor: medir la antigüedad con server_created_at (la fecha en
  // que nació la MEMORIA) en vez de tombstoned_at (la fecha en que se volvió tombstone) hace
  // que una observación vieja, recién borrada, se purgue como si el tombstone tuviera 90
  // días cuando en realidad tiene uno. Pasa por handlePush de punta a punta -- ni la
  // creación ni el borrado son SQL directo -- porque el bug vive exactamente en ese camino
  // (el `on conflict` de push.ts).
  it('no purga un tombstone recien creado aunque la observacion original sea vieja', async () => {
    const p = `purge-${randomUUID().slice(0, 8)}`
    const syncId = SYNC('old-memory')
    await handlePush(pool, auth, { mutations: [mutation(700, syncId, p, 'upsert', 'contenido viejo')] })
    // La memoria "nació" hace 200 días -- mucho más vieja que la ventana de 90 -- pero
    // todavía está VIVA en este punto.
    await backdate(syncId, 'server_created_at', 200)

    // El borrado pasa HOY, por el camino real. tombstoned_at se estampa fresco: es la
    // fecha del BORRADO la que tiene que importar, no la de la memoria original.
    await handlePush(pool, auth, { mutations: [mutation(701, syncId, p, 'delete', null)] })
    await purgeTombstones(pool, 90)

    const { rows } = await pool.query('select 1 from observations where sync_id = $1', [syncId])
    expect(rows).toHaveLength(1) // el tombstone tiene un día de vida: no se purga
  })

  it('purga un tombstone cuyo tombstoned_at es mas viejo que la ventana', async () => {
    const p = `purge-${randomUUID().slice(0, 8)}`
    const syncId = SYNC('old-tombstone')
    await handlePush(pool, auth, { mutations: [mutation(710, syncId, p, 'upsert', 'x')] })
    await handlePush(pool, auth, { mutations: [mutation(711, syncId, p, 'delete', null)] })
    // Simula que el borrado pasó hace 120 días, no hoy.
    await backdate(syncId, 'tombstoned_at', 120)

    const borradas = await purgeTombstones(pool, 90)
    expect(borradas).toBeGreaterThanOrEqual(1)
    const { rows } = await pool.query('select 1 from observations where sync_id = $1', [syncId])
    expect(rows).toHaveLength(0)
  })

  // Lo único que importa de verdad: la purga no puede tocar memoria VIVA por vieja que sea.
  it('nunca borra una observacion viva, por mas antigua que sea', async () => {
    const p = `purge-${randomUUID().slice(0, 8)}`
    const syncId = SYNC('viva')
    await handlePush(pool, auth, { mutations: [mutation(720, syncId, p, 'upsert', 'x')] })
    await backdate(syncId, 'server_created_at', 5000)

    await purgeTombstones(pool, 90)
    const { rows } = await pool.query('select 1 from observations where sync_id = $1', [syncId])
    expect(rows).toHaveLength(1)
  })

  // Fija la opción segura ya implementada (ronda de arreglo 2): esta fila no debería existir
  // en operación normal -- el `on conflict` de push.ts siempre estampa `tombstoned_at` en la
  // transición a `deleted` -- pero si igual apareciera (un bug en otro lado, una migración
  // salteada), la purga no debe interpretar "no sé desde cuándo" como "hace mucho".
  it('un tombstone con tombstoned_at nulo sobrevive a la purga', async () => {
    const p = `purge-${randomUUID().slice(0, 8)}`
    const syncId = SYNC('null-tombstoned-at')
    await handlePush(pool, auth, { mutations: [mutation(730, syncId, p, 'upsert', 'x')] })
    await handlePush(pool, auth, { mutations: [mutation(731, syncId, p, 'delete', null)] })
    // Fuerza el estado que push.ts nunca debería dejar: tombstone sin sello.
    await pool.query('update observations set tombstoned_at = null where sync_id = $1', [syncId])

    await purgeTombstones(pool, 90)
    const { rows } = await pool.query('select 1 from observations where sync_id = $1', [syncId])
    expect(rows).toHaveLength(1)
  })
})
