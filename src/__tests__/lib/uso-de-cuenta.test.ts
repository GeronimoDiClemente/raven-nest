import { describe, it, expect } from 'vitest'
import { estadoDeUso } from '../../lib/uso-de-cuenta'

const base = { state: 'connected', error: null, cloudProjects: null, maxProjects: null, localOnly: [], overLimit: false }
const rn = { projectKey: 'k-rn', name: 'raven-nest' }

describe('estadoDeUso', () => {
  it('not_in_beta en error es la beta, no un sync apagado', () => {
    expect(estadoDeUso({ ...base, state: 'error', error: 'not_in_beta' })).toEqual({ tipo: 'beta' })
  })

  it('desconectado es apagado', () => {
    expect(estadoDeUso({ ...base, state: 'disconnected' })).toEqual({ tipo: 'apagado' })
  })

  it.each(['connecting', 'migrating'])('%s es cargando, no apagado', (state) => {
    expect(estadoDeUso({ ...base, state })).toEqual({ tipo: 'cargando' })
  })

  it('paused cuenta como conectado', () => {
    expect(estadoDeUso({ ...base, state: 'paused' }).tipo).toBe('conectado')
  })

  it('conectado sin roster todavía: proyectos null', () => {
    expect(estadoDeUso(base)).toEqual({ tipo: 'conectado', proyectos: null, soloLocales: 0 })
  })

  it('con roster y tope 1', () => {
    expect(estadoDeUso({ ...base, cloudProjects: [rn], maxProjects: 1 }))
      .toEqual({ tipo: 'conectado', proyectos: '1 of 1 · raven-nest', soloLocales: 0 })
  })

  it('soloLocales cuenta los de localOnly que no están en el roster', () => {
    const r = estadoDeUso({
      ...base,
      cloudProjects: [rn],
      maxProjects: 1,
      localOnly: [rn, { projectKey: 'k-a', name: 'a' }, { projectKey: 'k-b', name: 'b' }],
    })
    expect(r).toEqual({ tipo: 'conectado', proyectos: '1 of 1 · raven-nest', soloLocales: 2 })
  })

  it('sobre el tope: lo que pasa del tope en la nube también es local only', () => {
    const r = estadoDeUso({
      ...base,
      cloudProjects: [rn, { projectKey: 'k-a', name: 'a' }, { projectKey: 'k-b', name: 'b' }],
      maxProjects: 1,
      overLimit: true,
    })
    expect(r).toMatchObject({ tipo: 'conectado', soloLocales: 2 })
  })
})
