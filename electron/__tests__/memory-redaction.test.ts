import { describe, it, expect } from 'vitest'
import { redact, isDeniedImportPath } from '../memory-redaction'

describe('redact', () => {
  it('redacts key=value style secrets', () => {
    const { text, redacted } = redact('set api_key=abc123def456 before running')
    expect(redacted).toBe(true)
    expect(text).not.toContain('abc123def456')
    expect(text).toContain('<redacted>')
  })

  it('redacts common provider token prefixes', () => {
    expect(redact('token is sk-1234567890abcdef').redacted).toBe(true)
    expect(redact('token is ghp_1234567890abcdefghij').redacted).toBe(true)
    expect(redact('slack token xoxb-1234567890-abcdefg').redacted).toBe(true)
    expect(redact('AWS key AKIAABCDEFGHIJKLMNOP').redacted).toBe(true)
  })

  it('redacts PEM private keys', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----'
    const { text, redacted } = redact(`here is my key:\n${pem}\nthanks`)
    expect(redacted).toBe(true)
    expect(text).not.toContain('MIIEpAIBAAKCAQEA')
  })

  it('redacts JWT-shaped strings', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    expect(redact(`bearer ${jwt}`).redacted).toBe(true)
  })

  it('leaves ordinary text untouched', () => {
    const { text, redacted } = redact('We decided to use TanStack Query for server state.')
    expect(redacted).toBe(false)
    expect(text).toBe('We decided to use TanStack Query for server state.')
  })
})

describe('isDeniedImportPath', () => {
  it('denies dotenv, pem, credential and key files', () => {
    expect(isDeniedImportPath('/repo/.env')).toBe(true)
    expect(isDeniedImportPath('/repo/.env.local')).toBe(true)
    expect(isDeniedImportPath('/repo/server.pem')).toBe(true)
    expect(isDeniedImportPath('/repo/aws-credentials.json')).toBe(true)
    expect(isDeniedImportPath('/repo/id_rsa.key')).toBe(true)
  })

  it('denies anything under .git/', () => {
    expect(isDeniedImportPath('/repo/.git/config')).toBe(true)
  })

  it('allows ordinary project files', () => {
    expect(isDeniedImportPath('/repo/CLAUDE.md')).toBe(false)
    expect(isDeniedImportPath('/repo/src/index.ts')).toBe(false)
  })
})
