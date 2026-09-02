import { describe, it, expect } from 'vitest'
import {
  aEquipos, validarSacarMiembro, validarTransferencia,
  type FilaTeam, type FilaMiembro, type FilaRepo,
} from '../equipos.ts'

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

const equipoDe = (miembros: FilaMiembro[]) => aEquipos(DUENO, [TEAM], miembros, [], {})[0]

describe('validarSacarMiembro', () => {
  it('deja sacar a un miembro que no es el dueno', () => {
    const e = equipoDe([MIEMBRO_DUENO, MIEMBRO_OTRO])
    expect(validarSacarMiembro(e, 'm2')).toEqual({ ok: true })
  })

  it('404 si la fila no pertenece a ese equipo', () => {
    const e = equipoDe([MIEMBRO_DUENO])
    expect(validarSacarMiembro(e, 'm2')).toEqual({
      ok: false, status: 404, error: 'Ese miembro no pertenece a este equipo',
    })
  })

  // Un equipo sin owner_id valido no es un estado que la app sepa dibujar.
  it('409 al intentar sacar al dueno', () => {
    const e = equipoDe([MIEMBRO_DUENO, MIEMBRO_OTRO])
    expect(validarSacarMiembro(e, 'm1')).toEqual({
      ok: false, status: 409,
      error: 'No se puede sacar al dueño del equipo. Transferí la propiedad primero.',
    })
  })

  it('deja cancelar una invitacion pendiente', () => {
    const pendiente: FilaMiembro = { ...MIEMBRO_OTRO, status: 'pending', accepted_at: null }
    expect(validarSacarMiembro(equipoDe([MIEMBRO_DUENO, pendiente]), 'm2')).toEqual({ ok: true })
  })
})

describe('validarTransferencia', () => {
  it('deja transferir a un miembro activo', () => {
    const e = equipoDe([MIEMBRO_DUENO, MIEMBRO_OTRO])
    expect(validarTransferencia(e, OTRO)).toEqual({ ok: true })
  })

  it('409 si no hay ningun otro miembro activo a quien transferirle', () => {
    const e = equipoDe([MIEMBRO_DUENO])
    expect(validarTransferencia(e, OTRO)).toEqual({
      ok: false, status: 409,
      error: 'El equipo no tiene otro miembro activo al que transferirle la propiedad',
    })
  })

  // El 409 va antes que el 400: sin candidatos, el problema no es el id que
  // mandaron sino que no hay ninguno posible, y eso es lo que la UI muestra.
  it('el 409 gana sobre el 400 cuando no hay candidatos', () => {
    const e = equipoDe([MIEMBRO_DUENO])
    expect(validarTransferencia(e, 'no-existe')).toMatchObject({ status: 409 })
  })

  it('400 si el destinatario no es miembro del equipo', () => {
    const e = equipoDe([MIEMBRO_DUENO, MIEMBRO_OTRO])
    expect(validarTransferencia(e, 'ajeno')).toEqual({
      ok: false, status: 400, error: 'El nuevo dueño tiene que ser miembro activo del equipo',
    })
  })

  it('400 si el destinatario es miembro pero no acepto la invitacion', () => {
    const pendiente: FilaMiembro = { ...MIEMBRO_OTRO, status: 'pending' }
    const e = equipoDe([MIEMBRO_DUENO, pendiente, { ...MIEMBRO_OTRO, id: 'm3', user_id: 'tercero' }])
    expect(validarTransferencia(e, OTRO)).toMatchObject({ status: 400 })
  })

  it('400 si ya es el dueno, para no auditar un cambio que no ocurre', () => {
    const e = equipoDe([MIEMBRO_DUENO, MIEMBRO_OTRO])
    expect(validarTransferencia(e, DUENO)).toEqual({
      ok: false, status: 400, error: 'Esa persona ya es la dueña del equipo',
    })
  })

  it('no permite transferir a un miembro cuya cuenta se borro', () => {
    const huerfano: FilaMiembro = { ...MIEMBRO_OTRO, user_id: null }
    const e = equipoDe([MIEMBRO_DUENO, huerfano])
    expect(validarTransferencia(e, OTRO)).toMatchObject({ status: 409 })
  })

  // El dueño puede irse del equipo por RLS ("User can leave their team") sin
  // que nadie se lo impida: si eso pasó, el dueño sólo pertenece al equipo por
  // `teams.owner_id`, y `useTeam.ts` arma la lista de equipos exclusivamente
  // desde `team_members`. Transferir en ese estado lo dejaría fuera del
  // equipo, que es justo lo que la spec promete que nunca pasa.
  it('409 si el dueno actual no tiene su propia fila de miembro activo', () => {
    const e = equipoDe([MIEMBRO_OTRO])
    expect(validarTransferencia(e, OTRO)).toEqual({
      ok: false, status: 409,
      error: 'El dueño actual no figura como miembro activo: transferir lo dejaría fuera del equipo',
    })
  })

  // El 409 de "sin candidatos" sigue ganando: sin este orden, un equipo sin
  // fila del dueño Y sin otros miembros mostraría el mensaje equivocado.
  it('el 409 de sin-candidatos sigue ganando sobre el del dueno sin fila propia', () => {
    const e = equipoDe([])
    expect(validarTransferencia(e, OTRO)).toEqual({
      ok: false, status: 409,
      error: 'El equipo no tiene otro miembro activo al que transferirle la propiedad',
    })
  })
})
