import { describe, it, expect } from 'vitest'
import { parseEnvelope, ackFrame } from '../integrations/slack-envelopes'

describe('slack envelopes', () => {
  it('app_mention → mention con channel/thread/user/text limpio (sin la mención)', () => {
    const env = { type: 'events_api', envelope_id: 'e1', payload: { event: {
      type: 'app_mention', channel: 'C1', ts: '111.1', thread_ts: '110.0', user: 'U9',
      text: '<@UBOT> arreglá el build',
    } } }
    const out = parseEnvelope(env)
    expect(out).toEqual({ kind: 'mention', envelopeId: 'e1',
      mention: { channel: 'C1', threadTs: '110.0', user: 'U9', text: 'arreglá el build' } })
  })

  it('app_mention sin thread_ts usa el ts del mensaje como thread', () => {
    const env = { type: 'events_api', envelope_id: 'e2', payload: { event: {
      type: 'app_mention', channel: 'C1', ts: '111.1', user: 'U9', text: '<@UBOT> hola' } } }
    expect((parseEnvelope(env) as { mention: { threadTs: string } }).mention.threadTs).toBe('111.1')
  })

  it('block_actions → action con actionId/value/channel/thread', () => {
    const env = { type: 'interactive', envelope_id: 'e3', payload: {
      type: 'block_actions', user: { id: 'U9' },
      channel: { id: 'C1' }, message: { thread_ts: '110.0' },
      actions: [{ action_id: 'fix_ci', value: '/wt/x' }] } }
    expect(parseEnvelope(env)).toEqual({ kind: 'action', envelopeId: 'e3',
      action: { actionId: 'fix_ci', value: '/wt/x', channel: 'C1', threadTs: '110.0', user: 'U9' } })
  })

  it('hello/disconnect/desconocido → kind control', () => {
    expect(parseEnvelope({ type: 'hello' }).kind).toBe('control')
    expect(parseEnvelope({ type: 'disconnect', envelope_id: 'x' }).kind).toBe('control')
  })

  it('ackFrame serializa {envelope_id}', () => {
    expect(JSON.parse(ackFrame('e1'))).toEqual({ envelope_id: 'e1' })
  })
})
