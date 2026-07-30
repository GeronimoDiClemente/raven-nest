import { join } from 'path'
import { mkdirSync, readdirSync, rmSync, existsSync, lstatSync, symlinkSync, linkSync, cpSync } from 'fs'
import { ravenHome } from './raven-home'
import { provisionClaudeAccount, deprovisionClaudeAccount, type ProvisionerPaths } from './memory-provisioner'
import { isWin } from './platform'

const BASE_DIR = join(ravenHome(), '.raven-nest', 'accounts')

const VALID_AI_TYPES = new Set(['claude', 'gemini', 'codex', 'copilot', 'opencode', 'terminal', 'custom'])

function assertSafe(aiType: string, name?: string): void {
  if (!VALID_AI_TYPES.has(aiType)) throw new Error(`Invalid AI type: ${aiType}`)
  // Quote characters are additionally rejected (minor, pty-manager.ts review round 1):
  // an account name becomes part of `accountDir`, which the Nest Memory provisioner can
  // pass through `--settings <accountDir>/.nest/memory-settings.json` on the literal
  // shell command line PtyManager writes into the pane (see quoteShellArg there). This
  // is defense in depth — quoteShellArg already escapes embedded quotes correctly — but
  // an account name should never need one, so rejecting it here removes the class of
  // input entirely rather than relying solely on correct escaping downstream.
  if (name !== undefined && (name.includes('..') || name.includes('/') || name.includes('\\') || name.includes('"'))) {
    throw new Error(`Invalid account name: ${name}`)
  }
}

// Items to symlink from ~/.claude into each Claude account's .claude dir
const CLAUDE_SHARED_ITEMS: Array<{ src: string; dest: string; type: 'file' | 'dir' }> = [
  { src: 'CLAUDE.md',                    dest: 'CLAUDE.md',                    type: 'file' },
  { src: 'settings.json',                dest: 'settings.json',                type: 'file' },
  { src: 'keybindings.json',             dest: 'keybindings.json',             type: 'file' },
  { src: 'skills',                       dest: 'skills',                       type: 'dir'  },
  { src: join('plugins', 'installed_plugins.json'), dest: join('plugins', 'installed_plugins.json'), type: 'file' },
]

function isSymlink(p: string): boolean {
  try { return lstatSync(p).isSymbolicLink() } catch { return false }
}

/**
 * True when `dest` is linked back to `src` — either as a symlink/junction or
 * as a hardlink (the Windows-without-DevMode fallback path of
 * `createSharedLink`). Hardlinks aren't detected by `isSymbolicLink`, so a
 * naive check would skip them in `detachClaudeConfig` and leave the user
 * with an account that still mutates the global config silently.
 *
 * Identifies hardlinks by comparing the NTFS/POSIX file ID (`ino`) and the
 * device id of src and dest with bigint stats (regular `ino` returns 0 on
 * some Windows configs). Two regular files with the same inode on the same
 * device are guaranteed to be the same on-disk object.
 */
function isSharedWithGlobal(src: string, dest: string): boolean {
  try {
    const dStat = lstatSync(dest, { bigint: true })
    if (dStat.isSymbolicLink()) return true
    if (!dStat.isFile()) return false
    if (!existsSync(src)) return false
    const sStat = lstatSync(src, { bigint: true })
    return dStat.dev === sStat.dev && dStat.ino === sStat.ino && dStat.ino !== 0n
  } catch {
    return false
  }
}

// Create a link from src -> dest that works without elevated privileges on
// every supported platform. On Windows: directories use a junction (no
// Developer Mode / admin required), files fall back to a hardlink if the
// symlink call is rejected. On macOS/Linux: standard symlinks.
function createSharedLink(src: string, dest: string, type: 'file' | 'dir'): void {
  try {
    symlinkSync(src, dest, type === 'dir' ? 'junction' : 'file')
  } catch (err) {
    if (type === 'file' && process.platform === 'win32') {
      linkSync(src, dest)
    } else {
      throw err
    }
  }
}

/**
 * Sets up symlinks in accountDir/.claude pointing to the global ~/.claude config.
 * Only creates a symlink if:
 *   - The source exists in ~/.claude
 *   - The destination doesn't exist yet (or is already a symlink — idempotent)
 * Skips items where the user already has their own real file/dir.
 *
 * Returns the destination paths that failed to link. On Windows without
 * Developer Mode, `symlinkSync` can be rejected and the file hardlink
 * fallback may also fail (e.g. cross-volume). Callers can surface this so
 * the user knows a shared CLAUDE.md / settings.json was NOT wired up for
 * the account — otherwise the warn lands silently in main.log.
 */
