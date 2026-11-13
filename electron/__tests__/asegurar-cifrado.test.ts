// Spec 2026-11-02 §3: adoptar primero, activar sólo con época 0 LEÍDA, nunca a ciegas.
import { describe, it, expect, vi } from 'vitest'
import { asegurarCifrado, type DepsDeAsegurar } from '../asegurar-cifrado'
import { KeysHttpError } from '../memory-keys-client'

const device = { publicKey: 'pub', privateKey: 'priv' }
function deps(over: Partial<DepsDeAsegurar> = {}): DepsDeAsegurar {
  return {
    material: () => ({ device, master: null, keyEpoch: 0 }),
    adoptar: vi.fn(async () => null),
    estadoRemoto: vi.fn(async () => ({ keyEpoch: 0 })),
    activar: vi.fn(async () => ({ master: 'M', keyEpoch: 1, recoveryCode: 'CODE' })),
    huella: () => 'HUELLA',
    ...over,
  }
}

describe('asegurarCifrado', () => {
  it('con la maestra vigente ya en la máquina: lista, sin adoptar ni activar', async () => {
    const d = deps({ material: () => ({ device, master: 'M', keyEpoch: 2 }), estadoRemoto: vi.fn(async () => ({ keyEpoch: 2 })) })
    expect(await asegurarCifrado(d)).toEqual({ estado: 'lista', master: 'M', keyEpoch: 2, nueva: false })
    expect(d.adoptar).not.toHaveBeenCalled()
    expect(d.activar).not.toHaveBeenCalled()
  })

  it('cuenta que ya cifra y envoltura publicada: adopta', async () => {
    const d = deps({ adoptar: vi.fn(async () => ({ master: 'M', keyEpoch: 3 })), estadoRemoto: vi.fn(async () => ({ keyEpoch: 3 })) })
    expect(await asegurarCifrado(d)).toEqual({ estado: 'lista', master: 'M', keyEpoch: 3, nueva: true })
    expect(d.activar).not.toHaveBeenCalled()
  })

  it('cuenta que ya cifra sin envoltura para esta máquina: espera con la huella, nunca activa', async () => {
    const d = deps({ estadoRemoto: vi.fn(async () => ({ keyEpoch: 3 })) })
    expect(await asegurarCifrado(d)).toEqual({ estado: 'esperando-autorizacion', huella: 'HUELLA' })
    expect(d.activar).not.toHaveBeenCalled()
  })

  it('época 0 leída: activa y devuelve el código', async () => {
    expect(await asegurarCifrado(deps())).toEqual({ estado: 'activada', master: 'M', keyEpoch: 1, recoveryCode: 'CODE' })
  })

  it('sin red al leer el estado: sin-estado, sin activar', async () => {
    const d = deps({ estadoRemoto: vi.fn(async () => { throw new Error('fetch failed') }) })
    expect(await asegurarCifrado(d)).toEqual({ estado: 'sin-estado', detalle: 'fetch failed' })
    expect(d.activar).not.toHaveBeenCalled()
  })

  it('sin red al adoptar: sin-estado, sin activar', async () => {
    const d = deps({ adoptar: vi.fn(async () => { throw new Error('offline') }) })
    expect((await asegurarCifrado(d)).estado).toBe('sin-estado')
    expect(d.activar).not.toHaveBeenCalled()
  })

  it('otra máquina activó en el medio (409): adopta la que quedó', async () => {
    const adoptar = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ master: 'OTRA', keyEpoch: 1 })
    const d = deps({ adoptar, activar: vi.fn(async () => { throw new KeysHttpError(409, 'stale_key_epoch') }) })
    expect(await asegurarCifrado(d)).toEqual({ estado: 'lista', master: 'OTRA', keyEpoch: 1, nueva: true })
  })

  it('409 y todavía sin envoltura para esta máquina: espera', async () => {
    const d = deps({ activar: vi.fn(async () => { throw new KeysHttpError(409, 'stale_key_epoch') }) })
    expect(await asegurarCifrado(d)).toEqual({ estado: 'esperando-autorizacion', huella: 'HUELLA' })
  })

  it('carrera con la relectura interna (403 not_authorized_to_rotate): adopta la que quedó', async () => {
    const adoptar = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ master: 'OTRA', keyEpoch: 1 })
    const d = deps({ adoptar, activar: vi.fn(async () => { throw new KeysHttpError(403, 'not_authorized_to_rotate') }) })
    expect(await asegurarCifrado(d)).toEqual({ estado: 'lista', master: 'OTRA', keyEpoch: 1, nueva: true })
  })

  it('403 not_authorized_to_rotate y todavía sin envoltura: espera', async () => {
    const d = deps({ activar: vi.fn(async () => { throw new KeysHttpError(403, 'not_authorized_to_rotate') }) })
    expect(await asegurarCifrado(d)).toEqual({ estado: 'esperando-autorizacion', huella: 'HUELLA' })
  })

  it('otro 403 no es la carrera: sin-estado', async () => {
    const d = deps({ activar: vi.fn(async () => { throw new KeysHttpError(403, 'forbidden') }) })
    expect((await asegurarCifrado(d)).estado).toBe('sin-estado')
  })

  it('maestra local de una época vieja: no cuenta como lista', async () => {
    const d = deps({
      material: () => ({ device, master: 'VIEJA', keyEpoch: 1 }),
      estadoRemoto: vi.fn(async () => ({ keyEpoch: 2 })),
    })
    expect(await asegurarCifrado(d)).toEqual({ estado: 'esperando-autorizacion', huella: 'HUELLA' })
  })
})
