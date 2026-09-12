import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { enrollDeviceKey, getKeyState, publishWraps } from '../src/keys'

const pool = getPool()
let userId: string
let deviceA: string
let deviceB: string
const authFor = (deviceId: string) => ({ deviceId, userId, plan: 'pro' })

beforeAll(async () => { await migrate(pool) })

beforeEach(async () => {
  userId = randomUUID()
  deviceA = randomUUID()
  deviceB = randomUUID()
  await pool.query("insert into users (id, plan) values ($1, 'pro')", [userId])
  for (const [id, nombre] of [[deviceA, 'mac'], [deviceB, 'pc']] as const) {
    await pool.query(
      "insert into devices (id, user_id, name, token_hash) values ($1, $2, $3, $4)",
      [id, userId, nombre, 'hash-' + id]
    )
  }
})

describe('/v1/keys', () => {
  it('una cuenta sin cifrado arranca en epoca 0, sin envoltura y sin claves', async () => {
    const estado = await getKeyState(pool, authFor(deviceA))
    expect(estado).toEqual({ keyEpoch: 0, wrap: null, devices: [] })
  })

  it('enrola la publica del dispositivo y la lista para los demas', async () => {
    expect(await enrollDeviceKey(pool, authFor(deviceA), { public_key: 'PUB-A' })).toEqual({ ok: true })
    const estado = await getKeyState(pool, authFor(deviceB))
    expect(estado.devices).toEqual([
      { deviceId: deviceA, name: 'mac', publicKey: 'PUB-A', hasWrap: false },
    ])
  })

  it('re-enrolar el mismo dispositivo pisa su publica, no duplica filas', async () => {
    await enrollDeviceKey(pool, authFor(deviceA), { public_key: 'PUB-A' })
    await enrollDeviceKey(pool, authFor(deviceA), { public_key: 'PUB-A2' })
    const estado = await getKeyState(pool, authFor(deviceA))
    expect(estado.devices).toHaveLength(1)
    expect(estado.devices[0].publicKey).toBe('PUB-A2')
  })

  it('rechaza una publica vacia o que no sea string', async () => {
    expect(await enrollDeviceKey(pool, authFor(deviceA), { public_key: '' }))
      .toEqual({ ok: false, status: 400, error: 'invalid_public_key' })
    expect(await enrollDeviceKey(pool, authFor(deviceA), { public_key: 42 as never }))
      .toEqual({ ok: false, status: 400, error: 'invalid_public_key' })
  })

  it('publicar la epoca 1 activa el cifrado y cada device ve SU envoltura', async () => {
    await enrollDeviceKey(pool, authFor(deviceA), { public_key: 'PUB-A' })
    const res = await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1,
      wraps: [
        { slot: deviceA, kind: 'device', wrapped: 'W-A' },
        { slot: 'recovery', kind: 'recovery', wrapped: 'W-R', wrap_meta: { salt: 'S' } },
      ],
    })
    expect(res).toEqual({ ok: true, keyEpoch: 1 })

    const desdeA = await getKeyState(pool, authFor(deviceA))
    expect(desdeA.keyEpoch).toBe(1)
    expect(desdeA.wrap).toEqual({ wrapped: 'W-A', wrapMeta: null })

    // B todavia no fue autorizado: ve que hay cifrado, pero no tiene con que abrirlo.
    const desdeB = await getKeyState(pool, authFor(deviceB))
    expect(desdeB.keyEpoch).toBe(1)
    expect(desdeB.wrap).toBeNull()
  })

  it('autorizar a B es publicar SU envoltura en la misma epoca', async () => {
    await enrollDeviceKey(pool, authFor(deviceA), { public_key: 'PUB-A' })
    await enrollDeviceKey(pool, authFor(deviceB), { public_key: 'PUB-B' })
    await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1, wraps: [{ slot: deviceA, kind: 'device', wrapped: 'W-A' }],
    })
    await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1, wraps: [{ slot: deviceB, kind: 'device', wrapped: 'W-B' }],
    })
    expect((await getKeyState(pool, authFor(deviceB))).wrap).toEqual({ wrapped: 'W-B', wrapMeta: null })
    // Y A no perdio la suya.
    expect((await getKeyState(pool, authFor(deviceA))).wrap).toEqual({ wrapped: 'W-A', wrapMeta: null })
  })

  it('hasWrap distingue una maquina autorizada de una que espera', async () => {
    await enrollDeviceKey(pool, authFor(deviceA), { public_key: 'PUB-A' })
    await enrollDeviceKey(pool, authFor(deviceB), { public_key: 'PUB-B' })
    await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1, wraps: [{ slot: deviceA, kind: 'device', wrapped: 'W-A' }],
    })
    const porId = new Map((await getKeyState(pool, authFor(deviceA))).devices.map((d) => [d.deviceId, d]))
    expect(porId.get(deviceA)!.hasWrap).toBe(true)
    expect(porId.get(deviceB)!.hasWrap).toBe(false)
  })

  // El 409 que protege al usuario de un cliente confundido: bajar la epoca borraria las
  // envolturas de la maestra vigente y dejaria la memoria de la nube ilegible.
  it('rechaza retroceder de época', async () => {
    await publishWraps(pool, authFor(deviceA), {
      key_epoch: 2, wraps: [{ slot: deviceA, kind: 'device', wrapped: 'W-A' }],
    })
    expect(await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1, wraps: [{ slot: deviceA, kind: 'device', wrapped: 'VIEJA' }],
    })).toEqual({ ok: false, status: 409, error: 'stale_key_epoch' })
    expect((await getKeyState(pool, authFor(deviceA))).wrap).toEqual({ wrapped: 'W-A', wrapMeta: null })
  })

  it('una época NUEVA borra las envolturas de la anterior (rotación)', async () => {
    await enrollDeviceKey(pool, authFor(deviceA), { public_key: 'PUB-A' })
    await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1,
      wraps: [{ slot: deviceA, kind: 'device', wrapped: 'W-A1' }, { slot: deviceB, kind: 'device', wrapped: 'W-B1' }],
    })
    await publishWraps(pool, authFor(deviceA), {
      key_epoch: 2, wraps: [{ slot: deviceA, kind: 'device', wrapped: 'W-A2' }],
    })
    expect((await getKeyState(pool, authFor(deviceA))).wrap).toEqual({ wrapped: 'W-A2', wrapMeta: null })
    // B queda sin envoltura: le sacaron el acceso, que es de lo que trata rotar.
    expect((await getKeyState(pool, authFor(deviceB))).wrap).toBeNull()
  })

  it('rechaza un body sin envolturas o con una época no positiva', async () => {
    expect(await publishWraps(pool, authFor(deviceA), { key_epoch: 1, wraps: [] }))
      .toEqual({ ok: false, status: 400, error: 'no_wraps' })
    expect(await publishWraps(pool, authFor(deviceA), { key_epoch: 0, wraps: [{ slot: deviceA, kind: 'device', wrapped: 'W' }] }))
      .toEqual({ ok: false, status: 400, error: 'invalid_key_epoch' })
  })

  it('no se ven las envolturas ni las claves de otra cuenta', async () => {
    await enrollDeviceKey(pool, authFor(deviceA), { public_key: 'PUB-A' })
    const otroUser = randomUUID()
    const otroDevice = randomUUID()
    await pool.query("insert into users (id, plan) values ($1, 'pro')", [otroUser])
    await pool.query(
      "insert into devices (id, user_id, name, token_hash) values ($1, $2, 'ajeno', $3)",
      [otroDevice, otroUser, 'hash-' + otroDevice]
    )
    const estado = await getKeyState(pool, { deviceId: otroDevice, userId: otroUser })
    expect(estado).toEqual({ keyEpoch: 0, wrap: null, devices: [] })
  })
})

