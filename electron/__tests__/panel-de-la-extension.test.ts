import { describe, it, expect } from 'vitest'
import { estadoDelPanel, type EntradaDelPanel } from '../panel-de-la-extension'

const base: EntradaDelPanel = {
  base: { modo: 'propia', path: '/home/x/.nest-memory/memory.db', nueva: false },
  cuentaConectada: false,
  enrolamiento: { estado: 'cuenta-sin-cifrado' },
  memorias: 120,
  ilegibles: 0,
}

const con = (over: Partial<EntradaDelPanel>) => estadoDelPanel({ ...base, ...over })

describe('estadoDelPanel', () => {
  it('siempre dice cuántas memorias ve y de dónde salen', () => {
    const p = con({})
    expect(p.memorias).toBe(120)
    expect(p.origen).toMatch(/this machine/i)
  })

  it('con Nest corriendo NO ofrece conectar: Nest ya es el dueño', () => {
    // Dos daemons sobre la misma cuenta es justo lo que el candado evita. Ofrecer el botón
    // acá invita al usuario a crear ese problema.
    const p = con({ base: { modo: 'daemon', socket: '/tmp/s', token: 't' } })
    expect(p.acciones).not.toContain('conectar-cuenta')
    expect(p.origen).toMatch(/nest/i)
  })

  it('sin cuenta, la acción principal es conectar', () => {
    const p = con({ cuentaConectada: false })
    expect(p.accionPrincipal).toBe('conectar-cuenta')
  })

  it('sin cuenta no habla de cifrado: todavía no aplica', () => {
    const p = con({ cuentaConectada: false, enrolamiento: { estado: 'esperando-autorizacion', huella: 'AAAA' } })
    expect(p.huella).toBeNull()
    expect(p.titular).not.toMatch(/encrypt/i)
  })

  it('esperando autorización muestra la huella, y para copiarla', () => {
    // La huella se muestra SIEMPRE que se espere, no sólo cuando algo falla: es lo que hace
    // visible la sustitución de clave, porque el usuario compara dos strings antes de
    // autorizar.
    const p = con({ cuentaConectada: true, enrolamiento: { estado: 'esperando-autorizacion', huella: '7K4M-92QP' } })
    expect(p.huella).toBe('7K4M-92QP')
    expect(p.accionPrincipal).toBe('copiar-huella')
  })

  it('el código de recuperación se ofrece SEGUNDO, nunca primero', () => {
    // Usarlo gasta la única copia de emergencia. Se ofrece, pero no es el camino principal.
    const p = con({ cuentaConectada: true, enrolamiento: { estado: 'esperando-autorizacion', huella: 'X' } })
    expect(p.acciones).toContain('usar-codigo-de-recuperacion')
    expect(p.accionPrincipal).not.toBe('usar-codigo-de-recuperacion')
  })

  it('lo que no puede leer, lo dice', () => {
    const p = con({ cuentaConectada: true, enrolamiento: { estado: 'esperando-autorizacion', huella: 'X' }, ilegibles: 12 })
    expect(p.ilegibles).toBe(12)
    expect(p.detalle).toContain('12')
  })

  it('sin llavero lo dice, y aclara que lo de esta máquina anda igual', () => {
    // Se afirma el SIGNIFICADO, no una palabra: la primera versión de este test exigía
    // "local" y la copy decía "what lives on this machine", que para un usuario es más
    // claro. Un test que fija vocabulario obliga a empeorar la copy para pasar.
    const p = con({ cuentaConectada: true, enrolamiento: { estado: 'sin-llavero' } })
    expect(p.titular).toMatch(/keyring|keychain/i)
    expect(p.detalle).toMatch(/this machine/i)
    expect(p.detalle).toMatch(/same|works/i)
    expect(p.acciones).not.toContain('copiar-huella')
  })

  it('con la clave lista, no queda nada por hacer del cifrado', () => {
    const p = con({ cuentaConectada: true, enrolamiento: { estado: 'lista', keyEpoch: 3 } })
    expect(p.huella).toBeNull()
    expect(p.acciones).not.toContain('copiar-huella')
    expect(p.acciones).not.toContain('usar-codigo-de-recuperacion')
  })

  it('un error del enrolamiento se muestra, no se disfraza de espera', () => {
    const p = con({ cuentaConectada: true, enrolamiento: { estado: 'error', detalle: '503' } })
    expect(p.detalle).toContain('503')
    expect(p.huella).toBeNull()
  })

  it('siempre se puede volver a configurar los editores', () => {
    expect(con({}).acciones).toContain('configurar-editores')
    expect(con({ cuentaConectada: true, enrolamiento: { estado: 'lista', keyEpoch: 1 } }).acciones)
      .toContain('configurar-editores')
  })

  it('la base de Nest se nombra como tal, aunque Nest esté cerrado', () => {
    const p = con({ base: { modo: 'nest', path: '/home/x/.raven-nest/memory/abc/memory.db' } })
    expect(p.origen).toMatch(/nest/i)
  })

  it('todo lo que sale está en inglés', () => {
    const casos: EntradaDelPanel[] = [
      base,
      { ...base, cuentaConectada: true, enrolamiento: { estado: 'esperando-autorizacion', huella: 'X' }, ilegibles: 3 },
      { ...base, cuentaConectada: true, enrolamiento: { estado: 'sin-llavero' } },
      { ...base, cuentaConectada: true, enrolamiento: { estado: 'lista', keyEpoch: 2 } },
      { ...base, base: { modo: 'daemon', socket: 's', token: 't' } },
    ]
    for (const c of casos) {
      const p = estadoDelPanel(c)
      expect(`${p.titular} ${p.detalle} ${p.origen}`).not.toMatch(/[áéíóúñ¿¡]/i)
    }
  })
})
