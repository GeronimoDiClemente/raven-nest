import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PaneLayoutEngine } from '../../components/PaneLayoutEngine'
import type { PaneNode } from '../../types'

// Un pane que aparece solo (el de un worker de orquestación) cambia la forma del layout: de
// '1' a '2V' el árbol de slots se remonta y React saca del DOM el slot viejo CON el host del
// pane enfocado adentro. El foco cae al body antes de que corra el layout effect que muda el
// host, y quien estaba escribiendo en el coordinador queda tecleando en la nada.
function makePane(id: string): PaneNode {
  return { id, aiType: 'terminal', accountName: '', accountDir: '', borderColor: '#888', cmd: '' }
}

const renderPane = (p: PaneNode) => <input data-testid={`in-${p.id}`} aria-label={p.id} />

describe('PaneLayoutEngine — foco al cambiar la forma del layout', () => {
  it('un pane nuevo que promueve el layout no le saca el foco al pane enfocado', () => {
    const a = makePane('a')
    const b = makePane('b')
    const { rerender, getByTestId } = render(
      <PaneLayoutEngine layoutId="1" panes={[a]} onResize={() => {}} renderPane={renderPane} renderEmpty={() => <div />} />,
    )
    const input = getByTestId('in-a') as HTMLInputElement
    input.focus()
    expect(document.activeElement).toBe(input)

    rerender(
      <PaneLayoutEngine layoutId="2V" panes={[a, b]} onResize={() => {}} renderPane={renderPane} renderEmpty={() => <div />} />,
    )

    expect(getByTestId('in-a')).toBe(input) // misma instancia (no se remontó)
    expect(document.activeElement).toBe(input)
  })

  it('si no había foco en ningún pane, no se lo da a ninguno', () => {
    const a = makePane('a')
    const b = makePane('b')
    const { rerender } = render(
      <PaneLayoutEngine layoutId="1" panes={[a]} onResize={() => {}} renderPane={renderPane} renderEmpty={() => <div />} />,
    )
    ;(document.activeElement as HTMLElement | null)?.blur()
    rerender(
      <PaneLayoutEngine layoutId="2V" panes={[a, b]} onResize={() => {}} renderPane={renderPane} renderEmpty={() => <div />} />,
    )
    expect(document.activeElement).toBe(document.body)
  })
})
