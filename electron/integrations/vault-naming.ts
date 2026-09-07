// Naming rules for the memory vault — pure, no fs, no Electron. See
// docs/superpowers/specs/2026-08-26-memory-vault-design.md §4.2-4.4.
//
// vaultSlug() is deliberately NOT chunker.ts's slugify(): that one keeps `/` (its input
// is a heading path, which can be hierarchical on purpose) — reusing it for a filename
// would create accidental subdirectories on all three OSes (H-3 in the vault spec).
import type { MemoryProject } from './memory-port'

const MAX_SLUG_LENGTH = 60
const GLOBAL_PROJECT_KEY = '__global__'

/**
 * Restricts to `[a-z0-9-]`, ASCII only. A title with no ASCII alphanumerics (Japanese,
 * emoji-only) slugs to '' → 'untitled' — the full title still lives in the frontmatter
 * and the note's `# ` heading, so nothing is lost, only the filename degrades.
 *
 * Case is folded to lowercase and cut at the last dash under MAX_SLUG_LENGTH, so the same
 * title always slugs identically on NTFS/APFS (case-insensitive) and ext4 (case-sensitive)
 * — see vault spec §11.
 */
export function vaultSlug(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    // Non-ASCII-alphanumeric chars become word separators, not silent deletions — "a<b>c"
    // must slug to "a-b-c", never the accidentally-merged "abc".
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!base) return 'untitled'
  if (base.length <= MAX_SLUG_LENGTH) return base
  const cut = base.slice(0, MAX_SLUG_LENGTH)
  const lastDash = cut.lastIndexOf('-')
  const trimmed = lastDash > 0 ? cut.slice(0, lastDash) : cut
  return trimmed || 'untitled'
}

/** Default (no-collision) file name for one observation: `{slug(title)}--{last 8 hex of sync_id}.md`. */
export function vaultFileName(title: string, syncId: string, useFullSyncId = false): string {
  const suffix = useFullSyncId ? syncId : syncId.slice(-8)
  return `${vaultSlug(title)}--${suffix}.md`
}

/**
 * Resolves file names for a whole set of observations, handling the rare same-slug +
 * same-8-hex-suffix collision (§4.3): the lexicographically smaller sync_id keeps the
 * short 8-hex name, the rest fall back to their full sync_id. Deterministic and
 * independent of input order — grouping happens before any winner is picked.
 */
