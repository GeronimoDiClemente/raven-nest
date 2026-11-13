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

/**
 * Las DECLARACIONES de una regla, sin sus comentarios.
 *
 * Sin sacar los comentarios, el propio texto que explica por qué el `inset` no está hacía
 * fallar al test que verifica que el `inset` no está. Un guard que se dispara con su propia
 * documentación es un guard que alguien termina borrando.
 */
function bloque(selector: string): string {
  const i = css.indexOf(`\n${selector} {`)
  if (i < 0) throw new Error(`no existe la regla ${selector}`)
  const fin = css.indexOf('\n}', i)
  return css.slice(i, fin).replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('la regla del borde', () => {
  /**
   * Lo que la regla prohíbe es el `inset`: pintaba el color del pane ADENTRO del área donde
   * se lee código, compitiendo con el fondo del tema. El resplandor exterior no — está por
   * fuera del pane y no pisa una sola línea de texto — y es lo que hace que con ocho paneles
   * el color se lea de lejos en vez de ser una línea de 1.5px que hay que buscar.
   */
  it('el pane no tiene sombra INTERNA teñida', () => {
    const b = bloque('.terminal-pane')
    expect(b, 'volvió el inset, que pinta adentro del área de terminal').not.toMatch(/inset/)
  })

  it('el resplandor exterior sí está: es lo que hace visible el color', () => {
    expect(bloque('.terminal-pane')).toMatch(/box-shadow:[^;]*--pane-color/)
  })

  it('el color sigue en el borde: no se perdió el identificador', () => {
    expect(bloque('.terminal-pane')).toMatch(/border:.*--pane-color/)
  })

  // La cabecera es cromo y está por FUERA del área donde se lee código: teñirla no compite
  // con un tema importado. Lo que no puede pasar es que el color entre al área de terminal.
  it('la cabecera se tiñe apenas, con el color del pane', () => {
    expect(bloque('.pane-header')).toMatch(/background:.*--pane-color/)
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

/**
 * El logo del agente y el circulo de color, en el mismo eje.
 *
 * El logo vive adentro del span de la etiqueta, y un `<svg>` adentro de un span de texto se
 * apoya en la LINEA BASE y no en el centro de la caja. El header centra a sus hijos, asi que
 * la caja de la etiqueta quedaba centrada pero el logo de adentro se apoyaba mas arriba: al
 * lado del circulo de color —que si se centra— el desfasaje se veia.
 */
describe('la cabecera del pane alinea el logo con el círculo', () => {
  it('la etiqueta centra su contenido en vez de apoyarlo en la línea base', () => {
    const b = bloque('.pane-ai-label')
    expect(b, 'sin display flex el svg vuelve a la línea base').toMatch(/display:\s*inline-flex/)
    expect(b).toMatch(/align-items:\s*center/)
  })

  it('el header centra a sus hijos', () => {
    expect(bloque('.pane-header-left')).toMatch(/align-items:\s*center/)
  })
})
