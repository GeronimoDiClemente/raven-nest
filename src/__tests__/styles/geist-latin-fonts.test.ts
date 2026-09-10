import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const raiz = resolve(here, '../../..')

// Guard de la Task 13 (item 2, Important 5 de la review). `geist-latin.css` y
// `geist-mono-latin.css` apuntan a sus .woff2 con el specifier bare del
// paquete (`@fontsource-variable/geist/files/...`), no con una ruta relativa
// a `node_modules`. Vite resuelve ese specifier a través del mapa `exports`
// del paquete — pero si un `npm update` renombra el archivo o cambia el
// mapa, Vite NO rompe el build: deja la url tal cual y sale exit 0 con un
// solo warning de stdout (verificado empíricamente contra Vite 6.4.1 con un
// .woff2 renombrado). El resultado es que la app cae a `system-ui` en
// runtime sin que ningún build falle — el bug exacto que Task 13 cierra, en
// la única forma en que puede volver. Este test lee la `url()` de cada
// @font-face, resuelve el specifier bare contra `node_modules/` a mano (sin
// pasar por Vite) y confirma que el archivo existe.
const archivos = ['src/styles/geist-latin.css', 'src/styles/geist-mono-latin.css']

// Extrae specifiers bare `@scope/paquete/resto` de dentro de `url(...)`,
// ignorando rutas relativas/absolutas (no hay ninguna después del fix, pero
// si alguien reintroduce una ruta relativa este regex simplemente no la
// matchea, y el test de abajo sobre `.length` la cacha por otro lado).
const URL_BARE_SPECIFIER = /url\(\s*['"]?(@[^'")]+)['"]?\s*\)/g

function extraerSpecifiers(css: string): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = URL_BARE_SPECIFIER.exec(css)) !== null) {
    out.push(m[1])
  }
  return out
}

describe('fuentes Geist latin — el archivo referenciado existe de verdad', () => {
  for (const archivo of archivos) {
    it(`cada url() de ${archivo} resuelve a un archivo real en node_modules`, () => {
      const css = readFileSync(resolve(raiz, archivo), 'utf8')
      const specifiers = extraerSpecifiers(css)

      // Si esto es 0, el regex dejó de matchear (p.ej. alguien volvió a una
      // ruta relativa a node_modules) — falla ruidoso en vez de pasar en
      // verde sin haber revisado nada.
      expect(specifiers.length).toBeGreaterThan(0)

      for (const specifier of specifiers) {
        const rutaEnNodeModules = resolve(raiz, 'node_modules', specifier)
        expect(existsSync(rutaEnNodeModules), `node_modules/${specifier} no existe`).toBe(true)
      }
    })
  }

  it('no queda ninguna url() apuntando directo a node_modules/ (la alternativa peor que el subpath export)', () => {
    for (const archivo of archivos) {
      const css = readFileSync(resolve(raiz, archivo), 'utf8')
      expect(css).not.toMatch(/url\([^)]*node_modules/)
    }
  })
})
