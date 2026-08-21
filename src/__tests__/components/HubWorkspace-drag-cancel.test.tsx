import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { PaneNode } from '../../types'

// Capturamos las props que HubWorkspace le pasa al DndContext: lo que importa
// es que cablee onDragCancel, no cómo lo renderiza dnd-kit.
let captured: Record<string, unknown> = {}
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  return {
    ...actual,
    DndContext: (props: Record<string, unknown> & { children?: React.ReactNode }) => {
      captured = props
      return <div data-testid="dnd">{props.children as React.ReactNode}</div>
    },
  }
})

const HubWorkspace = (await import('../../components/HubWorkspace')).default

const pane = (id: string): PaneNode => ({
  id, aiType: 'terminal', accountName: '', accountDir: '', borderColor: '#888', cmd: '',
})

describe('HubWorkspace — cancelar el drag', () => {
  // dnd-kit dispara onDragCancel (NO onDragEnd) al cancelar con Escape o perder
  // el puntero. El workspace ya lo cableaba; el Hub no, así que draggingId
  // quedaba pegado: los WebContentsView colapsados en 0x0 (panes negros) y todo
  // en opacity .3 hasta completar otro drag entero.
  it('cablea onDragCancel en el DndContext', () => {
    const onDragCancel = vi.fn()
    render(
      <HubWorkspace
        splitRatios={{}} hiddenCount={0} onResize={() => {}}
        onDragStart={() => {}} onDragEnd={() => {}} onDragCancel={onDragCancel}
        draggingId={null} dragSnapshot={null} sensors={[]}
        renderPane={(p: PaneNode) => <div>{p.id}</div>}
        panes={[pane('a'), pane('b')]} layoutId="2V"
      />
    )
    expect(typeof captured.onDragCancel).toBe('function')
    ;(captured.onDragCancel as () => void)()
    expect(onDragCancel).toHaveBeenCalled()
  })
})
