import { existsSync } from 'fs'
import { execSync } from 'child_process'

/**
 * Branch + remote origin for a cwd, best-effort (null on any failure — not a git repo, no
 * remote, git missing). Shared by MemoryIpcServer's `memory.save`/`memory.search` project-key
 * resolution AND the handoff:read/write handlers in main.ts.
 *
 * Vive aparte de `main.ts` desde el 2026-10-02 porque el paquete portátil también lo usa: su
 * MCP escribe sin Nest, y la clave de proyecto tiene que salir del remote igual que adentro
 * de la app, o una memoria guardada desde el paquete caería en otro proyecto.
 */
export function resolveGitInfoForCwd(cwd: string): { branch: string; remoteUrl: string | null } | null {
  try {
    if (!existsSync(cwd)) return null
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    let remoteUrl: string | null = null
    try { remoteUrl = execSync('git remote get-url origin', { cwd, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { /* no remote */ }
    return { branch, remoteUrl }
  } catch {
    return null
  }
}
