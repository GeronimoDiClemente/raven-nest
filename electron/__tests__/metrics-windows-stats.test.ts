import { describe, it, expect, vi } from 'vitest'

// metrics-collector imports `electron` at module top (for app.getAppMetrics).
vi.mock('electron', () => ({ app: { getAppMetrics: () => [] } }))

import { MetricsCollector, statsFromSnapshot } from '../metrics-collector'

describe('statsFromSnapshot', () => {
  const snap = {
    memByPid: new Map([[10, 1_000], [11, 2_000]]),
    cpuByPid: new Map([[10, 37.5]]),
  }

  it('returns working set and CPU for every pid in the snapshot', () => {
    expect(statsFromSnapshot([10, 11], snap)).toEqual({
      10: { cpu: 37.5, memory: 1_000 },
      11: { cpu: 0, memory: 2_000 },
    })
  })

  it('leaves out pids that already exited, like pidusage', () => {
    expect(statsFromSnapshot([10, 999], snap)).toEqual({ 10: { cpu: 37.5, memory: 1_000 } })
  })
})

describe.skipIf(process.platform !== 'win32')('MetricsCollector on Windows (real process host)', () => {
  it('reads CPU/RAM and the process tree without starting a PowerShell per query', async () => {
    const collector = new MetricsCollector()
    try {
      const first = await collector.getProcessStat(process.pid, 0)
      expect(first).not.toBeNull()
      expect(first!.memory).toBeGreaterThan(10 * 1024 * 1024)

      // Burn some CPU so the second snapshot sees a positive rate.
      const until = Date.now() + 400
      while (Date.now() < until) Math.sqrt(Math.random())
      const second = await collector.getProcessStat(process.pid, 0)
      expect(second!.cpu).toBeGreaterThan(0)

      const tree = await collector.getTreeForPid(process.ppid)
      expect(tree).toContain(process.pid)

      // Several snapshots, one PowerShell child.
      for (let i = 0; i < 3; i++) await collector.getProcessStat(process.pid, 0)
      const myTree = await collector.getTreeForPid(process.pid)
      const names = await Promise.all(myTree.map((p) => collector.getProcessName(p)))
      expect(names.filter((n) => /^powershell/i.test(n))).toHaveLength(1)

      expect(await collector.getProcessStat(2_147_483_000, 0)).toBeNull()
    } finally {
      collector.dispose()
    }
  }, 60_000)

  it('starts a new process host after dispose (a cancelled quit must not freeze metrics)', async () => {
    const collector = new MetricsCollector()
    try {
      expect(await collector.getProcessStat(process.pid, 0)).not.toBeNull()
      collector.dispose()
      expect(await collector.getProcessStat(process.pid, 0)).not.toBeNull()
    } finally {
      collector.dispose()
    }
  }, 60_000)
})
