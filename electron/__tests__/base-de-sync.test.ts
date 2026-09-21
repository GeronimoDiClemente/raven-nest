// De dónde sale la URL del servicio de sync.
//
// Esto existe por un bug que estuvo vivo y silencioso: `getMemorySyncBaseUrl()` leía
// `memoryConnectionState.syncBaseUrl || MAIN_VITE_SUPABASE_URL || null`, el campo guardado no
// lo escribía NADIE, y `MAIN_VITE_SUPABASE_URL` sólo existe en el `.env` de una máquina de
// desarrollo (gitignored, y los workflows de release no lo pasan). O sea que **toda
// instalación armada por CI queda sin servicio de sync**, y la única forma de arreglarlo era
// recompilar — justo lo que el comentario del C4 decía que no debía hacer falta.
import { describe, it, expect } from 'vitest'
import { resolverBaseDeSync, normalizarBaseDeSync, decidirCambioDeBase, BASE_DE_SYNC_POR_DEFECTO } from '../base-de-sync'

describe('normalizarBaseDeSync', () => {
  it('saca los espacios y las barras finales, que después se duplican contra el path', () => {
    expect(normalizarBaseDeSync('  https://sync.example.com///  ')).toBe('https://sync.example.com')
  })

  it('conserva un path base: un servicio puede vivir colgado de un prefijo', () => {
    expect(normalizarBaseDeSync('https://example.com/memoria/')).toBe('https://example.com/memoria')
  })

  it('rechaza lo que no es http(s): un `file:` o un `javascript:` no es un servicio', () => {
    expect(normalizarBaseDeSync('file:///etc/passwd')).toBeNull()
    expect(normalizarBaseDeSync('javascript:alert(1)')).toBeNull()
    expect(normalizarBaseDeSync('ftp://example.com')).toBeNull()
  })

  it('rechaza texto suelto y vacíos', () => {
    for (const v of ['', '   ', 'no-es-una-url', 'https://']) expect(normalizarBaseDeSync(v)).toBeNull()
  })

  it('acepta http, que es lo que usa un servicio local de desarrollo', () => {
    expect(normalizarBaseDeSync('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080')
  })
})

describe('resolverBaseDeSync', () => {
  it('la guardada gana: es la que el usuario eligió en ESTA instalación', () => {
    expect(resolverBaseDeSync({ guardada: 'https://mia.example.com', delBuild: 'https://del-build.example.com' }))
      .toBe('https://mia.example.com')
  })

  it('sin guardada, la del build: es lo que hace que un dev build apunte a su servicio', () => {
    expect(resolverBaseDeSync({ guardada: null, delBuild: 'https://del-build.example.com' }))
      .toBe('https://del-build.example.com')
  })

  // El corazón del arreglo. Antes, sin ninguna de las dos, la respuesta era `null` y la app
  // contestaba "No sync service configured for this build" — que es lo que le pasa HOY a
  // cualquier instalación hecha por CI, porque los workflows no pasan esa variable.
  it('sin ninguna de las dos hay servicio igual: una instalación no nace sin nube', () => {
    expect(resolverBaseDeSync({ guardada: null, delBuild: null })).toBe(BASE_DE_SYNC_POR_DEFECTO)
  })

  it('un vacío no cuenta como elegido, en ninguno de los dos orígenes', () => {
    expect(resolverBaseDeSync({ guardada: '', delBuild: '  ' })).toBe(BASE_DE_SYNC_POR_DEFECTO)
    expect(resolverBaseDeSync({ guardada: '   ', delBuild: 'https://del-build.example.com' }))
      .toBe('https://del-build.example.com')
  })

  // Una URL guardada que no se puede usar no puede dejar a la app sin sync: si lo hiciera, un
  // dedazo en el campo de la UI apagaría la nube hasta que alguien editara un JSON a mano.
  it('una guardada inservible se ignora y se sigue de largo', () => {
    expect(resolverBaseDeSync({ guardada: 'no-es-una-url', delBuild: 'https://del-build.example.com' }))
      .toBe('https://del-build.example.com')
    expect(resolverBaseDeSync({ guardada: 'file:///etc/passwd', delBuild: null })).toBe(BASE_DE_SYNC_POR_DEFECTO)
  })

  it('normaliza venga de donde venga, así el que la usa concatena sin pensar', () => {
    expect(resolverBaseDeSync({ guardada: 'https://mia.example.com/', delBuild: null })).toBe('https://mia.example.com')
    expect(resolverBaseDeSync({ guardada: null, delBuild: ' https://del-build.example.com// ' }))
      .toBe('https://del-build.example.com')
  })

  it('el default es una URL usable, no un placeholder', () => {
    expect(normalizarBaseDeSync(BASE_DE_SYNC_POR_DEFECTO)).toBe(BASE_DE_SYNC_POR_DEFECTO)
    expect(BASE_DE_SYNC_POR_DEFECTO.startsWith('https://')).toBe(true)
  })
})

// Guardar es más estricto que leer, y la asimetría es deliberada.
//
// `resolverBaseDeSync` se saltea una URL guardada que no sirve, porque su trabajo es que la
// app tenga servicio pase lo que pase. El SETTER no puede hacer eso: si aceptara un dedazo y
// después el resolver lo ignorara, el usuario vería su texto guardado en la pantalla y una
// app hablando con otro servicio, sin una sola señal de que algo no cerró.
describe('decidirCambioDeBase', () => {
  it('acepta una URL usable y la guarda normalizada', () => {
    expect(decidirCambioDeBase('  https://mia.example.com/  ')).toEqual({ ok: true, guardar: 'https://mia.example.com' })
  })

  it('vaciar el campo vuelve al default en vez de guardar un vacío', () => {
    expect(decidirCambioDeBase(null)).toEqual({ ok: true, guardar: null })
    expect(decidirCambioDeBase('   ')).toEqual({ ok: true, guardar: null })
  })

  it('un texto que no es una URL se rechaza con un motivo, no se traga', () => {
    const r = decidirCambioDeBase('sync-production-54ba.up.railway.app')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/https?/i)
  })

  it('rechaza esquemas que no son de un servicio web', () => {
    expect(decidirCambioDeBase('file:///etc/passwd').ok).toBe(false)
    expect(decidirCambioDeBase('javascript:alert(1)').ok).toBe(false)
  })

  it('guardar exactamente el default no es un caso especial: se guarda igual', () => {
    // Si se tratara como "volver al default" (guardar null), el día que el default cambie
    // esta instalación se mudaría sola a un servicio que el usuario no eligió.
    expect(decidirCambioDeBase(BASE_DE_SYNC_POR_DEFECTO)).toEqual({ ok: true, guardar: BASE_DE_SYNC_POR_DEFECTO })
  })
})
