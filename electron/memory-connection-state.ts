// Small local state file for Nest Memory's connection status — separate from
// settings-store.ts (which owns a fixed-shape keybindings/voiceLanguage document) and
// separate from credential.bin (which holds only the encrypted token, per
// docs/nest-memory-architecture.md §6.2 — secrets and non-secret state are deliberately
// not colocated).
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs'
import { randomUUID } from 'crypto'

export interface MemoryConnectionState {
  connected: boolean
  deviceId: string | null
  connectedAt: number | null
}

const DEFAULT_STATE: MemoryConnectionState = { connected: false, deviceId: null, connectedAt: null }

function statePath(ravenHomeDir: string): string {
  return join(ravenHomeDir, '.raven-nest', 'memory', 'connection.json')
}

export function getMemoryConnectionState(ravenHomeDir: string): MemoryConnectionState {
  try {
    const raw = readFileSync(statePath(ravenHomeDir), 'utf8')
    return { ...DEFAULT_STATE, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_STATE
  }
}

export function setMemoryConnectionState(ravenHomeDir: string, state: MemoryConnectionState): void {
  const path = statePath(ravenHomeDir)
  mkdirSync(join(ravenHomeDir, '.raven-nest', 'memory'), { recursive: true })
  writeFileSync(path, JSON.stringify(state, null, 2))
}

export function credentialPath(ravenHomeDir: string): string {
  return join(ravenHomeDir, '.raven-nest', 'memory', 'credential.bin')
}

export function deleteCredential(ravenHomeDir: string): void {
  const path = credentialPath(ravenHomeDir)
  if (existsSync(path)) unlinkSync(path)
}

export function ensureDeviceId(ravenHomeDir: string): string {
  const state = getMemoryConnectionState(ravenHomeDir)
  if (state.deviceId) return state.deviceId
  const deviceId = randomUUID()
  setMemoryConnectionState(ravenHomeDir, { ...state, deviceId })
  return deviceId
}
