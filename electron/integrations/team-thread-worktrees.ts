// De un worktree al conjunto de worktrees sobre los que hay que correr el hilo. Puro, sin
// fs ni git, para que la regla se testee sin montar 8 carpetas.
//
// Por que existe (I3 de la review final de rama): los settings del hilo son POR PROYECTO,
// pero la escritura y el borrado eran POR WORKTREE. Apagar el toggle desde uno de los 8
// worktrees de este repo dejaba los otros 7 con su `.nest/team/` viejo y la linea en su
// AGENTS.md; prenderlo desde uno no escribia el hilo en los demas, en contra de la
// decision 7 de la spec §3 ("se escribe uno por worktree, completo").

/** Lo minimo que este modulo necesita de `WorktreeMeta` (electron/worktree-store.ts). */
export interface WorktreeLike {
  repoPath: string
  rootRepoPath: string
}

/**
 * Clave de comparacion de paths. Misma normalizacion que `WorktreeStore.posixKey` (Windows
 * produce `C:\dev\repo` y `C:/dev/repo` para el mismo path fisico) mas el recorte de la
 * barra final, como hace `listForRepo` al comparar raices.
 */
export function normalizeWorktreeKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * Todos los worktrees del repo al que pertenece `worktreePath`, el propio incluido.
 *
 * El que dispara viene PRIMERO y verbatim: es el path que el handler ya valido como
 * absoluto, y devolverlo tal cual evita que la normalizacion cambie lo que se le pasa a
 * `join()`. Si el store no lo conoce (todavia no se registro, o es un repo suelto), el
 * resultado es el propio y nada mas — nunca vacio.
 */
export function worktreesOfSameRepo(all: WorktreeLike[], worktreePath: string): string[] {
  const propio = normalizeWorktreeKey(worktreePath)
  const meta = all.find((m) => normalizeWorktreeKey(m.repoPath) === propio)

  const salida = [worktreePath]
  const vistos = new Set([propio])
  if (!meta) return salida

  const raiz = normalizeWorktreeKey(meta.rootRepoPath)
  for (const otro of all) {
    if (normalizeWorktreeKey(otro.rootRepoPath) !== raiz) continue
    const clave = normalizeWorktreeKey(otro.repoPath)
    if (vistos.has(clave)) continue
    vistos.add(clave)
    salida.push(otro.repoPath)
  }
  return salida
}

export interface WorktreeRepoGroup {
  rootRepoPath: string
  worktrees: string[]
}

/** Todos los worktrees conocidos, agrupados por repo raiz — la entrada del poll de 60s y
 *  de la reconciliacion al arranque, que no parten de ningun worktree en particular. */
export function groupWorktreesByRepo(all: WorktreeLike[]): WorktreeRepoGroup[] {
  const porRaiz = new Map<string, WorktreeRepoGroup>()
  for (const m of all) {
    const raiz = normalizeWorktreeKey(m.rootRepoPath)
    const grupo = porRaiz.get(raiz)
    if (grupo) grupo.worktrees.push(m.repoPath)
    else porRaiz.set(raiz, { rootRepoPath: m.rootRepoPath, worktrees: [m.repoPath] })
  }
  return [...porRaiz.values()]
}
