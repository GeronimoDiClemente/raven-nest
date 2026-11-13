// Spec §5.1. El orden de prioridad es la decision de producto entera metida en una funcion:
// el fallo mudo (§2.2) gana sobre TODO lo demas, porque es el unico estado donde el usuario
// esta perdiendo trabajo sin saberlo.
import { describe, it, expect } from 'vitest'
import { bloqueadasPorFalla, paneDisplayLabel, summarizeMemories, textoDeTopeDePlan, type MemoriesStatusInput } from '../lib/memories-status'

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

  // Visto en la app real (e2e de dos máquinas): con una memoria decía «1 items · synced».
  it('con una sola memoria habla en singular', () => {
    expect(summarizeMemories({ ...base, itemCount: 1 }).text).toBe('1 item · synced')
    expect(summarizeMemories({ ...base, itemCount: 1, connected: false }).text).toBe('1 item · local only')
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

// Spec 2026-09-11 §2: "los pane-ids se van" — App.tsx's generateId() produce
// `pane-<n>-<timestamp-ms>`; el timestamp no dice cual terminal cerrar.
describe('paneDisplayLabel', () => {
  it('un paneId real (pane-<n>-<timestamp>) muestra solo el numero de pane', () => {
    expect(paneDisplayLabel('pane-3-1789095333962')).toBe('pane 3')
  })

  it('un paneId de un solo digito tambien funciona', () => {
    expect(paneDisplayLabel('pane-1-1700000000000')).toBe('pane 1')
  })

  it('un paneId que no matchea el formato se muestra tal cual (mejor un id crudo que undefined)', () => {
    expect(paneDisplayLabel('pane-7')).toBe('pane-7')
    expect(paneDisplayLabel('some-other-id')).toBe('some-other-id')
  })
})

// Spec 2b-1 §4.5: lo retenido por el tope de proyectos es el plan funcionando, no una falla.
describe('bloqueadasPorFalla', () => {
  it('no cuenta project_limit_reached; los demás motivos sí', () => {
    expect(bloqueadasPorFalla([{ reason: 'project_limit_reached', count: 7 }])).toBe(0)
    expect(bloqueadasPorFalla([
      { reason: 'project_limit_reached', count: 7 },
      { reason: 'quota_exceeded', count: 3 },
      { reason: 'undecryptable', count: 1 },
    ])).toBe(4)
  })
})

describe('textoDeTopeDePlan (spec 2b-1 §4.7)', () => {
  it('el copy del spec, con «one project» para Free', () => {
    expect(textoDeTopeDePlan(7, 1)).toBe('7 memories stay on this machine — your plan syncs one project')
  })
  it('singular, y el número del plan si no es uno', () => {
    expect(textoDeTopeDePlan(1, 3)).toBe('1 memory stays on this machine — your plan syncs 3 projects')
  })
  it('sin tope informado (servicio viejo) no inventa cuántos (D6)', () => {
    expect(textoDeTopeDePlan(2, null)).toBe('2 memories stay on this machine')
  })
  it('un plan sin tope (Cloud, 100) tampoco dice cuántos sincroniza (D4)', () => {
    expect(textoDeTopeDePlan(2, 100)).toBe('2 memories stay on this machine')
  })
})
