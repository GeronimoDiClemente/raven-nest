// Identidad canónica de worktreePath.
//
// `PaneNode.repoPath` tiene DOS productores con normalización distinta:
// worktree-store fuerza POSIX (`C:/dev/repo`, sale de `git worktree list`) y
// dialog:openFolder / git:clone persisten el path nativo en local-paths.json
// (`C:\dev\repo`). En Windows ambas formas del MISMO worktree conviven dentro
// de un tab, así que toda comparación de identidad (guards cross-worktree,
// keys de buffers) tiene que pasar por acá — comparar strings crudas rechaza
// o duplica en silencio.
//
// Solo para COMPARAR/keyear: nunca mandar el resultado por IPC — en unix un
// '\' es un carácter válido de nombre y normalizarlo cambiaría el path real
// (la colisión teórica de keys que eso implica es aceptable: nuestros
// productores unix jamás emiten '\' como separador).

// macOS (APFS default) es case-insensitive como NTFS; Linux (ext4) no. En el
// renderer no hay process.platform: se infiere de navigator. El override
// existe solo para tests (corren en node, sin navigator → default linux-like,
// el modo conservador).
let unixCaseInsensitiveOverride: boolean | null = null
export function __setUnixCaseInsensitiveForTests(v: boolean | null): void { unixCaseInsensitiveOverride = v }
function unixCaseInsensitive(): boolean {
  if (unixCaseInsensitiveOverride !== null) return unixCaseInsensitiveOverride
  return typeof navigator !== 'undefined' && /mac/i.test(navigator.platform ?? '')
}

export function worktreeKey(worktreePath: string): string {
  const posix = worktreePath.replace(/\\/g, '/')
  const trimmed = posix.replace(/\/+$/, '') || '/'
  // Case-insensitive donde el FS lo es: formas Windows (letra de unidad o
  // UNC — NTFS) siempre, y paths unix SOLO en macOS (APFS default). En Linux
  // ext4 es case-SENSITIVE: lowercasear colapsaría dos worktrees reales.
  // (main.ts lowercasea sin guard en sus propios chequeos — este lado queda
  // igual de estricto en win/mac y MÁS estricto en linux.) Colisión teórica
  // asumida: un nombre unix con '\' literal inicial se vuelve '//' y cae al
  // branch UNC — ningún productor real emite eso.
  if (/^[a-z]:/i.test(trimmed) || trimmed.startsWith('//')) return trimmed.toLowerCase()
  if (unixCaseInsensitive()) return trimmed.toLowerCase()
  return trimmed
}

/** Si dos repoPaths nombran el mismo worktree. Sin path no hay identidad: undefined nunca matchea, ni consigo mismo. */
export function sameWorktree(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false
  return worktreeKey(a) === worktreeKey(b)
}
