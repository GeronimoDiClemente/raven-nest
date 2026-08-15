import { describe, it, expect, vi } from 'vitest'

// metrics-collector imports `electron` at module top (for app.getAppMetrics).
// Outside a real Electron runtime the named `app` export is undefined; stub it
// so importing the module never throws. The pure function under test never
// touches `app`.
vi.mock('electron', () => ({ app: { getAppMetrics: () => [] } }))

import { assignExternalPidsToWorktrees } from '../metrics-collector'

describe('assignExternalPidsToWorktrees — shared process dedup', () => {
  it('counts a process tree shared by two worktrees only once in the grand total', () => {
    // Repro of the bug: the SAME external "External · :5173" Vite dev-server
    // tree (root 5000 + children 5001..5003) is discovered under TWO worktree
    // groups — e.g. two panes of the same repo ("review/hub-stats") that
    // resolved to two slightly different repoPath keys, so its command line
    // path-matches both. Both groups must NOT sum the tree independently.
    const viteTree = [5000, 5001, 5002, 5003]
    const treesByRoot = new Map<number, number[]>([[5000, viteTree]])
    const worktreeRoots = [
      { worktreePath: 'C:/repo/a', roots: [5000] },
      { worktreePath: 'C:/repo/b', roots: [5000] },
    ]
    // Per-PID memory (bytes); the shared tree totals ~3.07 GB.
    const memByPid = new Map<number, number>([
      [5000, 1_000_000_000],
      [5001, 900_000_000],
      [5002, 700_000_000],
      [5003, 470_000_000],
    ])

    const assignment = assignExternalPidsToWorktrees(worktreeRoots, treesByRoot)

    // Invariant 1: no PID may be attributed to more than one worktree.
    const seen = new Set<number>()
    for (const pids of assignment.values()) {
      for (const pid of pids) {
        expect(seen.has(pid)).toBe(false)
        seen.add(pid)
      }
    }

    // Invariant 2: the external contribution to the grand total (sum of memory
    // over every attributed pid, across every worktree) counts each PID exactly
    // once — one copy of the shared tree (~3.07 GB), never two (~6.14 GB).
    let grandTotal = 0
    for (const pids of assignment.values()) {
      for (const pid of pids) grandTotal += memByPid.get(pid) ?? 0
    }
    const expectedOnce = viteTree.reduce((s, p) => s + (memByPid.get(p) ?? 0), 0)
    expect(grandTotal).toBe(expectedOnce)
  })

  it('excludes PIDs already accounted for by Nest panes', () => {
    // 4001 is a descendant of a Nest pane already counted in the pane rows;
    // an external tree that happens to include it must not re-count it.
    const treesByRoot = new Map<number, number[]>([[4000, [4000, 4001]]])
    const worktreeRoots = [{ worktreePath: 'C:/repo/a', roots: [4000] }]
    const accounted = new Set<number>([4001])

    const assignment = assignExternalPidsToWorktrees(worktreeRoots, treesByRoot, accounted)

    const pids = assignment.get('C:/repo/a') ?? new Set<number>()
    expect(pids.has(4001)).toBe(false)
    expect(pids.has(4000)).toBe(true)
  })

  it('still attributes non-overlapping trees fully to their own worktree', () => {
    // Two genuinely distinct dev servers → each worktree keeps its own tree.
    const treesByRoot = new Map<number, number[]>([
      [6000, [6000, 6001]],
      [7000, [7000, 7001]],
    ])
    const worktreeRoots = [
      { worktreePath: 'C:/repo/a', roots: [6000] },
      { worktreePath: 'C:/repo/b', roots: [7000] },
    ]

    const assignment = assignExternalPidsToWorktrees(worktreeRoots, treesByRoot)

    expect(assignment.get('C:/repo/a')).toEqual(new Set([6000, 6001]))
    expect(assignment.get('C:/repo/b')).toEqual(new Set([7000, 7001]))
  })
})
