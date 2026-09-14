import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * LA REGLA DEL BORDE: de la línea del cromo para adentro manda el tema, de la línea para
 * afuera manda el color que elegiste.
 *
 * El color del pane se pintaba en cuatro lugares y dos caían DENTRO del área donde se lee
 * código. Con un único tema hardcodeado pasaba desapercibido; con temas importados es el
 * problema entero — alguien trae su Gruvbox y le queda teñido por un color que eligió para
 * otra cosa, y el tema deja de verse como se ve en su terminal de siempre.
 *
 * Este test es un guard sobre el CSS, no sobre un render: la regla es fácil de romper sin
 * querer agregando una línea a las 12.000 de `global.css`, y ahí no la ve nadie hasta que un
 * usuario se queja de que su tema se ve mal.
 */
const css = readFileSync(join(process.cwd(), 'src/styles/global.css'), 'utf8')

/** El bloque de una regla, por su selector exacto. */
function bloque(selector: string): string {
  const i = css.indexOf(`\n${selector} {`)
  if (i < 0) throw new Error(`no existe la regla ${selector}`)
  const fin = css.indexOf('\n}', i)
  return css.slice(i, fin)
}

describe('la regla del borde', () => {
  it('el pane no tiene resplandor ni borde interno teñidos', () => {
    const b = bloque('.terminal-pane')
    // `box-shadow` era `inset 0 0 0 1px <color>` + un glow: dos de los cuatro lugares.
    expect(b, 'el box-shadow teñido volvió').not.toMatch(/box-shadow/)
  })

  it('el color sigue en el borde: no se perdió el identificador', () => {
    expect(bloque('.terminal-pane')).toMatch(/border:.*--pane-color/)
  })

  it('la cabecera no se rellena con el color del pane', () => {
    const b = bloque('.pane-header')
    const fondo = b.split('\n').find((l) => /^\s*background:/.test(l)) ?? ''
    expect(fondo, 'el fondo de la cabecera volvió a teñirse').not.toMatch(/--pane-color/)
  })

  it('la línea de abajo de la cabecera SÍ conserva el color: es la continuación del borde', () => {
    expect(bloque('.pane-header')).toMatch(/border-bottom:.*--pane-color/)
  })

  /**
   * El área de terminal no puede tener un fondo propio en el CSS: lo pone el tema, inline,
   * desde `TerminalPane.tsx`. Una regla acá le ganaría al estilo del tema en el peor caso o
   * pelearía con él en el mejor.
   */
  it('el área de terminal no declara su propio fondo', () => {
    const b = bloque('.terminal-container')
    expect(b).not.toMatch(/^\s*background:/m)
  })
})
