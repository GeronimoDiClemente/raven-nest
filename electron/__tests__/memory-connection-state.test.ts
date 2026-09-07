import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'
import { getMemoryConnectionState, setMemoryConnectionState } from '../memory-connection-state'

describe('MemoryConnectionState — local capture vs cloud sync (C1)', () => {
  let home: string

  beforeEach(() => { home = makeTmpDir('raven-conn-') })
  afterEach(() => { cleanupTmp(home) })

  it('a home with no connection.json starts capturing locally and disconnected from the cloud', () => {
    const state = getMemoryConnectionState(home)
    expect(state.localEnabled).toBe(true)
    expect(state.connected).toBe(false)
  })

  it('an old connection.json without the field is adopted as capturing locally', () => {
    mkdirSync(join(home, '.raven-nest', 'memory'), { recursive: true })
    writeFileSync(
      join(home, '.raven-nest', 'memory', 'connection.json'),
      JSON.stringify({ connected: true, deviceId: 'dev-1', connectedAt: 123 })
    )
    const state = getMemoryConnectionState(home)
    expect(state.localEnabled).toBe(true)
    expect(state.connected).toBe(true)
  })

  it('turning local capture off persists and leaves the cloud state alone', () => {
    setMemoryConnectionState(home, { connected: true, localEnabled: false, deviceId: 'dev-1', connectedAt: 123, syncBaseUrl: null, deviceName: null })
    const state = getMemoryConnectionState(home)
    expect(state.localEnabled).toBe(false)
    expect(state.connected).toBe(true)
  })

  it('syncBaseUrl starts null and persists once set', () => {
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

  it('deviceName starts null', () => {
    expect(getMemoryConnectionState(home).deviceName).toBeNull()
  })

  it('deviceName persists and survives a change of cloud state', () => {
    setMemoryConnectionState(home, {
      connected: true,
      localEnabled: true,
      deviceId: 'dev-1',
      connectedAt: 123,
      syncBaseUrl: null,
      deviceName: 'PC-GERO',
    })
    expect(getMemoryConnectionState(home).deviceName).toBe('PC-GERO')

    const previous = getMemoryConnectionState(home)
    setMemoryConnectionState(home, { ...previous, connected: false, connectedAt: null })
    expect(getMemoryConnectionState(home).deviceName).toBe('PC-GERO')
  })
})
