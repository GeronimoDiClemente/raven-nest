import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
// Task 8 migra dos archivos a la vez — el overlay y su fila de estado — asi que este
// gate lee los dos, siguiendo la misma receta que TabBar-tokens/ResourceBar-tokens/
// Sidebar-tokens.
const files = {
  MemoriesWorkspace: readFileSync(resolve(here, '../../components/MemoriesWorkspace.tsx'), 'utf8'),
  MemoriesStatusRow: readFileSync(resolve(here, '../../components/MemoriesStatusRow.tsx'), 'utf8'),
}

describe.each(Object.entries(files))('%s migrado', (_name, src) => {
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
