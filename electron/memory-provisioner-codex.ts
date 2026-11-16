// Codex CLI memory provisioning (docs/nest-memory-architecture.md §2.5, §9).
//
// Deliberately a separate file from memory-provisioner.ts, same reason that file's own
// header and memory-provisioner-gemini.ts's header give: no shared-config hazard applies
// here that would require special handling in the Claude module.
//
// -----------------------------------------------------------------------------------------
// DESIGN NOTE — how this diverges from both Claude and Gemini, and why.
//
// docs/nest-memory-architecture.md §2.5 lists `codex` -> `{accountDir}/.codex/config.toml`,
// implying HOME-based resolution like Claude. That row is WRONG on Windows: Codex ignores
// HOME/USERPROFILE entirely for
// locating its config; only the explicit CODEX_HOME env var redirects it. That makes Codex
// closer to Gemini's GEMINI_CLI_HOME (an explicit env var is the only isolation lever) than
// to Claude's implicit HOME resolution.
//
// UNLIKE Gemini, though, there is no pre-existing Codex identity home for Nest to collide
// with: pty-manager.ts never sets CODEX_HOME anywhere. So this module CAN do what Gemini's
// module explicitly could NOT: mint a brand-new, 100%-Nest-owned home at
// `{accountDir}/.nest/codex-home`, and
// have provision()/deprovision() treat config.toml as fully owned (overwrite wholesale,
// delete wholesale) — no surgical merge needed, same simplicity as Claude's `.nest/`.
//
// TRAP: with HOME/USERPROFILE pointed at a tmp dir, `codex mcp add` still writes to the
// user's REAL `~/.codex/config.toml`. CODEX_HOME must always be passed as an explicit env var
// override, never inferred from HOME.
//
// TOML FORMAT: Codex's own `mcp add` generates `command`/`args` as TOML LITERAL strings
// (single-quoted) rather than basic strings, presumably because that needs no escaping for
// Windows backslash paths. A hooks block with basic (double-quoted) strings and manually
// escaped backslashes is rejected outright by `codex doctor` ("config could not be loaded"),
// so every path-bearing hook `command` is a TOML literal string as well.
import { existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { writeFileAtomic, writeWrapperScript, type ProvisionerPaths } from './memory-provisioner'

const HOOK_EVENTS: Array<{ toml: string; hookName: string; matcher?: string }> = [
  { toml: 'SessionStart', hookName: 'session-start', matcher: 'startup|resume' },
  { toml: 'Stop', hookName: 'stop' },
  { toml: 'PreCompact', hookName: 'pre-compact' },
]

/**
 * TOML literal string (single-quoted) — no escape processing at all, which is exactly why
 * Codex's own `mcp add` emits `command`/`args` this way for Windows paths. ONLY safe for
 * values that can never contain a literal `'` or a newline/control character — true here
 * because every caller passes either a path this module itself generated
 * (paths.execPath/paths.shimPath/wrapper, all from writeWrapperScript/ProvisionerPaths) or
 * a short fixed hook-invocation string built from those same paths. Never pass user input.
 */
function tomlLiteral(value: string): string {
  return `'${value}'`
}

/** Codex's per-Nest-account isolated home — see file header for why this is a NEW home
 *  (unlike Gemini's reuse of an existing identity home) and why CODEX_HOME must be passed
 *  explicitly rather than relying on HOME/USERPROFILE (Codex ignores both). */
function codexHomeDir(accountDir: string): string {
  return join(accountDir, '.nest', 'codex-home')
}

function configTomlPath(accountDir: string): string {
  return join(codexHomeDir(accountDir), 'config.toml')
}

function buildConfigToml(paths: ProvisionerPaths, wrapper: string): string {
  const lines: string[] = []
  lines.push('[mcp_servers.nest_memory]')
  lines.push(`command = ${tomlLiteral(paths.execPath)}`)
  lines.push(`args = [${tomlLiteral(paths.shimPath)}]`)
  lines.push('')
  lines.push('[mcp_servers.nest_memory.env]')
  lines.push('ELECTRON_RUN_AS_NODE = "1"')
  for (const { toml, hookName, matcher } of HOOK_EVENTS) {
    lines.push('')
    lines.push(`[[hooks.${toml}]]`)
    if (matcher) lines.push(`matcher = "${matcher}"`)
    lines.push('')
    lines.push(`[[hooks.${toml}.hooks]]`)
    lines.push('type = "command"')
    lines.push(`command = ${tomlLiteral(`"${wrapper}" hook ${hookName}`)}`)
    lines.push('timeout = 5')
  }
  return lines.join('\n') + '\n'
}

/** A root-level (interactive CLI) option, not only a `codex exec` one. Always included
 *  alongside CODEX_HOME, mirroring how Claude's adapter only adds `--settings` when memory
 *  provisioning ran. */
const BYPASS_HOOK_TRUST_ARGS = ['--dangerously-bypass-hook-trust']

/**
 * Provisions Nest Memory for one Codex account: a brand-new, Nest-exclusive CODEX_HOME
 * (`{accountDir}/.nest/codex-home`) containing mcp_servers.nest_memory + the 3 mapped hooks,
 * plus the platform wrapper script. Safe to call repeatedly — config.toml is fully
 * Nest-owned here (unlike Gemini's shared settings.json), so each call simply overwrites it
 * whole, same as Claude's memory-settings.json. Returns the CODEX_HOME env override plus
 * `--dangerously-bypass-hook-trust`, both of which PtyManager must inject for every codex
 * spawn while memory is enabled.
 */
export function provisionCodexAccount(
  accountDir: string,
  paths: ProvisionerPaths,
  isWin: boolean,
): { env: Record<string, string>; args: string[] } {
  const codexHome = codexHomeDir(accountDir)
  mkdirSync(codexHome, { recursive: true })
  const wrapper = writeWrapperScript(accountDir, paths, isWin)
  writeFileAtomic(configTomlPath(accountDir), buildConfigToml(paths, wrapper))
  return { env: { CODEX_HOME: codexHome }, args: [...BYPASS_HOOK_TRUST_ARGS] }
}

/**
 * Reverses provisioning: deletes `{accountDir}/.nest` entirely (wrapper script + the whole
 * codex-home, config.toml included) — safe because that directory holds only Nest-authored
 * files for this accountDir, same guarantee Claude's deprovision relies on. Unlike Gemini's
 * deprovision, there is no surgical merge to do: nothing outside `.nest/` was ever touched.
 */
export function deprovisionCodexAccount(accountDir: string): void {
  const dir = join(accountDir, '.nest')
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}

export function isCodexAccountProvisioned(accountDir: string): boolean {
  return existsSync(configTomlPath(accountDir))
}
