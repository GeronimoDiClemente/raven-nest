import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'
import { handleStatus } from '../src/status'

// `MAX_BYTES_PER_USER` cambiaba lo que `GET /v1/sync/status` INFORMA como `quota.max_bytes`,
// pero el rechazo por cuota de `push.ts` comparaba contra `limitsFor(plan).maxBytes` directo
// y nunca la leia: una instancia dedicada que la subiera mostraba una cuota grande y seguia
// frenando al tope del plan. Ahora los dos caminos resuelven el techo por `maxBytesFor`.
//
// Los casos de acá bajan el techo en vez de subirlo, a proposito: subirlo por encima de los
// 100 MiB de Free y despues probar que el push pasa costaria escribir 100 MB reales en cada
// corrida. Bajarlo prueba exactamente lo mismo — que `push` LEE el override — porque con el
// plan solo esas mutaciones estarian holgadamente adentro. El ultimo caso ademas sube el
// techo (desde uno ya excedido) y muestra que el push se destraba, que es la direccion que
// le importa a una instancia dedicada.
const pool = getPool()
const RUN = randomUUID().slice(0, 8)
const SYNC = (id: string) => `${RUN}-${id}`
const PROJECT = `maxbytes-${RUN}`

let auth: { deviceId: string; userId: string; plan: string }
const original = process.env.MAX_BYTES_PER_USER

const mut = (seq: number, syncId: string, content: string) => ({
  seq,
  sync_id: syncId,
  op: 'upsert' as const,
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
  // `free`: 100 MiB de techo por plan, o sea que sin override todo lo que se escribe acá
  // (unas decenas de bytes) entra holgado. Cualquier rechazo por cuota es, entonces, el
  // override haciendo efecto y nada más.
  await pool.query(`insert into users (id, plan) values ($1, 'free')`, [userId])
  await pool.query(
    `insert into devices (id, user_id, name, token_hash) values ($1, $2, 'maxbytes', $3)`,
    [deviceId, userId, `hash-${deviceId}`]
  )
  auth = { deviceId, userId, plan: 'free' }
})

afterEach(() => {
  if (original === undefined) delete process.env.MAX_BYTES_PER_USER
  else process.env.MAX_BYTES_PER_USER = original
})

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

describe('MAX_BYTES_PER_USER — el override aplica, no sólo se muestra', () => {
  it('sin override manda el plan, y push y status coinciden', async () => {
    delete process.env.MAX_BYTES_PER_USER

    const res = await handlePush(pool, auth, { mutations: [mut(1, SYNC('base'), 'x'.repeat(64))] })
    expect(res.results[0].outcome).toBe('applied')

    const status = await handleStatus(pool, auth)
    expect(status.quota.max_bytes).toBe(100 * 1024 * 1024)
    expect(status.quota.used_bytes).toBeGreaterThanOrEqual(64)
  })

  it('con el override por debajo del uso, el PUSH frena — no sólo el número de status', async () => {
    process.env.MAX_BYTES_PER_USER = '10'

    const status = await handleStatus(pool, auth)
    expect(status.quota.max_bytes).toBe(10)

    // Con el techo del plan (100 MiB) esta mutación entraría sin problema: que rebote es la
    // prueba de que `push` lee el mismo override que `status` informa.
    const res = await handlePush(pool, auth, { mutations: [mut(2, SYNC('frenada'), 'hola')] })
    expect(res.results[0]).toMatchObject({ outcome: 'rejected', error: 'quota_exceeded' })
  })

  it('subir el override destraba el push que el override chico frenaba', async () => {
    process.env.MAX_BYTES_PER_USER = String(10 * 1024 * 1024)

    const res = await handlePush(pool, auth, { mutations: [mut(3, SYNC('destrabada'), 'hola')] })
    expect(res.results[0].outcome).toBe('applied')
  })

  it('un override invalido cae al plan en los dos caminos, no a 1 GiB', async () => {
    process.env.MAX_BYTES_PER_USER = 'abc'

    // El fallback viejo era 1 GiB fijo: un typo en el env le reportaba a esta cuenta Free
    // diez veces su techo real.
    const status = await handleStatus(pool, auth)
    expect(status.quota.max_bytes).toBe(100 * 1024 * 1024)

    const res = await handlePush(pool, auth, { mutations: [mut(4, SYNC('typo'), 'hola')] })
    expect(res.results[0].outcome).toBe('applied')
  })
})
