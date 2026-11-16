# opencode Memory MCP Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `opencode` into Nest Memory's existing MCP server (`memory_search`, `memory_promote`, etc.) by writing an `mcp.nest_memory` entry into that account's `opencode.jsonc`, the same way Claude/Gemini/Codex/qwen already get their MCP config.

**Architecture:** A new provisioner module (`electron/memory-provisioner-opencode.ts`) mirrors the shape of `memory-provisioner-gemini.ts`/`memory-provisioner-qwen.ts` (idempotent provision/deprovision/isProvisioned, non-destructive merge into a file that isn't Nest-exclusive), but edits `opencode.jsonc` — a JSONC file with comments — via `jsonc-parser`'s text-level `modify()`/`applyEdits()` instead of the `JSON.parse`→mutate→`JSON.stringify()` the other provisioners use. It registers as a fourth-ish entry (`opencodeAdapter`) in the existing `memory-cli-adapters.ts` registry. No isolated identity home or CLI flags/env override needed — `pty-manager.ts` already redirects `HOME`/`USERPROFILE` to `accountDir` for every AI pane, and Task 6 Step 4 confirmed that alone isolates opencode's entire config root.

**Tech Stack:** TypeScript, Vitest, `jsonc-parser` (new dependency), Node `fs`.

**Spec:** `docs/superpowers/specs/2026-09-07-opencode-memory-mcp-design.md`

## Global Constraints

- Scope is MCP only. Hooks (`SessionStart`/`Stop`/`PreCompact` equivalents via opencode's embedded JS plugin system) are explicitly out of scope — do not add them in this plan.
- `opencode.jsonc` is never Nest-exclusive: never delete the file, never overwrite unrelated keys, never strip comments outside the `mcp.nest_memory` path.
- On genuine corruption (parse errors beyond the comments/trailing-commas JSONC always tolerates), provisioning must throw and leave the file untouched — never silently replace it with a fresh document.
- The MCP entry shape is exactly `{ type: 'local', command: [execPath, shimPath], environment: { ELECTRON_RUN_AS_NODE: '1' } }` under `mcp.nest_memory` — not `mcpServers`, not separate `command`/`args` fields (that's gemini/qwen/claude's shape, not opencode's).
- `provisionOpencodeAccount()` returns `{}` — no `args`, no `env`. opencode needs neither a CLI flag nor an environment override to pick up its own `mcp` config.
- Every new/changed file must pass `npx tsc -b` (see this repo's `CLAUDE.md` for why plain `tsc --noEmit` is useless here) and `npm test`, with `npm run native:node` run first and `npm run native:electron` run after, per this repo's better-sqlite3 binding gotcha.

---

### Task 1: `provisionOpencodeAccount` — happy path (create, idempotency, non-destructive merge, comment preservation)

**Files:**
- Modify: `package.json` (add `jsonc-parser` dependency)
- Create: `electron/memory-provisioner-opencode.ts`
- Create: `electron/__tests__/memory-provisioner-opencode.test.ts`

**Interfaces:**
- Produces: `provisionOpencodeAccount(accountDir: string, paths: ProvisionerPaths, isWin: boolean): { args?: string[]; env?: Record<string, string> }` — `ProvisionerPaths` is the existing type from `electron/memory-provisioner.ts` (`{ execPath: string; shimPath: string }`).
- Consumes: `writeFileAtomic(path: string, content: string, mode?: number): void` from `electron/memory-provisioner.ts` (already exported, used by every other provisioner for atomic writes).

- [ ] **Step 1: Install the new dependency**

Run: `npm install jsonc-parser`

This adds `jsonc-parser` to `dependencies` in `package.json` (it runs inside Electron's main process in production, not just in tests, so it must not land in `devDependencies`) and updates `package-lock.json`.

- [ ] **Step 2: Write the failing tests**

Create `electron/__tests__/memory-provisioner-opencode.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { makeTmpDir, cleanupTmp } from './setup'
import { provisionOpencodeAccount } from '../memory-provisioner-opencode'

// opencode needs no isolated identity home like Gemini's GEMINI_CLI_HOME: pty-manager.ts
// already redirects HOME/USERPROFILE to accountDir for every AI pane, and opencode resolves
// its config at os.homedir()/.config/opencode/opencode.jsonc — so
// accountDir/.config/opencode/opencode.jsonc IS opencode's real config file for this
// account (same non-exclusive-file principle as Gemini's and qwen's settings.json).
describe('memory-provisioner-opencode', () => {
  let home: string
  let accountDir: string
  let configPath: string

  const paths = { execPath: 'C:/fake/electron.exe', shimPath: 'C:/fake/dist-electron/memory-mcp.js' }

  beforeEach(() => {
    home = makeTmpDir('raven-provisioner-opencode-')
    accountDir = join(home, 'accounts', 'opencode', 'Bautista')
    mkdirSync(accountDir, { recursive: true })
    configPath = join(accountDir, '.config', 'opencode', 'opencode.jsonc')
  })

  afterEach(() => cleanupTmp(home))

  it('writes mcp.nest_memory into accountDir/.config/opencode/opencode.jsonc when the file does not exist yet', () => {
    const result = provisionOpencodeAccount(accountDir, paths, true)

    expect(existsSync(configPath)).toBe(true)
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(parsed.mcp.nest_memory).toEqual({
      type: 'local',
      command: [paths.execPath, paths.shimPath],
      environment: { ELECTRON_RUN_AS_NODE: '1' },
    })
    // Unlike Gemini/Codex, opencode needs no CLI flags or env override — HOME redirection
    // (already generic in pty-manager.ts) is the only isolation lever it needs.
    expect(result.args).toBeUndefined()
    expect(result.env).toBeUndefined()
  })

  it('is idempotent — provisioning twice does not duplicate or corrupt the entry', () => {
    provisionOpencodeAccount(accountDir, paths, true)
    provisionOpencodeAccount(accountDir, paths, true)

    const parsed = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(Object.keys(parsed.mcp)).toEqual(['nest_memory'])
  })

  it('preserves other keys and other mcp servers already in the file', () => {
    mkdirSync(join(accountDir, '.config', 'opencode'), { recursive: true })
    writeFileSync(
      configPath,
      JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        username: 'gerod',
        mcp: { other_server: { type: 'local', command: ['foo'] } },
      }),
    )

    provisionOpencodeAccount(accountDir, paths, true)

    const parsed = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(parsed.username).toBe('gerod')
    expect(parsed.mcp.other_server).toEqual({ type: 'local', command: ['foo'] })
    expect(parsed.mcp.nest_memory).toBeDefined()
  })

  it('preserves a real // comment in the file — the reason this module uses jsonc-parser instead of JSON.parse/stringify', () => {
    mkdirSync(join(accountDir, '.config', 'opencode'), { recursive: true })
    writeFileSync(configPath, '{\n  // my own note about this config\n  "username": "gerod"\n}\n')

    provisionOpencodeAccount(accountDir, paths, true)

    const raw = readFileSync(configPath, 'utf8')
    expect(raw).toContain('// my own note about this config')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run native:node && npx vitest run electron/__tests__/memory-provisioner-opencode.test.ts`

Expected: FAIL — `Cannot find module '../memory-provisioner-opencode'`. This is the correct failure reason (the module doesn't exist yet), the same shape of RED already used for `memory-provisioner-qwen.ts` in this same worktree.

- [ ] **Step 4: Write the minimal implementation**

Create `electron/memory-provisioner-opencode.ts`:

```typescript
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run electron/__tests__/memory-provisioner-opencode.test.ts`

Expected: PASS, all 4 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json electron/memory-provisioner-opencode.ts electron/__tests__/memory-provisioner-opencode.test.ts
git commit -m "feat(memory): opencode adapter — provision writes mcp.nest_memory into opencode.jsonc"
```

---

### Task 2: `deprovisionOpencodeAccount` and `isOpencodeAccountProvisioned`

**Files:**
- Modify: `electron/memory-provisioner-opencode.ts`
- Modify: `electron/__tests__/memory-provisioner-opencode.test.ts`

**Interfaces:**
- Consumes: `opencodeConfigPath`, `readConfigText` (private helpers already in the module from Task 1 — not exported, but this task's code lives in the same file and can call them directly).
- Produces: `deprovisionOpencodeAccount(accountDir: string): void`, `isOpencodeAccountProvisioned(accountDir: string): boolean`.

- [ ] **Step 1: Write the failing tests**

In `electron/__tests__/memory-provisioner-opencode.test.ts`, change the import line to:

```typescript
import { provisionOpencodeAccount, deprovisionOpencodeAccount, isOpencodeAccountProvisioned } from '../memory-provisioner-opencode'
```

(This task also adds a test seeding a `$schema` URL, on purpose — real `opencode.jsonc` files contain `"$schema": "https://opencode.ai/config.json"`, and a naive comment-stripping regex would mistake that `//` for a comment start and corrupt the parse. `isOpencodeAccountProvisioned`'s implementation below uses `jsonc-parser`'s own `parse()` specifically to avoid that trap.)

Then add these tests inside the existing `describe('memory-provisioner-opencode', ...)` block, after the last `it(...)` from Task 1:

```typescript
  it('deprovision removes mcp.nest_memory but preserves other keys and other mcp servers', () => {
    mkdirSync(join(accountDir, '.config', 'opencode'), { recursive: true })
    writeFileSync(
      configPath,
      JSON.stringify({
        username: 'gerod',
        mcp: { other_server: { type: 'local', command: ['foo'] } },
      }),
    )
    provisionOpencodeAccount(accountDir, paths, true)

    deprovisionOpencodeAccount(accountDir)

    expect(existsSync(configPath)).toBe(true) // file itself survives — it's not Nest-exclusive
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(parsed.username).toBe('gerod')
    expect(parsed.mcp.other_server).toEqual({ type: 'local', command: ['foo'] })
    expect(parsed.mcp.nest_memory).toBeUndefined()
  })

  it('deprovision preserves a real // comment in the file', () => {
    mkdirSync(join(accountDir, '.config', 'opencode'), { recursive: true })
    writeFileSync(configPath, '{\n  // my own note about this config\n  "username": "gerod"\n}\n')
    provisionOpencodeAccount(accountDir, paths, true)

    deprovisionOpencodeAccount(accountDir)

    const raw = readFileSync(configPath, 'utf8')
    expect(raw).toContain('// my own note about this config')
  })

  it('deprovision is a no-op (does not throw, does not create the file) when nothing was ever provisioned', () => {
    expect(() => deprovisionOpencodeAccount(accountDir)).not.toThrow()
    expect(existsSync(configPath)).toBe(false)
  })

  it('isOpencodeAccountProvisioned reflects provision/deprovision state', () => {
    expect(isOpencodeAccountProvisioned(accountDir)).toBe(false)
    provisionOpencodeAccount(accountDir, paths, true)
    expect(isOpencodeAccountProvisioned(accountDir)).toBe(true)
    deprovisionOpencodeAccount(accountDir)
    expect(isOpencodeAccountProvisioned(accountDir)).toBe(false)
  })

  it('isOpencodeAccountProvisioned is not fooled by a real $schema URL containing //', () => {
    mkdirSync(join(accountDir, '.config', 'opencode'), { recursive: true })
    writeFileSync(configPath, JSON.stringify({ $schema: 'https://opencode.ai/config.json' }))

    expect(isOpencodeAccountProvisioned(accountDir)).toBe(false)
    provisionOpencodeAccount(accountDir, paths, true)
    expect(isOpencodeAccountProvisioned(accountDir)).toBe(true)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run electron/__tests__/memory-provisioner-opencode.test.ts`

Expected: FAIL — `deprovisionOpencodeAccount`/`isOpencodeAccountProvisioned` are not exported by `../memory-provisioner-opencode` yet (the import itself errors).

- [ ] **Step 3: Write the minimal implementation**

In `electron/memory-provisioner-opencode.ts`, change the import line to also bring in `parse`:

```typescript
import { modify, applyEdits, parse } from 'jsonc-parser'
```

Then add at the end of the file:

```typescript
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

  const text = readConfigText(configPath)
  const edits = modify(text, ['mcp', 'nest_memory'], undefined, { formattingOptions: FORMATTING })
  writeFileAtomic(configPath, applyEdits(text, edits))
}

export function isOpencodeAccountProvisioned(accountDir: string): boolean {
  const configPath = opencodeConfigPath(accountDir)
  if (!existsSync(configPath)) return false
  try {
    // jsonc-parser's own parse() — never a hand-rolled comment-stripping regex, which would
    // mistake a real value like "https://opencode.ai/config.json" for a `//` comment start.
    const parsed = parse(readFileSync(configPath, 'utf8'))
    return !!parsed?.mcp?.nest_memory
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run electron/__tests__/memory-provisioner-opencode.test.ts`

Expected: PASS, all 9 tests.

- [ ] **Step 5: Commit**

```bash
git add electron/memory-provisioner-opencode.ts electron/__tests__/memory-provisioner-opencode.test.ts
git commit -m "feat(memory): opencode adapter — deprovision + isOpencodeAccountProvisioned"
```

---

### Task 3: Corruption safety — never overwrite a genuinely broken `opencode.jsonc`

**Files:**
- Modify: `electron/memory-provisioner-opencode.ts`
- Modify: `electron/__tests__/memory-provisioner-opencode.test.ts`

**Interfaces:**
- `readConfigText` (Task 1's private helper) is renamed to `readConfigTextOrThrow` and gains corruption detection. Its call sites (`provisionOpencodeAccount`, `deprovisionOpencodeAccount`) are updated to the new name — no signature change, so no other file is affected.

- [ ] **Step 1: Write the failing tests**

Add to `electron/__tests__/memory-provisioner-opencode.test.ts`, inside the same `describe` block:

```typescript
  it('provision throws instead of overwriting when opencode.jsonc is genuinely corrupted (not just JSONC comments/trailing commas)', () => {
    mkdirSync(join(accountDir, '.config', 'opencode'), { recursive: true })
    writeFileSync(configPath, '{ this is not valid json or jsonc at all ][')

    expect(() => provisionOpencodeAccount(accountDir, paths, true)).toThrow()
    // The corrupted content must survive untouched — never silently replaced with a fresh document.
    expect(readFileSync(configPath, 'utf8')).toBe('{ this is not valid json or jsonc at all ][')
  })

  it('provision does NOT throw for valid JSONC quirks — comments and trailing commas', () => {
    mkdirSync(join(accountDir, '.config', 'opencode'), { recursive: true })
    writeFileSync(configPath, '{\n  // a comment\n  "username": "gerod",\n}\n')

    expect(() => provisionOpencodeAccount(accountDir, paths, true)).not.toThrow()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run electron/__tests__/memory-provisioner-opencode.test.ts`

Expected: FAIL on the first new test — `readConfigText` currently returns the corrupted text as-is with no validation, so `modify()`/`applyEdits()` run against it without throwing (jsonc-parser's `modify` degrades gracefully on unparseable text instead of raising), and the `expect(...).toThrow()` assertion fails. The second new test should already pass (comments/trailing commas were never a problem) — confirm it does; if it doesn't, stop and re-check the JSONC snippet before continuing.

- [ ] **Step 3: Write the minimal implementation**

In `electron/memory-provisioner-opencode.ts`:

1. Change the import line (already has `parse` since Task 2) to also bring in the `ParseError` type:

```typescript
import { modify, applyEdits, parse, type ParseError } from 'jsonc-parser'
```

2. Replace the `readConfigText` function with:

```typescript
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
  const errors: ParseError[] = []
  parse(raw, errors, { allowTrailingComma: true })
  if (errors.length > 0) {
    throw new Error(`${configPath} is not valid JSONC (error code ${errors[0].error} at offset ${errors[0].offset})`)
  }
  return raw
}
```

3. In `provisionOpencodeAccount` and `deprovisionOpencodeAccount`, replace the two calls to `readConfigText(configPath)` with `readConfigTextOrThrow(configPath)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run electron/__tests__/memory-provisioner-opencode.test.ts`

Expected: PASS, all 11 tests.

- [ ] **Step 5: Commit**

```bash
git add electron/memory-provisioner-opencode.ts electron/__tests__/memory-provisioner-opencode.test.ts
git commit -m "fix(memory): opencode adapter — never overwrite a genuinely corrupted opencode.jsonc"
```

---

### Task 4: Register the adapter in `memory-cli-adapters.ts`

**Files:**
- Modify: `electron/memory-cli-adapters.ts`
- Modify: `electron/__tests__/memory-provisioner-opencode.test.ts`

**Interfaces:**
- Consumes: `AiMemoryAdapter` type, `ADAPTERS` registry, `adapterForAiType`/`adapterForBin` (all already in `electron/memory-cli-adapters.ts`); `provisionOpencodeAccount`/`deprovisionOpencodeAccount` from Task 1/2.
- Produces: `opencodeAdapter: AiMemoryAdapter` registered under `aiType: 'opencode'`, `binNames: ['opencode']`.

- [ ] **Step 1: Write the failing tests**

In `electron/__tests__/memory-provisioner-opencode.test.ts`, add this import at the top:

```typescript
import { adapterForAiType, adapterForBin } from '../memory-cli-adapters'
```

Then add these tests inside the `describe` block:

```typescript
  it('is registered in the adapter registry by aiType and by bin name', () => {
    expect(adapterForAiType('opencode')?.aiType).toBe('opencode')
    expect(adapterForBin('opencode')?.aiType).toBe('opencode')
  })

  it('the adapter.provision() return shape carries neither args nor env', () => {
    const adapter = adapterForAiType('opencode')!
    const result = adapter.provision(accountDir, paths, true)
    expect(result.args).toBeUndefined()
    expect(result.env).toBeUndefined()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run electron/__tests__/memory-provisioner-opencode.test.ts`

Expected: FAIL — `adapterForAiType('opencode')` returns `null` (opencode isn't in the `ADAPTERS` registry yet), so `?.aiType` is `undefined`, not `'opencode'`.

- [ ] **Step 3: Write the minimal implementation**

In `electron/memory-cli-adapters.ts`:

1. Add the import, alongside the existing gemini/codex/qwen imports:

```typescript
import { provisionOpencodeAccount, deprovisionOpencodeAccount } from './memory-provisioner-opencode'
```

2. Add the adapter definition, after `qwenAdapter`:

```typescript
/**
 * Wraps the opencode provisioning functions (memory-provisioner-opencode.ts) the same thin
 * way the others wrap theirs. See that module's header for why opencode needs no isolated
 * identity home or CLI flags/env override — pty-manager.ts's generic HOME/USERPROFILE
 * redirection already isolates it, same as qwen. MCP only in this entry — hooks are a
 * separate, not-yet-built adapter (see the module header and the spec).
 */
const opencodeAdapter: AiMemoryAdapter = {
  aiType: 'opencode',
  binNames: ['opencode'],
  provision(accountDir, paths, isWin) {
    return provisionOpencodeAccount(accountDir, paths, isWin)
  },
  deprovision(accountDir) {
    deprovisionOpencodeAccount(accountDir)
  },
}
```

3. Add it to the `ADAPTERS` registry:

```typescript
const ADAPTERS: Record<string, AiMemoryAdapter> = {
  claude: claudeAdapter,
  gemini: geminiAdapter,
  codex: codexAdapter,
  qwen: qwenAdapter,
  opencode: opencodeAdapter,
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run electron/__tests__/memory-provisioner-opencode.test.ts`

Expected: PASS, all 13 tests.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`

Expected: every test file passes (matches the baseline already established when the qwen adapter was added in this same worktree — 215 files / 2094 tests green, plus the 13 new ones this file's tasks added).

- [ ] **Step 6: Restore the Electron native binding**

Run: `npm run native:electron`

This repo's `better-sqlite3` binding must point at Electron (not Node) for the app itself to launch — `npm test`'s `pretest` hook already swapped it to Node for the test run.

- [ ] **Step 7: Commit**

```bash
git add electron/memory-cli-adapters.ts electron/__tests__/memory-provisioner-opencode.test.ts
git commit -m "feat(memory): opencode adapter — register in the adapter registry"
```

---

## After this plan

MCP retrieval/promotion (`memory_search`, `memory_promote`, etc.) works for opencode accounts. Automatic session capture (hooks) is a separate, not-yet-scoped follow-up — see the spec's §7 for why, and do a live smoke of `session.created`/`session.idle` cardinality before writing that design.
