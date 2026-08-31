import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve as pathResolve } from 'node:path'

// Paso 1 del rediseño: capa-puente entre los tokens que exporta tweakcn
// (shadcn: --background, --foreground, --primary…) y los tokens propios de
// Nest (--bg-app, --text-primary, --raven-blue…). El puente debe dejar el
// look IDÉNTICO (cada token de Nest resuelve al mismo hex de antes) pero
// pasar el control del tema a los tokens shadcn.

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

  it('define el contrato de tokens shadcn con los valores actuales de Nest', () => {
    expect(root['--background']).toBe('#000000')
    expect(root['--foreground']).toBe('#e8e8e8')
    expect(root['--card']).toBe('#0a0a0a')
    expect(root['--popover']).toBe('#111111')
    expect(root['--primary']).toBe('#0066FF')
    expect(root['--border']).toBe('#1e1e1e')
    expect(root['--ring']).toBe('#0066FF')
  })

  it('aliasea los tokens propios de Nest a los tokens shadcn', () => {
    expect(root['--raven-blue']).toBe('var(--primary)')
    expect(root['--bg-app']).toBe('var(--background)')
    expect(root['--bg-surface']).toBe('var(--card)')
    expect(root['--bg-elevated']).toBe('var(--popover)')
    expect(root['--text-primary']).toBe('var(--foreground)')
    expect(root['--text-secondary']).toBe('var(--muted-foreground)')
  })

  it('cero cambio visual: cada token de Nest resuelve al hex original', () => {
    const before: Record<string, string> = {
      '--raven-blue': '#0066FF',
      '--raven-blue-dim': '#0066FF44',
      '--bg-app': '#000000',
      '--bg-surface': '#0a0a0a',
      '--bg-elevated': '#111111',
      '--border': '#1e1e1e',
      '--text-primary': '#e8e8e8',
      '--text-secondary': '#888',
      '--text-muted': '#555',
      '--titlebar-height': '44px',
      '--header-height': '32px',
    }
    for (const [token, expected] of Object.entries(before)) {
      expect(resolveVar(root, root[token]).toLowerCase()).toBe(expected.toLowerCase())
    }
  })
})
