import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileP = promisify(execFile)

const isWindows = process.platform === 'win32'

// Module-level flag so the "lsof not installed" warning fires once per
// process lifetime instead of on every scan tick (the monitor polls often).
let warnedNoLsof = false

/**
 * Resolves a PID to its full process tree (root + descendants).
 * On Windows the caller MUST inject one — `wmic` was removed in Win11 22H2,
 * and rather than duplicate the CIM snapshot logic from MetricsCollector
 * here, main.ts passes `metricsCollector.getTreeForPid` in.
 */
export type TreeResolver = (pid: number) => Promise<number[]>

async function pidChildrenPosix(pid: number): Promise<number[]> {
  try {
    const { stdout } = await execFileP('pgrep', ['-P', String(pid)], { timeout: 3000 })
    return stdout
      .split(/\s+/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n))
  } catch (err) {
    // pgrep returns exit 1 when no children — that's normal, not an error.
    // Anything else (pgrep missing, timeout) we surface so a system without
    // pgrep doesn't silently report empty trees forever.
    const code = (err as NodeJS.ErrnoException)?.code
    if (code && code !== 'ENOENT') {
      console.warn('[port-monitor] pgrep failed', pid, code, err instanceof Error ? err.message : err)
    }
    return []
  }
}

export async function pidTree(rootPid: number, opts?: { depth?: number; treeResolver?: TreeResolver }): Promise<Set<number>> {
  if (opts?.treeResolver) {
    try {
      const tree = await opts.treeResolver(rootPid)
      const set = new Set<number>(tree.length > 0 ? tree : [rootPid])
      set.add(rootPid)  // ensure root is present even if resolver returned []
      return set
    } catch (err) {
      console.warn('[port-monitor] tree resolver failed for pid', rootPid, err instanceof Error ? err.message : err)
      return new Set([rootPid])
    }
  }
  if (isWindows) {
    // No resolver and no wmic — degrade to root-only rather than silently
    // pretending the tree is complete.
    return new Set([rootPid])
  }
  const depth = opts?.depth ?? 4
  const all = new Set<number>([rootPid])
  let frontier = [rootPid]
  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const next: number[] = []
    for (const pid of frontier) {
      const kids = await pidChildrenPosix(pid)
      for (const k of kids) {
        if (!all.has(k)) { all.add(k); next.push(k) }
      }
    }
    frontier = next
  }
  return all
}

export async function listenPortsForPids(pids: Set<number>): Promise<number[]> {
  if (pids.size === 0) return []
  if (isWindows) {
    try {
      const { stdout } = await execFileP('netstat', ['-ano'], { timeout: 5000 })
      const ports = new Set<number>()
      for (const line of stdout.split(/\r?\n/)) {
        const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/)
        if (!m) continue
        const port = parseInt(m[1]!, 10)
        const pid = parseInt(m[2]!, 10)
        if (pids.has(pid)) ports.add(port)
      }
      return Array.from(ports).sort((a, b) => a - b)
    } catch (err) {
      console.warn('[port-monitor] netstat failed', err instanceof Error ? err.message : err)
      return []
    }
  }
  // macOS / Linux: try lsof per pid
  const ports = new Set<number>()
  for (const pid of pids) {
    try {
      // Same lsof invocation works on both macOS and Linux — the previous
      // `isMac ? [...] : [...]` ternary had identical branches.
      const args = ['-P', '-iTCP', '-sTCP:LISTEN', '-n', '-p', String(pid), '-Fn']
      const { stdout } = await execFileP('lsof', args, { timeout: 3000 })
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.startsWith('n')) continue
        const m = line.match(/:(\d+)$/)
        if (m) ports.add(parseInt(m[1]!, 10))
      }
    } catch (err) {
      // lsof returns exit 1 when the pid has no matching sockets — normal.
      // ENOENT (lsof not installed) is worth a warn so users on minimal Linux
      // installs see why port detection is empty. Return `[]` (not a partial
      // accumulator) so callers see "no data" rather than misleading partial.
      const code = (err as NodeJS.ErrnoException)?.code
      if (code === 'ENOENT') {
        if (!warnedNoLsof) {
          console.warn('[port-monitor] lsof not installed; cannot enumerate listening ports')
          warnedNoLsof = true
        }
        return []
      }
    }
  }
  return Array.from(ports).sort((a, b) => a - b)
}

export async function scanPid(pid: number, treeResolver?: TreeResolver): Promise<number[]> {
  if (!Number.isFinite(pid) || pid <= 0) return []
  const tree = await pidTree(pid, { treeResolver })
  return listenPortsForPids(tree)
}
