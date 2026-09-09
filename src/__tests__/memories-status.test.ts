// Spec §5.1. El orden de prioridad es la decision de producto entera metida en una funcion:
// el fallo mudo (§2.2) gana sobre TODO lo demas, porque es el unico estado donde el usuario
// esta perdiendo trabajo sin saberlo.
import { describe, it, expect } from 'vitest'
import { summarizeMemories, type MemoriesStatusInput } from '../lib/memories-status'

const base: MemoriesStatusInput = {
  available: true, connected: true, itemCount: 142,
  pendingCount: 0, blockedTotal: 0, vaultConflicts: 0, silentSessions: 0,
}

describe('summarizeMemories', () => {
  it('todo en orden: verde, con el conteo', () => {
    expect(summarizeMemories(base)).toEqual({ dot: 'green', text: '142 items · synced' })
  })

  it('una sesion muda gana sobre todo lo demas', () => {
    const status = summarizeMemories({ ...base, silentSessions: 1, pendingCount: 5, blockedTotal: 9 })
    expect(status.dot).toBe('red')
    expect(status.text).toBe('1 session not writing')
  })

  it('pluraliza las sesiones mudas', () => {
    expect(summarizeMemories({ ...base, silentSessions: 3 }).text).toBe('3 sessions not writing')
  })

  it('mutaciones bloqueadas: ambar, y lo dice', () => {
    const status = summarizeMemories({ ...base, blockedTotal: 816 })
    expect(status).toEqual({ dot: 'amber', text: '816 blocked' })
  })

  it('conflictos del vault: ambar', () => {
    expect(summarizeMemories({ ...base, vaultConflicts: 2 })).toEqual({ dot: 'amber', text: '2 conflicts' })
  })

  it('bloqueadas gana sobre conflictos: es lo que no esta llegando a la nube', () => {
    expect(summarizeMemories({ ...base, blockedTotal: 3, vaultConflicts: 2 }).text).toBe('3 blocked')
  })

  it('pendientes normales: ambar, pero es transitorio', () => {
    expect(summarizeMemories({ ...base, pendingCount: 7 })).toEqual({ dot: 'amber', text: '7 pending' })
  })

  it('sin nube: gris y local only — no es un error, es un plan Free', () => {
    expect(summarizeMemories({ ...base, connected: false })).toEqual({ dot: 'grey', text: '142 items · local only' })
  })

  it('sin subsistema de memoria: gris y lo dice', () => {
    expect(summarizeMemories({ ...base, available: false })).toEqual({ dot: 'grey', text: 'unavailable' })
  })

  it('una sesion muda tambien gana estando sin nube', () => {
    expect(summarizeMemories({ ...base, connected: false, silentSessions: 1 }).dot).toBe('red')
  })

  it('un conflicto en singular no dice "conflicts"', () => {
    expect(summarizeMemories({ ...base, vaultConflicts: 1 }).text).toBe('1 conflict')
  })
})
