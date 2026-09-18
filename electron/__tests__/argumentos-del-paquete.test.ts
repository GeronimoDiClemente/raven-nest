import { describe, it, expect } from 'vitest'
import { parsearArgumentos, AYUDA } from '../argumentos-del-paquete'

const p = (...args: string[]) => parsearArgumentos(args)

describe('parsearArgumentos', () => {
  it('sin argumentos muestra la ayuda, no un error', () => {
    // Alguien que corre `npx nest-memory` a ver qué hace no se equivocó en nada.
    expect(p()).toEqual({ comando: 'ayuda' })
  })

  it('--help y -h también', () => {
    expect(p('--help')).toEqual({ comando: 'ayuda' })
    expect(p('-h')).toEqual({ comando: 'ayuda' })
  })

  it('setup, con todos los editores por defecto', () => {
    expect(p('setup')).toEqual({ comando: 'setup', soloEditores: null, deshacer: false, simulado: false })
  })

  it('setup --cursor limita a ese editor', () => {
    expect(p('setup', '--cursor')).toMatchObject({ comando: 'setup', soloEditores: ['cursor'] })
  })

  it('setup acepta varios editores', () => {
    expect(p('setup', '--cursor', '--claude')).toMatchObject({ soloEditores: ['cursor', 'claude'] })
  })

  it('setup --undo', () => {
    expect(p('setup', '--undo')).toMatchObject({ comando: 'setup', deshacer: true })
  })

  it('setup --dry-run no escribe: es para ver el plan', () => {
    expect(p('setup', '--dry-run')).toMatchObject({ comando: 'setup', simulado: true })
  })

  it('search junta las palabras en una consulta sola', () => {
    // `nest-memory search auth token` sin comillas es lo que la gente escribe de verdad.
    expect(p('search', 'auth', 'token')).toEqual({ comando: 'search', consulta: 'auth token' })
  })

  it('search sin nada que buscar es un error que lo dice', () => {
    expect(p('search')).toMatchObject({ comando: 'error' })
  })

  it('login, status, doctor, recover y mcp no llevan nada', () => {
    for (const c of ['login', 'status', 'doctor', 'recover', 'mcp']) {
      expect(p(c)).toEqual({ comando: c })
    }
  })

  it('un comando que no existe se dice, y se sugiere la ayuda', () => {
    const r = p('setpu')
    expect(r.comando).toBe('error')
    if (r.comando !== 'error') return
    expect(r.detalle).toContain('setpu')
    expect(r.detalle).toMatch(/--help/)
  })

  it('una opción que no existe NO se ignora en silencio', () => {
    // Ignorarla haría que `setup --dry-runn` escriba de verdad creyendo que simula.
    const r = p('setup', '--dry-runn')
    expect(r.comando).toBe('error')
    if (r.comando !== 'error') return
    expect(r.detalle).toContain('--dry-runn')
  })

  it('la ayuda nombra todos los comandos que el parser acepta', () => {
    for (const c of ['setup', 'login', 'status', 'search', 'doctor', 'recover', 'mcp']) {
      expect(AYUDA).toContain(c)
    }
  })

  it('la ayuda está en inglés, como todo lo que sale de este producto', () => {
    expect(AYUDA).not.toMatch(/[áéíóúñ¿¡]/i)
  })
})
