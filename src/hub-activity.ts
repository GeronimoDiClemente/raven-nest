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

// Under heavy output a single pane can emit hundreds of chunks/sec. An already
// -active pane doesn't need re-classifying on every chunk — its liveness only
// matters at ACTIVE_QUIET_MS granularity — so skip the regex when we classified
// it within THROTTLE_MS. We still process at least once per THROTTLE_MS while
// output flows, so the timer stays fresh and the dot never flickers; the only
// effect is the dot may drop up to THROTTLE_MS earlier once output truly stops.
const THROTTLE_MS = 250

const active = new Set<string>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const lastSeen = new Map<string, number>()
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
    // Throttle: an already-active pane keeps its timer fresh without paying the
    // hasVisibleOutput regex on every chunk. A pane not yet active is always
    // classified so activation is never delayed.
    const now = Date.now()
    if (active.has(paneId) && now - (lastSeen.get(paneId) ?? 0) < THROTTLE_MS) return
    // Only printable output (text or spinner glyphs) counts as work; ignore
    // pure cursor/escape/title repaints so idle TUIs don't stay green.
    if (!hasVisibleOutput(data)) return
    lastSeen.set(paneId, now)
    const isNew = !active.has(paneId)
    active.add(paneId)
    const prev = timers.get(paneId)
    if (prev) clearTimeout(prev)
    timers.set(paneId, setTimeout(() => {
      active.delete(paneId)
      timers.delete(paneId)
      lastSeen.delete(paneId)
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
  lastSeen.clear()
  started = false
  publish()
}
