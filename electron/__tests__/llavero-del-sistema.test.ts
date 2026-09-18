import { describe, it, expect, vi } from 'vitest'
import {
  llaveroPorPlataforma, cifradoDeLlavero, SERVICIO, CUENTA_DE_LA_CLAVE,
  type CorrerComando,
} from '../llavero-del-sistema'

/** Un llavero de mentira que vive en un Map, para probar el cifrado sin tocar el del SO. */
function llaveroFalso(disponible = true) {
  const datos = new Map<string, string>()
  return {
    datos,
    llavero: {
      disponible: () => disponible,
      leer: (c: string) => datos.get(c) ?? null,
      guardar: (c: string, s: string) => { datos.set(c, s) },
      borrar: (c: string) => { datos.delete(c) },
    },
  }
}

describe('las recetas por plataforma', () => {
  it('en Mac usa `security`, que viene con el sistema', () => {
    const correr = vi.fn<CorrerComando>(() => ({ ok: true, salida: '' }))
    llaveroPorPlataforma('darwin', correr).guardar('x', 'secreto')
    const [cmd, args] = correr.mock.calls[0]!
    expect(cmd).toBe('security')
    expect(args).toContain('add-generic-password')
    expect(args).toContain(SERVICIO)
  })

  it('en Mac el secreto NO viaja en la línea de comandos', () => {
    // `ps` muestra los argumentos de cualquier proceso a cualquier usuario de la máquina.
    // Un secreto pasado con `-w valor` queda visible mientras el comando corre.
    const correr = vi.fn<CorrerComando>(() => ({ ok: true, salida: '' }))
    llaveroPorPlataforma('darwin', correr).guardar('x', 'secreto-que-no-va')
    const [, args, entrada] = correr.mock.calls[0]!
    expect(args).not.toContain('secreto-que-no-va')
    expect(entrada).toContain('secreto-que-no-va')
  })

  it('en Mac el secreto se manda DOS veces, porque `security` lo confirma', () => {
    // Mandarlo una sola vez guarda una entrada vacía SIN dar error. Lo destapó el test de
    // integración contra el llavero real; los unitarios estaban todos verdes.
    const correr = vi.fn<CorrerComando>(() => ({ ok: true, salida: '' }))
    llaveroPorPlataforma('darwin', correr).guardar('x', 'abc')
    expect(correr.mock.calls[0]![2]).toBe('abc\nabc\n')
  })

  it('en Linux el secreto se manda UNA vez: secret-tool no confirma', () => {
    const correr = vi.fn<CorrerComando>(() => ({ ok: true, salida: '' }))
    llaveroPorPlataforma('linux', correr).guardar('x', 'abc')
    expect(correr.mock.calls[0]![2]).toBe('abc')
  })

  it('en Linux usa secret-tool', () => {
    const correr = vi.fn<CorrerComando>(() => ({ ok: true, salida: '' }))
    llaveroPorPlataforma('linux', correr).guardar('x', 's')
    expect(correr.mock.calls[0]![0]).toBe('secret-tool')
  })

  it('leer algo que no está da null, no una excepción', () => {
    const correr: CorrerComando = () => ({ ok: false, salida: 'no such item' })
    expect(llaveroPorPlataforma('darwin', correr).leer('x')).toBeNull()
  })

  it('leer devuelve el secreto sin el salto de línea que agrega el comando', () => {
    const correr: CorrerComando = () => ({ ok: true, salida: 'secreto123\n' })
    expect(llaveroPorPlataforma('darwin', correr).leer('x')).toBe('secreto123')
  })

  it('una plataforma desconocida no está disponible, en vez de inventar un comando', () => {
    const correr: CorrerComando = () => ({ ok: true, salida: '' })
    expect(llaveroPorPlataforma('aix' as NodeJS.Platform, correr).disponible()).toBe(false)
  })

  it('si el comando no existe, el llavero no está disponible', () => {
    const correr: CorrerComando = () => ({ ok: false, salida: 'command not found' })
    expect(llaveroPorPlataforma('linux', correr).disponible()).toBe(false)
  })
})

describe('el cifrado apoyado en el llavero', () => {
  it('ida y vuelta', () => {
    const { llavero } = llaveroFalso()
    const safe = cifradoDeLlavero(llavero)
    expect(safe.decryptString(safe.encryptString('hola maestra'))).toBe('hola maestra')
  })

  it('lo que queda escrito NO contiene el texto', () => {
    const { llavero } = llaveroFalso()
    const cifrado = cifradoDeLlavero(llavero).encryptString('sk-la-maestra')
    expect(cifrado.toString('utf8')).not.toContain('sk-la-maestra')
    expect(cifrado.toString('base64')).not.toContain(Buffer.from('sk-la-maestra').toString('base64'))
  })

  it('la clave que abre el archivo vive en el LLAVERO, no en el archivo', () => {
    const { datos, llavero } = llaveroFalso()
    cifradoDeLlavero(llavero).encryptString('x')
    expect(datos.has(CUENTA_DE_LA_CLAVE)).toBe(true)
  })

  it('la clave se genera una sola vez y se reusa', () => {
    const { datos, llavero } = llaveroFalso()
    const safe = cifradoDeLlavero(llavero)
    const uno = safe.encryptString('a')
    const clave = datos.get(CUENTA_DE_LA_CLAVE)
    safe.encryptString('b')
    expect(datos.get(CUENTA_DE_LA_CLAVE)).toBe(clave)
    // Y lo cifrado antes se sigue pudiendo abrir.
    expect(safe.decryptString(uno)).toBe('a')
  })

  it('dos cifrados del mismo texto dan bytes distintos', () => {
    // Sin nonce por operación, dos memorias iguales se verían iguales en disco.
    const { llavero } = llaveroFalso()
    const safe = cifradoDeLlavero(llavero)
    expect(safe.encryptString('igual').equals(safe.encryptString('igual'))).toBe(false)
  })

  it('un archivo manoseado NO se descifra a medias: lanza', () => {
    const { llavero } = llaveroFalso()
    const safe = cifradoDeLlavero(llavero)
    const bueno = safe.encryptString('intacto')
    const roto = Buffer.from(bueno)
    roto[roto.length - 1] ^= 0xff
    expect(() => safe.decryptString(roto)).toThrow()
  })

  it('con una clave distinta no abre', () => {
    const a = llaveroFalso()
    const b = llaveroFalso()
    const cifrado = cifradoDeLlavero(a.llavero).encryptString('secreto')
    expect(() => cifradoDeLlavero(b.llavero).decryptString(cifrado)).toThrow()
  })

  it('sin llavero NO está disponible — y entonces nadie escribe la maestra', () => {
    // `saveKeyMaterial` lanza cuando esto es false, que es justo lo que se quiere: guardar
    // una maestra en claro sería peor que no cifrar nada.
    const { llavero } = llaveroFalso(false)
    expect(cifradoDeLlavero(llavero).isEncryptionAvailable()).toBe(false)
  })

  it('sin llavero, cifrar lanza en vez de devolver el texto', () => {
    const { llavero } = llaveroFalso(false)
    expect(() => cifradoDeLlavero(llavero).encryptString('maestra')).toThrow()
  })
})
