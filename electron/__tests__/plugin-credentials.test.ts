import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PluginCredentialStore, NoKeyringError, type CryptoBackend } from '../plugin-credentials'

const fakeCrypto = (available = true): CryptoBackend => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(`enc:${s}`),
  decryptString: (b) => b.toString().replace(/^enc:/, ''),
})

describe('PluginCredentialStore', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nest-creds-')) })

  it('guarda y recupera un token cifrado', () => {
    const s = new PluginCredentialStore(fakeCrypto(), dir)
    s.setToken('slack', 'xoxb-123')
    expect(s.has('slack')).toBe(true)
    expect(s.getToken('slack')).toBe('xoxb-123')
  })

  it('getToken devuelve null si no existe', () => {
    expect(new PluginCredentialStore(fakeCrypto(), dir).getToken('slack')).toBeNull()
  })

  it('delete remueve el token', () => {
    const s = new PluginCredentialStore(fakeCrypto(), dir)
    s.setToken('slack', 'x'); s.delete('slack')
    expect(s.has('slack')).toBe(false)
  })

  it('lanza NoKeyringError si no hay cifrado disponible', () => {
    const s = new PluginCredentialStore(fakeCrypto(false), dir)
    expect(() => s.setToken('slack', 'x')).toThrow(NoKeyringError)
  })
})
