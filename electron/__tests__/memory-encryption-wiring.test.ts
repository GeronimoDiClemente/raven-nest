import { describe, it, expect } from 'vitest'
import { buildEncryptionStatus } from '../memory-encryption-status'

const base = {
  safeStorageAvailable: true,
  connected: true,
  keyEpoch: 1,
  hasMaster: true,
  devices: [
    { deviceId: 'mac', name: 'mac', publicKey: 'P1', hasWrap: true },
    { deviceId: 'pc', name: 'pc', publicKey: 'P2', hasWrap: false },
  ],
  undecryptable: 0,
}

describe('buildEncryptionStatus', () => {
  it('sin safeStorage el cifrado no está disponible', () => {
    const s = buildEncryptionStatus({ ...base, safeStorageAvailable: false })
    expect(s.available).toBe(false)
    expect(s.active).toBe(false)
  })

  it('sin cuenta conectada tampoco: no hay nube que cifrar', () => {
    expect(buildEncryptionStatus({ ...base, connected: false }).available).toBe(false)
  })

  it('época 0 es disponible pero no activo', () => {
    const s = buildEncryptionStatus({ ...base, keyEpoch: 0, hasMaster: false })
    expect(s.available).toBe(true)
    expect(s.active).toBe(false)
  })

  // El caso que la UI tiene que poder distinguir: la cuenta cifra, pero ESTA maquina no
  // tiene la clave. No es "activo", es "esperando autorizacion".
  it('con época pero sin maestra local, activo es false', () => {
    const s = buildEncryptionStatus({ ...base, hasMaster: false })
    expect(s.available).toBe(true)
    expect(s.active).toBe(false)
  })

  it('lista solo las máquinas que esperan autorización', () => {
    expect(buildEncryptionStatus(base).pendingDevices).toEqual([{ deviceId: 'pc', name: 'pc' }])
  })

  it('pasa el conteo de ilegibles tal cual', () => {
    expect(buildEncryptionStatus({ ...base, undecryptable: 7 }).undecryptable).toBe(7)
  })
})
