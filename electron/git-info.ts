import { existsSync } from 'fs'
import { runGit } from './git-exec'

/**
 * Branch + remote origin for a cwd, best-effort (null on any failure — not a git repo, no
 * remote, git missing). Shared by MemoryIpcServer's `memory.save`/`memory.search` project-key
 * resolution AND the handoff:read/write handlers in main.ts.
 *
 * Vive aparte de `main.ts` porque el paquete portátil también lo usa: su
 * MCP escribe sin Nest, y la clave de proyecto tiene que salir del remote igual que adentro
 * de la app, o una memoria guardada desde el paquete caería en otro proyecto.
 */
export async function resolveGitInfoForCwd(cwd: string): Promise<{ branch: string; remoteUrl: string | null } | null> {
  try {
    if (!existsSync(cwd)) return null
    const branch = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 3000 })
    let remoteUrl: string | null = null
    try { remoteUrl = await runGit(['remote', 'get-url', 'origin'], { cwd, timeout: 3000 }) } catch { /* no remote */ }
    return { branch, remoteUrl }
  } catch {
    return null
  }
}
