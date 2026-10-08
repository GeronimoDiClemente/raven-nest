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

  /**
   * Cuarta revisión (2026-10-08). `login` y `recover` del paquete guardan la maestra y nada
   * más; la app, al recibirla, re-baja lo salteado. Sin eso, lo que el MCP pulleó mientras la
   * máquina esperaba la autorización quedó marcado como ilegible y ATRÁS del cursor: no
   * vuelve nunca, y el contador de ilegibles queda congelado.
   */
  describe('al arrancar con una maestra nueva, se pone al día', () => {
    const conMaestra = (keyEpoch: number) => saveKeyMaterial(home, null, safeFalso(), {
      device: generateDeviceKeyPair(), master: randomBytes(32).toString('base64'), keyEpoch,
    })
    const estadoSalteado = () => {
      store.save({ projectKey: 'p', type: 'decision', source: 'mcp', title: 't', content: 'c', topicKey: 'tema' })
      store.markUndecryptable('fila-cifrada')
      store.setSyncState('p', { pullCursor: 42 })
    }

    it('re-baja lo que se salteó y completa los HMAC de tema', () => {
      estadoSalteado()
      conMaestra(2)
      armar()

      expect(store.getSyncState('p').pullCursor, 'el cursor vuelve a 0').toBe(0)
      expect(store.undecryptableCount()).toBe(0)
      expect(store.knownKeyEpoch()).toBe(2)
      expect(store.backfillTopicHmacs(), 'ya no quedan temas sin HMAC').toBe(0)
    })

    it('una sola vez por época: el segundo arranque no vuelve a re-bajar todo', () => {
      conMaestra(2)
      armar()
      store.setSyncState('p', { pullCursor: 42 })
      armar()
      expect(store.getSyncState('p').pullCursor).toBe(42)
    })

    it('sin maestra no toca nada', () => {
      estadoSalteado()
      saveKeyMaterial(home, null, safeFalso(), { device: generateDeviceKeyPair(), master: null, keyEpoch: 0 })
      armar()
      expect(store.getSyncState('p').pullCursor).toBe(42)
      expect(store.undecryptableCount()).toBe(1)
    })
  })

  it('el candado va al lado de la base', () => {
    const r = armar().deps.adquirirCandado!()
    expect(r.ok).toBe(true)
    if (r.ok) r.lock.release()
  })
})
