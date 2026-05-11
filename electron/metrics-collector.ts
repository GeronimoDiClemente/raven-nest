import { app } from 'electron'
import { execSync } from 'child_process'
import { opendirSync, statSync } from 'fs'
import { resolve, dirname, basename, join } from 'path'
import { totalmem, cpus } from 'os'
// pidusage ships no types — declare a minimal shape locally.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import pidusage from 'pidusage'

interface PidUsageStat {
  cpu: number
  memory: number
  ppid: number
  pid: number
  ctime: number
  elapsed: number
  timestamp: number
}

export interface NestProcessMetric {
  type: 'Main' | 'Renderer' | 'Other'
  cpuPercent: number
  memBytes: number
}

export interface PaneMetric {
  paneId: string
  label: string
  pid: number
  cpuPercent: number
  memBytes: number
}

export interface WorktreeMetric {
  worktreePath: string
  branchLabel: string
  cpuPercent: number
  memBytes: number
  diskBytes: number | null
  panes: PaneMetric[]
}

export interface RepoMetric {
  commonDir: string
  repoName: string
  cpuPercent: number
  memBytes: number
  diskBytes: number | null
  worktrees: WorktreeMetric[]
}

export interface MetricsSnapshot {
  totalSystemMemBytes: number
  totals: { cpuPercent: number; memBytes: number; ramSharePercent: number }
  nest: { processes: NestProcessMetric[]; cpuPercent: number; memBytes: number }
  repos: RepoMetric[]
}

export interface PaneInput {
  paneId: string
  pid: number
  label: string
  repoPath: string | undefined
}

interface WorktreeInfo {
  commonDir: string
  repoName: string
  branchLabel: string
}

// pidusage CPU is per-core summed (a fully-pinned single core on an 8-core
// machine reports 100, not 12.5). Divide by core count to express it as a
// share of the whole system, which is what the UI shows.
const CPU_COUNT = Math.max(1, cpus().length)

export class MetricsCollector {
  private wtCache = new Map<string, WorktreeInfo>()
  private diskCache = new Map<string, number>()

  async collect(panes: PaneInput[]): Promise<MetricsSnapshot> {
    const totalSystemMemBytes = totalmem()

    // 1. Nest's own metrics from Electron's app metrics API.
    const nestProcesses = this.collectNestMetrics()
    const nestCpu = nestProcesses.reduce((s, p) => s + p.cpuPercent, 0)
    const nestMem = nestProcesses.reduce((s, p) => s + p.memBytes, 0)

    // 2. Look up each pane's CPU/memory via pidusage. Skip dead PIDs silently
    //    so a single zombie doesn't blank out the whole snapshot.
    const paneStats = await this.collectPaneStats(panes)

    // 3. Resolve worktree info for every pane that has a repoPath. We group
    //    even panes without a live PID so the repo still appears in the tree —
    //    the UX is cleaner when a pane that hasn't fully spawned yet doesn't
    //    cause its worktree to flicker in/out.
    interface ResolvedPane extends PaneInput {
      cpuPercent: number
      memBytes: number
      worktreeInfo: WorktreeInfo | null
    }
    const resolved: ResolvedPane[] = panes.map((p) => {
      const stat = paneStats.get(p.pid)
      const cpuPercent = stat ? stat.cpu / CPU_COUNT : 0
      const memBytes = stat ? stat.memory : 0
      const worktreeInfo = p.repoPath ? this.getWorktreeInfo(p.repoPath) : null
      return { ...p, cpuPercent, memBytes, worktreeInfo }
    })

    // 4. Group resolved panes by worktreePath, then worktrees by commonDir.
    interface WorktreeAgg {
      worktreePath: string
      info: WorktreeInfo
      panes: PaneMetric[]
    }
    const worktreesByPath = new Map<string, WorktreeAgg>()
    for (const r of resolved) {
      if (!r.repoPath || !r.worktreeInfo) continue
      const key = r.repoPath
      let agg = worktreesByPath.get(key)
      if (!agg) {
        agg = { worktreePath: key, info: r.worktreeInfo, panes: [] }
        worktreesByPath.set(key, agg)
      }
      // Skip panes that have no live PID — they'd just show 0/0 noise.
      if (r.pid > 0 && paneStats.has(r.pid)) {
        agg.panes.push({
          paneId: r.paneId,
          label: r.label,
          pid: r.pid,
          cpuPercent: r.cpuPercent,
          memBytes: r.memBytes,
        })
      }
    }

    const reposByCommonDir = new Map<string, { repoName: string; worktrees: WorktreeMetric[] }>()
    for (const wt of worktreesByPath.values()) {
      const cpuSum = wt.panes.reduce((s, p) => s + p.cpuPercent, 0)
      const memSum = wt.panes.reduce((s, p) => s + p.memBytes, 0)
      const diskBytes = this.diskCache.get(wt.worktreePath) ?? null
      const wtMetric: WorktreeMetric = {
        worktreePath: wt.worktreePath,
        branchLabel: wt.info.branchLabel,
        cpuPercent: cpuSum,
        memBytes: memSum,
        diskBytes,
        panes: wt.panes,
      }
      const repoEntry = reposByCommonDir.get(wt.info.commonDir)
      if (repoEntry) {
        repoEntry.worktrees.push(wtMetric)
      } else {
        reposByCommonDir.set(wt.info.commonDir, {
          repoName: wt.info.repoName,
          worktrees: [wtMetric],
        })
      }
    }

    const repos: RepoMetric[] = []
    for (const [commonDir, { repoName, worktrees }] of reposByCommonDir) {
      const cpuPercent = worktrees.reduce((s, w) => s + w.cpuPercent, 0)
      const memBytes = worktrees.reduce((s, w) => s + w.memBytes, 0)
      const diskValues = worktrees.map((w) => w.diskBytes).filter((b): b is number => b !== null)
      const diskBytes = diskValues.length === worktrees.length && worktrees.length > 0
        ? diskValues.reduce((s, b) => s + b, 0)
        : null
      repos.push({ commonDir, repoName, cpuPercent, memBytes, diskBytes, worktrees })
    }

    // Stable ordering: alphabetical by repo name, then by worktree branch.
    repos.sort((a, b) => a.repoName.localeCompare(b.repoName))
    for (const r of repos) {
      r.worktrees.sort((a, b) => a.branchLabel.localeCompare(b.branchLabel))
    }

    const panesCpu = resolved.reduce((s, p) => s + p.cpuPercent, 0)
    const panesMem = resolved.reduce((s, p) => s + p.memBytes, 0)
    const totalCpu = nestCpu + panesCpu
    const totalMem = nestMem + panesMem
    const ramSharePercent = totalSystemMemBytes > 0
      ? (totalMem / totalSystemMemBytes) * 100
      : 0

    return {
      totalSystemMemBytes,
      totals: { cpuPercent: totalCpu, memBytes: totalMem, ramSharePercent },
      nest: { processes: nestProcesses, cpuPercent: nestCpu, memBytes: nestMem },
      repos,
    }
  }

