import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { randomBytes } from 'crypto'
import { ravenHome } from './raven-home'

export interface CryptoBackend {
  isEncryptionAvailable(): boolean
  encryptString(s: string): Buffer
  decryptString(b: Buffer): string
}

export class NoKeyringError extends Error {
  constructor() { super('NO_KEYRING'); this.name = 'NoKeyringError' }
}

type Stored = Record<string, string> // pluginId -> base64(encrypted)

export class PluginCredentialStore {
  private dir: string
  private file: string
  constructor(private crypto: CryptoBackend, baseDir: string = join(ravenHome(), '.raven-nest')) {
    this.dir = baseDir
    this.file = join(baseDir, 'plugin-credentials.json')
  }
  private load(): Stored {
    try { return JSON.parse(readFileSync(this.file, 'utf8')) } catch { return {} }
  }
  private persist(s: Stored): void {
    mkdirSync(this.dir, { recursive: true })
    // Atomic write (tmp + rename) so a crash mid-write can't corrupt the
    // credentials file. Per-call random tmp name mirrors worktree-store.ts /
    // local-paths-store.ts.
    const tmp = `${this.file}.${randomBytes(6).toString('hex')}.tmp`
    writeFileSync(tmp, JSON.stringify(s))
    renameSync(tmp, this.file)
  }
  setToken(pluginId: string, token: string): void {
    if (!this.crypto.isEncryptionAvailable()) throw new NoKeyringError()
    const s = this.load()
    s[pluginId] = this.crypto.encryptString(token).toString('base64')
    this.persist(s)
  }
  getToken(pluginId: string): string | null {
    const enc = this.load()[pluginId]
    if (!enc) return null
    if (!this.crypto.isEncryptionAvailable()) throw new NoKeyringError()
    return this.crypto.decryptString(Buffer.from(enc, 'base64'))
  }
  has(pluginId: string): boolean { return this.load()[pluginId] != null }
  delete(pluginId: string): void {
    const s = this.load()
    if (!(pluginId in s)) return
    delete s[pluginId]
    this.persist(s)
  }
}
