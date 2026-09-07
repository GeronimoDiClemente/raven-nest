// Gemini CLI memory provisioning (docs/nest-memory-architecture.md §2.5, §9 — the "Phase 2
// adapter" the doc's Claude-only section anticipates).
//
// Deliberately a separate file from memory-provisioner.ts, same reason that file's own
// header gives: that module documents and guards a Claude-specific hazard (the account's
// `.claude/settings.json` is frequently a symlink/hardlink back to the user's GLOBAL
// `~/.claude/settings.json` — never open it for read-modify-write). None of that applies
// here. Gemini has its own, different hazard — see below — so it gets its own module
// instead of a special case bolted onto Claude's.
//
// -----------------------------------------------------------------------------------------
// DESIGN DEVIATION FLAGGED FOR REVIEW — read before changing this file.
//
// The task that produced this module specified an isolated, Nest-exclusive home
// (`{accountDir}/.nest/gemini-home`) that `deprovision()` could `rmSync` wholesale, mirroring
// how memory-provisioner.ts's `.nest/` is 100% Nest-owned for Claude. Implementing it that
// way would collide with code that already exists and already runs in production:
//
//   - docs/nest-memory-architecture.md §2.5's own provisioning table already specifies
//     `GEMINI_CLI_HOME = {accountDir}/gemini`, "set at pty-manager.ts:53-57".
//   - pty-manager.ts's `create()` (the `cmd === 'gemini'` block) ALREADY sets
//     `env.GEMINI_CLI_HOME = join(accountDir, 'gemini')` for every real Gemini account pane
//     — this is Gemini's per-Nest-account IDENTITY home: its OAuth token, trustedFolders.json,
//     history. account-store.ts's `save()` already `mkdir`s that exact subdirectory for
//     every new account, gemini or not.
//   - Gemini CLI has no `--settings <file>` flag the way Claude does (verified: no such
//     flag exists) — GEMINI_CLI_HOME is the ONLY isolation lever, and it redirects the
//     entire config root, all or nothing (the exact equivalent of CLAUDE_CONFIG_DIR, not of
//     Claude's ADDITIVE `--settings`). Only one GEMINI_CLI_HOME value can apply to a given
//     spawn — whichever write happens last in pty-manager.ts's `env` object wins.
//
// A second, competing `.nest/gemini-home` would silently orphan the account's already-
// established Gemini login the moment memory turns on (GEMINI_CLI_HOME would point
// somewhere that has never seen that OAuth flow), AND fragment one Nest account's Gemini
// state across two unrelated directories. So this module reuses the SAME existing identity
// home instead of minting a second one. Consequence: unlike Claude's `.nest/` (holds only
// Nest-authored files, safe to delete outright), `{accountDir}/gemini/.gemini/settings.json`
// is NOT Nest-exclusive — it is Gemini's real config file, holding the user's own settings
// alongside ours. `deprovision()` below therefore does a surgical merge (remove exactly the
// `mcpServers.nest_memory` entry and the hook entries this module itself wrote, leave
// everything else — same principle §2.5 states for Claude, "removes the entry", not "deletes
// the file"), never a wholesale delete of that file or its parent directory. The wrapper
// script under `{accountDir}/.nest/` (see writeWrapperScript, reused from
// memory-provisioner.ts) IS 100% Nest-owned for this accountDir — same as for Claude — and
// deprovision below does remove that outright.
//
// Headless nodes (no saved account — see pty-manager.ts's `headlessAccountDir`): Claude's
// headless path deliberately does NOT redirect HOME, so a headless node keeps the real
// user's credentials (memory rides in via additive `--mcp-config`/`--settings` flags
// instead). There is no such additive path for Gemini — `provision()` here always returns a
// GEMINI_CLI_HOME override, which for a headless node WOULD redirect away from the real
// `~/.gemini` and its real login, same tension as above. Not fixed here: headless Gemini
// invocation isn't wired yet (graph-tick.ts's `launchCommand` returns `''` for a `gemini`
// agent — "no verified headless invocation yet"), so this path is currently unreachable in
// production. Flagging it so whoever wires up headless Gemini next sees the caveat instead
// of rediscovering it.
//
// HOOK EVENT NAMES (verified against gemini 0.55.1 installed on disk, not assumed): Gemini's
// hook system uses different event names than Claude's for the same moments — confirmed by
// running `gemini hooks migrate --from-claude` and reading its actual output:
//   Claude SessionStart -> Gemini SessionStart
//   Claude Stop         -> Gemini AfterAgent
//   Claude PreCompact    -> Gemini PreCompress
// The hooks ARRAY SHAPE (`[{ matcher, hooks: [{ type, command, timeout }] }]`) is identical
// to Claude's — only the outer object's key names differ. The shim itself is AI-agnostic:
// it takes the same `hook session-start|stop|pre-compact` subcommands regardless of which
// CLI invoked it, so only the Gemini-side event key changes, never the wrapper invocation.
//
// DO NOT call `gemini hooks migrate` from code, ever — verified with repeated runs: it reads
// `{cwd}/.claude/settings.json` (never our isolated file), always writes to PROJECT scope
// (`{cwd}/.gemini/settings.json`, never GEMINI_CLI_HOME), and is a SILENT no-op with a false
// "success" message when cwd === HOME. It is not a shortcut for what this module does —
// write the JSON directly, the same way memory-provisioner.ts already does for Claude.
import { existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { writeWrapperScript, readJsonOrThrow, writeJson, type JsonFile, type ProvisionerPaths } from './memory-provisioner'

/** Gemini hook event name -> the shim's own (AI-agnostic) hook subcommand. */
const GEMINI_HOOK_EVENTS: Record<string, string> = {
  SessionStart: 'session-start',
  AfterAgent: 'stop',
  PreCompress: 'pre-compact',
}

/** Gemini's per-Nest-account identity home — same directory pty-manager.ts already
 *  points GEMINI_CLI_HOME at for every real account pane (see the file header). */
function geminiHomeDir(accountDir: string): string {
  return join(accountDir, 'gemini')
}

function geminiSettingsPath(accountDir: string): string {
  return join(geminiHomeDir(accountDir), '.gemini', 'settings.json')
}

/**
 * True for a hooks-array entry this module itself wrote, identified by its command
 * referencing the Nest wrapper script filename — not by an exact path match, since the
 * wrapper's absolute path changes across reinstalls/app moves. Lets provision() replace its
 * own stale entries (idempotent) and deprovision() remove exactly its own entries without
 * touching hooks a user configured by hand under the same event name.
 */
function isNestHookEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false
  const hooks = (entry as { hooks?: unknown }).hooks
  if (!Array.isArray(hooks)) return false
  return hooks.some(
    (h) =>
      typeof h === 'object' &&
      h !== null &&
      typeof (h as { command?: unknown }).command === 'string' &&
      /nest-memory\.(cmd|sh)/.test((h as { command: string }).command),
  )
}

