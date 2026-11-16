// Spec 2b-2 §4.8: cuándo un cambio de plan merece el aviso y cuándo sólo un status nuevo.
import { describe, it, expect } from 'vitest'
import { cambioDePlan, esPlanPago } from '../../lib/cambio-de-plan'

describe('cambioDePlan', () => {
  it('de un no-pago a cloud: activado', () => {
    expect(cambioDePlan('free', 'cloud')).toBe('activado')
  })

  // Review Focus 1: la primera lectura no es un cambio.
  it('sin plan anterior (primera lectura) no es un cambio', () => {
    expect(cambioDePlan(null, 'cloud')).toBeNull()
    expect(cambioDePlan(null, 'free')).toBeNull()
  })

  it('de un pago a free: bajado', () => {
    expect(cambioDePlan('cloud', 'free')).toBe('bajado')
    expect(cambioDePlan('pro', 'free')).toBe('bajado')
  })

  it('sin cambio, o entre pagos, o de free a team: nada', () => {
    expect(cambioDePlan('cloud', 'cloud')).toBeNull()
    expect(cambioDePlan('pro', 'cloud')).toBeNull()
    expect(cambioDePlan('free', 'team')).toBeNull()
  })

  it('esPlanPago', () => {
    for (const p of ['cloud', 'pro', 'team', 'enterprise']) expect(esPlanPago(p)).toBe(true)
    for (const p of ['free', 'diamante', '']) expect(esPlanPago(p)).toBe(false)
  })
})
