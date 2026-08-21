import { describe, it, expect, beforeEach } from 'vitest'
import { useEffect } from 'react'
import { render } from '@testing-library/react'
import { PaneLayoutEngine } from '../../components/PaneLayoutEngine'
import type { PaneNode } from '../../types'

// Igual que pane-remount.test.tsx pero en un layout ANIDADO. '3M' es
// h(pane0, v(pane1, pane2)): el slot 0 vive en el grupo raíz y los slots 1-2 en
// un PanelGroup hijo, así que un swap entre el 0 y el 1 cruza de padre.
const mounts: Record<string, number> = {}
function Probe({ id }: { id: string }) {
  useEffect(() => {
    mounts[id] = (mounts[id] ?? 0) + 1
  }, [])
  return <div data-testid={`probe-${id}`}>{id}</div>
}

const makePane = (id: string): PaneNode =>
  ({ id, aiType: 'terminal', accountName: '', accountDir: '', borderColor: '#888', cmd: '' })

describe('PaneLayoutEngine — identidad en layouts anidados', () => {
  beforeEach(() => { for (const k of Object.keys(mounts)) delete mounts[k] })

  // BUG CONOCIDO (pendiente de decisión): React no puede mover un elemento
  // entre padres, así que un swap que cruza de PanelGroup remonta ambos panes
  // (Monaco negro, WebContentsView recreado). Arreglarlo de raíz exige
  // reparenting: montar cada pane en un contenedor estable y mover ese nodo
  // entre slots. it.fails documenta el límite sin dejar la suite en rojo:
  // cuando se arregle, este test pasa a it() normal y sigue verde.
  it.fails('un swap que cruza de PanelGroup tampoco debe remontar', () => {
    const a = makePane('a')
    const b = makePane('b')
    const c = makePane('c')
    const renderPane = (p: PaneNode) => <Probe key={p.id} id={p.id} />
    const props = { onResize: () => {}, renderPane, renderEmpty: () => <div /> }

    const { rerender } = render(
      <PaneLayoutEngine layoutId="3M" panes={[a, b, c]} {...props} />,
    )
    expect(mounts).toEqual({ a: 1, b: 1, c: 1 })

    // swap a <-> b: 'a' sale del grupo raíz y entra al grupo anidado, 'b' al revés
    rerender(
      <PaneLayoutEngine layoutId="3M" panes={[b, a, c]} {...props} />,
    )

    expect(mounts).toEqual({ a: 1, b: 1, c: 1 })
  })

  it('un swap dentro del MISMO grupo anidado no remonta', () => {
    const a = makePane('a')
    const b = makePane('b')
    const c = makePane('c')
    const renderPane = (p: PaneNode) => <Probe key={p.id} id={p.id} />
    const props = { onResize: () => {}, renderPane, renderEmpty: () => <div /> }

    const { rerender } = render(
      <PaneLayoutEngine layoutId="3M" panes={[a, b, c]} {...props} />,
    )
    rerender(
      <PaneLayoutEngine layoutId="3M" panes={[a, c, b]} {...props} />,
    )

    expect(mounts).toEqual({ a: 1, b: 1, c: 1 })
  })
})
