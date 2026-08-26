// Small local state file for Nest Memory's connection status — separate from
// settings-store.ts (which owns a fixed-shape keybindings/voiceLanguage document) and
// separate from credential.bin (which holds only the encrypted token, per
// docs/nest-memory-architecture.md §6.2 — secrets and non-secret state are deliberately
// not colocated).
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, renameSync } from 'fs'
import { randomUUID, randomBytes } from 'crypto'

export interface MemoryConnectionState {
  connected: boolean
  deviceId: string | null
  connectedAt: number | null
}

const DEFAULT_STATE: MemoryConnectionState = { connected: false, deviceId: null, connectedAt: null }

function statePath(ravenHomeDir: string): string {
  return join(ravenHomeDir, '.raven-nest', 'memory', 'connection.json')
}

// Deliberately DOES default to DEFAULT_STATE on any read/parse failure (unlike
// memory-provisioner.ts's readJsonOrThrow for .claude.json — see that file's comment
// for the general rule). The difference: this file holds only a connected flag + a
// device id we generate ourselves, is exclusively OUR OWN, and its worst-case failure
// mode is "the user has to click Connect again" — genuinely low-stakes and recoverable,
// unlike silently destroying a user's real Claude Code config. Called at module-load
// time in main.ts, too: throwing here would crash the whole app over a corrupt 3-field
// file, which would be a strictly worse outcome than resetting to disconnected.
export function getMemoryConnectionState(ravenHomeDir: string): MemoryConnectionState {
  try {
    const raw = readFileSync(statePath(ravenHomeDir), 'utf8')
    return { ...DEFAULT_STATE, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_STATE
  }
}

// Atomic write (tmp + rename), matching the house pattern in session-store.ts /
// local-paths-store.ts (docs/GUIA-TESTEO-BAUTISTA.md: "escribí atómico... el patrón
// está en electron/session-store.ts (PR #15): copiá ese"). A per-call random tmp
// filename — not just a fixed `.tmp` suffix — so two concurrent IPC handlers writing
// this same file (e.g. memory:connect and memory:ensureDeviceId) can't clobber each
// other's in-flight write (local-paths-store.ts's variant of the pattern).
export function setMemoryConnectionState(ravenHomeDir: string, state: MemoryConnectionState): void {
  const path = statePath(ravenHomeDir)
  const serialized = JSON.stringify(state, null, 2)
  mkdirSync(join(ravenHomeDir, '.raven-nest', 'memory'), { recursive: true })
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  writeFileSync(tmp, serialized)
  renameSync(tmp, path)
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
