// H7 — parseo puro de los envelopes de Slack Socket Mode. Sin red, sin estado:
// toma el objeto JSON ya deserializado que llega por el WebSocket y lo clasifica
// en una unión discriminada por `kind` (mention/action/control). El cliente
// SlackSocket usa esto para decidir qué callback disparar; el ACK lo hace por
// separado con `ackFrame`. Determinista y trivialmente testeable.

/** Mención `@Nest` en un canal/thread, ya con el texto limpio (sin el `<@...>`). */
export interface SlackMention {
  channel: string
  threadTs: string
  user: string
  text: string
}

/** Click de un botón Block Kit (block_actions). `value` viaja el contexto (ej worktreePath). */
export interface SlackAction {
  actionId: string
  value?: string
  channel: string
  threadTs?: string
  user: string
}

export type ParsedEnvelope =
  | { kind: 'mention'; envelopeId?: string; mention: SlackMention }
  | { kind: 'action'; envelopeId?: string; action: SlackAction }
  | { kind: 'control'; envelopeId?: string; control?: string }

// Shapes mínimos de lo que consumimos del envelope (Slack manda mucho más).
interface RawEnvelope {
  type?: string
  envelope_id?: string
  payload?: {
    type?: string
    event?: {
      type?: string
      channel?: string
      ts?: string
      thread_ts?: string
      user?: string
      text?: string
    }
    user?: { id?: string }
    channel?: { id?: string }
    message?: { thread_ts?: string; ts?: string }
    actions?: Array<{ action_id?: string; value?: string }>
  }
}

// Quita el primer `<@USERID>` (la mención al bot) y trimea. El resto del texto
// es la instrucción para el agente.
function stripMention(text: string): string {
  return text.replace(/<@[^>]+>/, '').trim()
}

export function parseEnvelope(env: unknown): ParsedEnvelope {
  const e = (env ?? {}) as RawEnvelope
  const envelopeId = e.envelope_id
  const payload = e.payload

  if (e.type === 'events_api' && payload?.event?.type === 'app_mention') {
    const ev = payload.event
    return {
      kind: 'mention',
      envelopeId,
      mention: {
        channel: ev.channel ?? '',
        threadTs: ev.thread_ts ?? ev.ts ?? '',
        user: ev.user ?? '',
        text: stripMention(ev.text ?? ''),
      },
    }
  }

  if (e.type === 'interactive' && payload?.type === 'block_actions') {
    const first = payload.actions?.[0]
    return {
      kind: 'action',
      envelopeId,
      action: {
        actionId: first?.action_id ?? '',
        value: first?.value,
        channel: payload.channel?.id ?? '',
        // Igual que el mention path: si el botón está sobre un mensaje top-level
        // (sin thread_ts), caemos al ts del mensaje para que slack:postThread tenga
        // dónde responder en vez de no-opear.
        threadTs: payload.message?.thread_ts ?? payload.message?.ts ?? '',
        user: payload.user?.id ?? '',
      },
    }
  }

  return { kind: 'control', envelopeId, control: e.type }
}

/** Frame de ACK que Slack espera por cada envelope con `envelope_id`. */
export function ackFrame(envelopeId: string): string {
  return JSON.stringify({ envelope_id: envelopeId })
}
