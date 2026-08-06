import { describe, it, expect } from 'vitest'
import { deriveScope } from '../integrations/board'

describe('deriveScope', () => {
  it('is personal when there is no repo', () => {
    expect(deriveScope(null, 'gero')).toEqual({ kind: 'personal' })
  })
  it('is personal when the owner is the signed-in user (case-insensitive)', () => {
    expect(deriveScope('Gero/dotfiles', 'gero')).toEqual({ kind: 'personal' })
  })
  it('is org when the owner is not the user', () => {
    expect(deriveScope('RAVEN/raven-nest', 'gero')).toEqual({ kind: 'org', org: 'RAVEN' })
  })
})
