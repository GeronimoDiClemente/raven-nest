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
  private snapshot: string | null = null
  private hostCols = 0
  private hostRows = 0
  private onData: ((data: string) => void) | null = null
  private onSize: ((cols: number, rows: number) => void) | null = null
  private listeners = new Set<Listener>()

  subscribe(fn: Listener) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
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
        this.hostCols = payload.cols as number
        this.hostRows = payload.rows as number
        this.onSize?.(this.hostCols, this.hostRows)
      })
      .on('broadcast', { event: 'snapshot' }, ({ payload }) => {
        // Foto de la pantalla del host al momento de entrar. Reemplaza al
        // historial incremental: lo que venga despues son deltas sobre ESTA base.
        this.snapshot = payload.data as string
        this.history = []
        if (this.onData) this.writeSnapshot(this.onData)
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
    if (this.replayTimer) { clearTimeout(this.replayTimer); this.replayTimer = null }
    // El estado conocido se escribe ANTES de enganchar el stream vivo, y de
    // forma sincrona. Antes era al reves: onData se enganchaba ya y el historial
    // se replayeaba 50ms despues, asi que los primeros chunks nuevos se escribian
    // ANTES que los viejos y la pantalla quedaba corrupta en cada join.
    this.writeSnapshot(fn)
    for (const data of this.history) fn(data)
    this.onData = fn
  }

  /** Limpia la pantalla y escribe la foto del host, si la tenemos. */
  private writeSnapshot(fn: (data: string) => void) {
    if (!this.snapshot) return
    fn('\x1b[H\x1b[2J\x1b[3J')
    fn(this.snapshot)
  }

  /** Tamano del host, para que el viewer adopte sus columnas. */
  get hostSize(): { cols: number; rows: number } | null {
    return this.hostCols > 0 ? { cols: this.hostCols, rows: this.hostRows } : null
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
