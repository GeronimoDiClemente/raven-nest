/**
 * Terminal join singleton — keeps the Supabase channel alive even when the panel unmounts.
 */
import { createClient } from '@supabase/supabase-js'

// Separate Supabase client for join — avoids topic conflicts
// when host and guest are in the same process (same shared WebSocket)
const joinSupabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 100 } },
  }
)

type Listener = () => void

class TerminalJoinService {
  private channel: ReturnType<typeof joinSupabase.channel> | null = null
  private timeoutId: ReturnType<typeof setTimeout> | null = null
  private replayTimer: ReturnType<typeof setTimeout> | null = null

  private _code: string | null = null
  private _connected = false
  private _connecting = false
  private _error: string | null = null
  private _waitingApproval = false
  private _rejected = false

  private history: string[] = []
  private onData: ((data: string) => void) | null = null
  private onSize: ((cols: number, rows: number) => void) | null = null
  private listeners = new Set<Listener>()

  subscribe(fn: Listener) {
    this.listeners.add(fn)
    // Bloque para descartar el boolean de Set.delete → unsubscribe es () => void,
    // compatible con el cleanup de useEffect.
    return () => { this.listeners.delete(fn) }
  }

  private notify() {
    for (const fn of this.listeners) fn()
  }

  private clearTimeout() {
    if (this.timeoutId) { clearTimeout(this.timeoutId); this.timeoutId = null }
  }

  get isConnected() { return this._connected }
  get isConnecting() { return this._connecting }
  get isWaitingApproval() { return this._waitingApproval }
  get code() { return this._code }
  get error() { return this._error }

  join(code: string) {
    // Clear any previous session
    if (this.channel) {
      this.clearTimeout()
      this.channel.unsubscribe()
      this.channel = null
    }

    this._code = code
    this._connecting = true
    this._connected = false
    this._error = null
    this._waitingApproval = false
    this._rejected = false
    this.history = []
    this.notify()

    const channelName = `terminal-${code}`
    console.log('[TerminalJoin] joining channel:', channelName)

    const channel = joinSupabase.channel(channelName, {
      config: { broadcast: { ack: false } }
    })

    // 15s timeout — if no status received, treat as failure
    this.timeoutId = setTimeout(() => {
      if (this._connecting) {
        console.log('[TerminalJoin] timeout — no status received')
        this._connecting = false
        this._error = 'Connection timed out'
        this.notify()
      }
    }, 15000)

    channel
      .on('broadcast', { event: 'data' }, ({ payload }) => {
        const data: string = payload.data
        this.history.push(data)
        if (this.history.length > 5000) this.history.shift()
        this.onData?.(data)
      })
      .on('broadcast', { event: 'size' }, ({ payload }) => {
        this.onSize?.(payload.cols as number, payload.rows as number)
      })
      .on('broadcast', { event: 'join-approved' }, () => {
        console.log('[TerminalJoin] join approved by host')
        this._waitingApproval = false
        this.notify()
      })
      .on('broadcast', { event: 'join-rejected' }, () => {
        console.log('[TerminalJoin] join rejected by host')
        this._rejected = true
        this._connected = false
        this._error = 'Host rejected the connection'
        this.notify()
      })
      .subscribe((status, err) => {
        console.log('[TerminalJoin] status:', status, err)
        this.clearTimeout()
        if (status === 'SUBSCRIBED') {
          this._connecting = false
          this._connected = true
          this._waitingApproval = true
          this.notify()
          // Ask the host for permission to send input
          channel.send({ type: 'broadcast', event: 'join-request', payload: {} })
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          this._connecting = false
          this._error = `Connection error: ${status}`
          this.notify()
        } else if (status === 'CLOSED') {
          this._connecting = false
          this._connected = false
          this.notify()
        }
      })

    this.channel = channel
  }

  attachViewer(fn: (data: string) => void) {
    this.onData = fn
    if (this.replayTimer) { clearTimeout(this.replayTimer); this.replayTimer = null }
    if (this.history.length > 0) {
      const snapshot = this.history.slice()
      this.replayTimer = setTimeout(() => {
        this.replayTimer = null
        for (const data of snapshot) fn(data)
      }, 50)
    }
  }

  detachViewer() {
    if (this.replayTimer) { clearTimeout(this.replayTimer); this.replayTimer = null }
    this.onData = null
    this.onSize = null
  }

  attachSizeListener(fn: (cols: number, rows: number) => void) {
    this.onSize = fn
  }

  /** Sends guest input to the host via broadcast. Blocked until host approves. */
  sendInput(data: string) {
    if (!this.channel || !this._connected || this._waitingApproval) return
    this.channel.send({ type: 'broadcast', event: 'input', payload: { data } })
  }

  /** Notifies the host of the viewer size so the PTY output is formatted correctly. */
  sendResize(cols: number, rows: number) {
    if (!this.channel || !this._connected) return
    this.channel.send({ type: 'broadcast', event: 'resize', payload: { cols, rows } })
  }

  leave() {
    this.clearTimeout()
    if (this.replayTimer) { clearTimeout(this.replayTimer); this.replayTimer = null }
    // Tell the host to restore its original size
    if (this.channel && this._connected) {
      this.channel.send({ type: 'broadcast', event: 'resize', payload: { cols: 0, rows: 0 } })
    }
    this.channel?.unsubscribe()
    this.channel = null
    this._code = null
    this._connected = false
    this._connecting = false
    this._error = null
    this._waitingApproval = false
    this._rejected = false
    this.history = []
    this.onData = null
    this.onSize = null
    this.notify()
  }
}

export const terminalJoinService = new TerminalJoinService()
