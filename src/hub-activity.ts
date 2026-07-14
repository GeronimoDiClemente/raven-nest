// Always-on cross-workspace activity signal for the Hub. Unlike busyPanes
// (driven only by the mounted active-tab TerminalPanes), this listens to the
// global PTY data bus, so it reflects background workspaces too. A pane is
// "active" while it has emitted output within ACTIVE_QUIET_MS.
import { useSyncExternalStore } from 'react'
import { subscribeToPtyData } from './pty-events'

const ACTIVE_QUIET_MS = 2000

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
  subscribeToPtyData((paneId) => {
    const isNew = !active.has(paneId)
    active.add(paneId)
    const prev = timers.get(paneId)
    if (prev) clearTimeout(prev)
    timers.set(paneId, setTimeout(() => {
      active.delete(paneId)
      timers.delete(paneId)
      publish()
    }, ACTIVE_QUIET_MS))
    // Publish only on membership transitions (idle→active); the per-byte
    // timer reset above keeps an already-active pane active without churning
    // subscribers on every chunk.
    if (isNew) publish()
  })
}

function subscribe(cb: () => void): () => void {
  ensureStarted()
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

function getSnapshot(): Set<string> {
  return snapshot
}

/** Set of paneIds that emitted output within the last ACTIVE_QUIET_MS. */
export function useHubActivity(): Set<string> {
  return useSyncExternalStore(subscribe, getSnapshot)
}
