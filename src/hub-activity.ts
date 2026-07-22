// Always-on cross-workspace activity signal for the Hub. Unlike busyPanes
// (driven only by the mounted active-tab TerminalPanes), this listens to the
// global PTY data bus, so it reflects background workspaces too. A pane is
// "active" while it has emitted VISIBLE output within ACTIVE_QUIET_MS — chunks
// that are only cursor moves / colour codes / title-bar repaints don't count,
// so an idle TUI redrawing its chrome doesn't read as working.
import { useSyncExternalStore } from 'react'
import { subscribeToPtyData, onStopListening } from './pty-events'
import { hasVisibleOutput } from './lib/terminal-chrome'

// Bridges normal bursty output gaps (a test runner or build printing a line
// every few seconds) so the dot doesn't drop-then-reappear between chunks.
const ACTIVE_QUIET_MS = 3500

const active = new Set<string>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const listeners = new Set<() => void>()
let snapshot: Set<string> = new Set()
let started = false

function publish() {
  snapshot = new Set(active)
  for (const l of listeners) l()
}

function ensureStarted() {
  if (started) return
  started = true
  subscribeToPtyData((paneId, data) => {
    // Only printable output (text or spinner glyphs) counts as work; ignore
    // pure cursor/escape/title repaints so idle TUIs don't stay green.
    if (!hasVisibleOutput(data)) return
    const isNew = !active.has(paneId)
    active.add(paneId)
    const prev = timers.get(paneId)
    if (prev) clearTimeout(prev)
    timers.set(paneId, setTimeout(() => {
      active.delete(paneId)
      timers.delete(paneId)
      publish()
    }, ACTIVE_QUIET_MS))
    // Publish only on membership transitions (idle→active); the per-chunk
    // timer reset above keeps an already-active pane active without churning
    // subscribers on every chunk.
    if (isNew) publish()
  })
  // A soft teardown (pty-events.stopListening on reload / in-app reconnect)
  // drops our bus subscription; reset our state too so the next ensureStarted
  // re-subscribes cleanly instead of staying started=true with a dead sub.
  onStopListening(resetHubActivity)
}

function subscribe(cb: () => void): () => void {
  ensureStarted()
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

function getSnapshot(): Set<string> {
  return snapshot
}

/** Set of paneIds that emitted visible output within the last ACTIVE_QUIET_MS. */
export function useHubActivity(): Set<string> {
  return useSyncExternalStore(subscribe, getSnapshot)
}

/**
 * Reset all activity state and drop the started flag so a fresh subscription is
 * established on the next ensureStarted. Runs on PTY-bus teardown; also exposed
 * for tests. Notifies current listeners so the Hub clears its dots immediately.
 */
export function resetHubActivity(): void {
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
  active.clear()
  started = false
  publish()
}
