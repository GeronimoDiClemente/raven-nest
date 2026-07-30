import { describe, it, expect } from 'vitest'
import { pkceChallenge, formatOutcome } from '../integrations/gcal'

describe('gcal helpers', () => {
  it('pkceChallenge(S256) es determinístico dado un verifier fijo', () => {
    // Vector del RFC 7636: verifier fijo → challenge conocido (S256 base64url del SHA-256).
    const { challenge } = pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })
  it('pkceChallenge genera verifier propio si no se pasa uno', () => {
    const a = pkceChallenge()
    expect(a.verifier.length).toBeGreaterThanOrEqual(43)
    expect(a.challenge).not.toBe(a.verifier)
  })
  it('formatOutcome arma el resumen de la sesión', () => {
    const s = formatOutcome({ repo: 'acme/app', branch: 'feat/x', prNumber: 456, commits: 3, testsGreen: true })
    expect(s).toContain('acme/app')
    expect(s).toContain('PR #456')
    expect(s).toContain('3 commits')
  })
})
