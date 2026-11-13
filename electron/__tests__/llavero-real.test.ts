// El llavero de VERDAD, no un mock de mis propias recetas.
//
// Los tests de `llavero-del-sistema.test.ts` prueban la lógica contra un `correr` inyectado,
// o sea que verifican que llamo a `security` con los argumentos que yo creo correctos. Eso no
// prueba que esos argumentos sean los correctos. Esto sí: corre el binario real.
//
// **macOS y Windows.** macOS desde el 2026-09-18 (`security`); Windows desde el 2026-10-02
// (DPAPI por PowerShell, en la clave de registro del usuario). Linux sigue escrito contra la
// documentación de `secret-tool` y sin ejecutar: ahí `disponible()` decide, y si da `false`
// el paquete queda en modo local, que es la falla segura.
//
// Escribe en el llavero real del usuario, con una cuenta única por corrida, y la borra.
import { describe, it, expect, afterAll } from 'vitest'
import { randomBytes } from 'crypto'
import {
  llaveroPorPlataforma, cifradoDeLlavero, correrComando, CUENTA_DE_LA_CLAVE,
  type LlaveroDelSistema,
} from '../llavero-del-sistema'

const plataforma = process.platform
const conLlaveroProbado = plataforma === 'darwin' || plataforma === 'win32'
const cuenta = `test-${randomBytes(6).toString('hex')}`
const cuentaDeLaClave = `${cuenta}-clave`
const llavero = llaveroPorPlataforma(plataforma, correrComando)

/**
 * El mismo llavero real, pero con la cuenta de la clave redirigida a una de prueba.
 *
 * `cifradoDeLlavero` usa siempre `CUENTA_DE_LA_CLAVE`, que es la entrada de VERDAD del
 * paquete. Hasta el 2026-10-02 este test la usaba tal cual: en una máquina con el paquete
 * instalado leía la clave real, y en una sin él dejaba creada una que nadie había pedido.
 */
const llaveroAislado: LlaveroDelSistema = {
  disponible: () => llavero.disponible(),
  leer: (c) => llavero.leer(c === CUENTA_DE_LA_CLAVE ? cuentaDeLaClave : c),
  guardar: (c, s) => llavero.guardar(c === CUENTA_DE_LA_CLAVE ? cuentaDeLaClave : c, s),
  borrar: (c) => llavero.borrar(c === CUENTA_DE_LA_CLAVE ? cuentaDeLaClave : c),
}

afterAll(() => {
  if (!conLlaveroProbado) return
  llavero.borrar(cuenta)
  llavero.borrar(cuentaDeLaClave)
})

describe.skipIf(!conLlaveroProbado)(`el llavero real (${plataforma})`, () => {
  it('está disponible', () => {
    expect(llavero.disponible()).toBe(true)
  })

  it('guarda, lee y borra', () => {
    llavero.guardar(cuenta, 'secreto-de-prueba')
    expect(llavero.leer(cuenta)).toBe('secreto-de-prueba')
    llavero.borrar(cuenta)
    expect(llavero.leer(cuenta)).toBeNull()
  })

  it('leer algo que nunca se guardó da null', () => {
    expect(llavero.leer(`${cuenta}-nunca`)).toBeNull()
  })

  it('guardar dos veces actualiza en vez de fallar', () => {
    llavero.guardar(cuenta, 'primero')
    llavero.guardar(cuenta, 'segundo')
    expect(llavero.leer(cuenta)).toBe('segundo')
  })

  it('un secreto con caracteres raros vuelve igual', () => {
    // Es base64 lo que se guarda de verdad, pero si el día de mañana cambia, que no sea
    // esto lo que se rompa en silencio.
    const raro = 'a b"c\'d$e`f\\g/h=+'
    llavero.guardar(cuenta, raro)
    expect(llavero.leer(cuenta)).toBe(raro)
  })

  it('el cifrado completo cierra contra el llavero real', () => {
    // Lo que importa de punta a punta: cifrar, y que lo cifrado se abra con la clave que
    // quedó en el llavero del sistema y no en el archivo.
    const safe = cifradoDeLlavero(llaveroAislado)
    expect(safe.isEncryptionAvailable()).toBe(true)
    const cifrado = safe.encryptString('la maestra de la cuenta')
    expect(cifrado.toString('utf8')).not.toContain('maestra')
    expect(safe.decryptString(cifrado)).toBe('la maestra de la cuenta')
    // Y la clave quedó en el llavero, con el largo de una clave AES-256.
    expect(Buffer.from(llavero.leer(cuentaDeLaClave) ?? '', 'base64')).toHaveLength(32)
  })
})
