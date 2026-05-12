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

// Windows cmd.exe metacharacters. With `shell: true`, spawn concatenates
// args into a single command line that cmd.exe parses — so a worktreePath
// containing any of these can break out of the quoted argument and execute
// arbitrary commands (e.g. `C:\foo & calc.exe & rem `). The upstream IPC
// handler only validates `isAbsolute`, which doesn't catch this.
const WIN_SHELL_METACHARS = /[&|<>^"`%!]/

export function openInIDE(binPath: string, worktreePath: string): void {
  if (process.platform === 'win32' && WIN_SHELL_METACHARS.test(worktreePath)) {
    console.error('[ide-launcher] refusing to launch IDE — worktreePath contains cmd.exe metacharacters', { worktreePath })
    return
  }
  // Windows: `code` resolves to `code.cmd`. Node's spawn won't find a .cmd
  // shim without shell:true (Electron 33 ships Node 20, which lacks the
  // safer .cmd handling added in Node 21). Without it, spawn emits an async
  // 'error' event that, if unhandled, crashes the main process.
  //
  // Quirk: with `shell: true`, Node does NOT quote the program path before
  // handing it to cmd.exe. A binPath with spaces (e.g. `C:\Program Files\…`
  // or VS Code's default location `…\Microsoft VS Code\bin\code`) gets split
  // by cmd at the first space → ENOENT silently. Manually quote it on
  // Windows when needed. We already rejected metacharacters in worktreePath
  // above, so this quoting is safe.
  const isWindows = process.platform === 'win32'
  const programToSpawn = isWindows && binPath.includes(' ') ? `"${binPath}"` : binPath
  const child = spawn(programToSpawn, [worktreePath], {
    detached: true,
    stdio: 'ignore',
    shell: isWindows,
    windowsVerbatimArguments: false,
  })
  child.on('error', (err) => {
    console.error('[ide-launcher] failed to spawn IDE', { binPath, error: err.message })
  })
  child.unref()
}

export function clearCache(): void { cache = null }
