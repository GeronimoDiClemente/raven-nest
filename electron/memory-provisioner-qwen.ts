// qwen CLI memory provisioning (docs/nest-memory-architecture.md §2.5, §9 — the "Phase 2
// adapter" the doc's Claude-only section anticipates; Task 6 Step 4 verified this CLI
// exists and is cheap to wire, same pattern as Gemini).
//
// Separate file from memory-provisioner-gemini.ts even though the shape is close, same
// reason both those modules give: each AI type gets its own hazards documented next to its
// own code instead of a shared module accumulating special cases.
//
// -----------------------------------------------------------------------------------------
// WHY qwen NEEDS NO ISOLATED IDENTITY HOME (unlike Gemini's GEMINI_CLI_HOME, Codex's
// CODEX_HOME): qwen resolves its user-scope config at `os.homedir()/.qwen/settings.json`
// (verified by reading the installed CLI's bundle, not assumed) — and pty-manager.ts
// ALREADY redirects HOME/USERPROFILE to `accountDir` for every AI pane generically. Task 6
// Step 4 confirmed this redirection is sufficient to isolate qwen's entire config root
// (verified by overriding the variable and watching the whole config dir move) — the same
// cheap category as Gemini, minus Gemini's extra GEMINI_CLI_HOME lever. So
// `{accountDir}/.qwen/settings.json` IS qwen's real per-account config file already, with
// no extra directory or env var to inject. provisionQwenAccount() therefore returns `{}`.
//
// Same non-exclusive-file consequence as Gemini's settings.json: this file holds the
// user's own qwen config (once they log in inside that pane) alongside ours, so
// deprovision() does a surgical merge, never a wholesale delete.
//
// HOOK EVENT NAMES: verified against the installed CLI's own docs
// (bundled/qc-helper/docs/features/hooks.md in @qwen-code/qwen-code) — qwen's hook events
// are named IDENTICALLY to Claude's for the 3 moments this module wires: SessionStart,
// Stop, PreCompact. No translation table needed the way Gemini's AfterAgent/PreCompress
// does — QWEN_HOOK_EVENTS below is a 1:1 map kept for structural symmetry with the Gemini
// module and in case a future qwen release renames one of them.
//
// TIMEOUT UNIT — the one real gotcha: qwen's command-hook `timeout` field is documented in
// MILLISECONDS (default 60000), not seconds like Claude/Gemini's `timeout: 5`. Using `5`
// here would time out the hook after 5ms. This module uses 5000 (ms) for the same
// real-world 5-second budget.
import { existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { writeWrapperScript, readJsonOrThrow, writeJson, type JsonFile, type ProvisionerPaths } from './memory-provisioner'

/** Claude-facing hook event name -> qwen's own hook event name (identical for all 3 today). */
const QWEN_HOOK_EVENTS: Record<string, string> = {
  SessionStart: 'session-start',
  Stop: 'stop',
  PreCompact: 'pre-compact',
}

const QWEN_HOOK_TIMEOUT_MS = 5000

function qwenSettingsPath(accountDir: string): string {
  return join(accountDir, '.qwen', 'settings.json')
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
 *  other hooks a user (or qwen itself) already has under the same or other event names. */
function mergeQwenHooks(existing: unknown, wrapper: string): JsonFile {
  const hooks: JsonFile = existing && typeof existing === 'object' ? { ...(existing as JsonFile) } : {}
  for (const [event, hookName] of Object.entries(QWEN_HOOK_EVENTS)) {
    const prior = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : []
    const kept = prior.filter((entry) => !isNestHookEntry(entry))
    kept.push({ matcher: '', hooks: [{ type: 'command', command: `"${wrapper}" hook ${hookName}`, timeout: QWEN_HOOK_TIMEOUT_MS }] })
    hooks[event] = kept
  }
  return hooks
}

/**
 * Provisions Nest Memory for one qwen account: mcpServers.nest_memory + the 3 hooks,
 * written into `{accountDir}/.qwen/settings.json` — qwen's real per-account config file
 * (see file header for why no separate identity home is needed). Safe to call repeatedly.
 * Returns nothing extra for PtyManager to inject — qwen needs no CLI flags or env override.
 */
export function provisionQwenAccount(accountDir: string, paths: ProvisionerPaths, isWin: boolean): { args?: string[]; env?: Record<string, string> } {
  mkdirSync(join(accountDir, '.qwen'), { recursive: true })
  const wrapper = writeWrapperScript(accountDir, paths, isWin)

  const settingsPath = qwenSettingsPath(accountDir)
  const settings = readJsonOrThrow(settingsPath)
  const mcpServers = (settings.mcpServers as JsonFile) ?? {}
  mcpServers.nest_memory = {
    command: paths.execPath,
    args: [paths.shimPath],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  }
  settings.mcpServers = mcpServers
  settings.hooks = mergeQwenHooks(settings.hooks, wrapper)
  writeJson(settingsPath, settings)

  return {}
}

/**
 * Reverses provisioning: removes mcpServers.nest_memory and this module's own hook entries
 * from `{accountDir}/.qwen/settings.json`, WITHOUT deleting that file or any other key in
 * it — it is qwen's real config, not a Nest-exclusive file (see file header). Also removes
 * `{accountDir}/.nest/` (the wrapper script), which holds only Nest-authored files for this
 * accountDir and is safe to delete outright.
 */
export function deprovisionQwenAccount(accountDir: string): void {
  const settingsPath = qwenSettingsPath(accountDir)
  if (existsSync(settingsPath)) {
    const settings = readJsonOrThrow(settingsPath)

    const mcpServers = (settings.mcpServers as JsonFile) ?? {}
    if ('nest_memory' in mcpServers) {
      delete mcpServers.nest_memory
      settings.mcpServers = mcpServers
    }

    const hooks = settings.hooks as JsonFile | undefined
    if (hooks) {
      for (const event of Object.keys(QWEN_HOOK_EVENTS)) {
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

export function isQwenAccountProvisioned(accountDir: string): boolean {
  const settingsPath = qwenSettingsPath(accountDir)
  if (!existsSync(settingsPath)) return false
  try {
    const settings = readJsonOrThrow(settingsPath)
    const mcpServers = settings.mcpServers as JsonFile | undefined
    return !!mcpServers?.nest_memory
  } catch {
    return false
  }
}
