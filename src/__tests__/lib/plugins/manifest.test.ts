import { describe, it, expect } from 'vitest'
import { validateManifest } from '../../../lib/plugins/manifest'

describe('validateManifest', () => {
  const valid = { id: 'slack', name: 'Slack', type: 'integration', category: 'comms' }

  it('acepta un manifest mínimo válido y aplica defaults', () => {
    const m = validateManifest(valid)
    expect(m).not.toBeNull()
    expect(m!.id).toBe('slack')
    expect(m!.publisher).toBe('raven')
    expect(m!.tier).toBe('free')
    expect(m!.color).toBe('#888')
  })

  it.each([
    null,
    {},
    { id: '', name: 'x', type: 'integration', category: 'comms' },
    { id: 'x', name: 'x', type: 'bogus', category: 'comms' },
    { id: 'x', type: 'integration', category: 'comms' }, // sin name
  ])('rechaza inválidos: %o', (raw) => {
    expect(validateManifest(raw)).toBeNull()
  })

  it('respeta comingSoon', () => {
    expect(validateManifest({ ...valid, comingSoon: true })!.comingSoon).toBe(true)
  })
})
