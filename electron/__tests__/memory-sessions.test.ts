// Spec §2.2 — el peor modo de falla del sistema, hoy completamente invisible: una terminal
// arrancada desde Nest, con NEST_MEMORY_SOCKET inyectado, cuya CLI nunca llego al bridge
// (el MCP murio con CONNECTION_CLOSED, o el hook no corrio). Este modulo es puro a
// proposito: el cruce se testea sin PTY, sin sockets y sin SQLite.
import { describe, it, expect } from 'vitest'
import { reconcileSessions, type PaneWithMemory, type OpenSessionRow } from '../memory-sessions'

const NOW = 1_757_000_000_000
const pane = (over: Partial<PaneWithMemory> = {}): PaneWithMemory => ({
  paneId: 'pane-1', aiType: 'claude', account: 'claude:Gero Personal',
  enabled: true, startedAt: NOW - 60_000, ...over,
})
const session = (over: Partial<OpenSessionRow> = {}): OpenSessionRow => ({
  id: 'sess-1', pane_id: 'pane-1', project_key: 'proj', ai_type: 'claude',
  account: 'claude:Gero Personal', started_at: NOW - 55_000, ...over,
})

describe('reconcileSessions', () => {
  it('un pane con memoria inyectada y sesion abierta esta escribiendo', () => {
    const [verdict] = reconcileSessions([pane()], [session()], NOW)
    expect(verdict.health).toBe('writing')
    expect(verdict.sessionId).toBe('sess-1')
  })

  it('un pane con memoria inyectada y SIN sesion, pasada la gracia, esta mudo', () => {
    const [verdict] = reconcileSessions([pane()], [], NOW)
    expect(verdict.health).toBe('silent')
    expect(verdict.sessionId).toBeNull()
  })

  it('un pane recien abierto no se reporta mudo todavia — la CLI esta arrancando', () => {
    const [verdict] = reconcileSessions([pane({ startedAt: NOW - 2_000 })], [], NOW)
    expect(verdict.health).toBe('writing')
  })

  it('un pane con la memoria apagada por config se reporta disabled, no mudo', () => {
    const [verdict] = reconcileSessions([pane({ enabled: false })], [], NOW)
    expect(verdict.health).toBe('disabled')
  })

  it('una sesion de otro pane no tapa el fallo de este', () => {
    const verdicts = reconcileSessions(
      [pane({ paneId: 'pane-a' }), pane({ paneId: 'pane-b' })],
      [session({ pane_id: 'pane-a' })],
      NOW
    )
    expect(verdicts.find((v) => v.paneId === 'pane-a')!.health).toBe('writing')
    expect(verdicts.find((v) => v.paneId === 'pane-b')!.health).toBe('silent')
  })

  it('una sesion sin pane_id no se le asigna a nadie', () => {
    const [verdict] = reconcileSessions([pane()], [session({ pane_id: null })], NOW)
    expect(verdict.health).toBe('silent')
  })
})
