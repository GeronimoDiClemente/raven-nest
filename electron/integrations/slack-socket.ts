// H7 — cliente Slack Socket Mode. Un WebSocket saliente autenticado con un
// app-level token (`xapp-...`, scope `connections:write`) que recibe los eventos
// del workspace sin exponer un endpoint público (imposible en un desktop).
//
// Flujo: `apps.connections.open` (POST, Bearer app token) devuelve una `wss://`
// efímera → abrimos el WebSocket ahí → por cada envelope ACKeamos de inmediato
// (o Slack reintenta) y dispatchamos vía parseEnvelope. Al cerrarse el socket
// (salvo `disconnect()` manual) reconectamos re-abriendo una URL nueva.
//
// El WebSocket es inyectable (`wsFactory`) para testear sin red: en tests se
// pasa un fake que captura `send` y simula `message`/`close`. Sin dependencia
// npm nueva — el default usa el `WebSocket` global de Node/Electron.
import { parseEnvelope, ackFrame, type SlackMention, type SlackAction } from './slack-envelopes'

/** API browser-like del WebSocket global de Node — lo mínimo que usamos. */
export interface WsLike {
  addEventListener(type: string, cb: (ev: unknown) => void): void
  send(data: string): void
  close(): void
}

export interface SlackSocketOptions {
  appToken: string
  fetch: typeof globalThis.fetch
  onAppMention: (m: SlackMention) => void
  onBlockAction: (a: SlackAction) => void
  /** Inyectable para tests; por default abre el WebSocket global. */
  wsFactory?: (url: string) => WsLike
}

const CONNECTIONS_OPEN = 'https://slack.com/api/apps.connections.open'

function defaultWsFactory(url: string): WsLike {
  const Ctor = (globalThis as { WebSocket?: new (url: string) => WsLike }).WebSocket
  if (!Ctor) throw new Error('WebSocket global no disponible (Node/Electron reciente lo trae)')
  return new Ctor(url)
}

export class SlackSocket {
  private ws: WsLike | null = null
  private stopped = false
  private readonly wsFactory: (url: string) => WsLike

  constructor(private readonly opts: SlackSocketOptions) {
    this.wsFactory = opts.wsFactory ?? defaultWsFactory
  }

  async connect(): Promise<void> {
    this.stopped = false
    const res = await this.opts.fetch(CONNECTIONS_OPEN, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.opts.appToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })
    const json = (await res.json()) as { ok?: boolean; url?: string; error?: string }
    if (!json.ok || !json.url) throw new Error(`apps.connections.open: ${json.error ?? 'sin url'}`)

    const ws = this.wsFactory(json.url)
    this.ws = ws
    ws.addEventListener('message', (ev) => this.onMessage(ev))
    ws.addEventListener('close', () => this.onClose())
  }

  private onMessage(ev: unknown): void {
    const raw = (ev as { data?: unknown })?.data
    let env: unknown
    try {
      env = typeof raw === 'string' ? JSON.parse(raw) : raw
    } catch {
      return // frame no-JSON: ignorar en vez de crashear el socket
    }
    // ACK inmediato por cada envelope con id (o Slack reintenta el evento).
    const envelopeId = (env as { envelope_id?: string })?.envelope_id
    if (envelopeId) this.ws?.send(ackFrame(envelopeId))

    const parsed = parseEnvelope(env)
    if (parsed.kind === 'mention') {
      this.opts.onAppMention(parsed.mention)
    } else if (parsed.kind === 'action') {
      this.opts.onBlockAction(parsed.action)
    } else if (parsed.control === 'disconnect') {
      // Slack avisa que va a cortar (refresh de infra): cerramos para que el
      // handler de close reabra con una URL nueva.
      this.ws?.close()
    }
    // resto de controls (hello, etc.) → noop
  }

  private onClose(): void {
    if (this.stopped) return
    // Reconexión: re-open + reconectar. Un fallo de connect (ej red caída) se
    // loguea; el próximo close/ciclo reintenta. Sin backoff en v1 (documentado).
    void this.connect().catch((e) => console.warn('[slack-socket] reconnect failed', e))
  }

  disconnect(): void {
    this.stopped = true
    this.ws?.close()
  }
}
