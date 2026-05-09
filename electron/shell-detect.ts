import { existsSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'

export interface ShellInfo {
  id: string           // 'powershell' | 'cmd' | 'pwsh' | 'gitbash' | 'wsl'
  label: string        // 'Windows PowerShell', 'Command Prompt', etc.
  bin: string          // absolute path to executable
  args: string[]       // spawn arguments
}

let cached: ShellInfo[] | null = null
let cachedAt = 0
const CACHE_TTL_MS = 30_000

export function detectShells(): ShellInfo[] {
  if (cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached
  if (process.platform !== 'win32') {
    cached = []
    cachedAt = Date.now()
    return cached
  }

  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const localAppData = process.env.LocalAppData ?? join(process.env.UserProfile ?? '', 'AppData', 'Local')

  // Defense-in-depth: only trust system shells if they actually live under
  // System32 (case-insensitive prefix). Blocks an attacker with env-var write
  // access from pointing SystemRoot at a directory with a malicious cmd.exe.
  const system32Prefix = (join(systemRoot, 'System32') + '\\').toLowerCase()
  const isInSystem32 = (p: string) => p.toLowerCase().startsWith(system32Prefix)

  const result: ShellInfo[] = []

  // Windows PowerShell — always present on Windows 10+
  // Note: NO `Set-Location $HOME` here. The PTY spawn passes cwd: repoPath, and
  // overriding that would defeat the whole "open shell in this repo" UX.
  const psPath = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  if (isInSystem32(psPath) && existsSync(psPath)) {
    result.push({
      id: 'powershell',
      label: 'Windows PowerShell',
      bin: psPath,
      args: ['-NoLogo', '-NoExit', '-Command',
        '$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")'],
    })
  }

  // Command Prompt — always present
  const cmdPath = join(systemRoot, 'System32', 'cmd.exe')
  if (isInSystem32(cmdPath) && existsSync(cmdPath)) {
    result.push({
      id: 'cmd',
      label: 'Command Prompt',
      bin: cmdPath,
      args: ['/K'],   // /K keeps the shell alive after running an initial command (none here)
    })
  }

  // PowerShell 7 (pwsh.exe) — modern cross-platform PowerShell, optional install
  const pwshCandidates = [
    join(programFiles, 'PowerShell', '7', 'pwsh.exe'),
    join(programFilesX86, 'PowerShell', '7', 'pwsh.exe'),
    join(localAppData, 'Microsoft', 'PowerShell', '7', 'pwsh.exe'),
  ]
  const pwshPath = pwshCandidates.find(existsSync)
  if (pwshPath) {
    result.push({
      id: 'pwsh',
      label: 'PowerShell 7',
      bin: pwshPath,
      args: ['-NoLogo', '-NoExit'],
    })
  }

  // Git Bash — comes with Git for Windows
  const gitBashCandidates = [
    join(programFiles, 'Git', 'bin', 'bash.exe'),
    join(programFilesX86, 'Git', 'bin', 'bash.exe'),
    join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'),
  ]
  const gitBashPath = gitBashCandidates.find(existsSync)
  if (gitBashPath) {
    result.push({
      id: 'gitbash',
      label: 'Git Bash',
      bin: gitBashPath,
      args: ['--login', '-i'],
    })
  }

  // WSL — wsl.exe ships with Windows as a stub even when the feature is
  // disabled or no distro is installed. Probe with `wsl -l -q` (timeout 1.5s)
  // and only expose the card if at least one distro is registered.
  const wslPath = join(systemRoot, 'System32', 'wsl.exe')
  if (isInSystem32(wslPath) && existsSync(wslPath) && hasWslDistro(wslPath)) {
    result.push({
      id: 'wsl',
      label: 'WSL',
      bin: wslPath,
      args: [],
    })
  }

  cached = result
  cachedAt = Date.now()
  return result
}

export function getShellById(id: string): ShellInfo | undefined {
  return detectShells().find((s) => s.id === id)
}

/**
 * Returns true if WSL has at least one distro registered. wsl.exe outputs
 * UTF-16 LE — we strip nulls and trim. Times out at 1.5s to avoid blocking
 * detection if WSL is hung.
 */
function hasWslDistro(wslPath: string): boolean {
  try {
    const out = execFileSync(wslPath, ['-l', '-q'], {
      encoding: 'utf8',
      timeout: 1500,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    // wsl.exe -l -q prints UTF-16 LE; in Node utf8 decode this becomes nulls
    // between every char. Strip them, trim, and check if any line remains.
    const lines = out.replace(/\0/g, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    return lines.length > 0
  } catch {
    return false
  }
}
