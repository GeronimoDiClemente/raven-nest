// Per-account MCP config + hook injection for Nest Memory — Claude Code only in Phase 1
// (Codex/Gemini adapters are Phase 2, per docs/nest-memory-architecture.md §2.5 and §9).
//
// THE SHARED-CONFIG HAZARD (§2.5): account-store.ts symlinks (or hardlinks, on Windows
// without Developer Mode) the user's global ~/.claude/settings.json into every Claude
// account. Writing hooks into {accountDir}/.claude/settings.json would silently mutate
// that GLOBAL file — polluting every Claude Code session on the machine, Nest or not.
//
// This module NEVER opens, reads-then-writes, or otherwise touches
// {accountDir}/.claude/settings.json. It launches Claude with an isolated,
// Nest-owned additional settings file instead:
//   claude --settings {accountDir}/.nest/memory-settings.json
// per Claude Code's documented `--settings <file>` flag, which loads ADDITIONAL settings
// on top of the normal hierarchy (O-1, resolved — see docs/nest-memory-architecture.md).
// electron/__tests__/memory-provisioner.test.ts asserts byte-for-byte that the global
// settings.json is unchanged by provision/deprovision — the regression test for this
// exact hazard (Phase 1 acceptance criterion #6, risk R-2).
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, chmodSync, renameSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'

const NEST_MARKER = 'memory'
const HOOK_EVENTS = ['SessionStart', 'Stop', 'PreCompact'] as const

export interface ProvisionerPaths {
  /** Absolute path to the Electron binary (process.execPath). */
  execPath: string
  /** Absolute path to the built memory-mcp shim entry (dist-electron/memory-mcp.js). */
  shimPath: string
}

function nestDir(accountDir: string): string {
  return join(accountDir, '.nest')
}

function wrapperPath(accountDir: string, isWin: boolean): string {
  return join(nestDir(accountDir), isWin ? 'nest-memory.cmd' : 'nest-memory.sh')
}

function memorySettingsPath(accountDir: string): string {
  return join(nestDir(accountDir), 'memory-settings.json')
}

function claudeJsonPath(accountDir: string): string {
  return join(accountDir, '.claude.json')
}

/**
 * Generates the platform wrapper script that sets ELECTRON_RUN_AS_NODE=1 and execs the
 * shim. A wrapper avoids relying on shell-specific inline env-var syntax (`VAR=x cmd` on
 * POSIX vs `set VAR=x && cmd` / `$env:VAR=x; cmd` on Windows) inside the hook "command"
 * string that Claude Code's hook runner executes.
 */
// Atomic write (tmp + rename) for every file this module owns — house pattern from
// session-store.ts/local-paths-store.ts (docs/GUIA-TESTEO-BAUTISTA.md). A per-call
// random tmp suffix avoids two concurrent provision calls (e.g. AccountStore.save() and
// a PtyManager.create() self-heal racing) clobbering each other's in-flight write.
export function writeFileAtomic(path: string, content: string, mode?: number): void {
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  writeFileSync(tmp, content, mode !== undefined ? { mode } : undefined)
  renameSync(tmp, path)
}

/** Exported for reuse by other AI adapters (e.g. memory-provisioner-gemini.ts) — the
 *  wrapper script itself is AI-agnostic (execs the shim with `ELECTRON_RUN_AS_NODE=1`)
 *  and lives at `{accountDir}/.nest/`, which never collides across AI types because
 *  accountDir already encodes the AI type (`accounts/{aiType}/{name}`). */
export function writeWrapperScript(accountDir: string, paths: ProvisionerPaths, isWin: boolean): string {
  const dir = nestDir(accountDir)
  mkdirSync(dir, { recursive: true })
  const target = wrapperPath(accountDir, isWin)
  if (isWin) {
    const content = `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${paths.execPath}" "${paths.shimPath}" %*\r\n`
    writeFileAtomic(target, content)
  } else {
    const content = `#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec "${paths.execPath}" "${paths.shimPath}" "$@"\n`
    writeFileAtomic(target, content, 0o755)
  }
  return target
}

export interface JsonFile {
  [key: string]: unknown
}