/** Idempotent: replaces this module's own entries under each mapped event, preserving any
 *  other hooks a user (or Gemini itself) already has under the same or other event names. */
function mergeGeminiHooks(existing: unknown, wrapper: string): JsonFile {
  const hooks: JsonFile = existing && typeof existing === 'object' ? { ...(existing as JsonFile) } : {}
  for (const [event, hookName] of Object.entries(GEMINI_HOOK_EVENTS)) {
    const prior = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : []
    const kept = prior.filter((entry) => !isNestHookEntry(entry))
    kept.push({ matcher: '', hooks: [{ type: 'command', command: `"${wrapper}" hook ${hookName}`, timeout: 5 }] })
    hooks[event] = kept
  }
  return hooks
}

/**
 * Provisions Nest Memory for one Gemini account: mcpServers.nest_memory + the 3 mapped
 * hooks, written into the account's EXISTING identity home
 * (`{accountDir}/gemini/.gemini/settings.json}`) — see the file header for why this reuses
 * that home instead of a second isolated one. Safe to call repeatedly: re-running replaces
 * this module's own entries in place instead of duplicating them, and never touches any
 * other key in that file. Returns the GEMINI_CLI_HOME override for PtyManager to inject —
 * Gemini needs no CLI flags (unlike Claude's `--settings`), so `args` is omitted.
 */
export function provisionGeminiAccount(accountDir: string, paths: ProvisionerPaths, isWin: boolean): { env: Record<string, string> } {
  const geminiHome = geminiHomeDir(accountDir)
  mkdirSync(join(geminiHome, '.gemini'), { recursive: true })
  const wrapper = writeWrapperScript(accountDir, paths, isWin)

  const settingsPath = geminiSettingsPath(accountDir)
  const settings = readJsonOrThrow(settingsPath)
  const mcpServers = (settings.mcpServers as JsonFile) ?? {}
  mcpServers.nest_memory = {
    command: paths.execPath,
    args: [paths.shimPath],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  }
  settings.mcpServers = mcpServers
  settings.hooks = mergeGeminiHooks(settings.hooks, wrapper)
  writeJson(settingsPath, settings)

  return { env: { GEMINI_CLI_HOME: geminiHome } }
}

/**
 * Reverses provisioning: removes mcpServers.nest_memory and this module's own hook entries
 * from `{accountDir}/gemini/.gemini/settings.json`, WITHOUT deleting that file or any other
 * key in it — it is Gemini's real config, not a Nest-exclusive file (see file header). Also
 * removes `{accountDir}/.nest/` (the wrapper script), which — same as for Claude — holds
 * only Nest-authored files for this accountDir and is safe to delete outright.
 */
export function deprovisionGeminiAccount(accountDir: string): void {
  const settingsPath = geminiSettingsPath(accountDir)
  if (existsSync(settingsPath)) {
    const settings = readJsonOrThrow(settingsPath)

    const mcpServers = (settings.mcpServers as JsonFile) ?? {}
    if ('nest_memory' in mcpServers) {
      delete mcpServers.nest_memory
      settings.mcpServers = mcpServers
    }

    const hooks = settings.hooks as JsonFile | undefined
    if (hooks) {
      for (const event of Object.keys(GEMINI_HOOK_EVENTS)) {
        const arr = hooks[event]
        if (!Array.isArray(arr)) continue
        const kept = arr.filter((entry) => !isNestHookEntry(entry))
        if (kept.length > 0) hooks[event] = kept
        else delete hooks[event]
      }
      if (Object.keys(hooks).length === 0) delete settings.hooks
      else settings.hooks = hooks
    }

    writeJson(settingsPath, settings)
  }

  const nestDirPath = join(accountDir, '.nest')
  if (existsSync(nestDirPath)) rmSync(nestDirPath, { recursive: true, force: true })
}

export function isGeminiAccountProvisioned(accountDir: string): boolean {
  const settingsPath = geminiSettingsPath(accountDir)
  if (!existsSync(settingsPath)) return false
  try {
    const settings = readJsonOrThrow(settingsPath)
    const mcpServers = settings.mcpServers as JsonFile | undefined
    return !!mcpServers?.nest_memory
  } catch {
    return false
  }
}
