import { describe, it, expect } from 'vitest'
import { reviewEntriesForTab } from '../../orchestration/review-for-tab'
import type { OrchestrationReviewEntry, PaneNode } from '../../types'

const e = (workerId: string, repoPath: string): OrchestrationReviewEntry => ({
  workerId, label: workerId, colorIndex: 0, branch: `nest/${workerId}`, worktreePath: `/wt/${workerId}`,
  baseBranch: 'main', status: 'done', repoPath,
})
const pane = (over: Partial<PaneNode>): PaneNode => ({
  id: 'p', aiType: 'claude', accountName: '', accountDir: '', borderColor: '', cmd: 'claude', ...over,
})

describe('reviewEntriesForTab', () => {
  it('muestra las ramas del repo del tab o de algún pane (no worker) del tab', () => {
    const entries = [e('a', '/repo'), e('b', '/otro'), e('c', '/coord-wt/')]
    const tab = {
      repoPath: '/repo/',
      panes: [
        pane({ id: 'coord', runningRepoPath: '/coord-wt' }),
        pane({ id: 'w', repoPath: '/otro', orchestration: { role: 'worker', workerId: 'x', coordinatorPaneId: 'coord', colorIndex: 0 } }),
      ],
    }
    expect(reviewEntriesForTab(entries, tab).map((x) => x.workerId)).toEqual(['a', 'c'])
  })

  it('un tab Hub o ausente no muestra nada', () => {
    expect(reviewEntriesForTab([e('a', '/repo')], { repoPath: '/repo', panes: [], isHub: true })).toEqual([])
    expect(reviewEntriesForTab([e('a', '/repo')], undefined)).toEqual([])
  })
})
