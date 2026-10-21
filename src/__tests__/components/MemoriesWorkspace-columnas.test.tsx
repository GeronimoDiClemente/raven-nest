// Fix round 1 de Task 10: las columnas de Memories y los colapsos AUTOMATICOS del panel
// derecho (ventana angosta al montar, pestana Team thread), que no se guardan como si los
// hubiera elegido la persona.
//
// vitest resuelve por defecto el build "node" de react-resizable-panels, que no corre layout
// effects (no hay layout, no hay colapso). Este archivo usa el build de browser —el mismo que
// usa el renderer— para poder ver los tamanos de verdad.
import { forwardRef, useImperativeHandle } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('react-resizable-panels', async () =>
  // @ts-expect-error -- el build interno no trae .d.ts; la API es la del paquete.
  await import('../../../node_modules/react-resizable-panels/dist/react-resizable-panels.browser.development.esm.js'))

vi.mock('react-force-graph-2d', () => ({
  default: forwardRef(function FG({ graphData }: { graphData: { nodes: Array<{ id: string; label: string }> } }, ref) {
    useImperativeHandle(ref, () => ({ d3Force: () => ({ distance: () => {} }), d3ReheatSimulation: () => {} }))
    return <div>{graphData.nodes.map((n) => <button key={n.id} type="button" aria-label={`node ${n.label}`} />)}</div>
  }),
}))

import MemoriesWorkspace from '../../components/MemoriesWorkspace'
import { __reiniciarPestanas } from '../../hooks/useMemoryTabs'

const CLAVE = 'nest:memories:columnas'

const nodo = (syncId: string, title: string) => ({
  syncId, projectKey: 'p1', projectDisplayName: 'raven-nest', tags: [], title, type: 'decision',
  scope: 'project', topicKey: null, gitBranch: null, originAi: null, authorDisplay: null,
  updatedAt: 1, superseded: false,
})

const conHilo = () => {
  ;(window as unknown as { memory: unknown }).memory = {
    status: vi.fn().mockResolvedValue({ connected: true, deviceId: 'd1', itemCount: 1, pendingCount: 0, daemonStatus: 'idle' }),
    graph: vi.fn().mockResolvedValue({ truncated: 0, nodes: [nodo('a', 'A'), nodo('b', 'B')], edges: [{ from: 'a', to: 'b', kind: 'wikilink', directed: true }] }),
    crossProject: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    teamThreadProjectKeyForWorktree: vi.fn().mockResolvedValue({ ok: true, projectKey: 'proj1111aaaaaaaa' }),
    teamThreadGetSettings: vi.fn().mockResolvedValue({ ok: true, settings: { enabled: true, includedTypes: [], writeAgentsPointer: false } }),
    teamThreadRead: vi.fn().mockResolvedValue({ ok: true, branches: [] }),
    // Lo minimo para que la pestaña Settings monte.
    onStatus: () => {},
    removeStatusListener: () => {},
    encryptionStatus: vi.fn().mockResolvedValue({ available: false, active: false, keyEpoch: 0, pendingDevices: [], undecryptable: 0 }),
  }
  ;(window as unknown as { git: unknown }).git = { info: vi.fn().mockResolvedValue({ branch: 'main', remoteUrl: null, githubUrl: null, isDirty: false }) }
}

const montar = () => render(
  <MemoriesWorkspace onClose={() => {}} activeRepoPath="/r" onOpenFile={() => {}} onHowItWorks={() => {}} />,
)

const tamDerecho = () => Number(document.getElementById('derecho')!.getAttribute('data-panel-size'))
const guardado = (): number[] | null => JSON.parse(localStorage.getItem(CLAVE) ?? 'null')

let anchoOriginal = 0
beforeEach(() => {
  __reiniciarPestanas()
  localStorage.clear()
  anchoOriginal = window.innerWidth
  conHilo()
})
afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: anchoOriginal, configurable: true, writable: true })
  delete (window as unknown as { memory?: unknown }).memory
  delete (window as unknown as { git?: unknown }).git
})
const ancho = (w: number) => Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true })

describe('columnas de Memories', () => {
  it('ventana angosta: el panel derecho arranca colapsado y eso NO se guarda', async () => {
    ancho(1000)
    montar()
    await screen.findByRole('tab', { name: /Graph/ })
    expect(tamDerecho()).toBe(0)
    expect(guardado()?.[2]).toBe(22)
  })

  it('el colapso por ventana angosta es solo al montar: volver de Settings no lo repite', async () => {
    ancho(1000)
    montar()
    await screen.findByRole('tab', { name: /Graph/ })
    expect(tamDerecho()).toBe(0)
    // La persona lo abre (teclado en el separador, como arrastrarlo).
    const separador = screen.getAllByRole('separator')[1]
    for (let i = 0; i < 3; i++) fireEvent.keyDown(separador, { key: 'ArrowLeft' })
    await waitFor(() => expect(tamDerecho()).toBeGreaterThan(0))
    const abierto = tamDerecho()

    fireEvent.click(screen.getByRole('button', { name: 'Memory settings' }))
    await waitFor(() => expect(tamDerecho()).toBe(0))
    fireEvent.click(screen.getByRole('tab', { name: /Graph/ }))
    await screen.findByRole('tab', { name: /Graph/ })
    expect(tamDerecho()).toBe(abierto)
    expect(guardado()?.[2]).toBeCloseTo(abierto, 0)
  })

  it('con Team thread activa el panel derecho se oculta y vuelve al salir, sin guardarlo', async () => {
    ancho(1400)
    montar()
    const hilo = await screen.findByRole('tab', { name: /Team thread/ })
    expect(tamDerecho()).toBe(22)

    fireEvent.click(hilo)
    await waitFor(() => expect(tamDerecho()).toBe(0))
    expect(guardado()?.[2]).toBe(22)

    fireEvent.click(screen.getByRole('tab', { name: /Graph/ }))
    await waitFor(() => expect(tamDerecho()).toBe(22))
  })

  it('con Settings activa el panel derecho se oculta y vuelve al salir, sin guardarlo', async () => {
    ancho(1400)
    montar()
    await screen.findByRole('tab', { name: /Graph/ })
    expect(tamDerecho()).toBe(22)
    fireEvent.click(screen.getByRole('button', { name: 'Memory settings' }))
    await waitFor(() => expect(tamDerecho()).toBe(0))
    expect(guardado()?.[2]).toBe(22)
    fireEvent.click(screen.getByRole('tab', { name: /Graph/ }))
    await waitFor(() => expect(tamDerecho()).toBe(22))
  })

  it('de Team thread directo a Settings el panel sigue cerrado (un solo motivo, D6)', async () => {
    ancho(1400)
    montar()
    fireEvent.click(await screen.findByRole('tab', { name: /Team thread/ }))
    await waitFor(() => expect(tamDerecho()).toBe(0))
    fireEvent.click(screen.getByRole('button', { name: 'Memory settings' }))
    await waitFor(() => expect(tamDerecho()).toBe(0))
    fireEvent.click(screen.getByRole('tab', { name: /Graph/ }))
    await waitFor(() => expect(tamDerecho()).toBe(22))
  })

  it('un layout guardado se respeta al montar', async () => {
    localStorage.setItem(CLAVE, JSON.stringify([25, 50, 25]))
    ancho(1400)
    montar()
    await screen.findByRole('tab', { name: /Graph/ })
    expect(tamDerecho()).toBe(25)
  })
})
