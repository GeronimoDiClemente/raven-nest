import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve as pathResolve } from 'node:path'

// Capa-puente entre el contrato de tokens shadcn (--background, --primary…)
// y los tokens propios de Nest (--bg-app, --text-primary, --raven-blue…).
//
// El tercer test de este archivo antes verificaba "cero cambio visual": que
// cada token de Nest resolviera al MISMO hex de antes del puente. Esa era la
// garantía de que el Paso 1 no tocaba nada, y se cumplió. Ahora los valores
// cambiaron a propósito (dirección "Nest Terminal"), así que ese test se
// reemplazó por los tres que sí importan de acá en adelante: que la escala
// tenga pasos separados, que haya UN solo acento y que sea acromático, y que
// el borde sea translúcido. Son las tres reglas que el diseño viejo rompía.

const here = dirname(fileURLToPath(import.meta.url))
const cssPath = pathResolve(here, '../../styles/global.css')

function firstRootBlock(rawCss: string): Record<string, string> {
  // Sacamos comentarios /* … */ primero: pueden contener llaves (ej. "{} Code")
  // que confundirían al matcher ingenuo de bloque de abajo.
  const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '')
  const start = css.indexOf(':root')
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  const body = css.slice(open + 1, close)
  const map: Record<string, string> = {}
  for (const decl of body.split(';')) {
    const idx = decl.indexOf(':')
    if (idx === -1) continue
    const name = decl.slice(0, idx).trim()
    const value = decl.slice(idx + 1).trim()
    if (name.startsWith('--')) map[name] = value
  }
  return map
}

// Resuelve cadenas var(--x) contra el mapa (uno o varios niveles).
function resolveVar(map: Record<string, string>, value: string, depth = 0): string {
  if (depth > 10) throw new Error('var() chain too deep: ' + value)
  const m = value.match(/^var\(\s*(--[a-zA-Z0-9-]+)\s*\)$/)
  if (m) {
    const next = map[m[1]]
    if (next === undefined) throw new Error('undefined token: ' + m[1])
    return resolveVar(map, next, depth + 1)
  }
  return value.trim()
}

describe('token bridge (Paso 1) — shadcn/tweakcn ↔ tokens de Nest', () => {
  const css = readFileSync(cssPath, 'utf8')
  const root = firstRootBlock(css)

  it('define el contrato de tokens shadcn con la escala Nest Terminal', () => {
    expect(root['--background']).toBe('#0a0a0a')
    expect(root['--foreground']).toBe('#f2f2f2')
    expect(root['--card']).toBe('#141414')
    expect(root['--popover']).toBe('#1f1f1f')
    expect(root['--primary']).toBe('#e8e8e8')
    expect(root['--border']).toBe('rgb(255 255 255 / 0.08)')
    expect(root['--ring']).toBe('#6e6e6e')
  })

  it('aliasea los tokens propios de Nest a los tokens shadcn', () => {
    expect(root['--raven-blue']).toBe('var(--primary)')
    expect(root['--bg-app']).toBe('var(--background)')
    expect(root['--bg-surface']).toBe('var(--card)')
    expect(root['--bg-elevated']).toBe('var(--popover)')
    expect(root['--text-primary']).toBe('var(--foreground)')
    expect(root['--text-secondary']).toBe('var(--muted-foreground)')
  })

  // ── Las tres reglas del sistema ────────────────────────────────────────
  // No son gusto: son lo que el diseño anterior rompía, y lo que hace que la
  // app se vea plana si alguien las deshace.

  const lum = (hex: string): number => {
    const h = hex.replace('#', '')
    const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }

  it('regla 1 — la escala tiene pasos que se ven, no tres tonos iguales', () => {
    const escala = ['--background', '--card', '--popover', '--accent'].map((t) => lum(root[t]))
    // Antes: #000 -> #0a0a0a -> #111111, o sea saltos de 10 y 7 puntos sobre 255.
    // Una tarjeta no se distinguía del fondo. Cada paso tiene que subir de verdad.
    for (let i = 1; i < escala.length; i++) {
      expect(escala[i] - escala[i - 1]).toBeGreaterThan(4)
    }
    // Y el recorrido total tiene que dar rango suficiente para agrupar.
    expect(escala[escala.length - 1] - escala[0]).toBeGreaterThan(25)
  })

  it('regla 2 — hay UN acento y es acromático', () => {
    const h = root['--primary'].replace('#', '')
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
    // El primary es casi blanco, como el de Orca (#e5e5e5). El color queda
    // reservado para ESTADO. Un primary cromático es exactamente el bug viejo:
    // dos acentos (azul #0066FF y violeta #7c3aed) peleando por ser la marca.
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(6)
    expect(lum(root['--primary'])).toBeGreaterThan(180)
  })

  it('regla 3 — el borde es translúcido, para funcionar sobre cualquier nivel', () => {
    // Un gris fijo sólo se ve bien sobre UN nivel de superficie.
    expect(root['--border']).toMatch(/^rgba?\(/)
    expect(root['--input']).toMatch(/^rgba?\(/)
  })

  it('no quedan acentos hardcodeados esquivando los tokens', () => {
    // 74 literales de azul/violeta convertidos a var(--primary)/color-mix.
    // Si vuelve a aparecer uno, la promesa "editá los tokens y se re-skinea
    // toda la app" vuelve a ser mentira.
    const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(sinComentarios).not.toMatch(/#0066[fF][fF]/)
    expect(sinComentarios).not.toMatch(/#7c3aed/i)
    expect(sinComentarios).not.toMatch(/#[aA]78[bB][fF][aA]/)
    expect(sinComentarios).not.toMatch(/#0052cc/i)
  })
})