  async refreshDisk(worktreePaths: string[]): Promise<Record<string, number>> {
    const result: Record<string, number> = {}
    for (const p of worktreePaths) {
      try {
        const bytes = this.walkDirSize(p)
        this.diskCache.set(p, bytes)
        result[p] = bytes
      } catch (err) {
        // Skip path on error — partial results are fine, the UI handles
        // missing entries gracefully (shows "—" instead of a number).
        console.warn('[metrics] walkDirSize failed', p, err instanceof Error ? err.message : err)
      }
    }
    return result
  }

  private collectNestMetrics(): NestProcessMetric[] {
    let raw: Electron.ProcessMetric[] = []
    try {
      raw = app.getAppMetrics()
    } catch {
      return []
    }
    return raw.map((m) => {
      let type: NestProcessMetric['type'] = 'Other'
      if (m.type === 'Browser') type = 'Main'
      else if (m.type === 'Tab') type = 'Renderer'
      // workingSetSize comes in KB from Chromium; convert to bytes.
      const memBytes = (m.memory?.workingSetSize ?? 0) * 1024
      const cpuPercent = (m.cpu?.percentCPUUsage ?? 0) / CPU_COUNT
      return { type, cpuPercent, memBytes }
    })
  }

  private async collectPaneStats(panes: PaneInput[]): Promise<Map<number, PidUsageStat>> {
    const pids = panes.map((p) => p.pid).filter((pid) => Number.isFinite(pid) && pid > 0)
    const out = new Map<number, PidUsageStat>()
    if (pids.length === 0) return out

    // pidusage accepts an array. allSettled wrapping the bulk call would still
    // reject the whole batch if any PID is invalid, so we issue one call per
    // pid and let dead ones reject individually.
    const results = await Promise.allSettled(
      pids.map((pid) => pidusage(pid) as Promise<PidUsageStat>),
    )
    results.forEach((res, idx) => {
      if (res.status === 'fulfilled' && res.value) {
        out.set(pids[idx], res.value)
      }
    })
    return out
  }

  private getWorktreeInfo(worktreePath: string): WorktreeInfo | null {
    const cached = this.wtCache.get(worktreePath)
    if (cached) return cached
    try {
      // --git-common-dir returns the path to the main repo's .git directory
      // (or "." if it's the main worktree). Resolve relative paths against
      // the worktree itself to get an absolute, canonical key.
      const rawCommon = execSync('git rev-parse --git-common-dir', {
        cwd: worktreePath,
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()
      const commonDir = resolve(worktreePath, rawCommon)
      const rawBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: worktreePath,
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()
      const branchLabel = rawBranch === 'HEAD' ? '(detached)' : rawBranch
      // commonDir typically ends in `.git`; the parent directory holds the
      // working tree of the main repo, whose basename is what users recognise.
      const repoName = basename(dirname(commonDir))
      const info: WorktreeInfo = { commonDir, repoName, branchLabel }
      this.wtCache.set(worktreePath, info)
      return info
    } catch {
      return null
    }
  }

  private walkDirSize(root: string): number {
    let total = 0
    const stack: string[] = [root]
    while (stack.length > 0) {
      const cur = stack.pop()!
      let dir: ReturnType<typeof opendirSync>
      try {
        dir = opendirSync(cur)
      } catch {
        continue
      }
      try {
        let entry = dir.readSync()
        while (entry !== null) {
          const full = join(cur, entry.name)
          if (entry.isDirectory()) {
            stack.push(full)
          } else if (entry.isFile()) {
            try {
              // opendirSync entries don't expose size, so stat each file.
              // Dirent.isFile() returns false for symlinks so we don't follow
              // them — avoids cycles and double-counting via node_modules links.
              const s = statSync(full)
              total += s.size
            } catch {
              // Permission denied / file vanished between readdir and stat —
              // skip and move on, don't kill the whole scan.
            }
          }
          entry = dir.readSync()
        }
      } finally {
        try { dir.closeSync() } catch {}
      }
    }
    return total
  }
}
