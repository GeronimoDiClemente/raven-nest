// Un pane de worker (orquestación) que aparece en el tab visible NO puede robar el foco: Gero
// está escribiendo en el coordinador. El resto de los panes conserva el foco al montar.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

const h = vi.hoisted(() => ({ focus: vi.fn() }))
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    options: Record<string, unknown> = {}
    loadAddon() {}
    open() {}
    focus() { h.focus() }
    attachCustomKeyEventHandler() {}
    onData() { return { dispose() {} } }
    onSelectionChange() { return { dispose() {} } }
    dispose() {}
  },
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }))
vi.mock('@xterm/addon-search', () => ({ SearchAddon: class {} }))
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class {} }))
vi.mock('../../lib/xterm-webgl', () => ({ activarWebgl: () => ({ dispose() {} }) }))

import { useXterm } from '../../hooks/useXterm'

function Host({ autofocus }: { autofocus?: boolean }) {
  const { containerRef } = useXterm('p1', undefined, 13, undefined, null, [], false, autofocus === undefined ? undefined : { autofocus })
  return <div ref={containerRef} />
}

const dosFrames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))))

beforeEach(() => {
  h.focus.mockClear()
  ;(window as unknown as { pty: unknown }).pty = { resize: vi.fn(), write: vi.fn() }
})

describe('useXterm · foco al montar', () => {
  it('por defecto enfoca la terminal al montar (comportamiento de siempre)', async () => {
    render(<Host />)
    await dosFrames()
    expect(h.focus).toHaveBeenCalled()
  })

  it('con autofocus false no toma el foco', async () => {
    render(<Host autofocus={false} />)
    await dosFrames()
    expect(h.focus).not.toHaveBeenCalled()
  })
})
