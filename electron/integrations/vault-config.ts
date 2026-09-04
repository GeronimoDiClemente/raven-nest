// `memory-vault.json` — same validated/atomic-write pattern as `worker-spec-store.ts` and
// `scheduler.ts`. Per-account, mirroring `resolveStorePath`'s layout (Task 1 of the
// multi-device memory plan added per-account stores; the vault is "a folder per account,
// mirror of that account's store — not a global one", per the plan doc's Task 5 line).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { randomBytes } from 'crypto'
import { isForbiddenVaultRoot, type ForbiddenRootCheck } from './vault-naming'

export interface VaultSettings {
  version: number
  enabled: boolean
  /** null = the default per-account root below. */
  root: string | null
  includeSuperseded: boolean
  includeTeamScope: boolean
}

export function defaultVaultSettings(): VaultSettings {
  return { version: 1, enabled: false, root: null, includeSuperseded: true, includeTeamScope: true }
}

function accountSegment(userId: string | null): string {
  return userId && userId.trim() ? userId : '_local'
}

/** `{ravenHome}/.raven-nest/memory-vault/<account>/` — outside `.raven-nest/memory/` on purpose, see vault spec §4.1. */
export function defaultVaultRoot(ravenHomeDir: string, userId: string | null): string {
  return join(ravenHomeDir, '.raven-nest', 'memory-vault', accountSegment(userId))
}

/**
 * Where THIS account's `enabled`/`root`/config flags live. Deliberately its own directory,
 * separate from both the vault content root (which the user may repoint anywhere, §14 V-3)
 * and from `.raven-nest/memory/` (never anything the user might zip as "the vault").
 */
export function vaultSettingsPath(ravenHomeDir: string, userId: string | null): string {
  return join(ravenHomeDir, '.raven-nest', 'memory-vault-settings', `${accountSegment(userId)}.json`)
}

function toVaultSettings(x: unknown): VaultSettings | null {
  if (!x || typeof x !== 'object') return null
  const r = x as Record<string, unknown>
  const out = defaultVaultSettings()
  if (typeof r.enabled === 'boolean') out.enabled = r.enabled
  if (typeof r.root === 'string' || r.root === null) out.root = r.root as string | null
  if (typeof r.includeSuperseded === 'boolean') out.includeSuperseded = r.includeSuperseded
  if (typeof r.includeTeamScope === 'boolean') out.includeTeamScope = r.includeTeamScope
  return out
}

/** Missing/corrupt file → the defaults (vault off), same robustness contract as worker-spec-store.ts. */
export function loadVaultSettings(filePath: string): VaultSettings {
  try {
    const raw = readFileSync(filePath, 'utf8')
    return toVaultSettings(JSON.parse(raw)) ?? defaultVaultSettings()
  } catch {
    return defaultVaultSettings()
  }
}

/** Atomic write (tmp + rename). Best-effort: a disk failure warns instead of throwing into an IPC handler. */
export function saveVaultSettings(filePath: string, settings: VaultSettings): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true })
    const tmp = `${filePath}.${randomBytes(6).toString('hex')}.tmp`
    writeFileSync(tmp, JSON.stringify(settings, null, 2))
    renameSync(tmp, filePath)
  } catch (err) {
    console.warn('[memory-vault] memory-vault.json write failed', err)
  }
}

export function resolveVaultRootDir(ravenHomeDir: string, userId: string | null, settings: VaultSettings): string {
  return settings.root ?? defaultVaultRoot(ravenHomeDir, userId)
}

/**
 * The real, fs-touching validation a caller runs before accepting a user-chosen root
 * (`isForbiddenVaultRoot` itself stays pure — see vault-naming.ts). Walks `root`'s
 * ancestors checking for a `.git` directory via `existsSync`, closing rule 5 of §4.1 for
 * real instead of the injectable no-op the pure function defaults to.
 */
export function validateVaultRoot(
  root: string,
  ctx: { ravenHomeDir: string; accountClaudeDirs: string[]; enrolledRepoRoots: string[]; platform: NodeJS.Platform }
): ForbiddenRootCheck {
  return isForbiddenVaultRoot(root, {
    ...ctx,
    hasGitDir: (candidateDir) => existsSync(join(candidateDir, '.git')),
  })
}
