import { describe, it, expect } from 'vitest'
import { estadoDePane, pareceEsperandoInput, ETIQUETA_DE_ESTADO } from '../lib/pane-state'

const base = { ocupado: false, colaDeSalida: '', enfocado: false, sinLeer: false }

describe('pareceEsperandoInput', () => {
  it('reconoce las confirmaciones de una letra', () => {
    expect(pareceEsperandoInput('Apply these changes? (y/n)')).toBe(true)
    expect(pareceEsperandoInput('Overwrite the file? [Y/n]')).toBe(true)
    expect(pareceEsperandoInput('Continue? (yes/no)')).toBe(true)
  })

  it('reconoce una pregunta abierta', () => {
    expect(pareceEsperandoInput('Do you want me to run the tests?')).toBe(true)
    expect(pareceEsperandoInput('Which file should I edit?')).toBe(true)
  })

  it('reconoce un prompt de contraseña', () => {
    expect(pareceEsperandoInput('Enter passphrase:')).toBe(true)
    expect(pareceEsperandoInput('Password:')).toBe(true)
  })

  it('reconoce el cursor del agente esperando', () => {
    expect(pareceEsperandoInput('listo\n›')).toBe(true)
    expect(pareceEsperandoInput('listo\n❯ ')).toBe(true)
  })

  it('no confunde salida normal con una pregunta', () => {
    expect(pareceEsperandoInput('3 archivos cambiados')).toBe(false)
    expect(pareceEsperandoInput('Running tests...')).toBe(false)
    expect(pareceEsperandoInput('')).toBe(false)
    expect(pareceEsperandoInput('   \n  \n ')).toBe(false)
  })

  /**
   * Un `(y/n)` de hace veinte lineas NO significa que este esperando ahora: ya lo
   * contestaste y el agente siguio. Sin la ventana de cola, el chip se quedaria clavado en
   * "needs you" por el resto de la sesion.
   */
  it('una pregunta vieja, ya contestada, no cuenta', () => {
    const viejo = [
      'Apply changes? (y/n)', 'y', 'aplicando', 'listo', '3 archivos cambiados', 'todo ok',
    ].join('\n')
    expect(pareceEsperandoInput(viejo)).toBe(false)
  })

  // El detector corre sobre texto YA limpio de ANSI. Si le llegara crudo, un `[?25h` al final
  // haria que ningun patron anclado en `$` matchee y no encontraria nada nunca.
  it('con la secuencia ANSI pegada no matchea — por eso se limpia antes', () => {
    expect(pareceEsperandoInput('Continue? (y/n)[?25h')).toBe(false)
  })
})

describe('estadoDePane', () => {
  it('si sale texto, esta trabajando', () => {
    expect(estadoDePane({ ...base, ocupado: true })).toBe('working')
  })

  /**
   * `working` gana sobre `waiting` aunque la ultima linea parezca una pregunta: lo que hay
   * abajo del scroll todavia se esta escribiendo.
   */
  it('trabajando le gana a una pregunta a medio imprimir', () => {
    expect(estadoDePane({ ...base, ocupado: true, colaDeSalida: 'Continue? (y/n)' })).toBe('working')
  })

  it('quieto con una pregunta al final, te necesita', () => {
    expect(estadoDePane({ ...base, colaDeSalida: 'Apply? (y/n)' })).toBe('waiting')
  })

  // Pedirte algo es mas urgente que tener algo para leer.
  it('necesitarte le gana a estar sin leer', () => {
    expect(estadoDePane({ ...base, colaDeSalida: 'Apply? (y/n)', sinLeer: true })).toBe('waiting')
  })

  it('termino y no lo miraste: sin leer', () => {
    expect(estadoDePane({ ...base, sinLeer: true })).toBe('unread')
  })

  // No puede haber nada "sin leer" en el pane que tenes adelante.
  it('el pane enfocado nunca esta sin leer', () => {
    expect(estadoDePane({ ...base, sinLeer: true, enfocado: true })).toBe('idle')
  })

  it('quieto y ya visto no muestra nada', () => {
    expect(estadoDePane(base)).toBe('idle')
    expect(ETIQUETA_DE_ESTADO.idle).toBe('')
  })
})

describe('las etiquetas', () => {
  // La app esta en ingles. Un chip en espanol seria lo unico traducido de la pantalla.
  it('estan en ingles', () => {
    for (const [estado, texto] of Object.entries(ETIQUETA_DE_ESTADO)) {
      expect(texto, estado).not.toMatch(/[áéíóúñ¿¡]/i)
    }
  })
})
