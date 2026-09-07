// opencode CLI memory provisioning — MCP only
// (docs/superpowers/specs/2026-09-07-opencode-memory-mcp-design.md).
//
// Hooks (session-start/stop/pre-compact) are explicitly out of scope for this module — see
// the spec's §1 and §7. opencode's hook system is a JS plugin embedded in its own process,
// not a stdin/stdout subcommand like Claude/Gemini/qwen, and its event mapping
// (session.created/session.idle) was never verified live.
//
// WHY opencode NEEDS NO ISOLATED IDENTITY HOME: same reasoning as
// memory-provisioner-qwen.ts — Task 6 Step 4 verified HOME/USERPROFILE redirection
// (already generic in pty-manager.ts) is enough to isolate opencode's entire config root
// (os.homedir()/.config/opencode/).
//
// WHY THIS FILE CANNOT REUSE readJsonOrThrow/writeJson FROM memory-provisioner.ts:
// opencode's config file is JSONC (comments allowed), not plain JSON. jsonc-parser's
// modify()/applyEdits() operate on the raw TEXT and preserve everything outside the edited
// path (comments included) — a fundamentally different API shape than
// parse-mutate-stringify. Only writeFileAtomic is reused, for the final write.
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { modify, applyEdits } from 'jsonc-parser'
import { writeFileAtomic, type ProvisionerPaths } from './memory-provisioner'

const FORMATTING = { insertSpaces: true, tabSize: 2 } as const

function opencodeConfigDir(accountDir: string): string {
  return join(accountDir, '.config', 'opencode')
}

function opencodeConfigPath(accountDir: string): string {
  return join(opencodeConfigDir(accountDir), 'opencode.jsonc')
}

/**
 * Reads the raw JSONC text to edit, defaulting to a minimal document ('{}') when the file
 * doesn't exist yet — never an actually-empty string, to avoid depending on whether
 * jsonc-parser's modify() special-cases that (untested, not worth the risk per the spec).
 */
function readConfigText(configPath: string): string {
  return existsSync(configPath) ? readFileSync(configPath, 'utf8') : '{}'
}

/**
 * Provisions Nest Memory for one opencode account: mcp.nest_memory, written into
 * {accountDir}/.config/opencode/opencode.jsonc via a text-level edit that preserves
 * comments and formatting outside that one path. Idempotent by construction — modify() on
 * an object property always replaces the prior value at that key, never duplicates.
 * Returns nothing extra for PtyManager to inject: opencode reads its own mcp config at
 * startup, no CLI flags or env override needed (same as qwen).
 */
export function provisionOpencodeAccount(accountDir: string, paths: ProvisionerPaths, _isWin: boolean): { args?: string[]; env?: Record<string, string> } {
  mkdirSync(opencodeConfigDir(accountDir), { recursive: true })
  const configPath = opencodeConfigPath(accountDir)
  const text = readConfigText(configPath)

  const value = {
    type: 'local',
    command: [paths.execPath, paths.shimPath],
    environment: { ELECTRON_RUN_AS_NODE: '1' },
  }
  const edits = modify(text, ['mcp', 'nest_memory'], value, { formattingOptions: FORMATTING })
  writeFileAtomic(configPath, applyEdits(text, edits))

  return {}
}
