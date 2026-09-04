import { describe, it, expect, afterEach } from 'vitest'
import { limitsFor, maxBytesFor, resolveMaxBytes } from '../src/limits'

const GIB = 1024 ** 3
const FREE_BYTES = 100 * 1024 * 1024

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

// Estos tests vivian en status.test.ts y afirmaban el fallback VIEJO (1 GiB fijo). Cambiaron
// junto con la regla: `resolveMaxBytes` ya no tiene una constante propia, ahora recibe el
// techo del plan y cae a EL. El fallback viejo no era neutral — con `MAX_BYTES_PER_USER=abc`
// TODO plan reportaba 1 GiB, Free (100 MiB) incluido, o sea que un typo en el env AFLOJABA
// el techo en vez de ignorarse. El README ya decia "se ignora y cae al plan"; ahora es
// verdad.
describe('resolveMaxBytes', () => {
  it('toma un valor sano del env', () => {
    expect(resolveMaxBytes('2048', FREE_BYTES)).toBe(2048)
    expect(resolveMaxBytes(String(GIB * 2), FREE_BYTES)).toBe(GIB * 2)
  })

  it('cae al limite del PLAN con cualquier valor invalido, vacio o <= 0', () => {
    for (const bad of [undefined, '', '   ', '1gb', 'lots', 'NaN', '-1', '0', 'Infinity']) {
      expect([bad, resolveMaxBytes(bad, FREE_BYTES)]).toEqual([bad, FREE_BYTES])
    }
  })

  // Lo que el fallback viejo rompia: el techo al que se cae depende del plan, no es uno solo.
  it('el fallback es POR PLAN: un env roto no le regala 1 GiB a Free', () => {
    expect(resolveMaxBytes('abc', limitsFor('free').maxBytes)).toBe(FREE_BYTES)
    expect(resolveMaxBytes('abc', limitsFor('cloud').maxBytes)).toBe(GIB)
    expect(resolveMaxBytes('abc', limitsFor('team').maxBytes)).toBe(5 * GIB)
  })
})

// Override de instancia dedicada (§10 de la spec de pricing). `maxBytesFor` es la UNICA via
// por la que se resuelve el techo: la usan `status` (lo que informa) y `push` (lo que aplica).
describe('maxBytesFor — el override de instancia dedicada', () => {
  const original = process.env.MAX_BYTES_PER_USER
  afterEach(() => {
    if (original === undefined) delete process.env.MAX_BYTES_PER_USER
    else process.env.MAX_BYTES_PER_USER = original
  })

  it('sin setear manda el plan', () => {
    delete process.env.MAX_BYTES_PER_USER
    expect(maxBytesFor('free')).toBe(FREE_BYTES)
    expect(maxBytesFor('cloud')).toBe(GIB)
    expect(maxBytesFor('team')).toBe(5 * GIB)
  })

  it('seteado pisa el techo de todos los planes', () => {
    process.env.MAX_BYTES_PER_USER = String(42 * GIB)
    expect(maxBytesFor('free')).toBe(42 * GIB)
    expect(maxBytesFor('cloud')).toBe(42 * GIB)
  })

  it('un valor invalido no afloja el techo de Free', () => {
    process.env.MAX_BYTES_PER_USER = 'abc'
    expect(maxBytesFor('free')).toBe(FREE_BYTES)
  })
})
