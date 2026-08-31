/**
 * Terminal sharing singleton — one independent channel per pane.
 * Survives component mount/unmount cycles.
 */
import { supabase } from './supabase'
import { getTerminal } from '../terminal-instances'
import { subscribeToPtyData } from '../pty-events'

function generateCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const array = new Uint32Array(8)
  crypto.getRandomValues(array)
  return Array.from(array, v => chars[v % chars.length]).join('')
}

interface PaneSession {
  code: string
  channelName: string
  channel: ReturnType<typeof supabase.channel>
  unsubPty: () => void
  queue: string[]
  ready: boolean
  dead: boolean // true when stop() was called — cancels reconnection
  hostCols: number  // last known size of the host terminal
  hostRows: number
  retryCount: number
  retryTimer: ReturnType<typeof setTimeout> | null
  inputAllowed: boolean
  onJoinRequest: (() => void) | null
}

type Listener = (paneId: string) => void

class TerminalShareService {
  private sessions = new Map<string, PaneSession>()
  private listeners = new Set<Listener>()

  subscribe(fn: Listener) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private notify(paneId: string) {
    for (const fn of this.listeners) fn(paneId)
  }

  isSharing(paneId: string): boolean {
    return this.sessions.has(paneId)
  }

  shareCode(paneId: string): string | null {
    return this.sessions.get(paneId)?.code ?? null
  }

  private createChannel(session: PaneSession, paneId: string) {
    const ch = supabase.channel(session.channelName, {
      // self:true — the server echoes back to the same WebSocket (needed when host and guest are in the same process)
      config: { broadcast: { self: true, ack: false } }
    })

    ch.on('broadcast', { event: 'join-request' }, () => {
      session.onJoinRequest?.()
      // El invitado arranca con un xterm vacio y solo recibe deltas: una TUI
      // (Ink/Claude Code) emite updates direccionados por cursor sobre una
      // pantalla que el invitado nunca vio, asi que veia basura. Le mandamos el
      // tamano del host y el scrollback completo para que parta del mismo estado.
      void this.sendHandshake(session, paneId)
    })

    ch.on('broadcast', { event: 'input' }, ({ payload }) => {
      if (!session.inputAllowed) return  // not approved yet
      const data = payload.data
      if (typeof data !== 'string' || data.length === 0 || data.length > 1024) return
      window.pty.write(paneId, data)
    })

    // El PTY lo redimensiona SOLO su dueno. Antes el invitado dictaba su tamano
    // ("the viewer dictates its size") y el host terminaba con las columnas del
    // otro mientras su propio xterm seguia en las suyas: doble wrap, scroll
    // descontrolado y, como hostCols nunca se poblaba en el flujo normal, el
    // tamano NO se restauraba al irse el invitado. Encima no estaba gateado por
    // la aprobacion, asi que alguien recien rechazado ya te habia roto la
    // terminal. Ahora el invitado adopta el tamano del host (evento 'size') y
    // escala; este mensaje queda ignorado por compatibilidad con clientes viejos.
    ch.on('broadcast', { event: 'resize' }, () => { /* ignorado a proposito */ })

    ch.subscribe((status) => {
      console.log('[TerminalShare] pane', paneId, 'status:', status)
      if (session.dead) return

      if (status === 'SUBSCRIBED') {
        session.ready = true
        session.retryCount = 0
        session.channel = ch
        // Flush data accumulated while connecting
        const queued = session.queue.splice(0)
        for (const data of queued) {
          ch.send({ type: 'broadcast', event: 'data', payload: { data } })
        }
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        session.ready = false
        // Create a new channel (a CLOSED channel cannot be re-subscribed)
        session.retryCount++
        if (session.retryCount > 5) {
          session.dead = true
          console.error('[TerminalShare] pane', paneId, 'failed permanently after', session.retryCount - 1, 'retries')
          this.notify(paneId)
          return
        }
        const delay = Math.min(2000 * Math.pow(2, session.retryCount - 1), 30000)
        console.log('[TerminalShare] pane', paneId, 'retry', session.retryCount, 'in', delay, 'ms')
        session.retryTimer = setTimeout(() => {
          session.retryTimer = null
          if (!session.dead) this.createChannel(session, paneId)
        }, delay)
      }
    })

    session.channel = ch
  }

