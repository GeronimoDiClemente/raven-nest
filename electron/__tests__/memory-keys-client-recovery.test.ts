import { describe, it, expect } from 'vitest'
import { regenerateRecoveryCode } from '../memory-keys-client'
import { generateMasterKey, rotateVerifier } from '../memory-crypto'
import { unwrapWithRecovery } from '../memory-key-wrap'

describe('regenerateRecoveryCode', () => {
  it('publica en modo recovery un wrap que abre con el código devuelto, con la prueba de la maestra', async () => {
    const master = generateMasterKey()
    let cuerpo: Record<string, any> = {}
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      cuerpo = JSON.parse(String(init?.body))
      return { ok: true, status: 200, json: async () => ({ ok: true, keyEpoch: 3 }) } as unknown as Response
    }) as unknown as typeof fetch
    const codigo = await regenerateRecoveryCode(
      { baseUrl: 'http://sync.test', token: 't', deviceId: 'd', fetchImpl }, master.toString('base64'), 3)

    expect(cuerpo.mode).toBe('recovery')
    expect(cuerpo.key_epoch).toBe(3)
    expect(cuerpo.rotate_proof).toBe(rotateVerifier(master, 3))
    expect(cuerpo.wraps).toHaveLength(1)
    expect(cuerpo.wraps[0]).toMatchObject({ slot: 'recovery', kind: 'recovery' })
    const abierta = unwrapWithRecovery(codigo, { wrapped: cuerpo.wraps[0].wrapped, salt: cuerpo.wraps[0].wrap_meta.salt })
    expect(abierta.equals(master)).toBe(true)
  })
})
