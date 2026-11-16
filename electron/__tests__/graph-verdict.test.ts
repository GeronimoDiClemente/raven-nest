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

  // Real claude reviewers often nest the verdict instead of putting {concerns,
  // blocking} at the top level (observed in the live smoke). Be tolerant.
  it('reads a verdict nested under "result"', () => {
    const raw = JSON.stringify({ role: 'review-security', result: { concerns: ['reused key'], blocking: true } })
    expect(parseVerdict(raw)).toEqual({ concerns: ['reused key'], blocking: true })
  })
  it('reads a verdict nested under any object key (e.g. "verdict")', () => {
    const raw = JSON.stringify({ verdict: { concerns: [], blocking: false } })
    expect(parseVerdict(raw)).toEqual({ concerns: [], blocking: false })
  })
  it('prefers a top-level blocking over a nested one', () => {
    const raw = JSON.stringify({ concerns: ['top'], blocking: false, result: { concerns: ['nested'], blocking: true } })
    expect(parseVerdict(raw)).toEqual({ concerns: ['top'], blocking: false })
  })
  it('falls back to top-level concerns when the nested verdict omits them', () => {
    const raw = JSON.stringify({ concerns: ['double-charge'], analysis: { attack_surface: 'none' }, result: { blocking: true } })
    expect(parseVerdict(raw)).toEqual({ concerns: ['double-charge'], blocking: true })
  })
  it('still returns null when no object carries a boolean blocking', () => {
    expect(parseVerdict(JSON.stringify({ role: 'x', analysis: { attack_surface: 'none' } }))).toBeNull()
  })
})
