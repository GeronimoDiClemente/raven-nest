# Import de configuración de editor (VS Code / IntelliJ) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user import their VS Code or IntelliJ editor preferences (font, tabs, word wrap, theme, etc.) into Nestmux's embedded Monaco editor with one click.

**Architecture:** A declarative mapping registry (pure functions, no IPC) translates VS Code `settings.json` / IntelliJ XML into Monaco's native option shape. A new main-process module (`electron/ide-config-bridge.ts`), separate from the worktree-scoped `fs-bridge.ts`, detects the config on disk and reads it — read-only, never writes back. Results flow through a new `window.ideConfig` IPC namespace into `useUserPreferences`'s `ui_settings.editorOptions` (Supabase-persisted, per-user), which `EditorPane` threads into Monaco's `options`/`theme` props. `SettingsPanel` gets the import UI with a preview-before-apply step.

**Tech Stack:** Existing stack (Electron 33, React 18, TypeScript 5.7 strict, Vitest 4, `@monaco-editor/react`). New dependency: `fast-xml-parser` (IntelliJ config is XML; no XML parser exists in this project yet — lightweight, no native deps).

## Global Constraints

- TypeScript 5.7 strict — no `any`, no implicit any.
- Every IPC handler returns `{ ok: true; ...data } | { ok: false; error: string }` — never throws across the IPC boundary (exact pattern already used by every `fs:*` handler in `electron/main.ts`).
- Never write back to VS Code's or IntelliJ's own config files — read-only import, one direction.
- `ide-config-bridge.ts` must NOT reuse or extend `fs-bridge.ts`'s worktree-scoped `resolveScoped()` — this reads well-known OS paths outside any worktree on purpose; keep it a fully separate module.
- Don't reuse the `DetectedIDE` name from `electron/ide-launcher.ts` (external-IDE-launch feature, unrelated) or the existing `ui_settings.fontSize` field (that's the **terminal's** font size, not the editor's — confirmed via `src/App.tsx:105-207`, wired to xterm.js zoom keybindings, not `EditorPane`).
- Spanish for commit messages and code comments where comments are warranted; UI copy in the app is English-only (matches `docs/GUIA-TESTEO-BAUTISTA.md`'s documented convention).
- Commit after every task.

---

### Task 1: Editor preference types + VS Code mapping registry

**Files:**
- Create: `src/lib/ide-config-mappings.ts`
- Test: `src/__tests__/lib/ide-config-mappings.test.ts`

**Interfaces:**
- Produces: `EditorPreferences` interface, `EditorTheme = 'vs' | 'vs-dark'` type, `parseVSCodeSettings(json: string): { ok: true; options: EditorPreferences; theme?: EditorTheme; unmappedTheme?: string } | { ok: false; error: string }`, `mergeEditorPreferences(base: EditorPreferences, patch: EditorPreferences): EditorPreferences` (handles the nested groups — shallow `Object.assign` would clobber `minimap`/`guides`/`bracketPairColorization`/`stickyScroll` instead of merging their sub-fields).

- [ ] **Step 1: Write the failing test for `parseVSCodeSettings` — flat fields**

```typescript
// src/__tests__/lib/ide-config-mappings.test.ts
import { describe, it, expect } from 'vitest'
import { parseVSCodeSettings } from '../../lib/ide-config-mappings'

describe('parseVSCodeSettings', () => {
  it('maps flat editor.* keys to Monaco options', () => {
    const json = JSON.stringify({
      'editor.fontSize': 16,
      'editor.fontFamily': 'Fira Code',
      'editor.tabSize': 2,
      'editor.insertSpaces': false,
      'editor.wordWrap': 'on',
      'editor.lineNumbers': 'relative',
    })
    const result = parseVSCodeSettings(json)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.options).toMatchObject({
      fontSize: 16,
      fontFamily: 'Fira Code',
      tabSize: 2,
      insertSpaces: false,
      wordWrap: 'on',
      lineNumbers: 'relative',
    })
  })

  it('maps nested dot-groups (minimap, guides) into nested Monaco option objects', () => {
    const json = JSON.stringify({
      'editor.minimap.enabled': false,
      'editor.minimap.scale': 2,
      'editor.guides.indentation': false,
      'editor.bracketPairColorization.enabled': true,
      'editor.stickyScroll.enabled': true,
    })
    const result = parseVSCodeSettings(json)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.options.minimap).toEqual({ enabled: false, scale: 2 })
    expect(result.options.guides).toEqual({ indentation: false })
    expect(result.options.bracketPairColorization).toEqual({ enabled: true })
    expect(result.options.stickyScroll).toEqual({ enabled: true })
  })

  it('maps workbench.colorTheme to a Monaco theme via a dark/light name heuristic', () => {
    const dark = parseVSCodeSettings(JSON.stringify({ 'workbench.colorTheme': 'Dark+ (default dark)' }))
    expect(dark.ok && dark.theme).toBe('vs-dark')

    const light = parseVSCodeSettings(JSON.stringify({ 'workbench.colorTheme': 'Light+ (default light)' }))
    expect(light.ok && light.theme).toBe('vs')

    const unknown = parseVSCodeSettings(JSON.stringify({ 'workbench.colorTheme': 'Monokai Pro Custom' }))
    expect(unknown.ok && unknown.theme).toBeUndefined()
    expect(unknown.ok && unknown.unmappedTheme).toBe('Monokai Pro Custom')
  })

  it('returns an error result for malformed JSON, never throws', () => {
    const result = parseVSCodeSettings('{ not valid json')
    expect(result.ok).toBe(false)
    expect(result.ok || result.error).toContain('JSON')
  })

  it('ignores unknown keys and missing keys without error', () => {
    const result = parseVSCodeSettings(JSON.stringify({ 'some.random.key': 'x' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.options).toEqual({})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/lib/ide-config-mappings.test.ts`
Expected: FAIL — `Cannot find module '../../lib/ide-config-mappings'` (file doesn't exist yet).

- [ ] **Step 3: Write the mapping registry and parser**

```typescript
// src/lib/ide-config-mappings.ts

export interface EditorPreferences {
  fontSize?: number
  fontFamily?: string
  fontWeight?: string
  fontLigatures?: boolean
  lineHeight?: number
  letterSpacing?: number
  tabSize?: number
  insertSpaces?: boolean
  detectIndentation?: boolean
  wordWrap?: 'on' | 'off'
  rulers?: number[]
  renderWhitespace?: 'none' | 'boundary' | 'selection' | 'trailing' | 'all'
  renderLineHighlight?: 'none' | 'gutter' | 'line' | 'all'
  lineNumbers?: 'on' | 'off' | 'relative' | 'interval'
  minimap?: { enabled?: boolean; side?: 'left' | 'right'; scale?: number }
  scrollBeyondLastLine?: boolean
  smoothScrolling?: boolean
  cursorStyle?: 'line' | 'block' | 'underline'
  cursorBlinking?: 'blink' | 'smooth' | 'phase' | 'expand' | 'solid'
  cursorSmoothCaretAnimation?: 'off' | 'explicit' | 'on'
  mouseWheelZoom?: boolean
  matchBrackets?: 'always' | 'near' | 'never'
  bracketPairColorization?: { enabled?: boolean }
  guides?: { indentation?: boolean; bracketPairs?: boolean }
  autoClosingBrackets?: 'always' | 'languageDefined' | 'beforeWhitespace' | 'never'
  quickSuggestions?: boolean
  wordBasedSuggestions?: boolean
  stickyScroll?: { enabled?: boolean }
  colorDecorators?: boolean
}

export type EditorTheme = 'vs' | 'vs-dark'

export type ParseResult =
  | { ok: true; options: EditorPreferences; theme?: EditorTheme; unmappedTheme?: string }
  | { ok: false; error: string }

// NESTED_GROUP_KEYS: which top-level EditorPreferences keys are objects that
// need merging field-by-field rather than being set wholesale by one VS Code
// key. A single VS Code settings.json commonly sets 'editor.minimap.enabled'
// and 'editor.minimap.scale' as two SEPARATE keys — both must land in the
// same `options.minimap` object without one overwriting the other.
type NestedGroupKey = 'minimap' | 'bracketPairColorization' | 'guides' | 'stickyScroll'
const NESTED_GROUP_KEYS: readonly NestedGroupKey[] = ['minimap', 'bracketPairColorization', 'guides', 'stickyScroll']

function setNested(options: EditorPreferences, group: NestedGroupKey, field: string, value: unknown): void {
  const target = (options[group] ??= {} as never)
  ;(target as Record<string, unknown>)[field] = value
}

interface VSCodeMapping {
  vsCodeKey: string
  apply: (options: EditorPreferences, value: unknown) => void
}

const VSCODE_MAPPINGS: VSCodeMapping[] = [
  { vsCodeKey: 'editor.fontSize', apply: (o, v) => { o.fontSize = v as number } },
  { vsCodeKey: 'editor.fontFamily', apply: (o, v) => { o.fontFamily = v as string } },
  { vsCodeKey: 'editor.fontWeight', apply: (o, v) => { o.fontWeight = String(v) } },
  { vsCodeKey: 'editor.fontLigatures', apply: (o, v) => { o.fontLigatures = Boolean(v) } },
  { vsCodeKey: 'editor.lineHeight', apply: (o, v) => { o.lineHeight = v as number } },
  { vsCodeKey: 'editor.letterSpacing', apply: (o, v) => { o.letterSpacing = v as number } },
  { vsCodeKey: 'editor.tabSize', apply: (o, v) => { o.tabSize = v as number } },
  { vsCodeKey: 'editor.insertSpaces', apply: (o, v) => { o.insertSpaces = Boolean(v) } },
  { vsCodeKey: 'editor.detectIndentation', apply: (o, v) => { o.detectIndentation = Boolean(v) } },
  { vsCodeKey: 'editor.wordWrap', apply: (o, v) => { o.wordWrap = v === 'on' ? 'on' : 'off' } },
  { vsCodeKey: 'editor.rulers', apply: (o, v) => { o.rulers = v as number[] } },
  { vsCodeKey: 'editor.renderWhitespace', apply: (o, v) => { o.renderWhitespace = v as EditorPreferences['renderWhitespace'] } },
  { vsCodeKey: 'editor.renderLineHighlight', apply: (o, v) => { o.renderLineHighlight = v as EditorPreferences['renderLineHighlight'] } },
  { vsCodeKey: 'editor.lineNumbers', apply: (o, v) => { o.lineNumbers = v as EditorPreferences['lineNumbers'] } },
  { vsCodeKey: 'editor.minimap.enabled', apply: (o, v) => setNested(o, 'minimap', 'enabled', Boolean(v)) },
  { vsCodeKey: 'editor.minimap.side', apply: (o, v) => setNested(o, 'minimap', 'side', v) },
  { vsCodeKey: 'editor.minimap.scale', apply: (o, v) => setNested(o, 'minimap', 'scale', v) },
  { vsCodeKey: 'editor.scrollBeyondLastLine', apply: (o, v) => { o.scrollBeyondLastLine = Boolean(v) } },
  { vsCodeKey: 'editor.smoothScrolling', apply: (o, v) => { o.smoothScrolling = Boolean(v) } },
  { vsCodeKey: 'editor.cursorStyle', apply: (o, v) => { o.cursorStyle = v as EditorPreferences['cursorStyle'] } },
  { vsCodeKey: 'editor.cursorBlinking', apply: (o, v) => { o.cursorBlinking = v as EditorPreferences['cursorBlinking'] } },
  { vsCodeKey: 'editor.cursorSmoothCaretAnimation', apply: (o, v) => { o.cursorSmoothCaretAnimation = v as EditorPreferences['cursorSmoothCaretAnimation'] } },
  { vsCodeKey: 'editor.mouseWheelZoom', apply: (o, v) => { o.mouseWheelZoom = Boolean(v) } },
  { vsCodeKey: 'editor.matchBrackets', apply: (o, v) => { o.matchBrackets = v as EditorPreferences['matchBrackets'] } },
  { vsCodeKey: 'editor.bracketPairColorization.enabled', apply: (o, v) => setNested(o, 'bracketPairColorization', 'enabled', Boolean(v)) },
  { vsCodeKey: 'editor.guides.indentation', apply: (o, v) => setNested(o, 'guides', 'indentation', Boolean(v)) },
  { vsCodeKey: 'editor.guides.bracketPairs', apply: (o, v) => setNested(o, 'guides', 'bracketPairs', Boolean(v)) },
  { vsCodeKey: 'editor.autoClosingBrackets', apply: (o, v) => { o.autoClosingBrackets = v as EditorPreferences['autoClosingBrackets'] } },
  { vsCodeKey: 'editor.quickSuggestions', apply: (o, v) => { o.quickSuggestions = Boolean(v) } },
  { vsCodeKey: 'editor.wordBasedSuggestions', apply: (o, v) => { o.wordBasedSuggestions = v !== 'off' } },
  { vsCodeKey: 'editor.stickyScroll.enabled', apply: (o, v) => setNested(o, 'stickyScroll', 'enabled', Boolean(v)) },
  { vsCodeKey: 'editor.colorDecorators', apply: (o, v) => { o.colorDecorators = Boolean(v) } },
]

function themeFromName(name: string): EditorTheme | undefined {
  const lower = name.toLowerCase()
  if (lower.includes('dark') || lower.includes('darcula') || lower.includes('black')) return 'vs-dark'
  if (lower.includes('light')) return 'vs'
  return undefined
}

export function parseVSCodeSettings(json: string): ParseResult {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(json)
  } catch (err) {
    return { ok: false, error: `No pudimos leer tu configuración: JSON inválido (${err instanceof Error ? err.message : String(err)})` }
  }

  const options: EditorPreferences = {}
  for (const mapping of VSCODE_MAPPINGS) {
    if (Object.prototype.hasOwnProperty.call(raw, mapping.vsCodeKey)) {
      mapping.apply(options, raw[mapping.vsCodeKey])
    }
  }

  const themeName = raw['workbench.colorTheme']
  if (typeof themeName === 'string') {
    const theme = themeFromName(themeName)
    return theme ? { ok: true, options, theme } : { ok: true, options, unmappedTheme: themeName }
  }

  return { ok: true, options }
}

export function mergeEditorPreferences(base: EditorPreferences, patch: EditorPreferences): EditorPreferences {
  const merged: EditorPreferences = { ...base, ...patch }
  for (const key of NESTED_GROUP_KEYS) {
    if (base[key] || patch[key]) {
      merged[key] = { ...(base[key] as object | undefined), ...(patch[key] as object | undefined) } as never
    }
  }
  return merged
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/lib/ide-config-mappings.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/ide-config-mappings.ts src/__tests__/lib/ide-config-mappings.test.ts
git commit -m "feat(editor): registro de mapeo VS Code -> opciones de Monaco"
```

---

### Task 2: IntelliJ XML mapping + parser

**Files:**
- Modify: `src/lib/ide-config-mappings.ts` (add IntelliJ parsing alongside Task 1's VS Code parsing)
- Modify: `src/__tests__/lib/ide-config-mappings.test.ts`
- Modify: `package.json` (add `fast-xml-parser` dependency)

**Interfaces:**
- Consumes: `EditorPreferences`, `EditorTheme`, `mergeEditorPreferences` from Task 1.
- Produces: `parseIntelliJConfig(editorXml: string, codeStyleXml: string | null): ParseResult` (same `ParseResult` shape as `parseVSCodeSettings` — one uniform return type for both IDEs, consumed identically by later tasks).

- [ ] **Step 1: Install the XML parser**

Run: `npm install fast-xml-parser`

- [ ] **Step 2: Write the failing test**

```typescript
// append to src/__tests__/lib/ide-config-mappings.test.ts
import { parseIntelliJConfig } from '../../lib/ide-config-mappings'

describe('parseIntelliJConfig', () => {
  const EDITOR_XML = `<application>
    <component name="EditorSettings">
      <option name="FONT_SIZE" value="15" />
      <option name="FONT_FAMILY" value="JetBrains Mono" />
      <option name="USE_SOFT_WRAPS" value="true" />
      <option name="LINE_NUMBERS_SHOWN" value="false" />
    </component>
  </application>`

  const CODE_STYLE_XML = `<code_scheme name="Project">
    <option name="TAB_SIZE" value="4" />
    <option name="USE_TAB_CHARACTER" value="false" />
  </code_scheme>`

  it('maps editor.xml + code style scheme fields to Monaco options', () => {
    const result = parseIntelliJConfig(EDITOR_XML, CODE_STYLE_XML)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.options).toMatchObject({
      fontSize: 15,
      fontFamily: 'JetBrains Mono',
      wordWrap: 'on',
      lineNumbers: 'off',
      tabSize: 4,
      insertSpaces: true,
    })
  })

  it('works with editor.xml alone when no code style scheme is available', () => {
    const result = parseIntelliJConfig(EDITOR_XML, null)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.options.fontSize).toBe(15)
    expect(result.options.tabSize).toBeUndefined()
  })

  it('returns an error result for malformed XML, never throws', () => {
    const result = parseIntelliJConfig('<application><unclosed>', null)
    expect(result.ok).toBe(false)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/__tests__/lib/ide-config-mappings.test.ts`
Expected: FAIL — `parseIntelliJConfig is not a function`.

- [ ] **Step 4: Implement the IntelliJ parser**

```typescript
// append to src/lib/ide-config-mappings.ts
import { XMLParser } from 'fast-xml-parser'

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' })

function findOptions(node: unknown): Array<{ name: string; value: string }> {
  // IntelliJ XML represents each setting as <option name="X" value="Y" />.
  // fast-xml-parser (attributeNamePrefix: '') turns that into
  // { name: 'X', value: 'Y' } objects, either a single object or an array
  // when there's more than one <option> under the same parent.
  const found: Array<{ name: string; value: string }> = []
  const visit = (n: unknown): void => {
    if (Array.isArray(n)) { n.forEach(visit); return }
    if (n && typeof n === 'object') {
      const obj = n as Record<string, unknown>
      if (typeof obj.name === 'string' && typeof obj.value === 'string') {
        found.push({ name: obj.name, value: obj.value })
      }
      for (const v of Object.values(obj)) visit(v)
    }
  }
  visit(node)
  return found
}

function optionValue(options: Array<{ name: string; value: string }>, name: string): string | undefined {
  return options.find((o) => o.name === name)?.value
}

export function parseIntelliJConfig(editorXml: string, codeStyleXml: string | null): ParseResult {
  let editorOptions: Array<{ name: string; value: string }>
  try {
    editorOptions = findOptions(xmlParser.parse(editorXml))
  } catch (err) {
    return { ok: false, error: `No pudimos leer tu configuración: XML inválido (${err instanceof Error ? err.message : String(err)})` }
  }

  const options: EditorPreferences = {}

  const fontSize = optionValue(editorOptions, 'FONT_SIZE')
  if (fontSize !== undefined) options.fontSize = Number(fontSize)
  const fontFamily = optionValue(editorOptions, 'FONT_FAMILY')
  if (fontFamily !== undefined) options.fontFamily = fontFamily
  const softWraps = optionValue(editorOptions, 'USE_SOFT_WRAPS')
  if (softWraps !== undefined) options.wordWrap = softWraps === 'true' ? 'on' : 'off'
  const lineNumbers = optionValue(editorOptions, 'LINE_NUMBERS_SHOWN')
  if (lineNumbers !== undefined) options.lineNumbers = lineNumbers === 'true' ? 'on' : 'off'

  if (codeStyleXml) {
    let codeStyleOptions: Array<{ name: string; value: string }>
    try {
      codeStyleOptions = findOptions(xmlParser.parse(codeStyleXml))
    } catch (err) {
      return { ok: false, error: `No pudimos leer tu configuración: XML de code style inválido (${err instanceof Error ? err.message : String(err)})` }
    }
    const tabSize = optionValue(codeStyleOptions, 'TAB_SIZE')
    if (tabSize !== undefined) options.tabSize = Number(tabSize)
    const useTabChar = optionValue(codeStyleOptions, 'USE_TAB_CHARACTER')
    if (useTabChar !== undefined) options.insertSpaces = useTabChar !== 'true'
  }

  return { ok: true, options }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/__tests__/lib/ide-config-mappings.test.ts`
Expected: PASS (8 tests total)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/ide-config-mappings.ts src/__tests__/lib/ide-config-mappings.test.ts
git commit -m "feat(editor): parseo de config de IntelliJ (editor.xml + code style) a opciones de Monaco"
```

---

### Task 3: Main-process path detection (VS Code + IntelliJ)

**Files:**
- Create: `electron/ide-config-bridge.ts`
- Test: `electron/__tests__/ide-config-bridge.test.ts`

**Interfaces:**
- Consumes: nothing from prior tasks (pure path/filesystem logic; parsing happens in Task 4's IPC handlers, which import Task 1/2's parsers directly).
- Produces:
  - `resolveVSCodeSettingsPath(homeDir: string, platform: NodeJS.Platform): string` — pure, no I/O, just builds the expected path.
  - `findIntelliJConfigDir(jetbrainsRoot: string): Promise<string | null>` — lists `jetbrainsRoot`, returns the `IntelliJIdea*`-named subdirectory with the most recent mtime, or `null` if none exist.
  - `resolveJetBrainsRoot(homeDir: string, platform: NodeJS.Platform): string`

- [ ] **Step 1: Write the failing test**

```typescript
// electron/__tests__/ide-config-bridge.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { mkdirSync, utimesSync } from 'fs'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'
import { resolveVSCodeSettingsPath, resolveJetBrainsRoot, findIntelliJConfigDir } from '../ide-config-bridge'

describe('resolveVSCodeSettingsPath', () => {
  it('builds the Windows path under AppData/Code/User', () => {
    expect(resolveVSCodeSettingsPath('C:\\Users\\bauti', 'win32'))
      .toBe('C:\\Users\\bauti\\AppData\\Roaming\\Code\\User\\settings.json')
  })

  it('builds the Linux path under .config/Code/User', () => {
    expect(resolveVSCodeSettingsPath('/home/bauti', 'linux'))
      .toBe('/home/bauti/.config/Code/User/settings.json')
  })

  it('builds the Mac path under Library/Application Support', () => {
    expect(resolveVSCodeSettingsPath('/Users/bauti', 'darwin'))
      .toBe('/Users/bauti/Library/Application Support/Code/User/settings.json')
  })
})

describe('resolveJetBrainsRoot', () => {
  it('builds the Windows JetBrains root', () => {
    expect(resolveJetBrainsRoot('C:\\Users\\bauti', 'win32')).toBe('C:\\Users\\bauti\\AppData\\Roaming\\JetBrains')
  })
})

describe('findIntelliJConfigDir', () => {
  let root: string

  afterEach(() => cleanupTmp(root))

  it('returns null when no IntelliJIdea* directory exists', async () => {
    root = makeTmpDir('jetbrains-')
    await expect(findIntelliJConfigDir(root)).resolves.toBeNull()
  })

  it('picks the most recently modified IntelliJIdea* directory when several exist', async () => {
    root = makeTmpDir('jetbrains-')
    const older = join(root, 'IntelliJIdea2024.3')
    const newer = join(root, 'IntelliJIdea2025.1')
    mkdirSync(older)
    mkdirSync(newer)
    const now = Date.now() / 1000
    utimesSync(older, now - 100, now - 100)
    utimesSync(newer, now, now)
    await expect(findIntelliJConfigDir(root)).resolves.toBe(newer)
  })

  it('ignores directories that do not match the IntelliJIdea* pattern', async () => {
    root = makeTmpDir('jetbrains-')
    mkdirSync(join(root, 'PyCharm2025.1'))
    await expect(findIntelliJConfigDir(root)).resolves.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/__tests__/ide-config-bridge.test.ts`
Expected: FAIL — `Cannot find module '../ide-config-bridge'`.

- [ ] **Step 3: Implement path detection**

```typescript
// electron/ide-config-bridge.ts
import { promises as fsp } from 'fs'
import { join } from 'path'

export function resolveVSCodeSettingsPath(homeDir: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') return join(homeDir, 'AppData', 'Roaming', 'Code', 'User', 'settings.json')
  if (platform === 'darwin') return join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'settings.json')
  return join(homeDir, '.config', 'Code', 'User', 'settings.json')
}

export function resolveJetBrainsRoot(homeDir: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') return join(homeDir, 'AppData', 'Roaming', 'JetBrains')
  if (platform === 'darwin') return join(homeDir, 'Library', 'Application Support', 'JetBrains')
  return join(homeDir, '.config', 'JetBrains')
}

export async function findIntelliJConfigDir(jetbrainsRoot: string): Promise<string | null> {
  let entries: string[]
  try {
    entries = await fsp.readdir(jetbrainsRoot)
  } catch {
    return null
  }
  const candidates = entries.filter((name) => name.startsWith('IntelliJIdea'))
  if (candidates.length === 0) return null

  const withMtime = await Promise.all(
    candidates.map(async (name) => {
      const full = join(jetbrainsRoot, name)
      const stat = await fsp.stat(full)
      return { full, mtimeMs: stat.mtimeMs }
    }),
  )
  withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return withMtime[0].full
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/__tests__/ide-config-bridge.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add electron/ide-config-bridge.ts electron/__tests__/ide-config-bridge.test.ts
git commit -m "feat(editor): detección de paths de config de VS Code/IntelliJ por SO"
```

---

### Task 4: Main-process import functions + IPC wiring

**Files:**
- Modify: `electron/ide-config-bridge.ts` (add the read+parse orchestration on top of Task 3's path resolution)
- Modify: `electron/__tests__/ide-config-bridge.test.ts`
- Modify: `electron/main.ts` (register `ipcMain.handle('ide-config:import', ...)`)
- Modify: `electron/preload.ts` (expose `window.ideConfig`)
- Modify: `src/types.ts` (declare `ideConfig` on the global `Window` interface)

**Interfaces:**
- Consumes: `resolveVSCodeSettingsPath`, `resolveJetBrainsRoot`, `findIntelliJConfigDir` (Task 3); `parseVSCodeSettings`, `parseIntelliJConfig`, `EditorPreferences`, `EditorTheme` (Task 1/2).
- Produces: `importVSCodeConfig(homeDir: string, platform: NodeJS.Platform): Promise<ImportResult>`, `importIntelliJConfig(homeDir: string, platform: NodeJS.Platform): Promise<ImportResult>`, where `ImportResult = { ok: true; options: EditorPreferences; theme?: EditorTheme; unmappedTheme?: string } | { ok: false; error: string }`. IPC channel `'ide-config:import'` takes `(source: 'vscode' | 'intellij')`, returns `ImportResult`. Renderer: `window.ideConfig.import(source: 'vscode' | 'intellij'): Promise<ImportResult>`.

- [ ] **Step 1: Write the failing test**

```typescript
// append to electron/__tests__/ide-config-bridge.test.ts
import { writeFileSync, mkdirSync as mkdirSync2 } from 'fs'
import { importVSCodeConfig, importIntelliJConfig } from '../ide-config-bridge'

describe('importVSCodeConfig', () => {
  let root: string
  afterEach(() => cleanupTmp(root))

  it('reads and parses settings.json from the resolved path', async () => {
    root = makeTmpDir('vscode-home-')
    const userDir = join(root, '.config', 'Code', 'User')
    mkdirSync2(userDir, { recursive: true })
    writeFileSync(join(userDir, 'settings.json'), JSON.stringify({ 'editor.fontSize': 18 }))

    const result = await importVSCodeConfig(root, 'linux')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.options.fontSize).toBe(18)
  })

  it('returns a not-found error when settings.json does not exist', async () => {
    root = makeTmpDir('vscode-home-empty-')
    const result = await importVSCodeConfig(root, 'linux')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('No encontramos')
  })
})

describe('importIntelliJConfig', () => {
  let root: string
  afterEach(() => cleanupTmp(root))

  it('reads and parses editor.xml (and code style, if present) from the newest version dir', async () => {
    root = makeTmpDir('jetbrains-home-')
    const optionsDir = join(root, '.config', 'JetBrains', 'IntelliJIdea2025.1', 'options')
    mkdirSync2(optionsDir, { recursive: true })
    writeFileSync(
      join(optionsDir, 'editor.xml'),
      '<application><component name="EditorSettings"><option name="FONT_SIZE" value="17" /></component></application>',
    )
    const result = await importIntelliJConfig(root, 'linux')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.options.fontSize).toBe(17)
  })

  it('returns a not-found error when no JetBrains install is found', async () => {
    root = makeTmpDir('jetbrains-home-empty-')
    const result = await importIntelliJConfig(root, 'linux')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('No encontramos')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/__tests__/ide-config-bridge.test.ts`
Expected: FAIL — `importVSCodeConfig is not a function`.

- [ ] **Step 3: Implement the import functions**

```typescript
// append to electron/ide-config-bridge.ts
import { parseVSCodeSettings, parseIntelliJConfig, EditorPreferences, EditorTheme } from '../src/lib/ide-config-mappings'

export type ImportResult =
  | { ok: true; options: EditorPreferences; theme?: EditorTheme; unmappedTheme?: string }
  | { ok: false; error: string }

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await fsp.readFile(path, 'utf8')
  } catch {
    return null
  }
}

export async function importVSCodeConfig(homeDir: string, platform: NodeJS.Platform): Promise<ImportResult> {
  const path = resolveVSCodeSettingsPath(homeDir, platform)
  const content = await readIfExists(path)
  if (content === null) {
    return { ok: false, error: 'No encontramos la configuración de VS Code en este equipo.' }
  }
  return parseVSCodeSettings(content)
}

export async function importIntelliJConfig(homeDir: string, platform: NodeJS.Platform): Promise<ImportResult> {
  const jetbrainsRoot = resolveJetBrainsRoot(homeDir, platform)
  const versionDir = await findIntelliJConfigDir(jetbrainsRoot)
  if (!versionDir) {
    return { ok: false, error: 'No encontramos la configuración de IntelliJ en este equipo.' }
  }
  const editorXml = await readIfExists(join(versionDir, 'options', 'editor.xml'))
  if (editorXml === null) {
    return { ok: false, error: 'No encontramos la configuración de IntelliJ en este equipo.' }
  }
  const codeStyleXml = await readIfExists(join(versionDir, 'codestyles', 'Project.xml'))
  return parseIntelliJConfig(editorXml, codeStyleXml)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/__tests__/ide-config-bridge.test.ts`
Expected: PASS (10 tests total)

- [ ] **Step 5: Wire the IPC handler**

VS Code/IntelliJ configs live in the **real OS home directory**, not Nest's own (possibly-redirected) storage root — same reasoning `electron/main.ts:510-515` already documents for git clone targets: use `userHome()` from `electron/raven-home.ts`, not `ravenHome()`. `userHome()` deliberately always ignores `RAVEN_HOME` (see its docstring — that env var is reserved for Nest's persistent storage, not for redirecting where other apps' config lives), so e2e tests need a **separate** override env var, checked here directly rather than by reusing `RAVEN_HOME`.

Add to `electron/main.ts`, right after the existing `fs:unwatch` handler (~line 1729):

```typescript
import { importVSCodeConfig, importIntelliJConfig } from './ide-config-bridge'
import { userHome } from './raven-home'

ipcMain.handle('ide-config:import', async (_evt, source: 'vscode' | 'intellij') => {
  try {
    const homeDir = process.env.RAVEN_IDE_CONFIG_HOME ?? userHome()
    return source === 'vscode'
      ? await importVSCodeConfig(homeDir, process.platform)
      : await importIntelliJConfig(homeDir, process.platform)
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
  }
})
```

- [ ] **Step 6: Expose it in the preload script**

Add to `electron/preload.ts`, alongside the existing `contextBridge.exposeInMainWorld('fs', ...)` block:

```typescript
contextBridge.exposeInMainWorld('ideConfig', {
  import: (source: 'vscode' | 'intellij') => ipcRenderer.invoke('ide-config:import', source),
})
```

- [ ] **Step 7: Declare the type on `Window`**

Add to `src/types.ts`, inside `declare global { interface Window { ... } }`, alongside the existing `fs: {...}` block:

```typescript
ideConfig: {
  import: (source: 'vscode' | 'intellij') => Promise<
    | { ok: true; options: EditorPreferences; theme?: EditorTheme; unmappedTheme?: string }
    | { ok: false; error: string }
  >
}
```

(Add `import type { EditorPreferences, EditorTheme } from './lib/ide-config-mappings'` to `src/types.ts`'s existing imports.)

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add electron/ide-config-bridge.ts electron/__tests__/ide-config-bridge.test.ts electron/main.ts electron/preload.ts src/types.ts
git commit -m "feat(editor): IPC ide-config:import + wiring main/preload/types"
```

---

### Task 5: Persist imported preferences + thread into EditorPane

**Files:**
- Modify: `src/hooks/useUserPreferences.ts`
- Modify: `src/components/EditorPane.tsx`
- Modify: `src/App.tsx` (pass the new prop through)
- Test: `src/__tests__/components/EditorPane.test.tsx`

**Interfaces:**
- Consumes: `EditorPreferences`, `EditorTheme` from `src/lib/ide-config-mappings.ts` (Task 1).
- Produces: `useUserPreferences().prefs.ui_settings.editorOptions: EditorPreferences | undefined`, `useUserPreferences().prefs.ui_settings.editorTheme: EditorTheme | undefined`, `useUserPreferences().setEditorOptions(options: EditorPreferences, theme?: EditorTheme): void` (bulk-merges into `ui_settings`, unlike the single-value `setFontSize`). `EditorPane` gains a new prop `editorOptions?: EditorPreferences` and `editorTheme?: EditorTheme`.

- [ ] **Step 1: Write the failing test**

```typescript
// append to src/__tests__/components/EditorPane.test.tsx
it('passes editorOptions and editorTheme through to Monaco', async () => {
  const { bridge } = makeMockBridge()
  render(
    <BridgeProvider value={bridge}>
      <EditorPane
        pane={makePane()}
        onTabsChange={vi.fn()}
        onClose={vi.fn()}
        onFocus={vi.fn()}
        onOpenInNewPane={vi.fn()}
        editorOptions={{ fontSize: 18, tabSize: 2 }}
        editorTheme="vs"
      />
    </BridgeProvider>,
  )
  await waitFor(() => expect(screen.getByTestId('monaco-stub')).toHaveValue('hello'))
  expect(monacoStub.lastOptions).toEqual({ fontSize: 18, tabSize: 2 })
  expect(monacoStub.lastTheme).toBe('vs')
})
```

Update the mock at the top of the file to record `options`/`theme`:

```typescript
const monacoStub = vi.hoisted(() => ({
  latestOnChange: null as ((v: string) => void) | null,
  lastOptions: undefined as unknown,
  lastTheme: undefined as string | undefined,
}))

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange, options, theme }: { value: string; onChange: (v: string | undefined) => void; options?: unknown; theme?: string }) => {
    monacoStub.latestOnChange = onChange
    monacoStub.lastOptions = options
    monacoStub.lastTheme = theme
    return <textarea data-testid="monaco-stub" value={value} onChange={(e) => onChange(e.target.value)} />
  },
}))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/components/EditorPane.test.tsx`
Expected: FAIL — `editorOptions`/`editorTheme` props don't exist on `EditorPaneProps`, `monacoStub.lastOptions` is `undefined` regardless (Monaco's `options`/`theme` props aren't wired yet).

- [ ] **Step 3: Extend `useUserPreferences`**

```typescript
// src/hooks/useUserPreferences.ts — modify the interface and add setEditorOptions
import type { EditorPreferences, EditorTheme } from '../lib/ide-config-mappings'

interface UserPreferences {
  active_team_id: string | null
  ui_settings: {
    fontSize?: number
    editorOptions?: EditorPreferences
    editorTheme?: EditorTheme
    // extensible
  }
}
```

Add, alongside the existing `setFontSize`:

```typescript
const setEditorOptions = useCallback((options: EditorPreferences, theme?: EditorTheme) => {
  updatePrefs({
    ui_settings: {
      ...prefs.ui_settings,
      editorOptions: { ...prefs.ui_settings.editorOptions, ...options },
      ...(theme ? { editorTheme: theme } : {}),
    },
  })
}, [updatePrefs, prefs.ui_settings])
```

Add `setEditorOptions` to the hook's return object.

- [ ] **Step 4: Thread the props through `EditorPane`**

In `src/components/EditorPane.tsx`, add to `EditorPaneProps`:

```typescript
editorOptions?: EditorPreferences
editorTheme?: EditorTheme
```

(`import type { EditorPreferences, EditorTheme } from '../lib/ide-config-mappings'`, add `editorOptions`/`editorTheme` to the destructured props in the function signature.)

Update the `<Editor>` JSX (currently `<Editor path={activePath} value={contents[activePath] ?? ''} onChange={(value) => handleChange(activePath, value)} theme="vs-dark" />`):

```tsx
<Editor
  path={activePath}
  value={contents[activePath] ?? ''}
  onChange={(value) => handleChange(activePath, value)}
  theme={editorTheme ?? 'vs-dark'}
  options={editorOptions}
/>
```

- [ ] **Step 5: Pass the props from `App.tsx`**

In `src/App.tsx`, update the `<EditorPane>` call (~line 1157):

```tsx
<EditorPane
  key={pane.id}
  pane={pane}
  onTabsChange={(tabs, activeEditorTabPath) => updatePaneEditorTabs(pane.id, tabs, activeEditorTabPath)}
  onClose={() => removePane(pane.id)}
  onFocus={() => { setFocusedPaneId(pane.id); focusedPaneIdRef.current = pane.id }}
  onOpenInNewPane={(relPath) => moveEditorTabToNewPane(pane.id, relPath)}
  editorOptions={userPrefs.prefs.ui_settings.editorOptions}
  editorTheme={userPrefs.prefs.ui_settings.editorTheme}
/>
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/__tests__/components/EditorPane.test.tsx`
Expected: PASS (all tests, including the new one)

- [ ] **Step 7: Typecheck and run the full unit suite**

Run: `npx tsc --noEmit && doppler run -- npm test`
Expected: no errors, all green.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useUserPreferences.ts src/components/EditorPane.tsx src/App.tsx src/__tests__/components/EditorPane.test.tsx
git commit -m "feat(editor): thread editorOptions/editorTheme desde preferencias hasta Monaco"
```

---

### Task 6: SettingsPanel import UI (preview + confirm)

**Files:**
- Modify: `src/components/SettingsPanel.tsx`
- Test: `src/__tests__/components/SettingsPanel.test.tsx` (check whether this file exists first — if not, create it following the pattern of `EditorPane.test.tsx`: `@testing-library/react`, mocked `bridge`)

**Interfaces:**
- Consumes: `window.ideConfig.import` (Task 4), `useUserPreferences().setEditorOptions` (Task 5).
- Produces: an "Importar configuración de editor" section in `SettingsPanel`, with two buttons and a preview/confirm flow. No new exports — this is leaf UI.

- [ ] **Step 1: Check for an existing SettingsPanel test file**

Run: `find src/__tests__/components -iname "SettingsPanel.test.tsx"`

If it exists, read it fully first to match its existing mocking pattern before writing new tests. If it doesn't exist, follow `EditorPane.test.tsx`'s pattern (`BridgeProvider`, `useBridge()`-style mock bridge) — check how `SettingsPanel.tsx` currently receives its dependencies (props vs. `useBridge()`/`useUserPreferences()` directly) before deciding the test's render setup, since this determines whether `useUserPreferences` needs mocking via `vi.mock('../../hooks/useUserPreferences', ...)` or can be exercised for real against a mocked `bridge.fs`/`supabase`.

- [ ] **Step 2: Write the failing test**

```typescript
// src/__tests__/components/SettingsPanel.test.tsx (new test, adjust imports/props to match SettingsPanel's actual signature found in Step 1)
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SettingsPanel } from '../../components/SettingsPanel'
// ... other imports matching SettingsPanel's real prop/context requirements

describe('SettingsPanel — editor config import', () => {
  it('shows a preview of the imported VS Code preferences before applying', async () => {
    ;(window as unknown as { ideConfig: { import: ReturnType<typeof vi.fn> } }).ideConfig = {
      import: vi.fn().mockResolvedValue({ ok: true, options: { fontSize: 18, tabSize: 2 } }),
    }
    render(/* <SettingsPanel ...requiredProps /> */)

    fireEvent.click(screen.getByText('Importar de VS Code'))
    await waitFor(() => expect(screen.getByTestId('ide-config-preview')).toBeInTheDocument())
    expect(screen.getByTestId('ide-config-preview')).toHaveTextContent('fontSize')
    expect(screen.getByTestId('ide-config-preview')).toHaveTextContent('18')
  })

  it('shows an error message without crashing when the config is not found', async () => {
    ;(window as unknown as { ideConfig: { import: ReturnType<typeof vi.fn> } }).ideConfig = {
      import: vi.fn().mockResolvedValue({ ok: false, error: 'No encontramos la configuración de VS Code en este equipo.' }),
    }
    render(/* <SettingsPanel ...requiredProps /> */)

    fireEvent.click(screen.getByText('Importar de VS Code'))
    await waitFor(() => expect(screen.getByText('No encontramos la configuración de VS Code en este equipo.')).toBeInTheDocument())
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/__tests__/components/SettingsPanel.test.tsx`
Expected: FAIL — no "Importar de VS Code" button exists yet.

- [ ] **Step 4: Implement the import UI**

Add a new `sp-section` block to `SettingsPanel.tsx` (follow the existing `tab === 'tutorial'` section's structure as the closest precedent — conditional block inside the existing tab-panel rendering):

```tsx
{tab === 'editor' && (
  <div className="sp-section">
    <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px' }}>
      Importá tus preferencias de edición desde VS Code o IntelliJ.
    </p>
    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
      <button className="sp-action-btn" onClick={() => handleImport('vscode')}>Importar de VS Code</button>
      <button className="sp-action-btn" onClick={() => handleImport('intellij')}>Importar de IntelliJ</button>
    </div>
    {importError && <p style={{ color: '#ef4444', fontSize: 12 }}>{importError}</p>}
    {importPreview && (
      <div data-testid="ide-config-preview">
        <ul>
          {Object.entries(importPreview.options).map(([key, value]) => (
            <li key={key}>{key}: {JSON.stringify(value)}</li>
          ))}
        </ul>
        <button className="sp-action-btn" onClick={confirmImport}>Aplicar</button>
        <button className="sp-btn-danger" onClick={() => setImportPreview(null)}>Cancelar</button>
      </div>
    )}
  </div>
)}
```

Add the supporting state/handlers near the top of the component body (alongside existing `useState` calls):

```typescript
const userPrefs = useUserPreferences()
const [importPreview, setImportPreview] = useState<{ source: 'vscode' | 'intellij'; options: EditorPreferences; theme?: EditorTheme } | null>(null)
const [importError, setImportError] = useState<string | null>(null)

const handleImport = useCallback(async (source: 'vscode' | 'intellij') => {
  setImportError(null)
  setImportPreview(null)
  const result = await window.ideConfig.import(source)
  if (!result.ok) {
    setImportError(result.error)
    return
  }
  setImportPreview({ source, options: result.options, theme: result.theme })
}, [])

const confirmImport = useCallback(() => {
  if (!importPreview) return
  userPrefs.setEditorOptions(importPreview.options, importPreview.theme)
  setImportPreview(null)
}, [importPreview, userPrefs])
```

Wire `'editor'` into the tab machinery (`SettingsPanel.tsx:11,141`):

```typescript
// line 11
type Tab = 'keybinds' | 'presets' | 'benchmarks' | 'updates' | 'account' | 'tutorial' | 'editor'
```

```tsx
// line 141 — the tab-button array; labels auto-capitalize from the id, so
// 'editor' renders as an "Editor" button with no extra label mapping needed
{(['keybinds', 'presets', 'benchmarks', 'updates', 'account', 'tutorial', 'editor'] as Tab[]).map(t => (
```

Add `import type { EditorPreferences, EditorTheme } from '../lib/ide-config-mappings'` and `import { useUserPreferences } from '../hooks/useUserPreferences'` to `SettingsPanel.tsx`'s existing imports (check first whether `useUserPreferences` is already imported there — it currently is not, per the codebase read during planning).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/__tests__/components/SettingsPanel.test.tsx`
Expected: PASS

- [ ] **Step 6: Typecheck and run the full unit suite**

Run: `npx tsc --noEmit && doppler run -- npm test`
Expected: no errors, all green.

- [ ] **Step 7: Commit**

```bash
git add src/components/SettingsPanel.tsx src/__tests__/components/SettingsPanel.test.tsx
git commit -m "feat(editor): UI de import de config en SettingsPanel (preview + confirmar)"
```

---

### Task 7: E2E test with a fake fixture

**Files:**
- Modify: `e2e/helpers/harness.ts` (set `RAVEN_IDE_CONFIG_HOME` in the spawned Electron process's env, same place `RAVEN_HOME`/`HOME`/`USERPROFILE` are already set — see `launchHarness`, ~line 38-46)
- Create: `e2e/editor-config-import.spec.ts`

**Interfaces:**
- Consumes: `importVSCodeConfig`/`importIntelliJConfig` (Task 4), `launchHarness`/`teardown` (existing `e2e/helpers/harness.ts`), `RAVEN_IDE_CONFIG_HOME` env var (wired in Task 4 Step 5).
- Produces: nothing consumed by later tasks — this is the final, whole-flow verification.

- [ ] **Step 1: Point the e2e harness's fake home at the IDE-config env var**

In `e2e/helpers/harness.ts`, `launchHarness()` already builds a fresh `homeDir` (`uniqueTmp('raven-e2e-home-')`) and sets `env.RAVEN_HOME = homeDir` alongside `env.HOME`/`env.USERPROFILE` (~line 38-46). Add one line right after those:

```typescript
env.RAVEN_IDE_CONFIG_HOME = homeDir
```

This reuses the SAME fake `homeDir` the harness already isolates everything else under — so a test can write a fake `settings.json` into `h.homeDir` and the main process's `ide-config:import` handler (Task 4 Step 5) will find it there instead of the real developer machine's actual VS Code config.

- [ ] **Step 2: Write the E2E test**

```typescript
// e2e/editor-config-import.spec.ts
import { test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { launchHarness, teardown, expect } from './helpers/harness'

test('importa fontSize/tabSize desde un settings.json fake de VS Code', async () => {
  const h = await launchHarness({ withRepo: true })

  const userDir = join(h.homeDir, '.config', 'Code', 'User')
  mkdirSync(userDir, { recursive: true })
  writeFileSync(join(userDir, 'settings.json'), JSON.stringify({ 'editor.fontSize': 22, 'editor.tabSize': 8 }))

  await h.page.locator('.sidebar-item-settings').click()  // Sidebar.tsx:710 — always-visible trigger, opens SettingsPanel
  await h.page.locator('.sp-tab', { hasText: 'Editor' }).click()  // the new tab added in Task 6 (SettingsPanel.tsx:141)
  await h.page.locator('text=Importar de VS Code').click()

  await expect(h.page.locator('[data-testid="ide-config-preview"]')).toContainText('22')
  await h.page.locator('text=Aplicar').click()

  // Preferences persisted via Supabase in the app; verifying the applied
  // value took effect is best done by re-opening an editor pane and reading
  // Monaco's live fontSize via a DOM/computed-style check, or by re-opening
  // SettingsPanel and confirming the new value shows as "current" — finalize
  // this assertion against SettingsPanel's actual real markup once Task 6
  // lands (this step's exact selectors are illustrative, not final).

  await teardown(h)
})
```

- [ ] **Step 3: Run it**

Run (foreground, no background/Monitor — same discipline as every other E2E run in this branch): `doppler run -- npm run pre-e2e && doppler run -- npm run e2e -- editor-config-import.spec.ts`
Expected: PASS. If selectors don't match the real `SettingsPanel` markup from Task 6, adjust them to match what Task 6 actually produced (this step was written before Task 6's exact JSX existed — expected to need small selector fixes, not a logic rewrite).

- [ ] **Step 4: Confirm no orphaned processes**

Run: `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Where-Object { $_.CommandLine -like '*feat-code-editor-integration*' }"` (this plan executes in the `feat-code-editor-integration` worktree — adjust the path filter if run elsewhere)
Expected: empty — `teardown()` cleaned everything up.

- [ ] **Step 5: Commit**

```bash
git add e2e/editor-config-import.spec.ts e2e/helpers/harness.ts
git commit -m "test(editor): E2E de import de config VS Code con fixture fake"
```

---

## Self-Review Notes

- **Spec coverage:** all spec sections have a task — registro declarativo (Task 1/2), IPC separado del fs-bridge scoped (Task 3/4), UI con preview (Task 6), persistencia por-usuario (Task 5), testing en las 4 capas (Task 1/2/3/4 unit, Task 5/6 component, Task 7 e2e). Keybindings and format-on-save are explicitly out of scope per the spec and have no task here.
- **Type consistency checked:** `ParseResult`/`ImportResult` share the same `{ ok: true; options; theme?; unmappedTheme? } | { ok: false; error }` shape end to end from Task 1 through Task 6's UI. `EditorPreferences`/`EditorTheme` are defined once (Task 1) and only ever imported, never redefined, in every later task.
- **Known follow-up, not a placeholder:** Task 7's exact Playwright selectors for `SettingsPanel`'s tab/trigger are marked illustrative because `SettingsPanel.tsx`'s real current tab-switching markup wasn't read in full during planning (Task 6 Step 1 explicitly requires reading it first) — this is a deliberately flagged small adjustment, not missing logic.
