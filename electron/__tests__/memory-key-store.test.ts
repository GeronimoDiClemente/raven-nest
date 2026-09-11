import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import {
  keyFilePath, loadKeyMaterial, saveKeyMaterial, ensureKeyMaterial, clearKeyMaterial,
  type SafeStorageLike,
} from '../memory-key-store'

// safeStorage falso: un ROT invertible alcanza para probar que el modulo lo USA (que no
// escribe texto plano) sin depender de Electron ni del llavero del SO.
const safe: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(Buffer.from(s, 'utf8').map((b) => b ^ 0x5a)),
  decryptString: (b) => Buffer.from(b.map((x) => x ^ 0x5a)).toString('utf8'),
}
const safeSinCifrado: SafeStorageLike = { ...safe, isEncryptionAvailable: () => false }

let home: string
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'nest-keys-')) })
afterEach(() => { rmSync(home, { recursive: true, force: true }) })

describe('memory-key-store', () => {
  it('particiona por cuenta, igual que el store', () => {
    const a = keyFilePath(home, 'user-a')
    const b = keyFilePath(home, 'user-b')
    expect(a).not.toBe(b)
    expect(a).toContain('user-a')
    // Sin cuenta logueada cae en `_local`, no en la de nadie.
    expect(keyFilePath(home, null)).toContain('_local')
    expect(keyFilePath(home, '  ')).toBe(keyFilePath(home, null))
  })

  it('sin archivo devuelve null en vez de lanzar', () => {
    expect(loadKeyMaterial(home, 'u1', safe)).toBeNull()
  })

  it('ensureKeyMaterial crea el par del dispositivo y lo persiste', () => {
    const primero = ensureKeyMaterial(home, 'u1', safe)
    expect(primero.device.publicKey).toBeTruthy()
    expect(primero.master).toBeNull()
    expect(primero.keyEpoch).toBe(0)
    // La segunda llamada NO rota el par: rotarlo dejaria huerfanas las envolturas que el
    // servidor ya tiene para este dispositivo.
    expect(ensureKeyMaterial(home, 'u1', safe).device.publicKey).toBe(primero.device.publicKey)
  })

  it('round-trip de la maestra y del epoch', () => {
    const m = ensureKeyMaterial(home, 'u1', safe)
    saveKeyMaterial(home, 'u1', safe, { ...m, master: Buffer.alloc(32, 7).toString('base64'), keyEpoch: 1 })
    const leido = loadKeyMaterial(home, 'u1', safe)!
    expect(leido.master).toBe(Buffer.alloc(32, 7).toString('base64'))
    expect(leido.keyEpoch).toBe(1)
    expect(leido.device.privateKey).toBe(m.device.privateKey)
  })

  it('el archivo NO contiene la privada en claro', () => {
    const m = ensureKeyMaterial(home, 'u1', safe)
    const bytes = readFileSync(keyFilePath(home, 'u1'))
    expect(bytes.includes(Buffer.from(m.device.privateKey, 'utf8'))).toBe(false)
  })

  it('el archivo queda 0600', () => {
    ensureKeyMaterial(home, 'u1', safe)
    if (process.platform !== 'win32') {
      expect(statSync(keyFilePath(home, 'u1')).mode & 0o777).toBe(0o600)
    }
  })

  // §6.2: sin cifrado del SO no se guarda una clave maestra en disco. Se REHUSA, no se
  // degrada a texto plano.
  it('sin safeStorage disponible, guardar lanza y no deja archivo', () => {
    expect(() => ensureKeyMaterial(home, 'u1', safeSinCifrado)).toThrow(/safeStorage/i)
    expect(existsSync(keyFilePath(home, 'u1'))).toBe(false)
  })

  it('un archivo corrupto devuelve null en vez de tumbar la memoria entera', () => {
    const path = keyFilePath(home, 'u1')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, Buffer.from('no es esto'))
    expect(loadKeyMaterial(home, 'u1', safe)).toBeNull()
  })

  it('clearKeyMaterial borra y es idempotente', () => {
    ensureKeyMaterial(home, 'u1', safe)
    clearKeyMaterial(home, 'u1')
    expect(existsSync(keyFilePath(home, 'u1'))).toBe(false)
    expect(() => clearKeyMaterial(home, 'u1')).not.toThrow()
  })
})
