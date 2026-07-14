// Global PTY event bus — registers IPC listeners once, dispatches to pane callbacks

type DataCallback = (data: string) => void
type ExitCallback = () => void
type GlobalDataCallback = (paneId: string, data: string) => void
type GlobalExitCallback = (paneId: string) => void

const dataCallbacks = new Map<string, DataCallback>()
const exitCallbacks = new Map<string, ExitCallback>()
const globalDataSubscribers = new Set<GlobalDataCallback>()
const globalExitSubscribers = new Set<GlobalExitCallback>()

let ipcRegistered = false

function ensureIpcRegistered() {
  if (ipcRegistered) return
  ipcRegistered = true
  window.pty.onData((paneId, data) => {
    dataCallbacks.get(paneId)?.(data)
    for (const cb of globalDataSubscribers) cb(paneId, data)
  })
  window.pty.onExit((paneId) => {
    exitCallbacks.get(paneId)?.()
    for (const cb of globalExitSubscribers) cb(paneId)
  })
}

export function registerPane(paneId: string, onData: DataCallback, onExit?: ExitCallback) {
  ensureIpcRegistered()
  dataCallbacks.set(paneId, onData)
  if (onExit) exitCallbacks.set(paneId, onExit)
}

export function unregisterPane(paneId: string) {
  dataCallbacks.delete(paneId)
  exitCallbacks.delete(paneId)
}

/** Subscribe to data events from all panes. Returns an unsubscribe function. */
export function subscribeToPtyData(cb: GlobalDataCallback): () => void {
  ensureIpcRegistered()
  globalDataSubscribers.add(cb)
  return () => { globalDataSubscribers.delete(cb) }
}

/** Subscribe to exit events from all panes. Returns an unsubscribe function. */
export function subscribeToPtyExit(cb: GlobalExitCallback): () => void {
  ensureIpcRegistered()
  globalExitSubscribers.add(cb)
  return () => { globalExitSubscribers.delete(cb) }
}

/**
 * Tear down the global IPC listeners and clear subscriber maps. Intended to
 * run on window `beforeunload` so the renderer doesn't leak listeners (or
 * keep stale callbacks alive) across reloads / window close.
 */
export function stopListening(): void {
  window.pty.removeAllListeners()
  dataCallbacks.clear()
  exitCallbacks.clear()
  globalDataSubscribers.clear()
  globalExitSubscribers.clear()
  ipcRegistered = false
}

// Attach at module load so cleanup happens regardless of which component
// mounted first. Idempotent — `removeAllListeners` is a no-op if nothing
// was registered yet.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', stopListening)
}
