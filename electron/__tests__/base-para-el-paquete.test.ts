import { describe, it, expect } from 'vitest'
import { decidirBase, pathDeBasePropia, type EntornoDeBase } from '../base-para-el-paquete'

const HOME = '/home/geronimo'

function entorno(over: Partial<EntornoDeBase> = {}): EntornoDeBase {
  return {
    home: HOME,
    existe: () => false,
    nestVivo: null,
    punteroDeNest: () => null,
    ...over,
  }
}

describe('decidirBase', () => {
  // Encontrar a Nest —variables, disco, ping— lo prueba nest-vivo-del-paquete.test.ts.
  it('con Nest vivo, delega en el daemon aunque haya base propia', () => {
    const d = decidirBase(entorno({ nestVivo: { socket: '/tmp/s', token: 't' }, existe: () => true }))
    expect(d).toEqual({ modo: 'daemon', socket: '/tmp/s', token: 't' })
  })

  it('con Nest vivo, delega aunque también esté su base: el daemon es el escritor único', () => {
    const d = decidirBase(entorno({
      nestVivo: { socket: '/tmp/s', token: 't' },
      punteroDeNest: () => '/home/geronimo/.raven-nest/memory/abc/memory.db',
    }))
    expect(d.modo).toBe('daemon')
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
    // Normalizado: en Windows `path.join` devuelve `\otro\home\...`.
    expect(pathDeBasePropia('/otro/home').replace(/\\/g, '/')).toContain('/otro/home')
    expect(pathDeBasePropia('/otro/home')).toContain('.nest-memory')
  })
})