export function resolveVaultFileNames(items: Array<{ syncId: string; title: string }>): Map<string, string> {
  const groups = new Map<string, string[]>()
  for (const item of items) {
    const key = `${vaultSlug(item.title)}--${item.syncId.slice(-8)}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(item.syncId)
    else groups.set(key, [item.syncId])
  }

  const result = new Map<string, string>()
  for (const item of items) {
    const key = `${vaultSlug(item.title)}--${item.syncId.slice(-8)}`
    const bucket = groups.get(key) ?? [item.syncId]
    if (bucket.length <= 1) {
      result.set(item.syncId, `${key}.md`)
      continue
    }
    const winner = [...bucket].sort()[0]
    result.set(item.syncId, item.syncId === winner ? `${key}.md` : `${vaultSlug(item.title)}--${item.syncId}.md`)
  }
  return result
}

/**
 * Folder name for a project: `{slug(readable name)}--{project_key[0:8]}/`, with `__global__`
 * mapped to `_global` (no hash suffix — it's a sentinel, not a real project_key) and a
 * project_key with no `projects` row (should only happen for `__global__` in practice)
 * falling back to the raw key.
 *
 * Readable name resolution order (§4.2): the last `org/repo` segment of the remote is
 * preferred over `display_name` on purpose — `display_name` freezes on whichever worktree
 * cwd first created the `projects` row (`ensureProject()` short-circuits once it exists),
 * so two worktrees of the same repo can otherwise show two different folder names.
 */
export function projectFolderName(projectKey: string, project: MemoryProject | null): string {
  if (projectKey === GLOBAL_PROJECT_KEY) return '_global'
  if (!project) return projectKey

  const fromRemote = project.remoteSlug?.split('/').filter(Boolean).pop()
  const readable = fromRemote || project.displayName || projectKey
  return `${vaultSlug(readable)}--${projectKey.slice(0, 8)}`
}

export interface ForbiddenRootCheck {
  forbidden: boolean
  reason?: string
}

const WINDOWS_CUSTOM_ROOT_MAX_LENGTH = 120

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** `candidate` equals `boundary`, or is nested inside it. Both normalized first. */
function isSameOrWithin(candidate: string, boundary: string): boolean {
  const a = normalizePath(candidate)
  const b = normalizePath(boundary)
  if (!b) return false
  return a === b || a.startsWith(`${b}/`)
}

/** Every path segment from `root` up to (not including) the filesystem root, root first. */
function ancestorsInclusive(root: string): string[] {
  const normalized = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = normalized.split('/')
  const out: string[] = []
  for (let i = parts.length; i > 0; i--) {
    const candidate = parts.slice(0, i).join('/')
    if (candidate) out.push(candidate)
  }
  return out
}

/**
 * Rejects a vault root that resolves to, or is nested inside, any of the six forbidden
 * locations from vault spec §4.1. Pure and testable: the `.git` ancestor check (rule 5)
 * is injected as `hasGitDir` rather than touching `fs` directly — real callers
 * (vault-config.ts) pass `existsSync`-backed logic, tests pass a fake.
 */
export function isForbiddenVaultRoot(
  root: string,
  ctx: {
    ravenHomeDir: string
    /** `{accountDir}/.claude` for every known account (any AI, any name) — markdown.ts's discovery roots. */
    accountClaudeDirs: string[]
    enrolledRepoRoots: string[]
    platform: NodeJS.Platform
    /** Checks whether `candidateDir/.git` exists. Defaults to "never" (no fs access) so this stays pure without a caller. */
    hasGitDir?: (candidateDir: string) => boolean
  }
): ForbiddenRootCheck {
  const memoryDir = `${ctx.ravenHomeDir}/.raven-nest/memory`
  if (isSameOrWithin(root, memoryDir)) {
    return { forbidden: true, reason: 'Contiene la credencial y el token del pipe de sync (.raven-nest/memory).' }
  }

  const globalClaudeDir = `${ctx.ravenHomeDir}/.claude`
  if (isSameOrWithin(root, globalClaudeDir)) {
    return { forbidden: true, reason: 'Es una fuente de descubrimiento del importer de markdown.' }
  }

  for (const accountClaudeDir of ctx.accountClaudeDirs) {
    if (isSameOrWithin(root, accountClaudeDir)) {
      return { forbidden: true, reason: 'Es una fuente de descubrimiento del importer de markdown (cuenta de IA).' }
    }
  }

  for (const repoRoot of ctx.enrolledRepoRoots) {
    if (isSameOrWithin(root, repoRoot)) {
      return { forbidden: true, reason: 'Es la raíz de un repo enrolado — el importer busca CLAUDE.md/AGENTS.md ahí.' }
    }
  }

  const hasGitDir = ctx.hasGitDir ?? (() => false)
  for (const ancestor of ancestorsInclusive(root)) {
    if (hasGitDir(ancestor)) {
      return { forbidden: true, reason: 'El vault no es código y no se versiona por accidente (hay un .git en el path).' }
    }
  }

  if (ctx.platform === 'win32' && root.length > WINDOWS_CUSTOM_ROOT_MAX_LENGTH) {
    return { forbidden: true, reason: `Path de más de ${WINDOWS_CUSTOM_ROOT_MAX_LENGTH} chars en Windows — riesgo de superar el límite de 260 al escribir notas.` }
  }

  return { forbidden: false }
}
