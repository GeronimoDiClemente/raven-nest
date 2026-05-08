import { join } from 'path'
import { mkdirSync, readdirSync, rmSync, existsSync, lstatSync, symlinkSync, cpSync } from 'fs'
import { ravenHome } from './raven-home'

const BASE_DIR = join(ravenHome(), '.raven-nest', 'accounts')

const VALID_AI_TYPES = new Set(['claude', 'gemini', 'codex', 'copilot', 'opencode', 'terminal', 'custom'])

function assertSafe(aiType: string, name?: string): void {
  if (!VALID_AI_TYPES.has(aiType)) throw new Error(`Invalid AI type: ${aiType}`)
  if (name !== undefined && (name.includes('..') || name.includes('/') || name.includes('\\'))) {
    throw new Error(`Invalid account name: ${name}`)
  }
}

// Items to symlink from ~/.claude into each Claude account's .claude dir
const CLAUDE_SHARED_ITEMS: Array<{ src: string; dest: string; type: 'file' | 'dir' }> = [
  { src: 'CLAUDE.md',                    dest: 'CLAUDE.md',                    type: 'file' },
  { src: 'settings.json',                dest: 'settings.json',                type: 'file' },
  { src: 'skills',                       dest: 'skills',                       type: 'dir'  },
  { src: join('plugins', 'installed_plugins.json'), dest: join('plugins', 'installed_plugins.json'), type: 'file' },
]

function isSymlink(p: string): boolean {
  try { return lstatSync(p).isSymbolicLink() } catch { return false }
}

/**
 * Sets up symlinks in accountDir/.claude pointing to the global ~/.claude config.
 * Only creates a symlink if:
 *   - The source exists in ~/.claude
 *   - The destination doesn't exist yet (or is already a symlink — idempotent)
 * Skips items where the user already has their own real file/dir.
 */
export function setupClaudeConfig(accountDir: string): void {
  const globalClaude = join(ravenHome(), '.claude')
  const localClaude = join(accountDir, '.claude')
  mkdirSync(join(localClaude, 'plugins'), { recursive: true })

  for (const item of CLAUDE_SHARED_ITEMS) {
    const src = join(globalClaude, item.src)
    const dest = join(localClaude, item.dest)

    if (!existsSync(src)) continue          // global source missing — skip
    if (isSymlink(dest)) continue           // already a symlink — idempotent
    if (existsSync(dest)) continue          // user has own config — respect it

    symlinkSync(src, dest)
  }
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

    if (!isSymlink(dest)) continue   // not a symlink — nothing to detach
    if (!existsSync(src)) continue   // source gone — leave as-is

    rmSync(dest, { recursive: true })
    cpSync(src, dest, { recursive: true })
  }
}

export class AccountStore {
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
    // For claude: auto-link global config
    if (aiType === 'claude') setupClaudeConfig(dir)
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
      setupClaudeConfig(this.getDir('claude', name))
    }
  }
}
