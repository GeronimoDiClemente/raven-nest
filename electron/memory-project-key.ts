// Project key derivation — pure, dependency-free (only Node's crypto) so it can be
// unit tested directly. See docs/nest-memory-architecture.md §3.3.
import { createHash } from 'crypto'

/** Normalizes a git remote URL to `host/org/repo` regardless of protocol. */
export function normalizeRemote(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim()
  if (!trimmed) return null

  // git@github.com:org/repo.git -> github.com/org/repo
  const scpMatch = trimmed.match(/^[\w.-]+@([\w.-]+):(.+?)(?:\.git)?\/?$/)
  if (scpMatch) return `${scpMatch[1]}/${scpMatch[2]}`

  // https://github.com/org/repo(.git) or ssh://git@host/org/repo(.git)
  try {
    const url = new URL(trimmed)
    const path = url.pathname.replace(/^\/+/, '').replace(/\.git$/, '').replace(/\/+$/, '')
    if (!path) return null
    return `${url.host}/${path}`
  } catch {
    return null
  }
}

/** `sha256(normalized)[0:16]` — see §3.3. Cloud never learns the repo name. */
export function projectKeyFromRemote(remoteUrl: string): string | null {
  const normalized = normalizeRemote(remoteUrl)
  if (!normalized) return null
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}

/** `sha256(lowercase(absolute root path))[0:16]` — used when there is no remote. */
export function projectKeyFromPath(absoluteRootPath: string): string {
  const normalized = absoluteRootPath.trim().toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '')
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}

export const GLOBAL_PROJECT_KEY = '__global__'

/** Resolution order from §3.3: remote -> path -> global. */
export function resolveProjectKey(opts: { remoteUrl?: string | null; rootPath?: string | null }): string {
  if (opts.remoteUrl) {
    const fromRemote = projectKeyFromRemote(opts.remoteUrl)
    if (fromRemote) return fromRemote
  }
  if (opts.rootPath) return projectKeyFromPath(opts.rootPath)
  return GLOBAL_PROJECT_KEY
}