/**
 * `.claude.json` is NOT a file this module owns exclusively — it's Claude Code's own
 * config (auth, project trust, other MCP servers a user configured by hand). A naive
 * "catch parse error -> default to {}" here is exactly the pitfall
 * docs/GUIA-TESTEO-BAUTISTA.md warns about: "un archivo que no parsea se reemplaza
 * entero en silencio" — a transient read (e.g. Claude Code itself mid-write) would
 * silently nuke the user's real config down to just our mcpServers.nest_memory entry
 * on the very next provision call. Missing file (ENOENT) is the normal "nothing here
 * yet" case and defaults to {}; any OTHER read/parse failure throws instead of
 * defaulting, so the caller's provisioning attempt aborts for this cycle rather than
 * clobbering. account-store.ts already wraps every provision call in try/catch and
 * logs — provisioning simply retries on the next PtyManager.create() (M11), so
 * aborting here costs nothing but safety.
 */
export function readJsonOrThrow(path: string): JsonFile {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }
  const parsed = JSON.parse(raw) // throws on malformed JSON — caller must not swallow this
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${path} did not contain a JSON object`)
  }
  return parsed as JsonFile
}

export function writeJson(path: string, data: JsonFile): void {
  writeFileAtomic(path, `${JSON.stringify(data, null, 2)}\n`)
}

/** Idempotent: writes mcpServers.nest_memory into {accountDir}/.claude.json. */
function provisionMcpConfig(accountDir: string, paths: ProvisionerPaths): void {
  const path = claudeJsonPath(accountDir)
  const config = readJsonOrThrow(path)
  const mcpServers = (config.mcpServers as JsonFile) ?? {}
  mcpServers.nest_memory = {
    command: paths.execPath,
    args: [paths.shimPath],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  }
  config.mcpServers = mcpServers
  writeJson(path, config)
}

function deprovisionMcpConfig(accountDir: string): void {
  const path = claudeJsonPath(accountDir)
  if (!existsSync(path)) return
  const config = readJsonOrThrow(path)
  const mcpServers = (config.mcpServers as JsonFile) ?? {}
  if ('nest_memory' in mcpServers) {
    delete mcpServers.nest_memory
    config.mcpServers = mcpServers
    writeJson(path, config)
  }
}

/** Idempotent: writes the Nest-owned hooks block into {accountDir}/.nest/memory-settings.json. */
function provisionHooks(accountDir: string, wrapper: string): void {
  const hooks: JsonFile = {}
  for (const event of HOOK_EVENTS) {
    const hookName = event === 'SessionStart' ? 'session-start' : event === 'Stop' ? 'stop' : 'pre-compact'
    hooks[event] = [
      {
        matcher: '',
        hooks: [{ type: 'command', command: `"${wrapper}" hook ${hookName}`, timeout: 5 }],
      },
    ]
  }
  const settings: JsonFile = { _nest: NEST_MARKER, hooks }
  writeJson(memorySettingsPath(accountDir), settings)
}

/**
 * Provisions Nest Memory for one Claude account: MCP config + isolated hooks settings
 * file + platform wrapper script. Never touches {accountDir}/.claude/settings.json.
 * Safe to call repeatedly (idempotent) — called from AccountStore.save(),
 * migrateClaudeAccounts() (startup), and defensively from PtyManager.create().
 */
export function provisionClaudeAccount(accountDir: string, paths: ProvisionerPaths, isWin: boolean): { settingsFlagPath: string } {
  mkdirSync(accountDir, { recursive: true })
  const wrapper = writeWrapperScript(accountDir, paths, isWin)
  provisionMcpConfig(accountDir, paths)
  provisionHooks(accountDir, wrapper)
  return { settingsFlagPath: memorySettingsPath(accountDir) }
}

/**
 * Reverses provisioning: removes mcpServers.nest_memory, deletes {accountDir}/.nest/
 * (which holds only Nest-owned files — the wrapper script and memory-settings.json,
 * both created exclusively by this module). Leaves everything else in the account
 * untouched, including the symlinked/hardlinked .claude/settings.json.
 */
export function deprovisionClaudeAccount(accountDir: string): void {
  deprovisionMcpConfig(accountDir)
  const dir = nestDir(accountDir)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}

/** Returns `['--settings', '<path>']` to append to the claude launch command, or `[]` if not provisioned. */
export function claudeSettingsFlagArgs(accountDir: string): string[] {
  const path = memorySettingsPath(accountDir)
  return existsSync(path) ? ['--settings', path] : []
}

export function isClaudeAccountProvisioned(accountDir: string): boolean {
  return existsSync(memorySettingsPath(accountDir))
}
