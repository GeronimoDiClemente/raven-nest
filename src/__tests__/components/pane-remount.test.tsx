import { describe, it, expect } from 'vitest'
import { useEffect } from 'react'
import { render } from '@testing-library/react'
import { PaneLayoutEngine } from '../../components/PaneLayoutEngine'
import type { PaneNode } from '../../types'

// Cuenta montajes por id: si al reordenar un pane se DESMONTA y vuelve a montar,
// su contador sube. Un pane que preserva identidad se mantiene en 1.
const mounts: Record<string, number> = {}
function Probe({ id }: { id: string }) {
  useEffect(() => {
    mounts[id] = (mounts[id] ?? 0) + 1
  }, [])
  return <div data-testid={`probe-${id}`}>{id}</div>
}

function makePane(id: string): PaneNode {
  return { id, aiType: 'terminal', accountName: '', accountDir: '', borderColor: '#888', cmd: '' }
}

describe('PaneLayoutEngine — identidad al reordenar', () => {
  it('reordenar NO debe remontar los panes (hoy se rompen: editor negro, huecos)', () => {
    const a = makePane('a')
    const b = makePane('b')
    const renderPane = (p: PaneNode) => <Probe key={p.id} id={p.id} />
    const { rerender } = render(
      <PaneLayoutEngine layoutId="2V" panes={[a, b]} onResize={() => {}} renderPane={renderPane} renderEmpty={() => <div />} />,
    )
    expect(mounts).toEqual({ a: 1, b: 1 })

    // Reordenar a [b, a] — como un drag que cambia posiciones
    rerender(
      <PaneLayoutEngine layoutId="2V" panes={[b, a]} onResize={() => {}} renderPane={renderPane} renderEmpty={() => <div />} />,
    )

    // Si preserva identidad, sigue {a:1,b:1}. Si remonta (bug), sube.
    expect(mounts).toEqual({ a: 1, b: 1 })
  })
})
