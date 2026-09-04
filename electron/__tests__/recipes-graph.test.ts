import { describe, it, expect } from 'vitest'
import { defaultRecipes, type TrackedLookup } from '../integrations/recipes'
import type { DomainEvent, NotifyCommand } from '../integrations/bus-types'

const lookup: TrackedLookup = () => undefined

describe('graph recipes (default)', () => {
  it('graph.node_needs_input → notify naming the role', () => {
    const r = defaultRecipes(lookup).find((x) => x.when === 'graph.node_needs_input')!
    const ev: DomainEvent = { type: 'graph.node_needs_input', ticketId: 't', nodeId: 'rev-perf', role: 'reviewer', question: 'ttl?' }
    const cmds = r.then(ev)
    expect(cmds).toHaveLength(1)
    expect(cmds[0].cmd).toBe('notify')
    expect((cmds[0] as NotifyCommand).message).toContain('reviewer')
  })

  it('graph.gate_blocked → notify listing what blocked it', () => {
    const r = defaultRecipes(lookup).find((x) => x.when === 'graph.gate_blocked')!
    const ev: DomainEvent = { type: 'graph.gate_blocked', ticketId: 't', gateId: 'gate', blockedBy: ['rev-perf'] }
    const cmds = r.then(ev)
    expect((cmds[0] as NotifyCommand).message).toContain('rev-perf')
  })

  it('graph.completed → both notify and logOutcome', () => {
    const rs = defaultRecipes(lookup).filter((x) => x.when === 'graph.completed')
    expect(rs).toHaveLength(2)
    const ev: DomainEvent = { type: 'graph.completed', ticketId: 't', templateId: 'full' }
    const cmds = rs.flatMap((r) => r.then(ev))
    expect(cmds.map((c) => c.cmd).sort()).toEqual(['logOutcome', 'notify'])
  })
})
