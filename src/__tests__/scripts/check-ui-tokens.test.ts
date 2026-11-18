// Contrato de scripts/check-ui-tokens.mjs (spec fase 1, C5). Dos funciones PURAS exportadas:
//
//   findColorLiterals(source: string): Array<{ line: number; text: string }>
//     `line` es 1-based dentro de `source`; `text` es el literal encontrado (p.ej. '#fff',
//     'rgba('). Una entrada por literal. Mira TODO el texto, comentarios incluidos.
//
//   addedLinesViolations(path: string, lines: Array<{ line: number; text: string }>)
//     : Array<{ path: string; line: number; text: string }>
//     `lines` son las líneas AGREGADAS por el diff (número en el archivo nuevo + contenido).
//     Devuelve el subconjunto que viola la regla. Sólo `src/styles/global.css` tiene regla;
//     cualquier otro path devuelve [].
//
// Se importa dinámicamente porque el .mjs no tiene tipos.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'path'
import { pathToFileURL } from 'url'

type Hallazgo = { line: number; text: string }
type Violacion = { path: string; line: number; text: string }
let findColorLiterals: (source: string) => Hallazgo[]
let addedLinesViolations: (path: string, lines: Hallazgo[]) => Violacion[]

beforeAll(async () => {
  const ruta = pathToFileURL(resolve(__dirname, '../../../scripts/check-ui-tokens.mjs')).href
  const mod = await import(/* @vite-ignore */ ruta)
  findColorLiterals = mod.findColorLiterals
  addedLinesViolations = mod.addedLinesViolations
})

describe('findColorLiterals', () => {
  it.each([
    ['#fff', '#fff'],
    ['#ffffff', '#ffffff'],
    ['#ffffff80', '#ffffff80'],
    ['#A1B2C3', '#A1B2C3'],
    ['rgb(1 2 3)', 'rgb('],
    ['rgba(1, 2, 3, 0.5)', 'rgba('],
    ['hsl(10 20% 30%)', 'hsl('],
    ['hsla(10, 20%, 30%, 0.5)', 'hsla('],
  ])('detecta %s', (literal, esperado) => {
    const r = findColorLiterals(`const x = "${literal}"`)
    expect(r).toHaveLength(1)
    expect(r[0].line).toBe(1)
    expect(r[0].text).toBe(esperado)
  })

  it('detecta un literal dentro de una clase arbitraria de Tailwind', () => {
    expect(findColorLiterals('<div className="bg-[#0f0f0f] p-2" />')).toHaveLength(1)
  })

  it('un #fff dentro de un comentario cuenta', () => {
    expect(findColorLiterals('// antes era #fff\nconst a = 1')).toEqual([{ line: 1, text: '#fff' }])
    expect(findColorLiterals('/* rgb(0 0 0) */')).toHaveLength(1)
  })

  it('informa la línea (1-based) de cada hallazgo', () => {
    const src = 'a\nb\nconst c = "#abc123"\nd\nstyle="color: rgba(0,0,0,.5)"'
    expect(findColorLiterals(src).map((h) => h.line)).toEqual([3, 5])
  })

  it('no marca tokens, utilidades de token ni anclas', () => {
    const limpio = [
      'className="bg-sidebar-row-selected text-info border-border"',
      'style={{ color: "var(--info)" }}',
      'color: var(--ok);',
      '<a href="#main-content">',
      'const n = 0xffffff',
      'const grid = "rgb"',
    ].join('\n')
    expect(findColorLiterals(limpio)).toEqual([])
  })

  it('devuelve [] con un source vacío', () => {
    expect(findColorLiterals('')).toEqual([])
  })
})

describe('addedLinesViolations', () => {
  const GLOBAL = 'src/styles/global.css'
  const l = (line: number, text: string) => ({ line, text })

  it.each([
    '',
    '   ',
    '/* tokens de la sidebar */',
    '  --sidebar: #0f0f0f;',
    '  --sidebar-row-hover: rgb(255 255 255 / 0.05);',
    '--sidebar-inset: 8px;',
    '  --ok-surface: rgb(74 222 128 / 0.10);',
  ])('en global.css acepta %j', (text) => {
    expect(addedLinesViolations(GLOBAL, [l(10, text)])).toEqual([])
  })

  it.each([
    '.nuevo-componente { color: red; }',
    '.btn-x {',
    'color: #fff;',
    'background: var(--card);',
    'padding: 4px;',
  ])('en global.css rechaza %j', (text) => {
    expect(addedLinesViolations(GLOBAL, [l(42, text)])).toEqual([{ path: GLOBAL, line: 42, text }])
  })

  it('con líneas mezcladas devuelve sólo las que violan, con su número de línea', () => {
    const r = addedLinesViolations(GLOBAL, [
      l(1, '--info: #8fb8ff;'),
      l(2, ''),
      l(3, '.foo { margin: 0; }'),
      l(4, '/* nota */'),
      l(5, 'display: flex;'),
    ])
    expect(r.map((v) => v.line)).toEqual([3, 5])
    expect(r.every((v) => v.path === GLOBAL)).toBe(true)
  })

  it('otros archivos no tienen esta regla', () => {
    expect(addedLinesViolations('src/styles/tailwind.css', [l(1, '.foo { color: red; }')])).toEqual([])
    expect(addedLinesViolations('src/App.tsx', [l(1, 'const a = 1')])).toEqual([])
  })

  it('sin líneas agregadas no hay violaciones', () => {
    expect(addedLinesViolations(GLOBAL, [])).toEqual([])
  })
})
