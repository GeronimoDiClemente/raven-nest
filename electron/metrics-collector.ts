import { app } from 'electron'
import { execSync } from 'child_process'
import { opendirSync, statSync } from 'fs'
import { resolve, dirname, basename, join } from 'path'
import { totalmem, cpus } from 'os'
// pidusage ships no types — declare a minimal shape locally.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import pidusage from 'pidusage'
// pidtree returns the descendant tree for a pid. Cross-platform, ~5KB.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import pidtree from 'pidtree'

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

export interface DiskBucket {
  name: string
  size: number
}

export interface WorktreeMetric {
  worktreePath: string
  branchLabel: string
  cpuPercent: number
  memBytes: number
  diskBytes: number | null
  diskBuckets?: DiskBucket[]
  panes: PaneMetric[]
}

export interface RepoMetric {
  commonDir: string
  repoName: string
  cpuPercent: number
  memBytes: number
  diskBytes: number | null
  diskBuckets?: DiskBucket[]
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
  accountName?: string
}

interface WorktreeInfo {
  commonDir: string
  repoName: string
  branchLabel: string
}

export interface DiskBreakdown {
  total: number
  buckets: DiskBucket[]
}

// pidusage CPU is per-core summed (a fully-pinned single core on an 8-core
// machine reports 100, not 12.5). Divide by core count to express it as a
// share of the whole system, which is what the UI shows.
const CPU_COUNT = Math.max(1, cpus().length)

// Top-level directory names that typically hold gigabytes of derived/cached
// content. Anything under these gets bucketed by name; everything else at the
// worktree root rolls up into a synthetic `source` bucket so the user can see
// where the disk goes without losing any bytes.
const KNOWN_HEAVY_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  '.turbo',
  '.vite',
  '.cache',
  '.parcel-cache',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  '.venv',
  '__pycache__',
  'coverage',
  '.gradle',
  '.idea',
])

const SOURCE_BUCKET = 'source'

export class MetricsCollector {
  private wtCache = new Map<string, WorktreeInfo>()
  private diskCache = new Map<string, DiskBreakdown>()