// Lo que la revisión adversarial del 2026-09-12 marcó como crítico: dos máquinas activando
// el cifrado casi a la vez leían las dos `key_epoch = 0`, generaban cada una su PROPIA
// maestra y publicaban época 1. El lock las serializaba pero no decidía: la segunda no era
// `<` (sin 409) ni `>` (sin rotar), así que pisaba el slot de recuperación con el suyo y
// quedaban dos maestras vivas en la misma época.
describe('activar contra autorizar — el empate de época', () => {
  it('una segunda activación con la misma época se rechaza en vez de pisar', async () => {
    const deviceId = deviceA
    const primera = await publishWraps(pool, authFor(deviceId), {
      key_epoch: 1, mode: 'activate',
      wraps: [
        { slot: deviceId, kind: 'device', wrapped: 'w-A' },
        { slot: 'recovery', kind: 'recovery', wrapped: 'r-A', wrap_meta: { salt: 's' } },
      ],
    })
    expect(primera.ok).toBe(true)

    const segunda = await publishWraps(pool, authFor(deviceId), {
      key_epoch: 1, mode: 'activate',
      wraps: [
        { slot: deviceId, kind: 'device', wrapped: 'w-B' },
        { slot: 'recovery', kind: 'recovery', wrapped: 'r-B', wrap_meta: { salt: 's' } },
      ],
    })
    expect(segunda.ok).toBe(false)
    if (!segunda.ok) expect(segunda.error).toBe('stale_key_epoch')

    // Y lo decisivo: la envoltura de recuperación sigue siendo la de la PRIMERA. Si se
    // hubiera pisado, el código que se le mostró a esa máquina ya no abriría nada.
    const { rows } = await pool.query(
      "select wrapped from key_wraps where user_id = $1 and slot = 'recovery'", [userId]
    )
    expect(rows[0]?.wrapped).toBe('r-A')
  })

  it('autorizar con la época vigente sí suma una envoltura, sin rotar', async () => {
    const deviceId = deviceA
    await publishWraps(pool, authFor(deviceId), {
      key_epoch: 1, mode: 'activate',
      wraps: [{ slot: deviceId, kind: 'device', wrapped: 'w-A' }],
    })
    const otra = await publishWraps(pool, authFor(deviceId), {
      key_epoch: 1, mode: 'authorize',
      wraps: [{ slot: deviceB, kind: 'device', wrapped: 'w-2' }],
    })
    expect(otra.ok).toBe(true)
    const { rows } = await pool.query(
      'select count(*)::int as n from key_wraps where user_id = $1', [userId]
    )
    expect(rows[0].n).toBe(2)
  })

  // Autorizar sobre una cuenta que nunca activó escribía envolturas huérfanas que después
  // nadie podía usar.
  it('autorizar sobre una cuenta sin activar se rechaza', async () => {
    const res = await publishWraps(pool, authFor(deviceA), {
      key_epoch: 0, mode: 'authorize',
      wraps: [{ slot: deviceA, kind: 'device', wrapped: 'w' }],
    })
    expect(res.ok).toBe(false)
  })
})
