import { execFile, spawn } from 'child_process'
import { promisify } from 'util'

const execFileP = promisify(execFile)

const isWindows = process.platform === 'win32'

export interface DetectedIDE {
  id: string
  name: string
  binPath: string
}

interface Probe {
  id: string
  name: string
  bins: string[]  // candidate binary names
}

const PROBES: Probe[] = [
  { id: 'vscode', name: 'VS Code', bins: ['code'] },
  { id: 'cursor', name: 'Cursor', bins: ['cursor'] },
  { id: 'jetbrains', name: 'JetBrains IDE', bins: ['idea', 'webstorm', 'pycharm', 'goland', 'rubymine', 'phpstorm', 'rider'] },
  { id: 'sublime', name: 'Sublime Text', bins: ['subl'] },
  { id: 'xcode', name: 'Xcode', bins: ['xed'] },
  { id: 'zed', name: 'Zed', bins: ['zed'] },
]

async function which(bin: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP(isWindows ? 'where' : 'which', [bin], { timeout: 2000 })
    const first = stdout.split(/\r?\n/).map((l) => l.trim()).find((l) => l)
    return first ?? null
  } catch {
    return null
  }
}

let cache: { ts: number; ides: DetectedIDE[] } | null = null
const TTL_MS = 60 * 60 * 1000  // 1h

export async function detectIDEs(force = false): Promise<DetectedIDE[]> {
  if (!force && cache && Date.now() - cache.ts < TTL_MS) return cache.ides
  const found: DetectedIDE[] = []
  for (const probe of PROBES) {
    for (const bin of probe.bins) {
      const path = await which(bin)
      if (path) {
        found.push({ id: probe.id, name: probe.name, binPath: path })
        break  // one bin per probe is enough
      }
    }
  }
  cache = { ts: Date.now(), ides: found }
  return found
}

export function openInIDE(binPath: string, worktreePath: string): void {
  spawn(binPath, [worktreePath], {
    detached: true,
    stdio: 'ignore',
  }).unref()
}

export function clearCache(): void { cache = null }
