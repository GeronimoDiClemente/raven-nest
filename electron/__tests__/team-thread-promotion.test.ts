import { describe, it, expect } from 'vitest'
import { scopeForCapture } from '../integrations/team-thread-promotion'
import type { TeamThreadSettings } from '../integrations/team-thread-config'

const ON: TeamThreadSettings = { enabled: true, includedTypes: ['handoff', 'decision'], writeAgentsPointer: true }
const OFF: TeamThreadSettings = { ...ON, enabled: false }

describe('scopeForCapture', () => {
  it('con el hilo apagado todo sigue naciendo personal', () => {
    expect(scopeForCapture(OFF, 'handoff', 'Un handoff', 'Cuerpo.')).toEqual({ scope: 'personal', heldBack: false })
  })

  it('con el hilo prendido, un handoff nace team', () => {
    expect(scopeForCapture(ON, 'handoff', 'Un handoff', 'Cuerpo.')).toEqual({ scope: 'team', heldBack: false })
  })

  it('un tipo que no esta en la lista sigue naciendo personal', () => {
    expect(scopeForCapture(ON, 'bugfix', 'Un fix', 'Cuerpo.')).toEqual({ scope: 'personal', heldBack: false })
  })

  it('EL GATE: algo con pinta de secreto NO se promueve solo', () => {
    const r = scopeForCapture(ON, 'handoff', 'Deploy', 'export GITHUB_TOKEN=ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(r.scope).toBe('personal')
    expect(r.heldBack).toBe(true)
  })

  it('el gate mira tambien el titulo, no solo el cuerpo', () => {
    const r = scopeForCapture(ON, 'handoff', 'ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Cuerpo limpio.')
    expect(r.heldBack).toBe(true)
  })
})
