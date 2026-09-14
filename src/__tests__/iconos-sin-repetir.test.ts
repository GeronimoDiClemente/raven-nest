import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Dos filas de la misma lista no pueden compartir icono.
 *
 * Un icono existe para que no tengas que LEER la fila. Dos iguales en la misma lista lo
 * anulan: `Terminal` y `Command presets` tenian los dos el `>_`, asi que la unica forma de
 * distinguirlos era leer el texto — y entonces el icono es decoracion que ocupa lugar.
 *
 * Se filtro dos veces en el mismo dia (el `>_` en Settings, y `Waypoints` entre la pestana
 * Worktrees y la fila Memories), siempre igual: alguien agrega una entrada y elige el icono
 * mas obvio, que es el que ya estaba usando el vecino. Nadie mira la lista entera.
 */
const fuente = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')

/** Los `icono:`/`Icon:` de un bloque de definicion, en orden. */
function iconosDe(texto: string, desde: string): Array<{ id: string; icono: string }> {
  const i = texto.indexOf(desde)
  if (i < 0) throw new Error(`no encontre ${desde}`)
  const fin = texto.indexOf('\n]', i)
  const bloque = texto.slice(i, fin)
  return [...bloque.matchAll(/id:\s*'(\w+)'[\s\S]*?icono:\s*(\w+)/g)].map((m) => ({ id: m[1], icono: m[2] }))
}

describe('los íconos de una misma lista son distintos', () => {
  it('las secciones de Settings', () => {
    const entradas = iconosDe(fuente('src/components/SettingsPanel.tsx'), 'const SECCIONES')
    expect(entradas.length, 'no se parsearon las secciones').toBeGreaterThan(5)
    const porIcono = new Map<string, string[]>()
    for (const e of entradas) porIcono.set(e.icono, [...(porIcono.get(e.icono) ?? []), e.id])
    const repetidos = [...porIcono].filter(([, ids]) => ids.length > 1)
    expect(
      repetidos.map(([icono, ids]) => `${icono} en ${ids.join(' y ')}`).join('; '),
      'dos secciones comparten ícono',
    ).toBe('')
  })

  /**
   * La barra lateral: las pestanas (`TAB_ICONS`) y la fila de Memories se ven A LA VEZ, asi
   * que comparten espacio aunque vivan en archivos distintos.
   */
  it('la barra lateral no repite entre las pestañas y Memories', () => {
    const tabs = fuente('src/components/SidebarTabBar.tsx')
    const deLasTabs = [...tabs.matchAll(/^\s*(\w+):\s*(\w+),\s*$/gm)]
      .map((m) => ({ id: m[1], icono: m[2] }))
      .filter((e) => ['worktrees', 'explorer', 'tools', 'hub'].includes(e.id))
    expect(deLasTabs.length, 'no se parsearon las pestañas').toBe(4)

    const memorias = fuente('src/components/MemoriesItem.tsx')
    const usadoPorMemorias = memorias.match(/<(\w+) size=\{ICON_SIZE/)?.[1]
    expect(usadoPorMemorias, 'no encontré el ícono de Memories').toBeTruthy()

    const choque = deLasTabs.find((t) => t.icono === usadoPorMemorias)
    expect(
      choque ? `${usadoPorMemorias} lo usan Memories y la pestaña ${choque.id}` : '',
      'Memories comparte ícono con una pestaña de la barra',
    ).toBe('')
  })
})
