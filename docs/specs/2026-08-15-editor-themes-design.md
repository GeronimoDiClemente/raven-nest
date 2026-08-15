# Editor Themes — TextMate-fidelity theme system (Option C)

**Date:** 2026-08-15
**Status:** Approved direction (user chose "C, bien completa"); detail decisions delegated.
**Branch:** feature work parallel to `feat/code-editor-integration`

## Goal

VS Code-grade theming for Nest's embedded Monaco editor: real TextMate
tokenization (1:1 highlight fidelity, not Monarch approximation) and themes the
user can select, import, load from disk, or install from a registry.

## Scope decisions (user-confirmed)

- **Sources (all four):**
  1. Bundled pack: ~15 well-known themes shipped with Shiki (Dracula, Monokai,
     Nord, GitHub Light/Dark, One Dark Pro, Catppuccin, Tokyo Night, Solarized,
     Vitesse...).
  2. Import from the user's installed VS Code (`~/.vscode/extensions/*/`:
     read each extension's `package.json` → `contributes.themes`, offer found
     themes).
  3. Load a `.json` VS Code theme file from disk.
  4. Registry download: **Open VSX** (NOT Microsoft's marketplace — its ToS
     restrict API use to official VS Code products; Open VSX is the
     Eclipse-run open registry used by VSCodium/Gitpod). Search by name,
     download the `.vsix`, extract ONLY `contributes.themes` JSONs.
- **Theming scope: editor pane only.** Nest's own UI keeps its identity. The
  Monaco surface (code + editor background) is painted by the theme.

## Engine

`shiki` + `@shikijs/monaco` (`shikiToMonaco(highlighter, monaco)`), verified
compatible with installed `monaco-editor` 0.55.1 / `@monaco-editor/react`
4.7.0. Shiki uses VS Code's own grammars and theme format; `loadTheme(json)`
accepts arbitrary VS Code theme JSON at runtime. Everything bundles locally
(WASM + grammars via Vite) — no network at highlight time, satisfying the
app's offline/CSP constraints.

## Architecture (units + interfaces)

1. **`src/lib/theme-registry.ts`** (pure, unit-testable)
   - `validateVSCodeTheme(json): ValidationResult` — shape-check (name/colors/
     tokenColors), reject non-theme JSON with actionable error.
   - `themeDisplayName`, `themeIsDark` helpers.
2. **`electron/theme-bridge.ts`** (main process) + IPC in `main.ts`, exposed
   via preload as `window.themes.*`:
   - `themes:listInstalled` → themes in `RAVEN_HOME/.raven-nest/themes/*.json`
     (per-device, like v1.2 local-paths).
   - `themes:saveInstalled(name, json)` / `themes:deleteInstalled(name)`.
   - `themes:scanVSCode` → read `~/.vscode/extensions/*/package.json`
     `contributes.themes`, return `{ label, path }[]`; `themes:importVSCode(path)`
     copies the theme JSON into the installed dir. Honors
     `RAVEN_IDE_CONFIG_HOME` for E2E isolation (same as ide-config bridge).
   - `themes:searchOpenVSX(query)` → GET `https://open-vsx.org/api/-/search`
     filtered to theme extensions; `themes:installOpenVSX(namespace, name)` →
     download `.vsix`, unzip (zip lib, e.g. `adm-zip`), extract ONLY the JSON
     files referenced by `contributes.themes`, save each via saveInstalled.
     **Never execute or persist extension JS.** Network stays in main process.
3. **`src/lib/shiki-monaco.ts`** (renderer)
   - Lazy singleton `getHighlighter()`; `ensureLanguage(ext)` dynamic-imports
     the grammar for the opened file's language (fine-grained shiki imports —
     keep initial bundle lean); `applyTheme(monaco, themeNameOrJson)` loads
     into the highlighter, re-runs `shikiToMonaco`, `monaco.editor.setTheme`.
   - Wired in `EditorPane`'s existing `onMount` (get monaco instance there).
   - Fallback: if a grammar/theme fails to load, Monaco's built-in Monarch +
     `vs-dark` remain — never a broken editor.
4. **Settings → Editor tab** (`SettingsPanel.tsx`)
   - Theme `<select>`: bundled pack + installed themes (grouped).
   - Buttons: "Import from VS Code" (scan → pick → import), "Load theme
     file…" (native open dialog via existing dialog IPC pattern), "Browse
     Open VSX…" (search box + results + Install).
   - All copy in English (branch rule).
5. **Persistence**
   - `ui_settings.editorTheme` widens from `'vs' | 'vs-dark'` to `string`
     (theme name). Unknown/missing name at load → fallback `'vs-dark'`.
   - Theme FILES are device-local; the SELECTED name is per-user (Supabase),
     consistent with the platform's split (v1.2 local-paths precedent).
   - The existing config-import's `unmappedTheme` field: when the imported VS
     Code theme name matches an installed/bundled Shiki theme, apply it
     directly (closes the loop the import feature left open).

## Error handling

- Invalid JSON / not-a-theme file → inline error in Settings, no crash.
- Open VSX network failure → inline error, retry allowed; no queued state.
- Corrupt installed theme at startup → skip it, log, fall back to vs-dark.

## Testing

- Unit (TDD): theme-registry validation; shiki-monaco language-ext mapping and
  fallback paths (mock shiki); SettingsPanel selector/install flows (mock
  `window.themes`); prefs widening (existing useUserPreferences tests extend).
- Main-process unit: theme-bridge scan/save/extract with fixture dirs and a
  fixture `.vsix` (a zip built in-test). No network in tests (mock fetch).
- E2E: select a bundled theme in Settings → editor background/token colors
  change (assert via computed style / `.monaco-editor` class), persisted
  across the session.

## Out of scope

- Theming Nest's own UI (sidebar, modals, terminal panes).
- Microsoft Marketplace API.
- Running any extension code from .vsix files.
- Theme editing/creation UI.
