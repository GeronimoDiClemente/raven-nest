// La pestaña Status con Nest abierto: `memory.status` pasado a lo que pinta la TUI.
import { describe, it, expect } from 'vitest'
import { statusDeNest, leerStatusDeNest, STATUS_SOLO_NEST } from '../tui-del-paquete/status-de-nest'
import { crearFuenteDelPaquete, type DependenciasDeFuente } from '../tui-del-paquete/fuente-del-paquete'
import type { StatusMemoryResult } from '../memory-protocol'
import { doctorDeNest, completarDoctorConNest } from '../tui-del-paquete/doctor-de-nest'
import type { DatosDeDoctor } from '../doctor-del-paquete'
import { ajustarTeclas, colorDelEstado } from '../tui-del-paquete/app'
import { posicionEnLista } from '../tui-del-paquete/lista'

const BASE: StatusMemoryResult = {
  total: 12, byType: { decision: 3, architecture: 2, bugfix: 4, discovery: 3 }, team: 2, pending: 0,
  sync: { status: 'idle', detail: null, plaintextPending: 0 },
  conflicts: 0,
  sessions: { writing: 2, silent: 0, disabled: 0 },
}
const con = (o: Partial<StatusMemoryResult>) => statusDeNest({ ...BASE, ...o })
const fila = (d: ReturnType<typeof statusDeNest>, etiqueta: string) => d.filas.find((f) => f.etiqueta === etiqueta)

describe('statusDeNest', () => {
  it('suma los tipos por grupo y separa personal de equipo', () => {
    const d = statusDeNest(BASE)
    expect(d.sinConteos).toBeUndefined()
    expect(d.total).toBe(12)
    expect(d.porGrupo).toEqual({ decisions: 3, conventions: 2, fixes: 4, discoveries: 3 })
    expect([d.personal, d.deEquipo]).toEqual([10, 2])
    expect(d.resumen).toBe('synced')
    expect(fila(d, 'Sync')).toMatchObject({ marca: 'ok', detalle: 'up to date' })
  })

  it('el sync dice lo mismo que la tarjeta de Memories', () => {
    expect(fila(con({ sync: null }), 'Sync')?.marca).toBe('nada')
    expect(con({ sync: null }).resumen).toBe('local only')
    expect(fila(con({ pending: 3 }), 'Sync')).toMatchObject({ marca: 'pendiente', detalle: 'uploading 3 changes…' })
    expect(con({ pending: 3 }).resumen).toBe('3 waiting to sync')
    expect(fila(con({ pending: 1, sync: { status: 'paused', detail: 'offline', plaintextPending: null } }), 'Sync')?.detalle)
      .toBe('offline — 1 change waiting')
    expect(fila(con({ sync: { status: 'paused', detail: 'lock_held', plaintextPending: null } }), 'Sync')?.detalle)
      .toContain('another Nest is syncing')
    expect(con({ sync: { status: 'error', detail: 'needs_encryption_setup', plaintextPending: null } }).resumen).toBe('needs encryption setup')
    expect(fila(con({ sync: { status: 'error', detail: 'auth', plaintextPending: null } }), 'Sync'))
      .toMatchObject({ marca: 'falla', detalle: "couldn't sync (auth)" })
    expect(fila(con({ sync: { status: 'idle', detail: null, plaintextPending: 7 } }), 'Sync')?.detalle)
      .toBe('encrypting your cloud memory… 7 left')
  })

  it('conflictos: sin vault no hay fila; con vault dice cuántos', () => {
    expect(fila(con({ conflicts: null }), 'Conflicts')).toBeUndefined()
    expect(fila(con({ conflicts: 0 }), 'Conflicts')?.marca).toBe('ok')
    expect(fila(con({ conflicts: 2 }), 'Conflicts')).toMatchObject({ marca: 'aviso' })
    expect(fila(con({ conflicts: 2 }), 'Conflicts')?.detalle).toMatch(/^2 in the vault/)
  })

  it('sesiones: una muda es falla, aunque otras escriban', () => {
    expect(fila(con({ sessions: { writing: 1, silent: 1, disabled: 0 } }), 'Sessions'))
      .toMatchObject({ marca: 'falla', detalle: '1 silent · 1 writing — an agent is running without memory' })
    expect(fila(con({ sessions: { writing: 1, silent: 0, disabled: 0 } }), 'Sessions')?.detalle).toBe('1 agent writing memory')
    expect(fila(con({ sessions: { writing: 0, silent: 0, disabled: 1 } }), 'Sessions')?.marca).toBe('nada')
    expect(fila(con({ sessions: null }), 'Sessions')).toBeUndefined()
  })
})

