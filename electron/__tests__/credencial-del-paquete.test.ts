import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { pathDeCredencial, guardarCredencial, leerCredencial, borrarCredencial } from '../credencial-del-paquete'

/** Un cifrado de mentira, invertible, para probar el módulo sin tocar el llavero del SO. */
const safeFalso = (disponible = true) => ({
  isEncryptionAvailable: () => disponible,
  encryptString: (t: string) => Buffer.from(`##${t}##`, 'utf8'),
  decryptString: (b: Buffer) => {
    const s = b.toString('utf8')
    if (!s.startsWith('##') || !s.endsWith('##')) throw new Error('no es nuestro')
    return s.slice(2, -2)
  },
})

let home: string
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'nest-cred-')) })
afterEach(() => { rmSync(home, { recursive: true, force: true }) })

describe('dónde vive', () => {
  it('cuelga de la carpeta del paquete, NO de la de Nest', () => {
    // Nest cifra su `credential.bin` con safeStorage de Electron y el paquete con el llavero
    // del sistema: son cifrados distintos. Compartir el archivo haría que cada uno rompiera
    // el del otro sin decir por qué.
    const p = pathDeCredencial('/home/x')
    expect(p).toContain('.nest-memory')
    expect(p).not.toContain('.raven-nest')
  })
})

describe('guardar y leer', () => {
  it('ida y vuelta', () => {
    guardarCredencial(home, safeFalso(), { token: 'nmk_abc', deviceId: 'd-1' })
    expect(leerCredencial(home, safeFalso())).toEqual({ token: 'nmk_abc', deviceId: 'd-1' })
  })

  it('el token NO queda legible en el archivo', () => {
    guardarCredencial(home, safeFalso(), { token: 'nmk_secreto', deviceId: 'd-1' })
    // Con el cifrado de mentira sí se ve; lo que se fija es que el módulo CIFRA antes de
    // escribir y no serializa en claro por su cuenta.
    const crudo = readFileSync(pathDeCredencial(home), 'utf8')
    expect(crudo.startsWith('##')).toBe(true)
  })

  it('el archivo no queda legible por todo el mundo', () => {
    guardarCredencial(home, safeFalso(), { token: 'nmk_abc', deviceId: 'd-1' })
    expect(statSync(pathDeCredencial(home)).mode & 0o077).toBe(0)
  })

  it('crea el directorio si no está', () => {
    expect(() => guardarCredencial(home, safeFalso(), { token: 't', deviceId: 'd' })).not.toThrow()
  })

  it('sin credencial guardada devuelve null', () => {
    expect(leerCredencial(home, safeFalso())).toBeNull()
  })
})

describe('lo que tiene que fallar bien', () => {
  it('guardar SIN cifrado del sistema LANZA, no escribe en claro', () => {
    // Misma regla que `memory-key-store.ts`: un token en texto plano es peor que no tener
    // token, porque el usuario cree que está guardado de forma segura.
    expect(() => guardarCredencial(home, safeFalso(false), { token: 't', deviceId: 'd' })).toThrow()
  })

  it('un archivo manoseado se lee como "no hay credencial", no como una excepción', () => {
    // Quien llama tiene que poder decir "volvé a conectarte", que es recuperable. Tirar
    // desde acá apagaría todo por una credencial ilegible.
    mkdirSync(dirname(pathDeCredencial(home)), { recursive: true })
    writeFileSync(pathDeCredencial(home), 'basura')
    expect(leerCredencial(home, safeFalso())).toBeNull()
  })

  it('leer sin cifrado disponible da null', () => {
    guardarCredencial(home, safeFalso(), { token: 't', deviceId: 'd' })
    expect(leerCredencial(home, safeFalso(false))).toBeNull()
  })

  it('una credencial a la que le falta el token no vale', () => {
    mkdirSync(dirname(pathDeCredencial(home)), { recursive: true })
    writeFileSync(pathDeCredencial(home), safeFalso().encryptString(JSON.stringify({ deviceId: 'd' })))
    expect(leerCredencial(home, safeFalso())).toBeNull()
  })

  it('borrar deja el sistema como si nunca se hubiera conectado', () => {
    guardarCredencial(home, safeFalso(), { token: 't', deviceId: 'd' })
    borrarCredencial(home)
    expect(leerCredencial(home, safeFalso())).toBeNull()
  })

  it('borrar lo que no está no rompe', () => {
    expect(() => borrarCredencial(home)).not.toThrow()
  })
})
