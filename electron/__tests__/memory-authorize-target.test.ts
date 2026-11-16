import { describe, it, expect } from 'vitest'
import { generateDeviceKeyPair, huellaDeClave } from '../memory-key-wrap'
import { elegirDestinoVerificado } from '../memory-authorize-target'

// I4 de la review final: el handler de autorizar volvía a pedir la lista de devices y envolvía
// para la pública de ESE segundo fetch. Entre lo que el usuario comparó en pantalla y lo que se
// envolvía, el servidor podía cambiar la clave (TOCTOU) y la verificación de huella no servía.
describe('elegirDestinoVerificado', () => {
  const real = generateDeviceKeyPair()
  const plantada = generateDeviceKeyPair()
  const huellaMostrada = huellaDeClave(real.publicKey)

  it('devuelve el destino cuando la pública del fetch es la que se le mostró al usuario', () => {
    const r = elegirDestinoVerificado([{ deviceId: 'b', publicKey: real.publicKey }], 'b', huellaMostrada)
    expect(r).toEqual({ ok: true, target: { deviceId: 'b', publicKey: real.publicKey } })
  })

  it('rechaza si la pública cambió entre lo mostrado y lo que se va a envolver', () => {
    const r = elegirDestinoVerificado([{ deviceId: 'b', publicKey: plantada.publicKey }], 'b', huellaMostrada)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/changed/i)
  })

  it('rechaza sin huella: autorizar sin haber comparado no es una opción', () => {
    for (const h of [undefined, null, '', '   ']) {
      const r = elegirDestinoVerificado([{ deviceId: 'b', publicKey: real.publicKey }], 'b', h as string | undefined)
      expect(r.ok).toBe(false)
    }
  })

  it('tolera mayúsculas/espacios en la huella (se tipea o se copia de otro lado)', () => {
    const r = elegirDestinoVerificado([{ deviceId: 'b', publicKey: real.publicKey }], 'b', ` ${huellaMostrada.toLowerCase()} `)
    expect(r.ok).toBe(true)
  })

  it('rechaza si el device ya no está en la lista', () => {
    const r = elegirDestinoVerificado([], 'b', huellaMostrada)
    expect(r.ok).toBe(false)
  })
})
