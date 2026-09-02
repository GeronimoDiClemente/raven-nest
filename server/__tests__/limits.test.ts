import { describe, it, expect } from 'vitest'
import { limitsFor } from '../src/limits'

describe('limitsFor', () => {
  it('da a Free un solo proyecto en la nube y el intervalo lento', () => {
    expect(limitsFor('free')).toMatchObject({
      maxProjects: 1,
      maxDevices: 3,
      maxBytes: 100 * 1024 * 1024,
      nextPollMs: 900_000,
      teamScope: false,
    })
  })

  it('da a Cloud proyectos de sobra, 1 GiB y el intervalo rápido', () => {
    expect(limitsFor('cloud')).toMatchObject({
      maxProjects: 100,
      maxDevices: 10,
      maxBytes: 1024 ** 3,
      nextPollMs: 300_000,
      teamScope: false,
    })
  })

  it('sólo Teams y Enterprise pueden escribir memoria compartida', () => {
    expect(limitsFor('team').teamScope).toBe(true)
    expect(limitsFor('enterprise').teamScope).toBe(true)
    expect(limitsFor('cloud').teamScope).toBe(false)
    expect(limitsFor('free').teamScope).toBe(false)
  })

  // El rename pro -> cloud es del plan siguiente. Hasta entonces el unico usuario `pro`
  // que existe tiene que seguir teniendo nube.
  it('trata a pro igual que a cloud mientras dure la transicion', () => {
    expect(limitsFor('pro')).toEqual(limitsFor('cloud'))
  })

  // Fallar cerrado: un plan que no conocemos no puede heredar los limites del plan pago.
  it('manda cualquier plan desconocido a los limites de Free', () => {
    expect(limitsFor('plan_que_no_existe')).toEqual(limitsFor('free'))
    expect(limitsFor('')).toEqual(limitsFor('free'))
  })
})
