import { describe, it, expect } from 'vitest'
import {
  isDomainEvent,
  isCommand,
  type DomainEvent,
  type Command,
} from '../integrations/bus-types'

const events: DomainEvent[] = [
  { type: 'task.created', taskId: 't1', pluginId: 'jira', providerId: 'p1', repoFullName: 'o/r', branch: 'b', title: 'T' },
  { type: 'task.created', taskId: 't1', pluginId: 'jira', providerId: 'p1', repoFullName: null, branch: 'b' },
  { type: 'session.opened', branch: 'b', repoPath: '/tmp/r' },
  { type: 'session.opened', branch: 'b', repoPath: '/tmp/r', pluginId: 'jira', providerId: 'p1' },
  { type: 'session.closed', branch: 'b' },
  { type: 'pr.opened', branch: 'b', repoFullName: 'o/r' },
  { type: 'pr.merged', branch: 'b', repoFullName: 'o/r' },
  { type: 'ci.failed', branch: 'b', repoFullName: 'o/r' },
  { type: 'ci.failed', branch: 'b', repoFullName: 'o/r', runUrl: 'u', summary: 's' },
  { type: 'error.detected', source: 'sentry', ref: 'ISSUE-1', summary: 'boom' },
  { type: 'block.started', label: 'deep work' },
  { type: 'block.started', taskId: 't1', label: 'deep work' },
  { type: 'meeting.transcribed', title: 'standup', items: ['a', 'b'] },
]

const commands: Command[] = [
  { cmd: 'createTask', pluginId: 'jira', title: 'T' },
  { cmd: 'createTask', pluginId: 'jira', title: 'T', body: 'body' },
  { cmd: 'openSession' },
  { cmd: 'openSession', pluginId: 'jira', providerId: 'p1', branch: 'b', repoFullName: 'o/r', context: 'ctx' },
  { cmd: 'notify', channel: '#dev', message: 'hi' },
  { cmd: 'notify', channel: '#dev', message: 'hi', buttons: [{ label: 'Fix', action: 'fix' }] },
  { cmd: 'updateStatus', pluginId: 'jira', providerId: 'p1', to: 'in_review' },
  { cmd: 'logOutcome', ref: 'r', summary: 's' },
  { cmd: 'scheduleBlock', when: '2026-07-21T10:00', label: 'focus' },
]

describe('isDomainEvent', () => {
  it('acepta todos los eventos bien formados', () => {
    for (const ev of events) expect(isDomainEvent(ev)).toBe(true)
  })

  it('rechaza null/undefined/primitivos', () => {
    expect(isDomainEvent(null)).toBe(false)
    expect(isDomainEvent(undefined)).toBe(false)
    expect(isDomainEvent('pr.opened')).toBe(false)
    expect(isDomainEvent(42)).toBe(false)
  })

  it('rechaza un type desconocido', () => {
    expect(isDomainEvent({ type: 'pr.reopened', branch: 'b', repoFullName: 'o/r' })).toBe(false)
    expect(isDomainEvent({ branch: 'b' })).toBe(false)
  })

  it('rechaza eventos con campos requeridos faltantes o mal tipados', () => {
    expect(isDomainEvent({ type: 'pr.opened', branch: 'b' })).toBe(false)
    expect(isDomainEvent({ type: 'pr.opened', branch: 7, repoFullName: 'o/r' })).toBe(false)
    expect(isDomainEvent({ type: 'task.created', taskId: 't1', pluginId: 'jira', providerId: 'p1', branch: 'b' })).toBe(false)
    expect(isDomainEvent({ type: 'meeting.transcribed', title: 'x', items: 'nope' })).toBe(false)
    expect(isDomainEvent({ type: 'meeting.transcribed', title: 'x', items: [1, 2] })).toBe(false)
  })

  it('rechaza campos opcionales mal tipados si están presentes', () => {
    expect(isDomainEvent({ type: 'ci.failed', branch: 'b', repoFullName: 'o/r', runUrl: 5 })).toBe(false)
    expect(isDomainEvent({ type: 'session.opened', branch: 'b', repoPath: '/r', pluginId: 9 })).toBe(false)
  })

  it('acepta repoFullName null en task.created pero rechaza número', () => {
    expect(isDomainEvent({ type: 'task.created', taskId: 't', pluginId: 'j', providerId: 'p', repoFullName: null, branch: 'b' })).toBe(true)
    expect(isDomainEvent({ type: 'task.created', taskId: 't', pluginId: 'j', providerId: 'p', repoFullName: 3, branch: 'b' })).toBe(false)
  })

  it('changes.requested válido', () => {
    expect(isDomainEvent({ type: 'changes.requested', branch: 'feat/x', repoFullName: 'o/r', prNumber: 5 })).toBe(true)
    expect(isDomainEvent({ type: 'changes.requested', branch: 'feat/x', repoFullName: 'o/r' })).toBe(false)
  })
  it('review.requested válido', () => {
    expect(isDomainEvent({ type: 'review.requested', repoFullName: 'o/r', prNumber: 5, prTitle: 'x' })).toBe(true)
    expect(isDomainEvent({ type: 'review.requested', repoFullName: 'o/r', prNumber: 5 })).toBe(false)
  })
})

describe('isCommand', () => {
  it('acepta todos los comandos bien formados', () => {
    for (const cmd of commands) expect(isCommand(cmd)).toBe(true)
  })

  it('rechaza null/undefined/primitivos', () => {
    expect(isCommand(null)).toBe(false)
    expect(isCommand(undefined)).toBe(false)
    expect(isCommand('notify')).toBe(false)
  })

  it('rechaza un cmd desconocido', () => {
    expect(isCommand({ cmd: 'deleteEverything' })).toBe(false)
    expect(isCommand({ pluginId: 'jira' })).toBe(false)
  })

  it('rechaza comandos con campos requeridos faltantes o mal tipados', () => {
    expect(isCommand({ cmd: 'createTask', pluginId: 'jira' })).toBe(false)
    expect(isCommand({ cmd: 'notify', channel: '#dev' })).toBe(false)
    expect(isCommand({ cmd: 'updateStatus', pluginId: 'j', providerId: 'p', to: 'blocked' })).toBe(false)
    expect(isCommand({ cmd: 'updateStatus', pluginId: 'j', providerId: 'p' })).toBe(false)
  })

  it('valida buttons de notify si están presentes', () => {
    expect(isCommand({ cmd: 'notify', channel: '#dev', message: 'hi', buttons: [{ label: 'x' }] })).toBe(false)
    expect(isCommand({ cmd: 'notify', channel: '#dev', message: 'hi', buttons: 'nope' })).toBe(false)
    expect(isCommand({ cmd: 'notify', channel: '#dev', message: 'hi', buttons: [] })).toBe(true)
  })

  it('acepta updateStatus con cada TicketState válido', () => {
    for (const to of ['todo', 'in_progress', 'in_review', 'done']) {
      expect(isCommand({ cmd: 'updateStatus', pluginId: 'j', providerId: 'p', to })).toBe(true)
    }
  })

  it('setPresence válido', () => {
    expect(isCommand({ cmd: 'setPresence', text: 'focus: X' })).toBe(true)
    expect(isCommand({ cmd: 'setPresence', text: 'focus: X', emoji: ':fire:' })).toBe(true)
    expect(isCommand({ cmd: 'setPresence' })).toBe(false)
    expect(isCommand({ cmd: 'setPresence', text: 5 })).toBe(false)
  })
})
