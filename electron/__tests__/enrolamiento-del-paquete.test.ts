import { describe, it, expect, vi } from 'vitest'
import { enrolarEstaMaquina, type DepsDeEnrolamiento } from '../enrolamiento-del-paquete'

const DEVICE = { publicKey: 'pub-de-esta', privateKey: 'priv-de-esta' }

function deps(over: Partial<DepsDeEnrolamiento> = {}): DepsDeEnrolamiento {
  return {
    hayLlavero: () => true,
    material: () => ({ device: DEVICE, master: null, keyEpoch: 0 }),
    guardarMaestra: vi.fn(),
    enrolar: vi.fn(async () => {}),
    estadoRemoto: vi.fn(async () => ({ keyEpoch: 0, wrap: null, devices: [] })),
    desenvolver: () => Buffer.from('la-maestra'),
    huella: (pub: string) => `HUELLA(${pub})`,
    ...over,
  }
}

describe('enrolarEstaMaquina', () => {
  it('sin llavero no enrola ni pregunta nada', async () => {
    // Sin dónde guardar la maestra, publicar una pública sólo deja basura en la cuenta: la
    // privada tampoco se puede persistir, así que la envoltura que llegue no se va a poder
    // abrir nunca.
    const d = deps({ hayLlavero: () => false })
    const r = await enrolarEstaMaquina(d)
    expect(r.estado).toBe('sin-llavero')
    expect(d.enrolar).not.toHaveBeenCalled()
    expect(d.estadoRemoto).not.toHaveBeenCalled()
  })

  it('si la cuenta no cifra, lo dice y NO muestra una huella', async () => {
    // Mostrar "autorizá esta máquina" cuando no hay nada que autorizar manda al usuario a
    // buscar un botón que no existe.
    const r = await enrolarEstaMaquina(deps())
    expect(r).toEqual({ estado: 'cuenta-sin-cifrado' })
  })

  it('si la cuenta cifra y todavía no hay envoltura, espera y muestra la huella', async () => {
    const d = deps({ estadoRemoto: vi.fn(async () => ({ keyEpoch: 3, wrap: null, devices: [] })) })
    const r = await enrolarEstaMaquina(d)
    expect(r).toEqual({ estado: 'esperando-autorizacion', huella: 'HUELLA(pub-de-esta)' })
    expect(d.enrolar).toHaveBeenCalledWith('pub-de-esta')
  })

  it('con envoltura, la abre y guarda la maestra', async () => {
    const guardarMaestra = vi.fn()
    const d = deps({
      guardarMaestra,
      estadoRemoto: vi.fn(async () => ({ keyEpoch: 3, wrap: { wrapped: 'sobre', wrapMeta: null }, devices: [] })),
    })
    const r = await enrolarEstaMaquina(d)
    expect(r).toEqual({ estado: 'lista', keyEpoch: 3 })
    expect(guardarMaestra).toHaveBeenCalledWith(Buffer.from('la-maestra').toString('base64'), 3)
  })

  it('si ya tiene la maestra de la época vigente, no pide nada', async () => {
    const d = deps({
      material: () => ({ device: DEVICE, master: 'yaLaTengo', keyEpoch: 3 }),
      estadoRemoto: vi.fn(async () => ({ keyEpoch: 3, wrap: null, devices: [] })),
    })
    const r = await enrolarEstaMaquina(d)
    expect(r).toEqual({ estado: 'lista', keyEpoch: 3 })
    expect(d.enrolar).not.toHaveBeenCalled()
  })

  it('si la cuenta ROTÓ la clave, la maestra vieja no sirve y se vuelve a enrolar', async () => {
    // Rotar sube la época y borra todas las envolturas. Una máquina que se quede con la
    // maestra vieja leería basura y creería que la base está corrupta.
    const guardarMaestra = vi.fn()
    const d = deps({
      guardarMaestra,
      material: () => ({ device: DEVICE, master: 'vieja', keyEpoch: 3 }),
      estadoRemoto: vi.fn(async () => ({ keyEpoch: 4, wrap: { wrapped: 'sobre-nuevo', wrapMeta: null }, devices: [] })),
    })
    const r = await enrolarEstaMaquina(d)
    expect(r).toEqual({ estado: 'lista', keyEpoch: 4 })
    expect(d.enrolar).toHaveBeenCalled()
    expect(guardarMaestra).toHaveBeenCalledWith(Buffer.from('la-maestra').toString('base64'), 4)
  })

  it('una envoltura que no abre es un error con detalle, no un "listo"', async () => {
    const d = deps({
      estadoRemoto: vi.fn(async () => ({ keyEpoch: 3, wrap: { wrapped: 'ajeno', wrapMeta: null }, devices: [] })),
      desenvolver: () => { throw new Error('no es para esta clave') },
    })
    const r = await enrolarEstaMaquina(d)
    expect(r).toMatchObject({ estado: 'error' })
    if (r.estado !== 'error') return
    expect(r.detalle).toContain('no es para esta clave')
  })

  it('si el servicio no contesta, es un error y NO se guarda nada', async () => {
    const guardarMaestra = vi.fn()
    const d = deps({ guardarMaestra, estadoRemoto: vi.fn(async () => { throw new Error('503') }) })
    const r = await enrolarEstaMaquina(d)
    expect(r).toMatchObject({ estado: 'error', detalle: '503' })
    expect(guardarMaestra).not.toHaveBeenCalled()
  })
})