  /** Tamano + foto de la pantalla del host, para que el invitado arranque igual. */
  private async sendHandshake(session: PaneSession, paneId: string) {
    const term = getTerminal(paneId)
    if (term) {
      session.hostCols = term.cols
      session.hostRows = term.rows
    }
    if (!session.ready) return
    if (session.hostCols > 0) {
      session.channel.send({ type: 'broadcast', event: 'size', payload: { cols: session.hostCols, rows: session.hostRows } })
    }
    try {
      const buffer = await window.pty.getBuffer(paneId)
      if (buffer) session.channel.send({ type: 'broadcast', event: 'snapshot', payload: { data: buffer } })
    } catch { /* el snapshot es best-effort: sin el, el invitado ve solo lo nuevo */ }
  }

  start(paneId: string) {
    if (this.sessions.has(paneId)) this.stop(paneId)

    const code = generateCode()
    const channelName = `terminal-${code}`
    console.log('[TerminalShare] pane', paneId, 'starting on channel:', channelName)

    const session: PaneSession = {
      code,
      channelName,
      channel: null!,
      unsubPty: () => {},
      queue: [],
      ready: false,
      dead: false,
      // Se poblaba SOLO desde broadcastSize, que en el flujo normal (abrir Share
      // no cambia el tamano del contenedor) nunca corria: quedaba en 0 y la
      // restauracion del tamano del host era codigo muerto.
      hostCols: getTerminal(paneId)?.cols ?? 0,
      hostRows: getTerminal(paneId)?.rows ?? 0,
      retryCount: 0,
      retryTimer: null,
      inputAllowed: false,
      onJoinRequest: null,
    }
    this.sessions.set(paneId, session)
    this.notify(paneId)

    this.createChannel(session, paneId)

    const unsubPty = subscribeToPtyData((id, data) => {
      if (id !== paneId) return
      if (session.ready) {
        session.channel.send({ type: 'broadcast', event: 'data', payload: { data } })
      } else {
        session.queue.push(data)
        if (session.queue.length > 2000) session.queue.shift()
      }
    })

    session.unsubPty = unsubPty
  }

  approveGuest(paneId: string) {
    const session = this.sessions.get(paneId)
    if (!session?.ready) return
    session.inputAllowed = true
    session.channel.send({ type: 'broadcast', event: 'join-approved', payload: {} })
  }

  rejectGuest(paneId: string) {
    const session = this.sessions.get(paneId)
    if (!session?.ready) return
    session.channel.send({ type: 'broadcast', event: 'join-rejected', payload: {} })
  }

  setJoinRequestCallback(paneId: string, fn: () => void) {
    const session = this.sessions.get(paneId)
    if (session) session.onJoinRequest = fn
  }

  stop(paneId: string) {
    const session = this.sessions.get(paneId)
    if (!session) return
    if (session.retryTimer) {
      clearTimeout(session.retryTimer)
      session.retryTimer = null
    }
    session.dead = true
    session.inputAllowed = false
    session.onJoinRequest = null
    session.unsubPty()
    session.channel?.unsubscribe()
    this.sessions.delete(paneId)
    this.notify(paneId)
  }

  /** Called from TerminalPane when xterm resizes — saves the host size. */
  broadcastSize(paneId: string, cols: number, rows: number) {
    const session = this.sessions.get(paneId)
    if (!session?.ready) return
    session.hostCols = cols
    session.hostRows = rows
    session.channel.send({ type: 'broadcast', event: 'size', payload: { cols, rows } })
  }

  stopAll() {
    for (const paneId of this.sessions.keys()) this.stop(paneId)
  }
}

export const terminalShareService = new TerminalShareService()
