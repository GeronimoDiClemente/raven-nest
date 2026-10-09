import { describe, it, expect, vi } from 'vitest'
import {
  llaveroPorPlataforma, cifradoDeLlavero, correrComando, SERVICIO, CUENTA_DE_LA_CLAVE,
  type CorrerComando, type EntornoDelLlavero,
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

/**
 * Un `secret-tool` de mentira que se porta como el real, medido el 2026-10-08 en Ubuntu 26.04
 * (WSL) contra libsecret-tools y gnome-keyring: `--version` NO existe (sale 2 con el uso),
 * `search` sale 0 haya o no servicio de secretos, y sólo `store` + `lookup` dicen la verdad.
 */
function secretToolReal(conServicio: boolean) {
  const datos = new Map<string, string>()
  const correr = vi.fn<CorrerComando>((cmd, args, entrada) => {
    if (cmd !== 'secret-tool') return { ok: false, salida: 'command not found' }
    const cuenta = args[args.indexOf('account') + 1]!
    switch (args[0]) {
      case 'store':
        if (!conServicio) return { ok: false, salida: '' }
        datos.set(cuenta, entrada ?? ''); return { ok: true, salida: '' }
      case 'lookup':
        return datos.has(cuenta) ? { ok: true, salida: datos.get(cuenta)! } : { ok: false, salida: '' }
      case 'clear':
        datos.delete(cuenta); return { ok: conServicio, salida: '' }
      case 'search':
        return { ok: true, salida: '' }
      default:
        return { ok: false, salida: 'usage: secret-tool store ...' }
    }
  })
  return { correr, datos }
}

/** Un Linux con bus de sesión, como un escritorio o un WSL con systemd. */
const CON_BUS: EntornoDelLlavero = {
  env: { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' },
  existe: () => false,
}

describe('Linux: el llavero contra el secret-tool real', () => {
  it('con servicio de secretos está disponible', () => {
    const { correr } = secretToolReal(true)
    expect(llaveroPorPlataforma('linux', correr, CON_BUS).disponible()).toBe(true)
  })

  it('sin servicio de secretos no está disponible', () => {
    const { correr } = secretToolReal(false)
    expect(llaveroPorPlataforma('linux', correr, CON_BUS).disponible()).toBe(false)
  })

  it('la sonda no deja nada escrito en el llavero', () => {
    const { correr, datos } = secretToolReal(true)
    llaveroPorPlataforma('linux', correr, CON_BUS).disponible()
    expect(datos.size).toBe(0)
  })

  // La sonda son tres procesos y un servicio colgado tarda el timeout entero: se paga una vez.
  it('la sonda corre una sola vez por proceso', () => {
    const { correr } = secretToolReal(true)
    const llavero = llaveroPorPlataforma('linux', correr, CON_BUS)
    llavero.disponible()
    const llamadas = correr.mock.calls.length
    llavero.disponible()
    expect(correr.mock.calls.length).toBe(llamadas)
  })
})

/**
 * El `dbus-send` real, medido el 2026-10-09 en Ubuntu 26.04 (WSL): el error del bus sale por
 * stderr con la forma `Error org.freedesktop.DBus.Error.<Nombre>: …`, y la respuesta de
 * `ReadAlias` es `object path "<ruta>"`. Lo que no es `dbus-send` lo atiende el secret-tool
 * de mentira de arriba.
 */
function conBus(dbus: { ok: boolean; salida: string }, conServicio = true) {
  const st = secretToolReal(conServicio)
  const correr = vi.fn<CorrerComando>((cmd, args, entrada) =>
    cmd === 'dbus-send' ? dbus : st.correr(cmd, args, entrada))
  const secretTool = () => correr.mock.calls.filter(([c]) => c === 'secret-tool').length
  return { correr, secretTool }
}

const RESPUESTA_CON_COLECCION = {
  ok: true,
  salida: 'method return time=1 sender=:1.0 -> destination=:1.2 serial=5 reply_serial=2\n' +
    '   object path "/org/freedesktop/secrets/collection/login"\n',
}

describe('Linux sin servicio de secretos: responder rápido, sin colgarse en la sonda', () => {
  // Sin servicio, `secret-tool` se cuelga hasta el timeout de 10 s en cada uno de sus tres
  // procesos, y eso se pagaba en CADA arranque del paquete en un servidor o un WSL pelado.

  it('sin bus de sesión no está disponible, y no corre ningún comando', () => {
    const { correr } = conBus(RESPUESTA_CON_COLECCION)
    const sinBus: EntornoDelLlavero = { env: {}, existe: () => true }
    expect(llaveroPorPlataforma('linux', correr, sinBus).disponible()).toBe(false)
    expect(correr).not.toHaveBeenCalled()
  })

  it('con XDG_RUNTIME_DIR pero sin el socket del bus, tampoco', () => {
    const { correr } = conBus(RESPUESTA_CON_COLECCION)
    const existe = vi.fn(() => false)
    const entorno: EntornoDelLlavero = { env: { XDG_RUNTIME_DIR: '/run/user/1000' }, existe }
    expect(llaveroPorPlataforma('linux', correr, entorno).disponible()).toBe(false)
    expect(existe).toHaveBeenCalledWith('/run/user/1000/bus')
    expect(correr).not.toHaveBeenCalled()
  })

  it('el bus de systemd en $XDG_RUNTIME_DIR/bus cuenta como bus aunque falte la variable', () => {
    const { correr } = conBus(RESPUESTA_CON_COLECCION)
    const entorno: EntornoDelLlavero = {
      env: { XDG_RUNTIME_DIR: '/run/user/1000' },
      existe: (r) => r === '/run/user/1000/bus',
    }
    expect(llaveroPorPlataforma('linux', correr, entorno).disponible()).toBe(true)
  })

  it('si nadie provee org.freedesktop.secrets, no sondea', () => {
    const { correr, secretTool } = conBus({
      ok: false,
      salida: 'Error org.freedesktop.DBus.Error.ServiceUnknown: The name org.freedesktop.secrets was not provided by any .service files\n',
    })
    expect(llaveroPorPlataforma('linux', correr, CON_BUS).disponible()).toBe(false)
    expect(secretTool()).toBe(0)
  })

  it('si el servicio se cuelga al activarse, no sondea', () => {
    // Medido en WSL con `dbus-run-session`: gnome-keyring activado por D-Bus no contesta
    // nunca, y store/lookup/clear tardaban 25 s cada uno (10 s con nuestro timeout).
    const { correr, secretTool } = conBus({
      ok: false,
      salida: 'Error org.freedesktop.DBus.Error.NoReply: Did not receive a reply.\n',
    })
    expect(llaveroPorPlataforma('linux', correr, CON_BUS).disponible()).toBe(false)
    expect(secretTool()).toBe(0)
  })

  it('si el servicio corre pero no tiene colección por defecto, no sondea', () => {
    // El gnome-keyring que systemd activa en un WSL pelado: ReadAlias da la ruta nula, y
    // `store` falla igual después de varios segundos.
    const { correr, secretTool } = conBus({
      ok: true,
      salida: 'method return time=1 sender=:1.3 -> destination=:1.2 serial=6 reply_serial=2\n   object path "/"\n',
    })
    expect(llaveroPorPlataforma('linux', correr, CON_BUS).disponible()).toBe(false)
    expect(secretTool()).toBe(0)
  })

  it('si el bus no se puede abrir, no sondea', () => {
    const { correr, secretTool } = conBus({
      ok: false,
      salida: 'Failed to open connection to "session" message bus: Failed to connect to socket /nope: No such file or directory\n',
    })
    expect(llaveroPorPlataforma('linux', correr, CON_BUS).disponible()).toBe(false)
    expect(secretTool()).toBe(0)
  })

  it('la pregunta al bus tiene un techo corto, no el de 10 s', () => {
    const { correr } = conBus(RESPUESTA_CON_COLECCION)
    llaveroPorPlataforma('linux', correr, CON_BUS).disponible()
    const [, args] = correr.mock.calls.find(([c]) => c === 'dbus-send')!
    const techo = Number(args.find((a) => a.startsWith('--reply-timeout='))?.split('=')[1])
    expect(techo).toBeGreaterThan(0)
    expect(techo).toBeLessThanOrEqual(2000)
  })
})

describe('Linux con servicio de secretos: la pregunta al bus no inventa un sí ni un no', () => {
  it('con colección por defecto, igual decide la sonda: si guarda, está disponible', () => {
    const { correr, secretTool } = conBus(RESPUESTA_CON_COLECCION, true)
    expect(llaveroPorPlataforma('linux', correr, CON_BUS).disponible()).toBe(true)
    expect(secretTool()).toBe(3)
  })

  it('con colección por defecto pero un store que falla, no está disponible', () => {
    const { correr } = conBus(RESPUESTA_CON_COLECCION, false)
    expect(llaveroPorPlataforma('linux', correr, CON_BUS).disponible()).toBe(false)
  })

  it('sin dbus-send instalado se cae a la sonda de siempre', () => {
    const { correr } = conBus({ ok: false, salida: 'spawnSync dbus-send ENOENT' }, true)
    expect(llaveroPorPlataforma('linux', correr, CON_BUS).disponible()).toBe(true)
  })

  it('un error del bus que no conocemos no es un no: decide la sonda', () => {
    const { correr } = conBus({
      ok: false,
      salida: 'Error org.freedesktop.DBus.Error.AccessDenied: Rejected send message\n',
    }, true)
    expect(llaveroPorPlataforma('linux', correr, CON_BUS).disponible()).toBe(true)
  })
})

describe('correrComando de verdad', () => {
  it('cuando el comando falla devuelve su stderr, no un string vacío', () => {
    // Con `stdout ?? stderr`, el '' de stdout tapaba siempre el stderr, que es donde
    // `dbus-send` escribe el error del bus.
    const r = correrComando(process.execPath, ['-e', 'process.stderr.write("boom"); process.exit(1)'])
    expect(r.ok).toBe(false)
    expect(r.salida).toContain('boom')
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

  // Un llavero que dice estar disponible pero no guarda (bloqueado, un diálogo que nadie
  // contesta y vence el timeout): cifrar con una clave que no quedó en ningún lado deja la
  // maestra ilegible para siempre en el próximo arranque. Tiene que lanzar.
  it('si la clave nueva no quedó guardada, cifrar lanza', () => {
    const llavero = {
      disponible: () => true,
      leer: () => null,
      guardar: () => { /* falla en silencio */ },
      borrar: () => {},
    }
    expect(() => cifradoDeLlavero(llavero).encryptString('maestra')).toThrow()
  })

  it('sin llavero, cifrar lanza en vez de devolver el texto', () => {
    const { llavero } = llaveroFalso(false)
    expect(() => cifradoDeLlavero(llavero).encryptString('maestra')).toThrow()
  })
})
