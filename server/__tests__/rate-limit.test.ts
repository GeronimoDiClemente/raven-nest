import { describe, it, expect } from 'vitest'
import { createRateLimiter } from '../src/rate-limit'

describe('createRateLimiter', () => {
  it('deja pasar hasta el limite y frena el siguiente', () => {
    let clock = 1_000_000
    const rl = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => clock })

    expect(rl.check('device-a').ok).toBe(true)
    expect(rl.check('device-a').ok).toBe(true)
    expect(rl.check('device-a').ok).toBe(true)

    const blocked = rl.check('device-a')
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.retryAfterSeconds).toBe(60)
  })

  it('cuenta cada device por separado', () => {
    let clock = 1_000_000
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => clock })

    expect(rl.check('device-a').ok).toBe(true)
    expect(rl.check('device-b').ok).toBe(true)
    expect(rl.check('device-a').ok).toBe(false)
  })

  it('vuelve a dejar pasar cuando la ventana termina', () => {
    let clock = 1_000_000
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => clock })

    expect(rl.check('device-a').ok).toBe(true)
    expect(rl.check('device-a').ok).toBe(false)
    clock += 60_001
    expect(rl.check('device-a').ok).toBe(true)
  })
})
