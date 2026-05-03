import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileP = promisify(execFile)

const isWindows = process.platform === 'win32'
const isMac = process.platform === 'darwin'

async function pidChildren(pid: number): Promise<number[]> {
  if (isWindows) {
    try {
      const { stdout } = await execFileP('wmic', [
        'process',
        'where',
        `(parentprocessid=${pid})`,
        'get',
        'processid',
      ], { timeout: 3000 })
      return stdout
        .split(/\r?\n/)
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n !== pid)
    } catch {
      return []
    }
  }
  try {
    const { stdout } = await execFileP('pgrep', ['-P', String(pid)], { timeout: 3000 })
    return stdout
      .split(/\s+/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n))
  } catch {
    return []
  }
}

export async function pidTree(rootPid: number, depth = 4): Promise<Set<number>> {
  const all = new Set<number>([rootPid])
  let frontier = [rootPid]
  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const next: number[] = []
    for (const pid of frontier) {
      const kids = await pidChildren(pid)
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
    } catch {
      return []
    }
  }
  // macOS / Linux: try lsof per pid
  const ports = new Set<number>()
  for (const pid of pids) {
    try {
      const args = isMac
        ? ['-P', '-iTCP', '-sTCP:LISTEN', '-n', '-p', String(pid), '-Fn']
        : ['-P', '-iTCP', '-sTCP:LISTEN', '-n', '-p', String(pid), '-Fn']
      const { stdout } = await execFileP('lsof', args, { timeout: 3000 })
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.startsWith('n')) continue
        const m = line.match(/:(\d+)$/)
        if (m) ports.add(parseInt(m[1]!, 10))
      }
    } catch {
      // lsof may not exist or pid gone
    }
  }
  return Array.from(ports).sort((a, b) => a - b)
}

export async function scanPid(pid: number): Promise<number[]> {
  if (!Number.isFinite(pid) || pid <= 0) return []
  const tree = await pidTree(pid)
  return listenPortsForPids(tree)
}
