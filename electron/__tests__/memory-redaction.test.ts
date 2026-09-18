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

  it('redacts an opaque (non-JWT) bearer token in an Authorization header, not just the prefix', () => {
    // Regression: the generic key=value pattern alone only matched "Authorization:
    // Bearer" (stopping at the space) and left an opaque, non-JWT token like this fully
    // exposed right after the redacted prefix.
    const { text, redacted } = redact('Authorization: Bearer sk_live_opaqueRandomToken1234567890')
    expect(redacted).toBe(true)
    expect(text).not.toContain('sk_live_opaqueRandomToken1234567890')
  })

  it('redacts a bare "Bearer <token>" with no Authorization: prefix', () => {
    const { text, redacted } = redact('curl -H "Bearer abcDEF123opaqueToken"')
    expect(redacted).toBe(true)
    expect(text).not.toContain('abcDEF123opaqueToken')
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

describe('claves que el patrón original dejaba pasar', () => {
  // Encontrado el 2026-09-18 escribiendo otro test: `/\bsk-[A-Za-z0-9]{10,}\b/` corta en el
  // primer guión, así que `sk-ant-api03-…` daba sólo "ant" (3 caracteres) y no llegaba al
  // mínimo. Es la clave que más probablemente aparezca en las memorias de ESTE producto:
  // los agentes que las escriben corren con una.
  const ANTHROPIC = `sk-ant-api03-${'A'.repeat(90)}`

  it('redacta una clave de Anthropic suelta', () => {
    expect(redact(`la clave es ${ANTHROPIC}`).text).not.toContain(ANTHROPIC)
  })

  it('redacta una clave de Anthropic como variable de entorno', () => {
    expect(redact(`ANTHROPIC_API_KEY=${ANTHROPIC}`).text).not.toContain(ANTHROPIC)
  })

  it('redacta otras variables de entorno con forma de secreto', () => {
    expect(redact('GITHUB_TOKEN=abcdef123456').text).not.toContain('abcdef123456')
    expect(redact('DB_PASSWORD: hunter2hunter2').text).not.toContain('hunter2hunter2')
    expect(redact('STRIPE_SECRET_KEY = sk_live_zzzz').text).not.toContain('sk_live_zzzz')
  })

  it('marca que hubo redacción', () => {
    expect(redact(`x ${ANTHROPIC}`).redacted).toBe(true)
  })

  it('no toca prosa que apenas menciona una clave sin darla', () => {
    const texto = 'hay que rotar la API key del proyecto'
    expect(redact(texto).text).toBe(texto)
  })
})
