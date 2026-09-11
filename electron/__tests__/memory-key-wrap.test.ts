import { describe, it, expect } from 'vitest'
import { randomBytes } from 'crypto'
import {
  generateDeviceKeyPair, wrapForDevice, unwrapWithDevice,
  generateRecoveryCode, normalizeRecoveryCode, wrapForRecovery, unwrapWithRecovery,
  MemoryUnwrapError,
} from '../memory-key-wrap'

describe('memory-key-wrap — sealed box por dispositivo', () => {
  it('genera pares distintos, serializados como strings', () => {
    const a = generateDeviceKeyPair()
    const b = generateDeviceKeyPair()
    expect(typeof a.publicKey).toBe('string')
    expect(typeof a.privateKey).toBe('string')
    expect(a.publicKey).not.toBe(b.publicKey)
  })

  // El caso central: la maquina que envuelve NO tiene la privada de la que va a abrir.
  it('envuelve con la publica del destinatario y abre con su privada', () => {
    const dispositivo = generateDeviceKeyPair()
    const master = randomBytes(32)
    const wrapped = wrapForDevice(dispositivo.publicKey, master)
    expect(unwrapWithDevice(dispositivo.privateKey, wrapped).equals(master)).toBe(true)
  })

  it('dos envolturas del mismo secreto son distintas (efimera aleatoria)', () => {
    const d = generateDeviceKeyPair()
    const master = randomBytes(32)
    expect(wrapForDevice(d.publicKey, master)).not.toBe(wrapForDevice(d.publicKey, master))
  })

  it('otra privada no abre la envoltura', () => {
    const destinatario = generateDeviceKeyPair()
    const intruso = generateDeviceKeyPair()
    const wrapped = wrapForDevice(destinatario.publicKey, randomBytes(32))
    expect(() => unwrapWithDevice(intruso.privateKey, wrapped)).toThrow(MemoryUnwrapError)
  })

  it('una envoltura con un byte cambiado no abre', () => {
    const d = generateDeviceKeyPair()
    const raw = Buffer.from(wrapForDevice(d.publicKey, randomBytes(32)), 'base64')
    raw[raw.length - 1] ^= 0xff
    expect(() => unwrapWithDevice(d.privateKey, raw.toString('base64'))).toThrow(MemoryUnwrapError)
  })

  it('basura lanza MemoryUnwrapError y no revienta el proceso', () => {
    const d = generateDeviceKeyPair()
    expect(() => unwrapWithDevice(d.privateKey, 'no-es-base64-valido!!')).toThrow(MemoryUnwrapError)
    expect(() => unwrapWithDevice(d.privateKey, '')).toThrow(MemoryUnwrapError)
  })
})

describe('memory-key-wrap — código de recuperación', () => {
  it('el código tiene 6 grupos de 4 del alfabeto sin ambigüedades', () => {
    const code = generateRecoveryCode()
    expect(code).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}(-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}){5}$/)
    // Nunca I, L, O ni U: se confunden al copiarlas a mano de una pantalla.
    expect(code).not.toMatch(/[ILOU]/)
  })

  it('dos códigos seguidos son distintos', () => {
    expect(generateRecoveryCode()).not.toBe(generateRecoveryCode())
  })

  // El usuario lo va a tipear a mano. Que un espacio de mas o una minuscula le
  // devuelvan "codigo incorrecto" seria un error nuestro, no de el.
  it('normaliza minúsculas, espacios y guiones faltantes', () => {
    const code = generateRecoveryCode()
    const sucio = ' ' + code.toLowerCase().replace(/-/g, ' ') + '  '
    expect(normalizeRecoveryCode(sucio)).toBe(code)
  })

  it('round-trip con el código correcto', () => {
    const code = generateRecoveryCode()
    const master = randomBytes(32)
    const wrap = wrapForRecovery(code, master)
    expect(unwrapWithRecovery(code, wrap).equals(master)).toBe(true)
  })

  it('round-trip con el código tipeado sucio', () => {
    const code = generateRecoveryCode()
    const master = randomBytes(32)
    const wrap = wrapForRecovery(code, master)
    expect(unwrapWithRecovery(code.toLowerCase().replace(/-/g, ''), wrap).equals(master)).toBe(true)
  })

  it('un código equivocado no abre', () => {
    const wrap = wrapForRecovery(generateRecoveryCode(), randomBytes(32))
    expect(() => unwrapWithRecovery(generateRecoveryCode(), wrap)).toThrow(MemoryUnwrapError)
  })

  it('la misma clave con otra sal da otra envoltura', () => {
    const code = generateRecoveryCode()
    const master = randomBytes(32)
    const a = wrapForRecovery(code, master)
    const b = wrapForRecovery(code, master)
    expect(a.salt).not.toBe(b.salt)
    expect(a.wrapped).not.toBe(b.wrapped)
  })

  // Lo que estas dos envolturas prometen: que el servidor las guarde sin poder abrirlas.
  // Ningun otro test mira si el secreto quedo visible adentro, que es exactamente lo que
  // le importa a alguien con acceso a la tabla `key_wraps`.
  it('ninguna envoltura deja ver el secreto que envuelve', () => {
    const master = randomBytes(32)
    const d = generateDeviceKeyPair()
    expect(Buffer.from(wrapForDevice(d.publicKey, master), 'base64').includes(master)).toBe(false)
    const code = generateRecoveryCode()
    const rec = wrapForRecovery(code, master)
    expect(Buffer.from(rec.wrapped, 'base64').includes(master)).toBe(false)
  })

  // 24 caracteres de un alfabeto de 32 son 120 bits. Si alguien acorta el codigo para que
  // sea mas comodo de tipear, este test dice cuanto se esta pagando por esa comodidad.
  it('el codigo de recuperacion tiene 120 bits de entropia', () => {
    const code = generateRecoveryCode()
    const utiles = code.replace(/-/g, '')
    expect(utiles).toHaveLength(24)
    expect(utiles).toMatch(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]+$/)
    // Sin I, L, O ni U: son las que se confunden al leer un codigo escrito a mano.
    expect(utiles).not.toMatch(/[ILOU]/)
  })
})
