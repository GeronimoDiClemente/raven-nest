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
import { modify, applyEdits, parse, printParseErrorCode, type ParseError } from 'jsonc-parser'
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
 * Throws on genuine corruption (anything beyond the comments/trailing-commas JSONC always
 * tolerates) instead of silently editing on top of broken content — same discipline
 * memory-provisioner.ts's readJsonOrThrow documents for .claude.json, and the same reason:
 * aborting this cycle costs nothing, PtyManager.create() retries provisioning on next launch.
 */
function readConfigTextOrThrow(configPath: string): string {
  if (!existsSync(configPath)) return '{}'
  const raw = readFileSync(configPath, 'utf8')
  // An empty or whitespace-only file (e.g. `touch opencode.jsonc`) is a reasonable starting
  // state, not corruption — jsonc-parser's parse() reports ValueExpected for it same as it
  // would for real corruption, so treat it the same as a missing file before checking further.
  if (raw.trim() === '') return '{}'
  const errors: ParseError[] = []
  const value = parse(raw, errors, { allowTrailingComma: true })
  if (errors.length > 0) {
    throw new Error(
      `${configPath} is not valid JSONC (${printParseErrorCode(errors[0].error)} at offset ${errors[0].offset})`,
    )
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${configPath} did not contain a JSON object`)
  }
  return raw
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
  const text = readConfigTextOrThrow(configPath)

  const value = {
    type: 'local',
    command: [paths.execPath, paths.shimPath],
    environment: { ELECTRON_RUN_AS_NODE: '1' },
  }
  const edits = modify(text, ['mcp', 'nest_memory'], value, { formattingOptions: FORMATTING })
  writeFileAtomic(configPath, applyEdits(text, edits))

  return {}
}

/**
 * Reverses provisioning: removes mcp.nest_memory from opencode.jsonc via the same
 * text-level edit mechanism (passing `undefined` as the value tells jsonc-parser's
 * modify() to generate a removal edit), WITHOUT deleting the file or any other key in it —
 * it is opencode's real config, not a Nest-exclusive file (same principle
 * memory-provisioner-gemini.ts and memory-provisioner-qwen.ts apply to their own files).
 * A no-op (no file created, nothing thrown) when nothing was ever provisioned.
 */
export function deprovisionOpencodeAccount(accountDir: string): void {
  const configPath = opencodeConfigPath(accountDir)
  if (!existsSync(configPath)) return
  // jsonc-parser's modify() throws "Can not delete in empty document" when the PARENT path
  // segment (`mcp`) is missing from the document, not just when the leaf key is missing — so
  // this guard is required for the no-op contract documented above, not just an optimization.
  if (!isOpencodeAccountProvisioned(accountDir)) return

  const text = readConfigTextOrThrow(configPath)
  const edits = modify(text, ['mcp', 'nest_memory'], undefined, { formattingOptions: FORMATTING })
  writeFileAtomic(configPath, applyEdits(text, edits))
}

export function isOpencodeAccountProvisioned(accountDir: string): boolean {
  const configPath = opencodeConfigPath(accountDir)
  if (!existsSync(configPath)) return false
  try {
    // jsonc-parser's own parse() — never a hand-rolled comment-stripping regex, which would
    // mistake a real value like "https://opencode.ai/config.json" for a `//` comment start.
    const parsed = parse(readFileSync(configPath, 'utf8'), [], { allowTrailingComma: true })
    return !!parsed?.mcp?.nest_memory
  } catch {
    return false
  }
}
