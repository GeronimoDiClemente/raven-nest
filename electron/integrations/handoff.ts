import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'fs'
import { isAbsolute, join, resolve } from 'path'

function handoffPath(worktreePath: string): string {
  return join(worktreePath, '.nest', 'handoff.md')
}

/**
 * El directorio de git de un worktree. En un clon normal es `{path}/.git`; en un worktree
 * de git `.git` es un ARCHIVO con `gitdir: <path>` adentro, y los worktrees son el caso
 * normal de este producto, no el raro.
 */
function gitDir(worktreePath: string): string | null {
  const dotGit = join(worktreePath, '.git')
  if (!existsSync(dotGit)) return null
  try {
    if (statSync(dotGit).isDirectory()) return dotGit
    const apunta = readFileSync(dotGit, 'utf8').trim().replace(/^gitdir:\s*/, '')
    if (!apunta) return null
    return isAbsolute(apunta) ? apunta : resolve(worktreePath, apunta)
  } catch {
    return null
  }
}

/**
 * Deja `.nest/` fuera del `git status` del repo del usuario.
 *
 * El handoff se escribe DENTRO de su worktree, así que sin esto aparecía como basura
 * nuestra en su repo. El `.gitignore` no sirve por dos motivos: el archivo cae en repos
 * ajenos (no en éste), y el del usuario es un archivo suyo y versionado que no nos
 * corresponde editar. `.git/info/exclude` es por clon, no se commitea y no toca nada
 * tracked.
 *
 * Best-effort de punta a punta: que no se pueda excluir no puede impedir escribir el
 * handoff, que es lo que el usuario pidió.
 */
function excluirNestDelRepo(worktreePath: string): void {
  try {
    const dir = gitDir(worktreePath)
    if (!dir) return  // no es un repo — no hay status que ensuciar
    const infoDir = join(dir, 'info')
    const excludePath = join(infoDir, 'exclude')
    const actual = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : ''
    if (actual.split('\n').some((linea) => linea.trim() === '.nest/')) return
    mkdirSync(infoDir, { recursive: true })
    const sep = actual === '' || actual.endsWith('\n') ? '' : '\n'
    writeFileSync(excludePath, `${actual}${sep}# Nest: el handoff y los artefactos de la sesion\n.nest/\n`)
  } catch (err) {
    console.warn('[handoff] no se pudo excluir .nest/ del repo', err)
  }
}

/** Read the current handoff summary for a worktree, or null if none written yet. */
export function readHandoff(worktreePath: string): string | null {
  try { return readFileSync(handoffPath(worktreePath), 'utf8') } catch { return null }
}

/** Write/overwrite the handoff summary. Creates .nest/ if missing (same as
 *  startWorkOnWorktree's TASK.md write). Best-effort: a disk failure warns
 *  instead of throwing into the IPC caller. */
export function writeHandoff(worktreePath: string, content: string): void {
  try {
    mkdirSync(join(worktreePath, '.nest'), { recursive: true })
    writeFileSync(handoffPath(worktreePath), content)
    excluirNestDelRepo(worktreePath)
  } catch (err) {
    console.warn('[handoff] write failed', err)
  }
}
