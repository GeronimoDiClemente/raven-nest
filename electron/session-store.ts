import { join } from 'path'
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'fs'
import { ravenHome } from './raven-home'

// Lazy paths (not module-level constants) so tests can point RAVEN_HOME at a
// tmp dir per test.
const sessionDir = () => join(ravenHome(), '.raven-nest')
const sessionPath = () => join(sessionDir(), 'session.json')

export function loadSession(): unknown | null {
  try {
    return JSON.parse(readFileSync(sessionPath(), 'utf8'))
  } catch (err) {
    // ENOENT is the expected "first launch, no session yet" case — return null
    // silently. Any other error means the session file is corrupt / unreadable;
    // log loud so we can debug why the user's panes didn't restore.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    console.error('[session-store] failed to read session', sessionPath(), err)
    return null
  }
}

/**
 * Atomic save: serialize first (so a stringify error can't touch the file),
 * write to a tmp sibling, then rename over session.json. A crash mid-write
 * leaves the previous session intact instead of a truncated JSON that
 * loadSession() can't parse — that was unrecoverable data loss.
 */
export function saveSession(data: unknown): void {
  const serialized = JSON.stringify(data)
  mkdirSync(sessionDir(), { recursive: true })
  const tmp = sessionPath() + '.tmp'
  try {
    writeFileSync(tmp, serialized)
    renameSync(tmp, sessionPath())
  } catch (err) {
    try { rmSync(tmp, { force: true }) } catch { /* best effort */ }
    throw err
  }
}