export function setupClaudeConfig(accountDir: string): { failed: string[] } {
  const globalClaude = join(ravenHome(), '.claude')
  const localClaude = join(accountDir, '.claude')
  mkdirSync(join(localClaude, 'plugins'), { recursive: true })

  const failed: string[] = []
  for (const item of CLAUDE_SHARED_ITEMS) {
    const src = join(globalClaude, item.src)
    const dest = join(localClaude, item.dest)

    if (!existsSync(src)) continue          // global source missing — skip
    if (isSymlink(dest)) continue           // already a symlink — idempotent
    if (existsSync(dest)) continue          // user has own config — respect it

    try {
      createSharedLink(src, dest, item.type)
    } catch (err) {
      console.warn('[account-store] failed to link shared item', { src, dest, error: err instanceof Error ? err.message : String(err) })
      failed.push(dest)
    }
  }
  return { failed }
}

/**
 * Detaches an account from the shared config by replacing symlinks with real copies.
 * After this, edits to the account's config won't affect the global ~/.claude.
 */
export function detachClaudeConfig(accountDir: string): void {
  const globalClaude = join(ravenHome(), '.claude')
  const localClaude = join(accountDir, '.claude')

  for (const item of CLAUDE_SHARED_ITEMS) {
    const src = join(globalClaude, item.src)
    const dest = join(localClaude, item.dest)

    // Match both symlinks/junctions AND hardlinks back to the global config.
    // A hardlink wouldn't be detected by `isSymlink` alone — leaving it in
    // place would mean the account silently keeps mutating ~/.claude.
    if (!isSharedWithGlobal(src, dest)) continue
    if (!existsSync(src)) continue   // source gone — leave as-is

    rmSync(dest, { recursive: true })
    cpSync(src, dest, { recursive: true })
  }
}

export class AccountStore {
  // Nest Memory (§2.5). Optional and injected — AccountStore has no other Electron
  // dependency today, and existing callers/tests construct it with `new AccountStore()`.
  // When unset, save()/migrateClaudeAccounts() simply skip provisioning (memory
  // disconnected / not yet configured).
  private memory?: { paths: ProvisionerPaths; isEnabled: () => boolean }

  configureMemory(memory: { paths: ProvisionerPaths; isEnabled: () => boolean }): void {
    this.memory = memory
  }

  private provisionMemoryIfEnabled(aiType: string, dir: string): void {
    if (aiType !== 'claude' || !this.memory || !this.memory.isEnabled()) return
    try {
      provisionClaudeAccount(dir, this.memory.paths, isWin)
    } catch (err) {
      console.warn('[account-store] memory provisioning failed', { dir, error: err instanceof Error ? err.message : String(err) })
    }
  }

  /** Removes Nest Memory provisioning from a Claude account without deleting the account itself. */
  disconnectMemoryFromAllClaudeAccounts(): void {
    for (const name of this.list('claude')) {
      try { deprovisionClaudeAccount(this.getDir('claude', name)) }
      catch (err) { console.warn('[account-store] memory deprovisioning failed', { name, error: err instanceof Error ? err.message : String(err) }) }
    }
  }

  list(aiType: string): string[] {
    assertSafe(aiType)
    const dir = join(BASE_DIR, aiType)
    if (!existsSync(dir)) return []
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  }

  save(aiType: string, name: string): string {
    assertSafe(aiType, name)
    const dir = this.getDir(aiType, name)
    mkdirSync(dir, { recursive: true })
    // For gemini: create subdirectory
    mkdirSync(join(dir, 'gemini'), { recursive: true })
    // For claude: auto-link global config. Log any items that failed so the
    // user has a breadcrumb if their account is missing CLAUDE.md / settings.
    // The renderer doesn't consume this yet — wiring an IPC surface is a
    // follow-up, but the data is here when we get to it.
    if (aiType === 'claude') {
      const { failed } = setupClaudeConfig(dir)
      if (failed.length > 0) {
        console.warn('[account-store] save: some claude config items did not link', { aiType, name, failed })
      }
      this.provisionMemoryIfEnabled(aiType, dir)
    }
    return dir
  }

  delete(aiType: string, name: string): void {
    assertSafe(aiType, name)
    const dir = this.getDir(aiType, name)
    if (existsSync(dir)) rmSync(dir, { recursive: true })
  }

  getDir(aiType: string, name: string): string {
    assertSafe(aiType, name)
    return join(BASE_DIR, aiType, name)
  }

  /** Run on app startup: ensure all existing Claude accounts have the shared config linked. */
  migrateClaudeAccounts(): void {
    for (const name of this.list('claude')) {
      const dir = this.getDir('claude', name)
      const { failed } = setupClaudeConfig(dir)
      if (failed.length > 0) {
        // Best-effort at startup — just log. The user already has a working
        // account dir; the missing shared items will retry next launch.
        console.warn('[account-store] migrate: some claude config items did not link', { name, failed })
      }
      this.provisionMemoryIfEnabled('claude', dir)
    }
  }
}
