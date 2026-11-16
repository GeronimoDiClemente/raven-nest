import { describe, it, expect } from 'vitest'
import { placeWorkerPane, handleLaunchPane } from '../../orchestration/place-worker-pane'
import { workerSwatch } from '../../lib/worker-palette'
import { MAX_PANES, type OrchestrationLaunchPaneRequest, type PaneNode, type WorkspaceTab } from '../../types'

const pane = (id: string): PaneNode => ({ id, aiType: 'claude', accountName: 'main', accountDir: '/acc/claude/main', borderColor: '#fff', cmd: 'claude' })

const REQ: OrchestrationLaunchPaneRequest = {
  requestId: 'r1', coordinatorPaneId: 'coord', paneId: 'w1', aiType: 'claude', accountName: 'main',
  accountDir: '/acc/claude/main', cmd: 'claude', repoPath: '/wt/nest/api-abc', label: 'api',
  colorIndex: 1, initialInput: 'preamble', workerId: 'wk1',
}

const tabs = (): WorkspaceTab[] => [
  { id: 'activo', name: 'A', layoutId: '1', panes: [pane('otro')] },
  { id: 'delCoord', name: 'B', layoutId: '1', panes: [pane('coord')] },
]

describe('placeWorkerPane', () => {
  it('agrega el worker al tab del coordinador, no al activo', () => {
    const { tabs: t, reply } = placeWorkerPane(tabs(), REQ, undefined)
    expect(reply).toEqual({ requestId: 'r1', ok: true, tabPaneCount: 2 })
    expect(t[0].panes.map((p) => p.id)).toEqual(['otro'])
    const w = t[1].panes[1]
    expect(w).toMatchObject({
      id: 'w1', customLabel: 'api', repoPath: '/wt/nest/api-abc', initialInput: 'preamble', cmd: 'claude',
      accountDir: '/acc/claude/main', accountName: 'main', aiType: 'claude',
      borderColor: workerSwatch(1, undefined),
      orchestration: { role: 'worker', workerId: 'wk1', coordinatorPaneId: 'coord', colorIndex: 1 },
    })
    // El layout crece con el pane nuevo.
    expect(t[1].layoutId).not.toBe('1')
  })

  it('el color sale de la paleta ANSI del tema', () => {
    const ansi = Array.from({ length: 16 }, (_, i) => `#${i.toString(16).repeat(6)}`)
    const { tabs: t } = placeWorkerPane(tabs(), REQ, ansi)
    expect(t[1].panes[1].borderColor).toBe(workerSwatch(1, ansi))
  })

  it('sin tab que contenga al coordinador da no_tab y no toca nada', () => {
    const antes = tabs()
    const { tabs: t, reply } = placeWorkerPane(antes, { ...REQ, coordinatorPaneId: 'nadie' }, undefined)
    expect(reply).toEqual({ requestId: 'r1', ok: false, error: 'no_tab' })
    expect(t).toBe(antes)
  })

  it('un tab Hub que tenga el id no cuenta como el tab del coordinador', () => {
    const t0: WorkspaceTab[] = [{ id: 'hub', name: 'Hub', layoutId: '1', panes: [pane('coord')], isHub: true }]
    expect(placeWorkerPane(t0, REQ, undefined).reply.ok).toBe(false)
  })

  it('con MAX_PANES en el tab da tab_full', () => {
    const lleno = Array.from({ length: MAX_PANES }, (_, i) => pane(i === 0 ? 'coord' : `p${i}`))
    const t0: WorkspaceTab[] = [{ id: 'x', name: 'X', layoutId: '12G', panes: lleno }]
    const { tabs: t, reply } = placeWorkerPane(t0, REQ, undefined)
    expect(reply).toEqual({ requestId: 'r1', ok: false, error: 'tab_full' })
    expect(t).toBe(t0)
  })
})

describe('handleLaunchPane', () => {
  it('dos pedidos antes de un render en el borde de MAX_PANES: el segundo da tab_full', () => {
    const casiLleno = Array.from({ length: MAX_PANES - 1 }, (_, i) => pane(i === 0 ? 'coord' : `p${i}`))
    const tabsRef = { current: [{ id: 'x', name: 'X', layoutId: '12G', panes: casiLleno }] as WorkspaceTab[] }
    const replies: unknown[] = []
    const updaters: Array<(prev: WorkspaceTab[]) => WorkspaceTab[]> = []
    // setTabs NO aplica (React todavía no renderizó): sólo encola.
    const host = { tabsRef, setTabs: (u: (p: WorkspaceTab[]) => WorkspaceTab[]) => { updaters.push(u) }, reply: (r: unknown) => replies.push(r), ansi: () => undefined }
    handleLaunchPane({ ...REQ, requestId: 'a', paneId: 'wa' }, host)
    handleLaunchPane({ ...REQ, requestId: 'b', paneId: 'wb' }, host)
    expect(replies).toEqual([
      { requestId: 'a', ok: true, tabPaneCount: MAX_PANES },
      { requestId: 'b', ok: false, error: 'tab_full' },
    ])
    expect(updaters).toHaveLength(1)
  })
})
