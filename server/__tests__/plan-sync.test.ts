// Spec 2b-2 §4.5: la firma del aviso de plan y la lectura del cuerpo. Puro: sin Postgres.
import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { leerAvisoDePlan, verificarFirmaDePlan, VENTANA_DE_FIRMA_SEG } from '../src/plan-sync'

const SECRETO = 'test-secret'
const T = 1_700_000_000
const CUERPO = '{"user_id":"00000000-0000-4000-8000-000000000001","plan":"cloud"}'
// D13: el MISMO vector que fija el firmador del webhook (aviso-de-plan.test.ts).
const V1_DEL_VECTOR = '8b149a93534d60ed7fb23268c484647e3a5a939afa9a2fe94402be2161e7fee8'
const firmar = (cuerpo: string, t = T, secreto = SECRETO) =>
  `t=${t},v1=${createHmac('sha256', secreto).update(`${t}.${cuerpo}`).digest('hex')}`

describe('verificarFirmaDePlan', () => {
  it('acepta el vector fijo compartido con el webhook', () => {
    expect(verificarFirmaDePlan(`t=${T},v1=${V1_DEL_VECTOR}`, CUERPO, SECRETO, T)).toBe(true)
  })

  it('acepta dentro de la ventana de 300 s, para los dos lados', () => {
    expect(verificarFirmaDePlan(firmar(CUERPO), CUERPO, SECRETO, T + VENTANA_DE_FIRMA_SEG)).toBe(true)
    expect(verificarFirmaDePlan(firmar(CUERPO), CUERPO, SECRETO, T - VENTANA_DE_FIRMA_SEG)).toBe(true)
  })

  it('rechaza una firma vieja (> 300 s)', () => {
    expect(verificarFirmaDePlan(firmar(CUERPO), CUERPO, SECRETO, T + VENTANA_DE_FIRMA_SEG + 1)).toBe(false)
  })

  it('rechaza una firma inválida, de otro secreto o de otro cuerpo', () => {
    expect(verificarFirmaDePlan(`t=${T},v1=${'0'.repeat(64)}`, CUERPO, SECRETO, T)).toBe(false)
    expect(verificarFirmaDePlan(firmar(CUERPO, T, 'otro'), CUERPO, SECRETO, T)).toBe(false)
    expect(verificarFirmaDePlan(firmar(CUERPO), CUERPO.replace('cloud', 'team'), SECRETO, T)).toBe(false)
  })

  it('rechaza sin cabecera, sin secreto o con cabecera mal formada', () => {
    expect(verificarFirmaDePlan(undefined, CUERPO, SECRETO, T)).toBe(false)
    expect(verificarFirmaDePlan(firmar(CUERPO), CUERPO, '', T)).toBe(false)
    for (const mala of ['', 'v1=abc', `t=${T}`, `t=abc,v1=${V1_DEL_VECTOR}`, `t=${T},v1=zz`, `t=${T},v1=${V1_DEL_VECTOR}00`]) {
      expect(verificarFirmaDePlan(mala, CUERPO, SECRETO, T)).toBe(false)
    }
  })

  // Review Focus 2: el HMAC es sobre los bytes que llegaron, no sobre un JSON re-serializado.
  it('un cuerpo con espacios y claves en otro orden, firmado tal cual, pasa', () => {
    const crudo = '{ "plan" : "cloud",\n  "user_id": "00000000-0000-4000-8000-000000000001" }'
    expect(verificarFirmaDePlan(firmar(crudo), crudo, SECRETO, T)).toBe(true)
  })
})

describe('leerAvisoDePlan', () => {
  it('lee user_id y plan', () => {
    expect(leerAvisoDePlan(CUERPO)).toEqual({ ok: true, aviso: { userId: '00000000-0000-4000-8000-000000000001', plan: 'cloud' } })
  })

  // Review Focus 5: entrada rota es 400, nunca 500.
  it('JSON roto o que no es objeto: bad_json', () => {
    for (const c of ['', '{', 'null', '[]', '"x"']) expect(leerAvisoDePlan(c)).toEqual({ ok: false, error: 'bad_json' })
  })

  it('user_id que no es uuid: invalid_user_id', () => {
    for (const id of ['', 'u-1', 42, null, "'; drop table users;--"]) {
      expect(leerAvisoDePlan(JSON.stringify({ user_id: id, plan: 'cloud' }))).toEqual({ ok: false, error: 'invalid_user_id' })
    }
  })

  it('plan fuera de CLOUD_PLANS: invalid_plan', () => {
    for (const plan of ['diamante', '', 'CLOUD', 3]) {
      expect(leerAvisoDePlan(JSON.stringify({ user_id: '00000000-0000-4000-8000-000000000001', plan }))).toEqual({ ok: false, error: 'invalid_plan' })
    }
  })
})
