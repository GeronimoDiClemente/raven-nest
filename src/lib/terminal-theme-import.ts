/**
 * Traer un tema de Ghostty o de Warp.
 *
 * El catálogo de `terminal-themes.ts` son trece temas que elegimos nosotros. Esto es la otra
 * mitad y la que importa más: **el usuario ya tiene su tema elegido**, configurado hace meses
 * en la terminal que usa todos los días, y lo único que le pide a Nest es reconocerlo. Orca
 * hace exactamente esto —importa de Ghostty y de Warp— y no inventó un lenguaje visual
 * propio: adoptó el que la gente ya tiene.
 *
 * Los dos formatos salen de archivos REALES, no de la documentación: un tema de Ghostty y uno
 * de Warp, descargados el 2026-09-13 de `mbadolato/iTerm2-Color-Schemes` y de
 * `warpdotdev/themes`. Parsear contra lo que un formato *dice* ser es como se llega a un
 * importador que anda con el ejemplo del README y con nada más.
 *
 * Es un parser puro: sin `fs`, sin Electron. Quien lee el archivo es el llamador.
 */
import type { TemaDeTerminal } from './terminal-themes'

export type ResultadoDeImport =
  | { ok: true; tema: TemaDeTerminal }
  | { ok: false; error: string }

/** Los 16 en el orden estándar, que es el que usa `TemaDeTerminal.ansi`. */
const ORDEN: Array<'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white'> =
  ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']

const HEX = /^#?[0-9a-fA-F]{6}$/

