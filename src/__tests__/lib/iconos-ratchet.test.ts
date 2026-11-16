// El trinquete de la migración de íconos: los números sólo pueden bajar.
//
// La migración a lucide (`src/lib/icons.ts`) no entra de una sola vez — son ~150 SVG
// dibujados a mano en casi 40 archivos. Mientras dura, el riesgo real no es que quede a
// medias: es que alguien **agregue uno nuevo a mano** y el trabajo no termine nunca.
//
// Este test no exige que la migración esté completa. Exige que no retroceda. Cuando migrás
// un archivo, los topes de abajo bajan; si alguien dibuja un `<svg>` nuevo, el test se pone
// rojo y le cuenta por qué.
//
// **El número que importa es el segundo.** El grosor que el ojo ve no es el `strokeWidth`
// del markup, sino `strokeWidth × (width / viewBox)` — y con los viewBox mezclados en 12, 14
// y 16, dos íconos declarados los dos "16px" pintaban trazos distintos. Así es como la app
// llegó a tener 28 grosores separados por centésimas de pixel sin que nadie lo decidiera.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'

const SRC = resolve(__dirname, '..', '..')

/**
 * Lo que NO se migra a lucide, a propósito:
 *
 * - `AILogos` / `IntegrationLogos`: marcas de terceros. Conservan forma y color — es la
 *   excepción explícita de la regla acromática.
 * - `ResourceBarPopover`: la paleta de íconos por extensión de archivo (el hexágono de Go,
 *   el cilindro de una base, la gota de Sass). Son marcas de lenguaje: pasarlas por un set
 *   genérico las volvería todas iguales, que es lo contrario de para qué existen. Sí
 *   comparten el grosor con el resto (usan `ICON_STROKE`).
 */
const EXENTOS = /AILogos|IntegrationLogos|ResourceBarPopover|__tests__/

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { tsxFiles(full, out); continue }
    if (name.endsWith('.tsx') && !EXENTOS.test(full)) out.push(full)
  }
  return out
}

interface Auditoria {
  svgs: number
  grosores: Set<number>
  archivosQueMezclan: number
}

function auditar(): Auditoria {
  let svgs = 0
  const grosores = new Set<number>()
  const porArchivo = new Map<string, Set<number>>()

  for (const file of tsxFiles(SRC)) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/g)) {
      svgs++
      const w = Number(/width="(\d+(?:\.\d+)?)"/.exec(m[1])?.[1])
      const vb = Number(/viewBox="0 0 (\d+(?:\.\d+)?) /.exec(m[1])?.[1])
      if (!w || !vb) continue
      const escala = w / vb
      for (const s of m[2].matchAll(/strokeWidth="([0-9.]+)"/g)) {
        const efectivo = Math.round(Number(s[1]) * escala * 100) / 100
        grosores.add(efectivo)
        const set = porArchivo.get(file) ?? new Set<number>()
        set.add(efectivo)
        porArchivo.set(file, set)
      }
    }
  }

  const archivosQueMezclan = [...porArchivo.values()].filter((s) => s.size > 1).length
  return { svgs, grosores, archivosQueMezclan }
}

// Topes vigentes. BAJAN cuando migrás un archivo; nunca suben.
// Punto de partida medido el 2026-09-11, antes de tocar nada: 148 SVG, 28 grosores
// efectivos, 13 archivos mezclando adentro.
const TOPE_SVGS = 64
const TOPE_GROSORES = 17
const TOPE_MEZCLAN = 8

describe('trinquete de la migracion de iconos', () => {
  const a = auditar()

  it(`no hay mas de ${TOPE_SVGS} SVG dibujados a mano`, () => {
    expect(
      a.svgs,
      `Subio la cantidad de <svg> a mano (${a.svgs} > ${TOPE_SVGS}). Si agregaste un icono, ` +
      'usalo de lucide-react con el tamaño de ICON_SIZE (src/lib/icons.ts) en vez de ' +
      'dibujarlo. Si migraste un archivo, baja TOPE_SVGS a lo que da hoy.',
    ).toBeLessThanOrEqual(TOPE_SVGS)
  })

  it(`no hay mas de ${TOPE_GROSORES} grosores de trazo efectivos distintos`, () => {
    expect(
      a.grosores.size,
      `Aparecio un grosor efectivo nuevo (${a.grosores.size} > ${TOPE_GROSORES}). Los valores ` +
      `de hoy son: ${[...a.grosores].sort((x, y) => x - y).join(', ')}. Ojo que el grosor que ` +
      'se VE es strokeWidth × (width / viewBox), no el strokeWidth del markup.',
    ).toBeLessThanOrEqual(TOPE_GROSORES)
  })

  it(`no hay mas de ${TOPE_MEZCLAN} archivos que mezclen grosores adentro`, () => {
    expect(
      a.archivosQueMezclan,
      `Mas archivos con grosores mezclados adentro (${a.archivosQueMezclan} > ${TOPE_MEZCLAN}). ` +
      'Dos iconos de la misma pantalla con trazos apenas distintos es exactamente lo que hace ' +
      'que una interfaz parezca improvisada.',
    ).toBeLessThanOrEqual(TOPE_MEZCLAN)
  })

  it('el contrato define un solo grosor y tres tamaños', async () => {
    const { ICON_STROKE, ICON_SIZES } = await import('../../lib/icons')
    expect(typeof ICON_STROKE).toBe('number')
    expect(ICON_SIZES).toHaveLength(3)
    // Ordenados y sin repetir: una escala con dos valores iguales no es una escala.
    expect([...ICON_SIZES].sort((x, y) => x - y)).toEqual([...ICON_SIZES])
    expect(new Set(ICON_SIZES).size).toBe(ICON_SIZES.length)
  })
})