  async collect(panes: PaneInput[]): Promise<MetricsSnapshot> {
    const totalSystemMemBytes = totalmem()

    // 1. Nest's own metrics from Electron's app metrics API.
    const nestProcesses = this.collectNestMetrics()
    const nestCpu = nestProcesses.reduce((s, p) => s + p.cpuPercent, 0)
    const nestMem = nestProcesses.reduce((s, p) => s + p.memBytes, 0)

    // 2. For each pane, resolve its full process tree so we measure the
    //    actual AI agent (claude.exe, node, etc.) instead of just the
    //    PowerShell shell the PTY spawned. Then issue ONE bulk pidusage call
    //    for every pid across every pane — much cheaper than N round-trips.
    const paneTrees = await this.collectPaneTrees(panes)
    const aggregated = await this.collectAggregatedStats(panes, paneTrees)

    // 3. Resolve worktree info for every pane that has a repoPath. We group
    //    even panes without a live PID so the repo still appears in the tree —
    //    the UX is cleaner when a pane that hasn't fully spawned yet doesn't
    //    cause its worktree to flicker in/out.
    interface ResolvedPane extends PaneInput {
      cpuPercent: number
      memBytes: number
      worktreeInfo: WorktreeInfo | null
      hasLiveStats: boolean
    }
    const resolved: ResolvedPane[] = panes.map((p) => {
      const agg = aggregated.get(p.pid)
      const cpuPercent = agg ? agg.cpu / CPU_COUNT : 0
      const memBytes = agg ? agg.memory : 0
      const worktreeInfo = p.repoPath ? this.getWorktreeInfo(p.repoPath) : null
      return { ...p, cpuPercent, memBytes, worktreeInfo, hasLiveStats: !!agg }
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
      if (r.pid > 0 && r.hasLiveStats) {
        // Compose a label that always includes the pid; the renderer renders
        // accountName as a middle segment when present. Putting accountName
        // and pid in the label keeps PaneMetric backward-compatible without
        // adding fields the UI would need to thread through.
        const baseLabel = r.accountName ? `${r.label} · ${r.accountName}` : r.label
        agg.panes.push({
          paneId: r.paneId,
          label: baseLabel,
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
      const cached = this.diskCache.get(wt.worktreePath)
      const diskBytes = cached ? cached.total : null
      const diskBuckets = cached ? cached.buckets : undefined
      const wtMetric: WorktreeMetric = {
        worktreePath: wt.worktreePath,
        branchLabel: wt.info.branchLabel,
        cpuPercent: cpuSum,
        memBytes: memSum,
        diskBytes,
        diskBuckets,
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
      // Sum buckets by name across all worktrees of this repo — only when
      // EVERY worktree has been measured, so the inline preview doesn't show
      // a partial picture that misleads the user.
      let repoBuckets: DiskBucket[] | undefined
      if (diskValues.length === worktrees.length && worktrees.length > 0
          && worktrees.every((w) => Array.isArray(w.diskBuckets))) {
        const sums = new Map<string, number>()
        for (const w of worktrees) {
          for (const b of w.diskBuckets!) {
            sums.set(b.name, (sums.get(b.name) ?? 0) + b.size)
          }
        }
        repoBuckets = Array.from(sums.entries())
          .map(([name, size]) => ({ name, size }))
          .sort((a, b) => b.size - a.size)
      }
      repos.push({ commonDir, repoName, cpuPercent, memBytes, diskBytes, diskBuckets: repoBuckets, worktrees })
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

  async refreshDisk(worktreePaths: string[]): Promise<Record<string, DiskBreakdown>> {
    const result: Record<string, DiskBreakdown> = {}
    for (const p of worktreePaths) {
      try {
        const breakdown = this.walkDirWithBreakdown(p)
        this.diskCache.set(p, breakdown)
        result[p] = breakdown
      } catch (err) {
        // Skip path on error — partial results are fine, the UI handles
        // missing entries gracefully (shows "—" instead of a number).
        console.warn('[metrics] walkDirWithBreakdown failed', p, err instanceof Error ? err.message : err)
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

  /**
   * For each pane PID, resolve the process tree (root + descendants). If
   * pidtree fails (process died between snapshot and tree call), fall back
   * to just the original pid so we still measure SOMETHING.
   */
  private async collectPaneTrees(panes: PaneInput[]): Promise<Map<number, number[]>> {
    const out = new Map<number, number[]>()
    const validPanes = panes.filter((p) => Number.isFinite(p.pid) && p.pid > 0)
    if (validPanes.length === 0) return out

    const results = await Promise.allSettled(
      validPanes.map((p) => pidtree(p.pid, { root: true }) as Promise<number[]>),
    )
    results.forEach((res, idx) => {
      const pid = validPanes[idx]!.pid
      if (res.status === 'fulfilled' && Array.isArray(res.value) && res.value.length > 0) {
        out.set(pid, res.value)
      } else {
        // pidtree failed — process likely just died. Use the original pid
        // alone so the bulk call still has something to look up.
        out.set(pid, [pid])
      }
    })
    return out
  }

  /**
   * Bulk-call pidusage with the union of every pid across every pane tree,
   * then aggregate (sum) cpu + memory per ORIGINAL pane PID. Tree members
   * that don't return a stat (dead between tree resolution and pidusage)
   * are simply skipped — the survivors still contribute.
   */
  private async collectAggregatedStats(
    panes: PaneInput[],
    paneTrees: Map<number, number[]>,
  ): Promise<Map<number, { cpu: number; memory: number }>> {
    const aggregated = new Map<number, { cpu: number; memory: number }>()
    if (paneTrees.size === 0) return aggregated

    // Union all pids across all trees into a single flat list.
    const allPids = new Set<number>()
    for (const tree of paneTrees.values()) {
      for (const pid of tree) {
        if (Number.isFinite(pid) && pid > 0) allPids.add(pid)
      }
    }
    if (allPids.size === 0) return aggregated

    // pidusage accepts an array — ONE call beats N calls hands-down because
    // each call spawns wmic/ps internally on platforms without native APIs.
    // If the bulk call rejects entirely (rare), fall back to per-pid so a
    // single bad pid doesn't blank the whole snapshot.
    let stats: Record<number, PidUsageStat | null> = {}
    try {
      stats = await (pidusage(Array.from(allPids)) as Promise<Record<number, PidUsageStat | null>>)
    } catch {
      const pidList = Array.from(allPids)
      const results = await Promise.allSettled(
        pidList.map((p) => pidusage(p) as Promise<PidUsageStat>),
      )
      results.forEach((res, idx) => {
        if (res.status === 'fulfilled' && res.value) {
          stats[pidList[idx]!] = res.value
        }
      })
    }

    // Aggregate per ORIGINAL pane pid (the PTY shell). The descendants'
    // numbers fold into the pane's aggregate so what the user sees is "this
    // pane's total CPU/RAM" including the AI agent running underneath.
    for (const pane of panes) {
      const tree = paneTrees.get(pane.pid)
      if (!tree) continue
      let cpu = 0
      let memory = 0
      let any = false
      for (const pid of tree) {
        const stat = stats[pid]
        if (stat && typeof stat === 'object') {
          cpu += stat.cpu
          memory += stat.memory
          any = true
        }
      }
      if (any) aggregated.set(pane.pid, { cpu, memory })
    }
    return aggregated
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

  /**
   * Single-pass disk walk: only the TOP-LEVEL entries of the worktree are
   * categorised. Known-heavy directories get their own bucket; every other
   * directory and every top-level file rolls into a synthetic `source`
   * bucket so the total never loses bytes.
   *
   * Recursion uses opendirSync (one entry at a time) instead of readdirSync
   * so memory stays bounded even for huge node_modules trees.
   */
  private walkDirWithBreakdown(root: string): DiskBreakdown {
    const buckets = new Map<string, number>()
    const addTo = (name: string, bytes: number) => {
      buckets.set(name, (buckets.get(name) ?? 0) + bytes)
    }

    let rootDir: ReturnType<typeof opendirSync>
    try {
      rootDir = opendirSync(root)
    } catch (err) {
      // Worktree root itself is unreadable — return empty so caller can
      // decide to retry; total of 0 won't get cached because total === 0
      // is still a valid state ("just got cleaned").
      throw err
    }
    try {
      let entry = rootDir.readSync()
      while (entry !== null) {
        const full = join(root, entry.name)
        if (entry.isDirectory()) {
          const bucketName = KNOWN_HEAVY_DIRS.has(entry.name) ? entry.name : SOURCE_BUCKET
          // Each top-level dir is fully walked into its bucket. Failures
          // inside the walk (permission, vanished) are absorbed silently —
          // the partial sum still gets attributed.
          const bytes = this.walkSubtreeSize(full)
          addTo(bucketName, bytes)
        } else if (entry.isFile()) {
          try {
            // Top-level files always go into source — we never break out
            // individual file types as buckets (that's UI noise).
            const s = statSync(full)
            addTo(SOURCE_BUCKET, s.size)
          } catch {
            // Permission / vanished — skip.
          }
        }
        entry = rootDir.readSync()
      }
    } finally {
      try { rootDir.closeSync() } catch {}
    }

    const bucketList: DiskBucket[] = Array.from(buckets.entries())
      .map(([name, size]) => ({ name, size }))
      .sort((a, b) => b.size - a.size)
    const total = bucketList.reduce((s, b) => s + b.size, 0)
    return { total, buckets: bucketList }
  }

  /**
   * Streaming recursive size of a subtree. Uses opendirSync so we never load
   * a huge directory listing into memory at once (node_modules can hold
   * hundreds of thousands of files). All errors (permission, vanished
   * between readdir and stat, symlink cycles) are swallowed silently —
   * partial totals are preferred over crashing the whole refresh.
   */
  private walkSubtreeSize(root: string): number {
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
