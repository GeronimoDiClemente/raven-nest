// Los comandos de siempre (mcp, status, search, login…) no cargan Ink ni React: la TUI entra
// SÓLO por el `import()` dinámico de `./tui-del-paquete/arrancar` en el caso `tui` del CLI.
//
// `mcp` es lo que los editores lanzan en cada sesión: arrastrar React y el árbol de Ink ahí
// es tiempo de arranque que no compra nada, y un error de carga de Ink tiraría el servidor MCP.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { RAIZ, cadenasHasta } from './grafo-de-imports'

const DE_LA_TUI = ['ink', 'react', 'ink-testing-library']

describe('la TUI se carga tarde', () => {
  it('desde cli-del-paquete.ts no se llega estáticamente a ink ni a react', () => {
    const visitados = new Set<string>()
    expect(cadenasHasta('cli-del-paquete.ts', DE_LA_TUI, visitados)).toEqual([])
    // Un .tsx compila con `react/jsx-runtime` implícito: tampoco puede estar en el grafo.
    expect([...visitados].filter((f) => f.endsWith('.tsx'))).toEqual([])
    expect(visitados.has(join(RAIZ, 'tui-del-paquete', 'arrancar.ts'))).toBe(false)
  })

  it('el CLI la carga con import() dinámico de ./tui-del-paquete/arrancar', () => {
    const cli = readFileSync(join(RAIZ, 'cli-del-paquete.ts'), 'utf8')
    expect(cli).toContain("import('./tui-del-paquete/arrancar')")
  })

  it('el guard sabe encontrar la cadena cuando la hay', () => {
    // Sin esto, un caminador roto haría pasar todo por no mirar nada.
    expect(cadenasHasta('tui-del-paquete/arrancar.ts', DE_LA_TUI).length).toBeGreaterThan(0)
  })
})
