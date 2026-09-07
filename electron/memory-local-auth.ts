// Local IPC access control for Nest Memory — see docs/nest-memory-architecture.md §1.1
// and the C2 fix note in memory-protocol.ts.
//
// Why this exists: on Windows, Node's `net` module offers no way to attach a custom
// DACL to a named pipe, and no way to read the connecting process's user SID to verify
// it before serving a request — both would require a full native (Win32 API) transport
// layer, which is a much larger and riskier undertaking than this fix warrants. Instead,
// every request carries a shared-secret token that only a process running as the SAME
// Windows/POSIX user can read, because the token file inherits the same per-user
// filesystem permissions every other secret in this app already relies on
// (credential.bin uses the identical pattern — mode 0600 + default OS directory ACLs).
// A process that can't read this file can connect to the pipe but every request it sends
// is rejected before touching the store.
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, renameSync } from 'fs'
import { randomBytes } from 'crypto'

export interface LocalAuthMaterial {
  /** Unpredictable per-install suffix for the Windows named pipe path (see daemonSocketPath). */
  pipeId: string
  /** Shared-secret validated on every MemoryRequest by memory-ipc-server.ts. */
  token: string
}

function materialPath(ravenHomeDir: string): string {
  return join(ravenHomeDir, '.raven-nest', 'memory', 'pipe-auth.json')
}

function isValidMaterial(value: unknown): value is LocalAuthMaterial {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as LocalAuthMaterial).pipeId === 'string' &&
    (value as LocalAuthMaterial).pipeId.length > 0 &&
    typeof (value as LocalAuthMaterial).token === 'string' &&
    (value as LocalAuthMaterial).token.length > 0
  )
}

/** Generated once per install, persisted, reused across restarts. */
export function ensureLocalAuthMaterial(ravenHomeDir: string): LocalAuthMaterial {
  const path = materialPath(ravenHomeDir)
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'))
      if (isValidMaterial(parsed)) return parsed
    } catch {
      // Corrupt file — fall through and regenerate.
    }
  }
  const material: LocalAuthMaterial = {
    pipeId: randomBytes(16).toString('hex'),
    token: randomBytes(32).toString('hex'),
  }
  mkdirSync(join(ravenHomeDir, '.raven-nest', 'memory'), { recursive: true })
  // Atomic write (tmp + rename) — house pattern from session-store.ts/local-paths-store.ts
  // (docs/GUIA-TESTEO-BAUTISTA.md). A crash mid-write must never leave a truncated,
  // unparseable pipe-auth.json — that would silently regenerate fresh (harmless, just a
  // reconnect-required blip) rather than the historically worse "half-written secret on
  // disk" failure mode. mode 0600 is set on the tmp file so the final path (same inode
  // after rename) inherits it — never briefly world-readable between write and chmod.
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  writeFileSync(tmp, JSON.stringify(material), { mode: 0o600 })
  try { chmodSync(tmp, 0o600) } catch { /* best effort — e.g. unsupported on this fs */ }
  renameSync(tmp, path)
  return material
}
