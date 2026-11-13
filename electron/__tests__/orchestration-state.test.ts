import { describe, it, expect } from 'vitest'
import { OrchestrationState } from '../orchestration/orchestration-state'

function nuevoWorker(s: OrchestrationState, coord: string, n: number, now = 1) {
  return s.addWorker(
    {
      workerId: `w${coord}${n}`,
      coordinatorPaneId: coord,
      paneId: `p${coord}${n}`,
      label: `W${n}`,
      branch: `b${n}`,
      worktreePath: `/wt/${n}`,
      baseBranch: 'main',
      agent: 'claude'
    },
    now
  )
}

describe('OrchestrationState', () => {
  it('quinto worker vivo da worker_limit', () => {
    const s = new OrchestrationState()
    for (let i = 0; i < 4; i++) {
      expect(s.canLaunch('c', 5)).toEqual({ ok: true })
      nuevoWorker(s, 'c', i)
    }
    expect(s.canLaunch('c', 5)).toEqual({ ok: false, error: 'worker_limit' })
  })

  it('worker terminado libera cupo y color', () => {
    const s = new OrchestrationState()
    const ws = [0, 1, 2, 3].map((i) => nuevoWorker(s, 'c', i))
    expect(ws.map((w) => w.colorIndex)).toEqual([0, 1, 2, 3])
    s.setStatus(ws[1].workerId, 'done', 50)
    expect(s.workerByPane(ws[1].paneId)?.finishedAt).toBe(50)
    expect(s.canLaunch('c', 5)).toEqual({ ok: true })
    expect(nuevoWorker(s, 'c', 9).colorIndex).toBe(1)
  })

  it('un worker no puede lanzar', () => {
    const s = new OrchestrationState()
    const w = nuevoWorker(s, 'c', 0)
    expect(s.canLaunch(w.paneId, 2)).toEqual({ ok: false, error: 'nesting_not_allowed' })
  })

  it('tab con 12 panes da tab_full', () => {
    const s = new OrchestrationState()
    expect(s.canLaunch('c', 11)).toEqual({ ok: true })
    expect(s.canLaunch('c', 12)).toEqual({ ok: false, error: 'tab_full' })
  })

  it('pending es FIFO y markDelivered los vacía', () => {
    const s = new OrchestrationState()
    const w = nuevoWorker(s, 'c', 0)
    const a = s.push(w.workerId, 'done', 'a', 1)
    const b = s.push(w.workerId, 'question', 'b', 2)
    expect(s.pending('c').map((m) => m.msgId)).toEqual([a.msgId, b.msgId])
    expect(s.markDelivered('c').map((m) => m.msgId)).toEqual([a.msgId, b.msgId])
    expect(s.pending('c')).toEqual([])
  })

  it('push después de markPointed vuelve a dejar pendiente', () => {
    const s = new OrchestrationState()
    const w = nuevoWorker(s, 'c', 0)
    s.push(w.workerId, 'done', 'a', 1)
    s.markPointed('c')
    expect(s.pending('c')[0].delivery).toBe('pointed')
    const b = s.push(w.workerId, 'blocked', 'b', 2)
    expect(b.delivery).toBe('pending')
    expect(s.pending('c').map((m) => m.delivery)).toEqual(['pointed', 'pending'])
  })

  it('dropCoordinator devuelve sus workers y borra su bandeja', () => {
    const s = new OrchestrationState()
    const w = nuevoWorker(s, 'c', 0)
    nuevoWorker(s, 'd', 0)
    s.push(w.workerId, 'done', 'a', 1)
    expect(s.dropCoordinator('c').map((x) => x.workerId)).toEqual([w.workerId])
    expect(s.pending('c')).toEqual([])
    expect(s.workersOf('c')).toEqual([])
    expect(s.workersOf('d')).toHaveLength(1)
  })

  it('push a un worker desconocido lanza', () => {
    expect(() => new OrchestrationState().push('x', 'done', '', 1)).toThrow()
  })
})
