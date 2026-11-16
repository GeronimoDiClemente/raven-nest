// Sin red o con Supabase caído, quien tiene una sesión guardada entra a la app; quien no, al login.
import { describe, it, expect } from 'vitest'
import { haySesionGuardada, decidirSesionAlArrancar, eventoDecideSesion, ESPERA_DE_SESION_MS } from '../../lib/sesion-al-arrancar'

function relojFalso() {
  const timers: Array<{ cb: () => void; at: number; vivo: boolean }> = []
  let now = 0
  return {
    setTimer: (cb: () => void, ms: number) => { const t = { cb, at: now + ms, vivo: true }; timers.push(t); return t },
    clearTimer: (t: unknown) => { (t as { vivo: boolean }).vivo = false },
    avanzar: (ms: number) => { now += ms; for (const t of timers) if (t.vivo && t.at <= now) { t.vivo = false; t.cb() } },
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))
const GUARDADA = JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: 1 })

describe('haySesionGuardada', () => {
  it('sólo una sesión con refresh token cuenta', () => {
    expect(haySesionGuardada(GUARDADA)).toBe(true)
    expect(haySesionGuardada(null)).toBe(false)
    expect(haySesionGuardada('no es json')).toBe(false)
    expect(haySesionGuardada(JSON.stringify({ access_token: 'a' }))).toBe(false)
    expect(haySesionGuardada('null')).toBe(false)
  })
})

describe('decidirSesionAlArrancar', () => {
  it('con sesión válida entra', async () => {
    const r = relojFalso(); const fijadas: boolean[] = []
    decidirSesionAlArrancar({ ...r, cliente: { getSession: async () => ({ data: { session: {} } }) }, guardada: () => false, fijar: (v) => fijadas.push(v) })
    await tick()
    expect(fijadas).toEqual([true])
  })

  it('sin red: el refresh falló pero la sesión sigue guardada, así que entra (antes iba al login)', async () => {
    const r = relojFalso(); const fijadas: boolean[] = []
    decidirSesionAlArrancar({ ...r, cliente: { getSession: async () => ({ data: { session: null } }) }, guardada: () => true, fijar: (v) => fijadas.push(v) })
    await tick()
    expect(fijadas).toEqual([true])
  })

  it('refresh token revocado: auth-js borró la sesión, así que va al login', async () => {
    const r = relojFalso(); const fijadas: boolean[] = []
    decidirSesionAlArrancar({ ...r, cliente: { getSession: async () => ({ data: { session: null } }) }, guardada: () => false, fijar: (v) => fijadas.push(v) })
    await tick()
    expect(fijadas).toEqual([false])
  })

  it('Supabase lento: a los 5s decide con lo guardado, y cuando contesta manda su respuesta', async () => {
    const r = relojFalso(); const fijadas: boolean[] = []
    let contestar!: (v: { data: { session: unknown } }) => void
    decidirSesionAlArrancar({ ...r, cliente: { getSession: () => new Promise((res) => { contestar = res }) }, guardada: () => true, fijar: (v) => fijadas.push(v) })
    r.avanzar(ESPERA_DE_SESION_MS)
    expect(fijadas).toEqual([true])
    contestar({ data: { session: {} } })
    await tick()
    expect(fijadas).toEqual([true, true])
  })

  it('si getSession tira, decide con lo guardado', async () => {
    const r = relojFalso(); const fijadas: boolean[] = []
    decidirSesionAlArrancar({ ...r, cliente: { getSession: async () => { throw new Error('red') } }, guardada: () => true, fijar: (v) => fijadas.push(v) })
    await tick()
    expect(fijadas).toEqual([true])
  })
})

describe('eventoDecideSesion', () => {
  it('INITIAL_SESSION no pisa la decisión de arranque; los demás sí cuentan', () => {
    expect(eventoDecideSesion('INITIAL_SESSION')).toBe(false)
    for (const e of ['SIGNED_IN', 'SIGNED_OUT', 'TOKEN_REFRESHED', 'USER_UPDATED']) expect(eventoDecideSesion(e)).toBe(true)
  })
})
