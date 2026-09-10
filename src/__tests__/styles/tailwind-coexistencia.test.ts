import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const raiz = resolve(here, '../../..')
const tw = readFileSync(resolve(raiz, 'src/styles/tailwind.css'), 'utf8')
const global = readFileSync(resolve(raiz, 'src/styles/global.css'), 'utf8')

describe('Tailwind convive con global.css', () => {
  // El chequeo central de toda la migración: preflight normaliza márgenes,
  // bordes y tipografía de TODOS los elementos, y las 12k líneas de
  // global.css están escritas contra el default del navegador. Importarlo
  // rompe la app.
  it('NO importa preflight', () => {
    expect(tw).not.toMatch(/preflight/)
    expect(tw).not.toMatch(/@import\s+["']tailwindcss["']\s*;/)
  })

  it('importa sólo las capas theme y utilities', () => {
    expect(tw).toMatch(/@import\s+["']tailwindcss\/theme\.css["']\s+layer\(theme\)/)
    expect(tw).toMatch(/@import\s+["']tailwindcss\/utilities\.css["']\s+layer\(utilities\)/)
  })

  it('declara el orden de capas, con utilities al final', () => {
    const m = tw.match(/@layer\s+([^;]+);/)
    expect(m).not.toBeNull()
    const capas = m![1].split(',').map((c) => c.trim())
    expect(capas[capas.length - 1]).toBe('utilities')
  })

  // `@theme inline` LEE los tokens de :root en vez de redefinirlos. Si los
  // redefiniera habría dos fuentes de verdad para el mismo color y se
  // desincronizarían el día que alguien toque una sola.
  it('expone los tokens de Nest al motor sin redefinirlos', () => {
    expect(tw).toMatch(/@theme\s+inline\s*\{/)
    for (const t of ['background', 'foreground', 'card', 'popover', 'primary', 'border', 'muted-foreground']) {
      expect(tw).toContain(`--color-${t}: var(--${t});`)
    }
    // La fuente de verdad sigue siendo global.css.
    expect(global).toMatch(/--background:\s*#0a0a0a/)
  })

  it('global.css importa la capa nueva', () => {
    expect(global).toMatch(/@import\s+["']\.\/tailwind\.css["']/)
  })
})
