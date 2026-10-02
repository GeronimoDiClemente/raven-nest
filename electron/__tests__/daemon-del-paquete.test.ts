// Las dependencias del daemon del paquete portátil. Lo que se prueba es lo que no se puede
// equivocar: el gate de cifrado y de dónde salen la credencial y las claves.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { makeTmpDir, cleanupTmp } from './setup'
import { MemoryStore } from '../memory-store'
import { depsDelDaemonDelPaquete } from '../daemon-del-paquete'
import { guardarCredencial } from '../credencial-del-paquete'
import { saveKeyMaterial } from '../memory-key-store'
import { generateDeviceKeyPair } from '../memory-key-wrap'

const safeFalso = (disponible = true) => ({
  isEncryptionAvailable: () => disponible,
  encryptString: (t: string) => Buffer.from(`##${t}##`, 'utf8'),
  decryptString: (b: Buffer) => {
    const s = b.toString('utf8')
    if (!s.startsWith('##') || !s.endsWith('##')) throw new Error('no es nuestro')
    return s.slice(2, -2)
  },
})

let home: string
let dbPath: string
let store: MemoryStore

beforeEach(() => {
  home = makeTmpDir('nest-daemon-paquete-')
  dbPath = join(home, '.nest-memory', 'memory.db')
  store = new MemoryStore(dbPath)
})
afterEach(() => { store.close(); cleanupTmp(home) })

const armar = (over: { baseUrl?: string | null; safe?: ReturnType<typeof safeFalso> } = {}) =>
  depsDelDaemonDelPaquete({
    store, dbPath, home,
    baseUrl: over.baseUrl === undefined ? 'https://sync.example' : over.baseUrl,
    safe: over.safe ?? safeFalso(),
  })

describe('depsDelDaemonDelPaquete', () => {
  it('sin credencial no hay cuenta', () => {
    expect(armar().hayCuenta).toBe(false)
  })

  it('con credencial pero sin servicio configurado, tampoco', () => {
    guardarCredencial(home, safeFalso(), { token: 'nmk_x', deviceId: 'd-1' })
    expect(armar({ baseUrl: null }).hayCuenta).toBe(false)
  })

  it('con credencial y servicio, hay cuenta, y el token y el device salen de la credencial', () => {
    guardarCredencial(home, safeFalso(), { token: 'nmk_x', deviceId: 'd-1' })
    const { deps, hayCuenta } = armar()
    expect(hayCuenta).toBe(true)
    expect(deps.getToken()).toBe('nmk_x')
    expect(deps.getDeviceId()).toBe('d-1')
  })

  it('sin llavero es modo local: ni cuenta ni claves', () => {
    guardarCredencial(home, safeFalso(), { token: 'nmk_x', deviceId: 'd-1' })
    const { deps, hayCuenta } = armar({ safe: safeFalso(false) })
    expect(hayCuenta).toBe(false)
    expect(deps.getEnvelopeContext!()).toBeNull()
  })

  it('sin maestra no hay sobre — y el gate sigue armado si la cuenta cifra', () => {
    // El caso que importa: un paquete recién logueado, sin autorizar, sobre una cuenta que
    // cifra. Sin el gate subiría título y contenido en claro.
    saveKeyMaterial(home, null, safeFalso(), { device: generateDeviceKeyPair(), master: null, keyEpoch: 0 })
    const { deps } = armar()
    expect(deps.getEnvelopeContext!()).toBeNull()
    expect(deps.isEncryptionExpected!()).toBe(false)
    store.rememberKeyEpoch(3)
    expect(deps.isEncryptionExpected!()).toBe(true)
  })

  it('con la maestra hay sobre, con su época', () => {
    saveKeyMaterial(home, null, safeFalso(), {
      device: generateDeviceKeyPair(), master: randomBytes(32).toString('base64'), keyEpoch: 2,
    })
    const ctx = armar().deps.getEnvelopeContext!()
    expect(ctx?.keyEpoch).toBe(2)
  })

  it('el candado va al lado de la base', () => {
    const r = armar().deps.adquirirCandado!()
    expect(r.ok).toBe(true)
    if (r.ok) r.lock.release()
  })
})
