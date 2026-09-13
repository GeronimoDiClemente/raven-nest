import { describe, it, expect, beforeEach } from 'vitest'
import { generateDeviceKeyPair, unwrapWithDevice, MemoryUnwrapError } from '../memory-key-wrap'
import {
  enrollPublicKey, fetchKeyState, activateEncryption, adoptExistingKey,
  authorizeDevice, recoverWithCode, KeysHttpError, type KeysClientDeps,
} from '../memory-keys-client'

// Servidor de mentira con la MISMA semantica que server/src/keys.ts: una epoca por cuenta,
// un slot por destinatario, y rotar borra las envolturas viejas.
function servidorFalso() {
  const wraps = new Map<string, { wrapped: string; wrapMeta: Record<string, unknown> | null }>()
  const publicas = new Map<string, string>()
  let keyEpoch = 0
  // Lo que el servidor real guarda en `users.rotate_verifier`: el verificador de la maestra
  // vigente. Es contra esto que se compara la prueba de posesion.
  let verificador: string | null = null
  const llamadas: string[] = []

  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const parsed = new URL(url)
    const path = parsed.pathname
    llamadas.push(path)
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json } as unknown as Response)

    if (path === '/v1/keys/enroll') {
      publicas.set(body.device_id_test, body.public_key)
      return ok({ ok: true })
    }
    if (path === '/v1/keys') {
      // El servidor real rutea por `pathname`, asi que el query no cambia la ruta — pero SI
      // elige de que slot es la envoltura que devuelve. Sin esto el doble ignora
      // `?slot=recovery` y la recuperacion "no funciona" por culpa del doble, no del codigo.
      const slot = parsed.searchParams.get('slot')
      const yo = slot ?? (init as { headers?: Record<string, string> })?.headers?.['X-Device-Test'] ?? ''
      return ok({
        keyEpoch,
        wrap: wraps.get(yo) ?? null,
        devices: [...publicas].map(([deviceId, publicKey]) => ({
          deviceId, name: deviceId, publicKey, hasWrap: wraps.has(deviceId),
        })),
      })
    }
    if (path === '/v1/keys/publish') {
      /**
       * Las MISMAS reglas que `server/src/keys.ts`, y no una version relajada.
       *
       * Este doble aceptaba cualquier publish: sin `mode`, sin prueba de posesion, y dejando
       * que una maquina se escribiera su propio slot. Asi, los tests del cliente quedaron en
       * verde mientras el servidor real rechazaba el camino de recuperacion con un 403 —
       * el unico camino que queda cuando no hay ninguna maquina viva. Un doble que perdona
       * mas que el original no prueba el contrato: prueba el doble.
       */
      const fallo = (status: number, error: string) =>
        ({ ok: false, status, json: async () => ({ error }) } as unknown as Response)
      if (body.mode !== 'activate' && body.mode !== 'authorize') return fallo(400, 'invalid_mode')
      if (body.mode === 'activate' && body.key_epoch !== keyEpoch + 1) return fallo(409, 'stale_key_epoch')
      if (body.mode === 'authorize' && (body.key_epoch !== keyEpoch || keyEpoch === 0)) {
        return fallo(409, keyEpoch === 0 ? 'not_activated' : 'stale_key_epoch')
      }
      const pruebaOk = Boolean(verificador) && body.rotate_proof === verificador
      if (body.mode === 'activate' && keyEpoch > 0 && !pruebaOk) return fallo(403, 'not_authorized_to_rotate')
      if (body.mode === 'authorize') {
        const yo = (init as { headers?: Record<string, string> })?.headers?.['X-Device-Test'] ?? ''
        for (const w of body.wraps) {
          if (w.slot === 'recovery' || w.kind === 'recovery') return fallo(403, 'cannot_overwrite_recovery')
          if (w.slot === yo && !pruebaOk) return fallo(403, 'cannot_authorize_self')
        }
      }
      if (body.key_epoch > keyEpoch) {
        wraps.clear()
        keyEpoch = body.key_epoch
        verificador = typeof body.rotate_verifier === 'string' ? body.rotate_verifier : null
      }
      for (const w of body.wraps) wraps.set(w.slot, { wrapped: w.wrapped, wrapMeta: w.wrap_meta ?? null })
      return ok({ ok: true, key_epoch: keyEpoch })
    }
    return { ok: false, status: 404, json: async () => ({ error: 'not_found' }) } as unknown as Response
  }) as unknown as typeof fetch

  return {
    fetchImpl, wraps, publicas, llamadas,
    get epoch() { return keyEpoch },
    get verificador() { return verificador },
  }
}

let srv: ReturnType<typeof servidorFalso>
const depsDe = (deviceId: string): KeysClientDeps =>
  ({ baseUrl: 'http://sync.test', token: 'nmk_x', deviceId, fetchImpl: srv.fetchImpl })

beforeEach(() => { srv = servidorFalso() })

describe('activar el cifrado', () => {
  it('genera maestra, la envuelve para este device y para el código, y publica época 1', async () => {
    const device = generateDeviceKeyPair()
    srv.publicas.set('mac', device.publicKey)
    const res = await activateEncryption(depsDe('mac'), device)

    expect(res.keyEpoch).toBe(1)
    expect(Buffer.from(res.master, 'base64').length).toBe(32)
    expect(res.recoveryCode).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){5}$/)

    // La envoltura del device abre y da EXACTAMENTE la maestra que devolvio.
    const wrap = srv.wraps.get('mac')!
    expect(unwrapWithDevice(device.privateKey, wrap.wrapped).toString('base64')).toBe(res.master)
    // Y hay una de recuperacion, con su sal.
    expect(srv.wraps.get('recovery')!.wrapMeta).toHaveProperty('salt')
  })

  it('enrola la pública antes de publicar — un device sin pública no se puede autorizar', async () => {
    const device = generateDeviceKeyPair()
    await activateEncryption(depsDe('mac'), device)
    expect(srv.llamadas[0]).toBe('/v1/keys/enroll')
  })

  it('la maestra NUNCA viaja en claro', async () => {
    const device = generateDeviceKeyPair()
    const res = await activateEncryption(depsDe('mac'), device)
    for (const w of srv.wraps.values()) {
      expect(w.wrapped).not.toContain(res.master)
    }
  })
})

