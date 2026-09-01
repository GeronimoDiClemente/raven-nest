import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'
import { getMemoryConnectionState, setMemoryConnectionState } from '../memory-connection-state'

describe('MemoryConnectionState — local vs nube (C1)', () => {
  let home: string

  beforeEach(() => { home = makeTmpDir('raven-conn-') })
  afterEach(() => { cleanupTmp(home) })

  it('una casa sin connection.json arranca capturando y sin nube', () => {
    const state = getMemoryConnectionState(home)
    expect(state.localEnabled).toBe(true)
    expect(state.connected).toBe(false)
  })

  it('una connection.json vieja sin el campo se adopta capturando', () => {
    mkdirSync(join(home, '.raven-nest', 'memory'), { recursive: true })
    writeFileSync(
      join(home, '.raven-nest', 'memory', 'connection.json'),
      JSON.stringify({ connected: true, deviceId: 'dev-1', connectedAt: 123 })
    )
    const state = getMemoryConnectionState(home)
    expect(state.localEnabled).toBe(true)
    expect(state.connected).toBe(true)
  })

  it('apagar la captura local persiste y no toca el estado de nube', () => {
    setMemoryConnectionState(home, { connected: true, localEnabled: false, deviceId: 'dev-1', connectedAt: 123, syncBaseUrl: null, deviceName: null })
    const state = getMemoryConnectionState(home)
    expect(state.localEnabled).toBe(false)
    expect(state.connected).toBe(true)
  })

  it('syncBaseUrl arranca en null y persiste cuando se setea', () => {
    expect(getMemoryConnectionState(home).syncBaseUrl).toBeNull()
    setMemoryConnectionState(home, {
      connected: false,
      localEnabled: true,
      deviceId: null,
      connectedAt: null,
      syncBaseUrl: 'https://memory.nestmux.com',
      deviceName: null,
    })
    expect(getMemoryConnectionState(home).syncBaseUrl).toBe('https://memory.nestmux.com')
  })

  it('deviceName arranca en null', () => {
    expect(getMemoryConnectionState(home).deviceName).toBeNull()
  })

  it('deviceName persiste y sobrevive a un cambio de estado de nube', () => {
    setMemoryConnectionState(home, {
      connected: true,
      localEnabled: true,
      deviceId: 'dev-1',
      connectedAt: 123,
      syncBaseUrl: null,
      deviceName: 'PC-GERO',
    })
    expect(getMemoryConnectionState(home).deviceName).toBe('PC-GERO')

    const previo = getMemoryConnectionState(home)
    setMemoryConnectionState(home, { ...previo, connected: false, connectedAt: null })
    expect(getMemoryConnectionState(home).deviceName).toBe('PC-GERO')
  })
})
