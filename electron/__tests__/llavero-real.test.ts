// El llavero de VERDAD, no un mock de mis propias recetas.
//
// Los tests de `llavero-del-sistema.test.ts` prueban la lógica contra un `correr` inyectado,
// o sea que verifican que llamo a `security` con los argumentos que yo creo correctos. Eso no
// prueba que esos argumentos sean los correctos. Esto sí: corre el binario real.
//
// **Sólo en macOS.** En Windows y Linux las recetas están escritas contra su documentación y
// no ejecutadas; ahí `disponible()` decide, y si da `false` el paquete queda en modo local,
// que es la falla segura. Ver el encabezado del módulo.
//
// Escribe en el llavero real del usuario, con una cuenta única por corrida, y la borra.
import { describe, it, expect, afterAll } from 'vitest'
import { randomBytes } from 'crypto'
import { llaveroPorPlataforma, cifradoDeLlavero, correrComando } from '../llavero-del-sistema'

const enMac = process.platform === 'darwin'
const cuenta = `test-${randomBytes(6).toString('hex')}`
const llavero = llaveroPorPlataforma('darwin', correrComando)

afterAll(() => { if (enMac) llavero.borrar(cuenta) })

describe.skipIf(!enMac)('el llavero real de macOS', () => {
  it('está disponible', () => {
    expect(llavero.disponible()).toBe(true)
  })

  it('guarda, lee y borra', () => {
    llavero.guardar(cuenta, 'secreto-de-prueba')
    expect(llavero.leer(cuenta)).toBe('secreto-de-prueba')
    llavero.borrar(cuenta)
    expect(llavero.leer(cuenta)).toBeNull()
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
    const safe = cifradoDeLlavero(llaveroPorPlataforma('darwin', correrComando))
    expect(safe.isEncryptionAvailable()).toBe(true)
    const cifrado = safe.encryptString('la maestra de la cuenta')
    expect(cifrado.toString('utf8')).not.toContain('maestra')
    expect(safe.decryptString(cifrado)).toBe('la maestra de la cuenta')
  })
})
