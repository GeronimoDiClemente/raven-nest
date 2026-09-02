import { describe, it, expect } from 'vitest'
import { aEquipos, type FilaTeam, type FilaMiembro, type FilaRepo } from '../equipos.ts'

const DUENO = '10663452-fd04-401f-8e92-f5927f503703'
const OTRO = '7d5ad196-a62c-4065-bfb9-f5d7119ddcea'

const TEAM: FilaTeam = {
  id: 't1', name: 'STI-PROJECTS', owner_id: DUENO, created_at: '2026-05-01T10:00:00.000Z',
}

const MIEMBRO_DUENO: FilaMiembro = {
  id: 'm1', team_id: 't1', user_id: DUENO, email: 'gero@nestmux.com',
  role: 'leader', status: 'active', invited_at: null, accepted_at: '2026-05-01T10:00:00.000Z',
}

const MIEMBRO_OTRO: FilaMiembro = {
  id: 'm2', team_id: 't1', user_id: OTRO, email: 'otro@nestmux.com',
  role: 'member', status: 'active', invited_at: '2026-05-02T10:00:00.000Z',
  accepted_at: '2026-05-03T10:00:00.000Z',
}

describe('aEquipos', () => {
  it('marca es_dueno en el equipo cuando el usuario es owner_id', () => {
    const [e] = aEquipos(DUENO, [TEAM], [MIEMBRO_DUENO], [], {})
    expect(e.es_dueno).toBe(true)
  })

  it('no marca es_dueno cuando el usuario solo es miembro', () => {
    const [e] = aEquipos(OTRO, [TEAM], [MIEMBRO_DUENO, MIEMBRO_OTRO], [], {})
    expect(e.es_dueno).toBe(false)
  })

  // La propiedad la define teams.owner_id, NO team_members.role: hay equipos
  // reales con 4 miembros marcados 'leader' y un solo dueño.
  it('marca es_dueno del miembro por owner_id y no por el role', () => {
    const cuatroLideres: FilaMiembro[] = [
      MIEMBRO_DUENO,
      { ...MIEMBRO_OTRO, role: 'leader' },
    ]
    const [e] = aEquipos(DUENO, [TEAM], cuatroLideres, [], {})
    expect(e.miembros.find((m) => m.id === 'm1')!.es_dueno).toBe(true)
    expect(e.miembros.find((m) => m.id === 'm2')!.es_dueno).toBe(false)
  })

  it('reporta el dueno con el email que sale de su fila de miembro', () => {
    const [e] = aEquipos(DUENO, [TEAM], [MIEMBRO_DUENO], [], {})
    expect(e.dueno).toEqual({ id: DUENO, email: 'gero@nestmux.com' })
  })

  // Los 3 equipos de prueba que hay en produccion no tienen ninguna fila en
  // team_members, ni siquiera la del dueno.
  it('sin filas de miembros el dueno queda sin email en vez de romper', () => {
    const [e] = aEquipos(DUENO, [TEAM], [], [], {})
    expect(e.dueno).toEqual({ id: DUENO, email: null })
    expect(e.miembros).toEqual([])
  })

  // La FK es ON DELETE SET NULL: la fila sobrevive al borrado de la cuenta y
  // sigue ocupando un seat. Es justo la que alguien tiene que poder sacar.
  it('conserva el miembro cuya cuenta se borro, con user_id null', () => {
    const huerfano: FilaMiembro = { ...MIEMBRO_OTRO, user_id: null }
    const [e] = aEquipos(DUENO, [TEAM], [MIEMBRO_DUENO, huerfano], [], {})
    const m = e.miembros.find((x) => x.id === 'm2')!
    expect(m.user_id).toBeNull()
    expect(m.email).toBe('otro@nestmux.com')
    expect(m.es_dueno).toBe(false)
  })

  it('normaliza el status ausente a pending y el role ausente a member', () => {
    const raro: FilaMiembro = { ...MIEMBRO_OTRO, role: null, status: null }
    const [e] = aEquipos(DUENO, [TEAM], [raro], [], {})
    expect(e.miembros[0].status).toBe('pending')
    expect(e.miembros[0].role).toBe('member')
  })

  it('mapea los repos compartidos sin el path local', () => {
    const repo: FilaRepo = {
      team_id: 't1', repo_full_name: 'gero/nest', provider: 'github',
      added_at: '2026-06-01T10:00:00.000Z',
    }
    const [e] = aEquipos(DUENO, [TEAM], [MIEMBRO_DUENO], [repo], {})
    expect(e.repos).toEqual([
      { full_name: 'gero/nest', provider: 'github', agregado: '2026-06-01T10:00:00.000Z' },
    ])
    expect(JSON.stringify(e.repos)).not.toContain('local_path')
  })

  it('toma el conteo de mensajes del mapa y cae a cero si falta', () => {
    const [conMensajes] = aEquipos(DUENO, [TEAM], [MIEMBRO_DUENO], [], { t1: 3 })
    expect(conMensajes.mensajes).toBe(3)
    const [sinMensajes] = aEquipos(DUENO, [TEAM], [MIEMBRO_DUENO], [], {})
    expect(sinMensajes.mensajes).toBe(0)
  })

  it('no mezcla miembros ni repos entre equipos', () => {
    const otroTeam: FilaTeam = { ...TEAM, id: 't2', name: 'RENEMED.com' }
    const deOtro: FilaMiembro = { ...MIEMBRO_OTRO, id: 'm9', team_id: 't2' }
    const equipos = aEquipos(DUENO, [TEAM, otroTeam], [MIEMBRO_DUENO, deOtro], [], {})
    expect(equipos.find((e) => e.id === 't1')!.miembros.map((m) => m.id)).toEqual(['m1'])
    expect(equipos.find((e) => e.id === 't2')!.miembros.map((m) => m.id)).toEqual(['m9'])
  })

  it('ordena los equipos propios primero y despues por nombre', () => {
    const ajeno: FilaTeam = { ...TEAM, id: 't2', name: 'AAA ajeno', owner_id: OTRO }
    const equipos = aEquipos(DUENO, [ajeno, TEAM], [], [], {})
    expect(equipos.map((e) => e.id)).toEqual(['t1', 't2'])
  })
})
