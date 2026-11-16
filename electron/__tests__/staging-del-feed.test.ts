// El freno del rollout: `stagingPercentage` en el feed del auto-updater.
import { describe, it, expect } from 'vitest'
// @ts-expect-error — es un .mjs de scripts/ sin tipos
import { conStaging } from '../../scripts/staging-del-feed.mjs'

const FEED = `version: 1.6.0
files:
  - url: Nest-1.6.0-arm64.dmg
    sha512: abc
    size: 123
path: Nest-1.6.0-arm64.dmg
sha512: abc
releaseDate: '2026-11-06T00:00:00.000Z'
`

describe('conStaging', () => {
  it('agrega la clave al final sin tocar el resto del feed', () => {
    expect(conStaging(FEED, 10)).toBe(`${FEED}stagingPercentage: 10\n`)
  })

  it('reemplaza la que ya estaba en vez de duplicarla', () => {
    const dos = conStaging(conStaging(FEED, 10), 0)
    expect(dos.match(/^stagingPercentage:/gm)).toHaveLength(1)
    expect(dos).toContain('stagingPercentage: 0\n')
  })

  it('un feed sin salto de línea final no queda pegado a la clave', () => {
    expect(conStaging('version: 1.6.0', 50)).toBe('version: 1.6.0\nstagingPercentage: 50\n')
  })

  it('rechaza lo que no es un entero de 0 a 100', () => {
    for (const p of [-1, 101, 5.5, NaN]) expect(() => conStaging(FEED, p)).toThrow()
  })
})
