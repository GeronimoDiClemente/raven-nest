import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
// Task 8 migra dos archivos a la vez — el overlay y su fila de estado — asi que este
// gate lee los dos, siguiendo la misma receta que TabBar-tokens/ResourceBar-tokens/
// Sidebar-tokens.
//
// 2026-10-20 (Memories estilo Obsidian): suma el adaptador de la pestaña de nota y TODO lo de
// `components/memories/`, leído del directorio para que un componente nuevo entre solo.
const dirMemories = resolve(here, '../../components/memories')
const files: Record<string, string> = {
  MemoriesWorkspace: readFileSync(resolve(here, '../../components/MemoriesWorkspace.tsx'), 'utf8'),
  MemoriesStatusRow: readFileSync(resolve(here, '../../components/MemoriesStatusRow.tsx'), 'utf8'),
  MemoriesNoteTab: readFileSync(resolve(here, '../../components/MemoriesNoteTab.tsx'), 'utf8'),
  ...Object.fromEntries(
    readdirSync(dirMemories)
      .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
      .map((f) => [`memories/${f}`, readFileSync(resolve(dirMemories, f), 'utf8')]),
  ),
}

it('lee todos los componentes de memories/', () => {
  expect(Object.keys(files).filter((k) => k.startsWith('memories/')).length).toBeGreaterThanOrEqual(6)
})

/**
 * La única excepción: el canvas del grafo (MemoryGraph2D) no puede leer `var(--x)`, así que
 * lee el token con getComputedStyle y trae un hex de respaldo para cuando el token no está.
 * El respaldo NO decide el color —manda el token—; se saca antes de mirar.
 */
const sinRespaldosDeCanvas = (src: string) => src.replace(/token\('--[\w-]+',\s*'#[0-9a-fA-F]{3,8}'\)/g, '')

describe.each(Object.entries(files))('%s migrado', (_name, original) => {
  const src = sinRespaldosDeCanvas(original)
  it('no tiene literales de color', () => {
    // La regla que hace que la promesa "editá los tokens y se re-skinea toda la
    // app" sea cierta. Un componente migrado no decide colores: los consume.
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(src).not.toMatch(/rgba?\(\s*\d/)
  })

  it('no tiene tamaños de fuente sueltos', () => {
    // Todo font-size sale de la escala (--fs-*, o las utilidades text-fs-*).
    expect(src).not.toMatch(/fontSize:\s*\d/)
  })
})