/** Normaliza `282a36`, `#282a36` y `#282A36` a `#282a36`. Devuelve null si no es un color. */
function hex(valor: string | undefined): string | null {
  if (!valor) return null
  const limpio = valor.trim().replace(/^["']|["']$/g, '')
  if (!HEX.test(limpio)) return null
  return ('#' + limpio.replace('#', '')).toLowerCase()
}

export function slugDeTema(nombre: string): string {
  return nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'importado'
}

/**
 * Un tema de Ghostty: líneas `clave = valor`, y la paleta como 16 líneas repetidas
 * `palette = N=#hex`.
 *
 * Ejemplo real (Dracula):
 * ```
 * palette = 0=#21222c
 * background = #282a36
 * cursor-color = #f8f8f2
 * ```
 */
export function importarDeGhostty(texto: string, nombre: string): ResultadoDeImport {
  const ansi: Array<string | null> = Array(16).fill(null)
  const campos = new Map<string, string>()

  for (const linea of texto.split('\n')) {
    const sinComentario = linea.split('#')[0] === '' ? linea : linea
    const corte = sinComentario.indexOf('=')
    if (corte < 0) continue
    const clave = sinComentario.slice(0, corte).trim().toLowerCase()
    const valor = sinComentario.slice(corte + 1).trim()
    if (clave === 'palette') {
      // `palette = 12=#d6acff`: el índice y el color van del lado derecho.
      const corte2 = valor.indexOf('=')
      if (corte2 < 0) continue
      const i = Number(valor.slice(0, corte2).trim())
      const c = hex(valor.slice(corte2 + 1))
      if (Number.isInteger(i) && i >= 0 && i < 16 && c) ansi[i] = c
    } else if (clave) {
      campos.set(clave, valor)
    }
  }

  const background = hex(campos.get('background'))
  const foreground = hex(campos.get('foreground'))
  const faltan = ansi.filter((c) => c === null).length

  if (!background || !foreground) {
    return { ok: false, error: 'This file has no background or foreground colour — it does not look like a Ghostty theme.' }
  }
  if (faltan > 0) {
    return { ok: false, error: `This Ghostty theme only defines ${16 - faltan} of the 16 palette colours.` }
  }

  return {
    ok: true,
    tema: {
      id: slugDeTema(nombre),
      nombre,
      background,
      foreground,
      cursor: hex(campos.get('cursor-color')) ?? foreground,
      selection: hex(campos.get('selection-background')) ?? '#ffffff33',
      ansi: ansi as string[],
    },
  }
}

/**
 * Un tema de Warp: YAML con `terminal_colors.normal` y `.bright`.
 *
 * **Se parsea a mano y no con una librería de YAML**, a propósito: el archivo que interesa es
 * un mapa de dos niveles con valores escalares y nada más — sin anclas, sin listas, sin
 * multilínea. Sumar un parser de YAML entero al bundle del renderer por esto sería pagar un
 * peso que el usuario descarga siempre para una función que usa una vez.
 *
 * El precio de esa decisión, dicho: un YAML válido pero escrito de otra forma (todo en una
 * línea con `{}`) no se va a entender. Devuelve un error que lo dice, no un tema a medias.
 */
export function importarDeWarp(texto: string, nombre: string): ResultadoDeImport {
  const raiz = new Map<string, string>()
  /** `normal` y `bright`, cada uno con sus ocho. */
  const grupos = new Map<string, Map<string, string>>()

  let grupoActual: string | null = null
  let dentroDeTerminalColors = false

  for (const cruda of texto.split('\n')) {
    const linea = cruda.replace(/\r$/, '')
    if (linea.trim() === '' || linea.trim().startsWith('#')) continue
    const sangria = linea.length - linea.trimStart().length
    const corte = linea.indexOf(':')
    if (corte < 0) continue
    const clave = linea.slice(0, corte).trim().toLowerCase()
    const valor = linea.slice(corte + 1).trim()

    if (sangria === 0) {
      dentroDeTerminalColors = clave === 'terminal_colors'
      grupoActual = null
      if (!dentroDeTerminalColors && valor) raiz.set(clave, valor)
      continue
    }
    if (!dentroDeTerminalColors) continue
    if (valor === '') {
      // `  normal:` — abre un grupo.
      grupoActual = clave
      grupos.set(clave, new Map())
      continue
    }
    if (grupoActual) grupos.get(grupoActual)?.set(clave, valor)
  }

  const background = hex(raiz.get('background'))
  const foreground = hex(raiz.get('foreground'))
  const normal = grupos.get('normal')
  const bright = grupos.get('bright')

  if (!background || !foreground) {
    return { ok: false, error: 'This file has no background or foreground colour — it does not look like a Warp theme.' }
  }
  if (!normal || !bright) {
    return { ok: false, error: 'This Warp theme has no terminal_colors with normal and bright groups.' }
  }

  const ansi: string[] = []
  for (const grupo of [normal, bright]) {
    for (const nombreDeColor of ORDEN) {
      const c = hex(grupo.get(nombreDeColor))
      if (!c) {
        return { ok: false, error: `This Warp theme is missing the ${nombreDeColor} colour.` }
      }
      ansi.push(c)
    }
  }

  return {
    ok: true,
    tema: {
      id: slugDeTema(nombre),
      nombre,
      background,
      foreground,
      // Warp no tiene color de cursor propio: usa el acento, y si no, el texto.
      cursor: hex(raiz.get('accent')) ?? foreground,
      selection: hex(raiz.get('accent')) ?? '#ffffff33',
      ansi,
    },
  }
}

/**
 * Importa mirando el CONTENIDO, no la extensión.
 *
 * Un tema de Ghostty no tiene extensión (`~/.config/ghostty/themes/Dracula`) y uno de Warp es
 * `.yaml`, pero el usuario puede haberlo renombrado o bajado con otro nombre. Decidir por el
 * contenido hace que "arrastrá tu archivo" funcione sin explicarle a nadie qué formato tiene
 * lo que ya tiene.
 */
export function importarTema(texto: string, nombre: string): ResultadoDeImport {
  const pareceGhostty = /^\s*palette\s*=/m.test(texto)
  const pareceWarp = /^\s*terminal_colors\s*:/m.test(texto)

  if (pareceGhostty) return importarDeGhostty(texto, nombre)
  if (pareceWarp) return importarDeWarp(texto, nombre)
  return {
    ok: false,
    error: 'This does not look like a Ghostty or Warp theme. Ghostty themes have "palette =" lines; Warp themes have a "terminal_colors:" block.',
  }
}
