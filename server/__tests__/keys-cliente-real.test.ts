/**
 * El cliente REAL contra el servidor REAL, sin dobles en el medio.
 *
 * Existe por una lección concreta: el servidor de mentira de
 * `electron/__tests__/memory-keys-client.test.ts` aceptaba cualquier publish —sin `mode`, sin
 * prueba de posesión— así que los tests del cliente quedaban en verde mientras el servidor
 * de verdad rechazaba el camino de recuperación con un 403. Un doble que perdona más que el
 * original prueba el doble, no el contrato.
 *
 * Acá `fetchImpl` rutea a `enrollDeviceKey`/`getKeyState`/`publishWraps` de verdad, igual que
 * `src/http.ts`, contra el Postgres de desarrollo. Si una regla del servidor se endurece y el
 * cliente no se entera, esto se pone rojo — que es lo que no pasó las dos veces anteriores.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { enrollDeviceKey, getKeyState, publishWraps } from '../src/keys'
import {
  activateEncryption, recoverWithCode, adoptExistingKey, authorizeDevice,
  type KeysClientDeps,
} from '../../electron/memory-keys-client'
import { generateDeviceKeyPair } from '../../electron/memory-key-wrap'

const pool = getPool()
let userId: string

// Un "servidor" que rutea al codigo REAL, como lo hace src/http.ts.
const depsPara = (deviceId: string): KeysClientDeps => ({
  baseUrl: 'http://x.test', token: 't', deviceId,
  fetchImpl: (async (url: string, init?: RequestInit) => {
    const u = new URL(url)
    const auth = { deviceId, userId }
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    const ok = (j: unknown) => ({ ok: true, status: 200, json: async () => j } as unknown as Response)
    if (u.pathname === '/v1/keys/enroll') {
      const r = await enrollDeviceKey(pool, auth, body)
      return r.ok ? ok(r) : { ok: false, status: r.status, json: async () => ({ error: r.error }) } as unknown as Response
    }
    if (u.pathname === '/v1/keys') {
      return ok(await getKeyState(pool, auth, u.searchParams.get('slot') ?? undefined))
    }
    if (u.pathname === '/v1/keys/publish') {
      const r = await publishWraps(pool, auth, body)
      return r.ok ? ok({ ok: true, key_epoch: r.keyEpoch })
                  : { ok: false, status: r.status, json: async () => ({ error: r.error }) } as unknown as Response
    }
    return { ok: false, status: 404, json: async () => ({ error: 'nf' }) } as unknown as Response
  }) as unknown as typeof fetch,
})

beforeAll(async () => { await migrate(pool) })
beforeEach(async () => {
  userId = randomUUID()
  await pool.query("insert into users (id, plan) values ($1,'pro')", [userId])
})

const nuevoDevice = async (nombre: string) => {
  const id = randomUUID()
  await pool.query("insert into devices (id,user_id,name,token_hash) values ($1,$2,$3,$4)", [id, userId, nombre, 'h-' + id])
  return id
}

describe('los tres caminos del cliente contra el servidor REAL', () => {
  it('activar, autorizar a otra, y que la otra adopte', async () => {
    const idA = await nuevoDevice('mac'); const idB = await nuevoDevice('pc')
    const parA = generateDeviceKeyPair(); const parB = generateDeviceKeyPair()

    const act = await activateEncryption(depsPara(idA), parA)
    expect(act.keyEpoch).toBe(1)

    // B publica su publica y todavia no tiene envoltura.
    expect(await adoptExistingKey(depsPara(idB), parB)).toBeNull()

    // A la autoriza.
    const estado = await getKeyState(pool, { deviceId: idA, userId })
    const target = estado.devices.find((d) => d.deviceId === idB)!
    await authorizeDevice(depsPara(idA), act.master, act.keyEpoch, target)

    const adoptada = await adoptExistingKey(depsPara(idB), parB)
    expect(adoptada?.master, 'B toma exactamente la maestra de A').toBe(act.master)
  })

  it('recuperar con el codigo cuando no queda ninguna maquina viva (D8)', async () => {
    const idA = await nuevoDevice('la-que-murio')
    const parA = generateDeviceKeyPair()
    const act = await activateEncryption(depsPara(idA), parA)

    // Maquina nueva, sin envoltura, con el codigo anotado en un papel.
    const idNueva = await nuevoDevice('la-nueva')
    const parNueva = generateDeviceKeyPair()
    const rec = await recoverWithCode(depsPara(idNueva), parNueva, act.recoveryCode)
    expect(rec.master, 'la recuperacion devuelve la maestra original').toBe(act.master)

    // Y quedo auto-autorizada: el proximo arranque no vuelve a pedir el codigo.
    const otraVez = await adoptExistingKey(depsPara(idNueva), parNueva)
    expect(otraVez?.master).toBe(act.master)
  })
})