describe('adoptar la clave que ya existe', () => {
  it('un device con envoltura la desenvuelve y obtiene la maestra', async () => {
    const mac = generateDeviceKeyPair()
    srv.publicas.set('mac', mac.publicKey)
    const activada = await activateEncryption(depsDe('mac'), mac)
    const adoptada = await adoptExistingKey(depsDe('mac'), mac)
    expect(adoptada).toEqual({ master: activada.master, keyEpoch: 1 })
  })

  it('un device sin envoltura devuelve null — no lanza, está esperando autorización', async () => {
    const mac = generateDeviceKeyPair()
    const pc = generateDeviceKeyPair()
    await activateEncryption(depsDe('mac'), mac)
    expect(await adoptExistingKey(depsDe('pc'), pc)).toBeNull()
    // Y de paso dejo publicada MI publica, para que la Mac me pueda autorizar.
    expect(srv.publicas.get('pc')).toBe(pc.publicKey)
  })

  it('una cuenta sin cifrado devuelve null', async () => {
    const mac = generateDeviceKeyPair()
    expect(await adoptExistingKey(depsDe('mac'), mac)).toBeNull()
  })
})

describe('autorizar una segunda máquina', () => {
  it('la Mac envuelve para la PC y la PC la abre', async () => {
    const mac = generateDeviceKeyPair()
    const pc = generateDeviceKeyPair()
    const { master, keyEpoch } = await activateEncryption(depsDe('mac'), mac)
    await adoptExistingKey(depsDe('pc'), pc) // la PC publica su publica

    await authorizeDevice(depsDe('mac'), master, keyEpoch, { deviceId: 'pc', publicKey: pc.publicKey })

    expect(await adoptExistingKey(depsDe('pc'), pc)).toEqual({ master, keyEpoch })
  })

  it('autorizar no le saca la envoltura a las máquinas que ya la tenían', async () => {
    const mac = generateDeviceKeyPair()
    const pc = generateDeviceKeyPair()
    const { master, keyEpoch } = await activateEncryption(depsDe('mac'), mac)
    await authorizeDevice(depsDe('mac'), master, keyEpoch, { deviceId: 'pc', publicKey: pc.publicKey })
    expect(await adoptExistingKey(depsDe('mac'), mac)).toEqual({ master, keyEpoch })
    // Y no rotó: sigue en la epoca 1.
    expect(srv.epoch).toBe(1)
  })
})

describe('recuperar con el código', () => {
  it('una máquina nueva recupera la maestra y se auto-autoriza', async () => {
    const mac = generateDeviceKeyPair()
    const pc = generateDeviceKeyPair()
    const { master, recoveryCode } = await activateEncryption(depsDe('mac'), mac)

    const rec = await recoverWithCode(depsDe('pc'), pc, recoveryCode)
    expect(rec).toEqual({ master, keyEpoch: 1 })
    // Se dejó su propia envoltura, asi que el proximo arranque no vuelve a pedir el codigo.
    expect(await adoptExistingKey(depsDe('pc'), pc)).toEqual({ master, keyEpoch: 1 })
  })

  it('acepta el código tipeado con minúsculas y sin guiones', async () => {
    const mac = generateDeviceKeyPair()
    const pc = generateDeviceKeyPair()
    const { master, recoveryCode } = await activateEncryption(depsDe('mac'), mac)
    const rec = await recoverWithCode(depsDe('pc'), pc, recoveryCode.toLowerCase().replace(/-/g, ''))
    expect(rec.master).toBe(master)
  })

  it('un código equivocado lanza MemoryUnwrapError y no publica nada', async () => {
    const mac = generateDeviceKeyPair()
    const pc = generateDeviceKeyPair()
    await activateEncryption(depsDe('mac'), mac)
    const antes = srv.wraps.size
    await expect(recoverWithCode(depsDe('pc'), pc, 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF'))
      .rejects.toBeInstanceOf(MemoryUnwrapError)
    expect(srv.wraps.size).toBe(antes)
  })

  it('sin envoltura de recuperación en el servidor, lanza con un mensaje propio', async () => {
    const pc = generateDeviceKeyPair()
    await expect(recoverWithCode(depsDe('pc'), pc, 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF'))
      .rejects.toThrow(/no hay una copia de recuperación/i)
  })
})

describe('errores HTTP', () => {
  it('un 4xx sale como KeysHttpError con su status', async () => {
    const deps: KeysClientDeps = {
      baseUrl: 'http://sync.test', token: 'nmk_x', deviceId: 'mac',
      fetchImpl: (async () => ({ ok: false, status: 403, json: async () => ({ error: 'plan_required' }) })) as unknown as typeof fetch,
    }
    await expect(fetchKeyState(deps)).rejects.toMatchObject({ name: 'KeysHttpError', status: 403 })
  })

  it('enrollPublicKey propaga el error en vez de tragárselo', async () => {
    const deps: KeysClientDeps = {
      baseUrl: 'http://sync.test', token: 'nmk_x', deviceId: 'mac',
      fetchImpl: (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch,
    }
    await expect(enrollPublicKey(deps, 'PUB')).rejects.toBeInstanceOf(KeysHttpError)
  })
})
