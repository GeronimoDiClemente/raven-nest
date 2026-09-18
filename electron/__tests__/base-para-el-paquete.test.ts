import { describe, it, expect } from 'vitest'
import { decidirBase, pathDeBasePropia, type EntornoDeBase } from '../base-para-el-paquete'

const HOME = '/home/geronimo'

function entorno(over: Partial<EntornoDeBase> = {}): EntornoDeBase {
  return {
    env: {},
    home: HOME,
    existe: () => false,
    socketVivo: () => true,
    punteroDeNest: () => null,
    ...over,
  }
}

describe('decidirBase', () => {
  it('con el socket y el token de Nest en el entorno, delega en el daemon', () => {
    const d = decidirBase(entorno({ env: { NEST_MEMORY_SOCKET: '/tmp/s', NEST_MEMORY_TOKEN: 't' } }))
    expect(d).toEqual({ modo: 'daemon', socket: '/tmp/s', token: 't' })
  })

  it('con socket pero SIN token no delega: no podría hablarle', () => {
    const d = decidirBase(entorno({ env: { NEST_MEMORY_SOCKET: '/tmp/s' } }))
    expect(d.modo).not.toBe('daemon')
  })

  it('un socket MUERTO no cuenta — Nest cerrado deja la variable puesta en su terminal', () => {
    const d = decidirBase(entorno({
      env: { NEST_MEMORY_SOCKET: '/tmp/s', NEST_MEMORY_TOKEN: 't' },
      socketVivo: () => false,
      punteroDeNest: () => '/home/geronimo/.raven-nest/memory/abc/memory.db',
    }))
    expect(d).toEqual({ modo: 'nest', path: '/home/geronimo/.raven-nest/memory/abc/memory.db' })
  })

  it('sin Nest corriendo, usa la base de Nest de esta máquina', () => {
    const d = decidirBase(entorno({ punteroDeNest: () => '/x/memory.db' }))
    expect(d).toEqual({ modo: 'nest', path: '/x/memory.db' })
  })

  it('sin Nest y sin base de Nest, usa la propia si ya existe', () => {
    const propia = pathDeBasePropia(HOME)
    const d = decidirBase(entorno({ existe: (p) => p === propia }))
    expect(d).toEqual({ modo: 'propia', path: propia, nueva: false })
  })

  it('sin nada, la propia es nueva', () => {
    const d = decidirBase(entorno())
    expect(d).toEqual({ modo: 'propia', path: pathDeBasePropia(HOME), nueva: true })
  })

  it('la base de Nest gana sobre una propia que ya exista — son las mismas memorias', () => {
    // Duplicarlas sería el peor resultado posible: dos verdades de lo mismo, y ninguna
    // forma de saber cuál leyó el agente.
    const d = decidirBase(entorno({ punteroDeNest: () => '/x/memory.db', existe: () => true }))
    expect(d.modo).toBe('nest')
  })

  it('la base propia cuelga del home que le pasan', () => {
    expect(pathDeBasePropia('/otro/home')).toContain('/otro/home')
    expect(pathDeBasePropia('/otro/home')).toContain('.nest-memory')
  })
})