describe('leerStatusDeNest', () => {
  it('un Nest viejo (Unknown method) vuelve a la línea de siempre', async () => {
    const d = await leerStatusDeNest({ call: async () => { throw new Error('Unknown method: memory.status') } })
    expect(d).toBe(STATUS_SOLO_NEST)
    expect(d.sinConteos).toBe(true)
  })

  it('la fuente del paquete con Nest abierto le pide el status al daemon, no a la base', async () => {
    const pedidos: string[] = []
    const deps: DependenciasDeFuente = {
      base: { modo: 'daemon', socket: 's', token: 't' }, cwd: '/tmp/r',
      existe: () => true, buscarNest: async () => null,
      baseSinNest: () => ({ modo: 'propia', path: '/x', nueva: false }),
      crearDaemon: () => ({ call: async (m: string) => { pedidos.push(m); return BASE } }),
      crearLocal: () => { throw new Error('no usado') },
      leerStatus: async () => { throw new Error('no usado') },
      leerDoctor: async () => { throw new Error('no usado') },
    }
    const d = await crearFuenteDelPaquete(deps).status()
    expect(pedidos).toEqual(['memory.status'])
    expect(d.total).toBe(12)
  })
})

describe('el encabezado nombra lo peor', () => {
  it('sesión muda, después el sync, después los conflictos', () => {
    expect(con({ sessions: { writing: 0, silent: 2, disabled: 0 }, pending: 3 }).resumen).toBe('2 silent sessions')
    expect(con({ pending: 3, conflicts: 1 }).resumen).toBe('3 waiting to sync')
    expect(con({ conflicts: 1 }).resumen).toBe('1 conflict')
    expect(con({}).resumen).toBe('synced')
  })

  it('el punto toma el color de la peor fila', () => {
    expect(colorDelEstado(statusDeNest(BASE).filas)).toBe('green')
    expect(colorDelEstado(con({ conflicts: 2 }).filas)).toBe('yellow')
    expect(colorDelEstado(con({ sessions: { writing: 0, silent: 1, disabled: 0 } }).filas)).toBe('red')
    expect(colorDelEstado([{ marca: 'nada', etiqueta: 'Sync', detalle: 'local only' }])).toBe('gray')
  })
})

describe('doctorDeNest', () => {
  const base: DatosDeDoctor = {
    filas: [
      { marca: 'ok', etiqueta: 'Nest', detalle: 'open' },
      { marca: 'nada', etiqueta: 'Blocked', detalle: 'see Memory settings in Nest' },
    ],
    homeDeNest: false, bloqueadas: [], problemas: 0, avisos: 0,
  }

  it('suma lo bloqueado y las ilegibles, y saca la fila que mandaba a Nest', () => {
    const d = doctorDeNest(base, {
      blocked: [{ syncId: 'a', title: 'T', reason: 'quota_exceeded' }, { syncId: 'b', title: 'U', reason: 'quota_exceeded' }],
      undecryptable: 3,
    })
    expect(d.filas.map((f) => f.etiqueta)).toEqual(['Nest', 'Encrypted'])
    expect(d.bloqueadas).toEqual([
      { syncId: 'a', titulo: 'T', motivo: 'quota_exceeded' }, { syncId: 'b', titulo: 'U', motivo: 'quota_exceeded' },
    ])
    expect(d.avisos).toBe(2)
  })

  it('sin nada bloqueado no suma avisos', () => {
    expect(doctorDeNest(base, { blocked: [], undecryptable: 0 }).avisos).toBe(0)
  })

  it('un Nest viejo deja el doctor como estaba', async () => {
    expect(await completarDoctorConNest({ call: async () => { throw new Error('Unknown method: memory.doctor') } }, base)).toBe(base)
  })
})

describe('la barra y la lista', () => {
  const recent = '↑↓ move  ⏎ open  n new  e edit  d delete  g scope  / search  ? help  q quit'

  it('a 80 columnas la barra de Recent entra entera', () => {
    expect(ajustarTeclas(recent, 78)).toBe(recent)
  })

  it('angosta, se caen teclas del final pero quedan help y quit', () => {
    const a = ajustarTeclas(recent, 40)
    expect(a.length).toBeLessThanOrEqual(40)
    expect(a.startsWith('↑↓ move')).toBe(true)
    expect(a.endsWith('? help  q quit')).toBe(true)
  })

  it('la posición dice dónde está el cursor, el tope y el alcance', () => {
    const lista = Array.from({ length: 3 }, () => ({}) as never)
    expect(posicionEnLista({ lista, cursor: 0, pestana: 'recent', todosLosProyectos: false })).toBe('1 of 3 · this project')
    expect(posicionEnLista({ lista, cursor: 2, pestana: 'recent', todosLosProyectos: true })).toBe('3 of 3 · all projects')
    const llena = Array.from({ length: 50 }, () => ({}) as never)
    expect(posicionEnLista({ lista: llena, cursor: 4, pestana: 'search', todosLosProyectos: false })).toBe('5 of 50+')
  })
})
