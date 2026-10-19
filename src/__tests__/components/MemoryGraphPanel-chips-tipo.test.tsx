// Spec 2026-10-19 §2: los chips de tipo viven en la leyenda del grafo, pero el Set que
// deciden vive en MemoriesWorkspace — el único lugar que ve al grafo Y a la lista. Este
// test reproduce ese cableado con un harness chico en vez de montar MemoriesWorkspace
// entero (que trae mucho más estado no relevante acá).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import MemoryGraphPanel from '../../components/MemoryGraphPanel'
import MemoriesList from '../../components/MemoriesList'

const nodoDelGrafo = (syncId: string, type: string, title: string) => ({
  syncId, projectKey: 'raven-nest', projectDisplayName: 'Raven Nest',
  tags: [], title, type,
  scope: 'personal' as const, topicKey: null, gitBranch: 'main', originAi: null,
  authorDisplay: null, updatedAt: Date.now(), superseded: false,
})

const itemDeLaLista = (syncId: string, type: string, title: string) => ({
  syncId, projectKey: 'raven-nest', projectDisplayName: 'Raven Nest',
  title, type, scope: 'project' as const, originAi: null, authorDisplay: null,
  updatedAt: Date.now(), tags: [],
})

/** El cableado real vive en MemoriesWorkspace.tsx: un Set de tipos ocultos y un toggle,
 *  pasados a los dos paneles. Acá se reconstruye lo mínimo para probar que los dos
 *  reaccionan al mismo Set sin saber uno del otro. */
function Harness() {
  const [tiposOcultos, setTiposOcultos] = useState<Set<string>>(new Set())
  const onToggleTipo = (t: string) => {
    setTiposOcultos((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }
  return (
    <>
      <MemoryGraphPanel
        selectedId={null}
        onSelect={() => {}}
        tiposOcultos={tiposOcultos}
        onToggleTipo={onToggleTipo}
      />
      <MemoriesList tiposOcultos={tiposOcultos} />
    </>
  )
}

beforeEach(() => {
  // @tanstack/react-virtual necesita un alto medido — jsdom no hace layout real.
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600)
  ;(window as unknown as { memory: unknown }).memory = {
    graph: vi.fn(async () => ({
      nodes: [
        nodoDelGrafo('d1', 'decision', 'Una decision'),
        nodoDelGrafo('b1', 'bugfix', 'Un bugfix'),
      ],
      edges: [{ from: 'd1', to: 'b1', kind: 'similar', directed: false }],
      truncated: 0,
    })),
    observation: vi.fn(async () => null),
    crossProject: vi.fn().mockResolvedValue({
      items: [
        itemDeLaLista('d1', 'decision', 'Una decision'),
        itemDeLaLista('b1', 'bugfix', 'Un bugfix'),
      ],
      nextCursor: null,
    }),
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  ;(window as unknown as { memory?: unknown }).memory = undefined
})

describe('los chips de tipo filtran el grafo y la lista a la vez', () => {
  it('click en el chip Bugfix lo apaga (aria-pressed=false) y la fila desaparece de la lista', async () => {
    render(<Harness />)

    await waitFor(() => expect(screen.getByText('Un bugfix')).toBeInTheDocument())

    const chip = await screen.findByRole('button', { name: /Bugfix/ })
    expect(chip).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(chip)

    expect(chip).toHaveAttribute('aria-pressed', 'false')
    await waitFor(() => expect(screen.queryByText('Un bugfix')).toBeNull())
    // La decision sigue — sólo se apagó el tipo clickeado.
    expect(screen.getByText('Una decision')).toBeInTheDocument()

    // Click de nuevo: vuelve a prenderse en los dos paneles.
    fireEvent.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(screen.getByText('Un bugfix')).toBeInTheDocument())
  })
})
