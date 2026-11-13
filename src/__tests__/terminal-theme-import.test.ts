import { describe, it, expect } from 'vitest'
import { importarTema, importarDeGhostty, importarDeWarp } from '../lib/terminal-theme-import'
import { peorContraste } from '../lib/terminal-themes'

/**
 * Los dos formatos salen de archivos REALES —un tema de Ghostty y uno de Warp, bajados el
 * 2026-09-13 de `mbadolato/iTerm2-Color-Schemes` y de `warpdotdev/themes`— y no de lo que la
 * documentacion dice que son. Parsear contra lo que un formato *dice* ser es como se llega a
 * un importador que anda con el ejemplo del README y con nada mas.
 */
const GHOSTTY_DRACULA = [
  ...Array.from({ length: 16 }, (_, i) => `palette = ${i}=#${['21222c','ff5555','50fa7b','f1fa8c','bd93f9','ff79c6','8be9fd','f8f8f2','6272a4','ff6e6e','69ff94','ffffa5','d6acff','ff92df','a4ffff','ffffff'][i]}`),
  'background = #282a36',
  'foreground = #f8f8f2',
  'cursor-color = #f8f8f2',
  'selection-background = #44475a',
].join('\n')

const WARP_DRACULA = `accent: "#bd93f9"
background: "#282a36"
details: darker
foreground: "#f8f8f2"
terminal_colors:
  bright:
    black: "#555555"
    blue: "#caa9fa"
    cyan: "#8be9fd"
    green: "#50fa7b"
    magenta: "#ff79c6"
    red: "#ff5555"
    white: "#ffffff"
    yellow: "#f1fa8c"
  normal:
    black: "#000000"
    blue: "#bd93f9"
    cyan: "#8be9fd"
    green: "#50fa7b"
    magenta: "#ff79c6"
    red: "#ff5555"
    white: "#bbbbbb"
    yellow: "#f1fa8c"
`

describe('Ghostty', () => {
  it('trae los 16 en el orden estandar', () => {
    const r = importarDeGhostty(GHOSTTY_DRACULA, 'Dracula')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.tema.ansi).toHaveLength(16)
    expect(r.tema.ansi[0]).toBe('#21222c')
    expect(r.tema.ansi[1]).toBe('#ff5555')
    expect(r.tema.ansi[15]).toBe('#ffffff')
    expect(r.tema.background).toBe('#282a36')
    expect(r.tema.cursor).toBe('#f8f8f2')
    expect(r.tema.id).toBe('dracula')
  })

  // Un tema a medias es peor que ninguno: la mitad de la paleta sale de otro lado y el
  // usuario ve colores que no eligio nadie.
  it('un tema incompleto se rechaza entero', () => {
    const parcial = 'palette = 0=#000000\nbackground = #111111\nforeground = #eeeeee'
    const r = importarDeGhostty(parcial, 'Parcial')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/only defines 1 of the 16/i)
  })

  it('sin fondo ni texto, dice que no parece un tema', () => {
    const r = importarDeGhostty('palette = 0=#000000', 'X')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/no background or foreground/i)
  })

  it('acepta hex sin numeral y normaliza a minusculas', () => {
    const sinNumeral = GHOSTTY_DRACULA.replace('background = #282a36', 'background = 282A36')
    const r = importarDeGhostty(sinNumeral, 'D')
    expect(r.ok && r.tema.background).toBe('#282a36')
  })
})

describe('Warp', () => {
  it('mapea normal y bright al orden ANSI', () => {
    const r = importarDeWarp(WARP_DRACULA, 'Dracula')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // normal: black red green yellow blue magenta cyan white
    expect(r.tema.ansi.slice(0, 8)).toEqual(
      ['#000000', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#bbbbbb'],
    )
    expect(r.tema.ansi[8]).toBe('#555555')
    expect(r.tema.background).toBe('#282a36')
    // Warp no tiene color de cursor: usa el acento.
    expect(r.tema.cursor).toBe('#bd93f9')
  })

  it('sin terminal_colors lo dice', () => {
    const r = importarDeWarp('background: "#111111"\nforeground: "#eeeeee"', 'X')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/terminal_colors/i)
  })

  it('si falta un color del grupo, nombra cual', () => {
    const sinRojo = WARP_DRACULA.replace('    red: "#ff5555"\n    white: "#bbbbbb"', '    white: "#bbbbbb"')
    const r = importarDeWarp(sinRojo, 'X')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/missing the red/i)
  })
})

/**
 * Se decide por el CONTENIDO y no por la extension: un tema de Ghostty no tiene extension
 * (`~/.config/ghostty/themes/Dracula`) y el usuario puede haber renombrado el de Warp.
 */
describe('importarTema elige el formato solo', () => {
  it('reconoce Ghostty por sus lineas de palette', () => {
    const r = importarTema(GHOSTTY_DRACULA, 'Dracula')
    expect(r.ok && r.tema.ansi[1]).toBe('#ff5555')
  })

  it('reconoce Warp por su bloque terminal_colors', () => {
    const r = importarTema(WARP_DRACULA, 'Dracula')
    expect(r.ok && r.tema.ansi[1]).toBe('#ff5555')
  })

  it('un archivo que no es ninguno de los dos lo dice, y dice como reconocerlos', () => {
    const r = importarTema('{"theme": "nope"}', 'X')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/Ghostty/)
      expect(r.error).toMatch(/Warp/)
    }
  })

  // Los dos formatos del MISMO tema tienen que dar el mismo resultado donde se solapan.
  it('el mismo tema desde los dos formatos coincide en lo que comparten', () => {
    const g = importarTema(GHOSTTY_DRACULA, 'Dracula')
    const w = importarTema(WARP_DRACULA, 'Dracula')
    expect(g.ok && w.ok).toBe(true)
    if (!g.ok || !w.ok) return
    expect(g.tema.background).toBe(w.tema.background)
    expect(g.tema.foreground).toBe(w.tema.foreground)
    for (const i of [1, 2, 3, 5, 6]) {
      expect(g.tema.ansi[i], `ansi ${i}`).toBe(w.tema.ansi[i])
    }
  })

  // Un tema importado entra al mismo circuito que los del catalogo, ajuste de contraste
  // incluido: si no, importar seria la puerta de atras para meter un tema ilegible.
  it('lo importado se puede medir como cualquier otro', () => {
    const r = importarTema(GHOSTTY_DRACULA, 'Dracula')
    expect(r.ok).toBe(true)
    if (r.ok) expect(peorContraste(r.tema)).toBeGreaterThan(1)
  })
})
