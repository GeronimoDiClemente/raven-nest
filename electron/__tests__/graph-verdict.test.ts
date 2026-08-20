import { describe, it, expect } from 'vitest'
import { parseVerdict } from '../integrations/graph-verdict'

describe('parseVerdict', () => {
  it('parses a valid blocking verdict', () => {
    const raw = JSON.stringify({ concerns: ['idempotency key reused'], blocking: true })
    expect(parseVerdict(raw)).toEqual({ concerns: ['idempotency key reused'], blocking: true })
  })
  it('parses a clean non-blocking verdict', () => {
    expect(parseVerdict(JSON.stringify({ concerns: [], blocking: false }))).toEqual({ concerns: [], blocking: false })
  })
  it('coerces missing concerns to [] and keeps blocking', () => {
    expect(parseVerdict(JSON.stringify({ blocking: true }))).toEqual({ concerns: [], blocking: true })
  })
  it('returns null for null input (artifact missing)', () => {
    expect(parseVerdict(null)).toBeNull()
  })
  it('returns null for malformed JSON', () => {
    expect(parseVerdict('{not json')).toBeNull()
  })
  it('returns null when blocking is not a boolean', () => {
    expect(parseVerdict(JSON.stringify({ concerns: [], blocking: 'yes' }))).toBeNull()
  })
  it('drops non-string concerns', () => {
    expect(parseVerdict(JSON.stringify({ concerns: ['a', 3, null, 'b'], blocking: false })))
      .toEqual({ concerns: ['a', 'b'], blocking: false })
  })
})
