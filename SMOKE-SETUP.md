# Memory bridge — smoke test environment

Worktree: `C:\Users\gerod\Dev\raven-nest\.claude\worktrees\memory-smoke`
Branch: `smoke/memory-bridge` (disposable — do not merge anywhere), from `feat/integrations` @ `49f5638`, merged with `feat/nest-memory-phase1` @ `78dae0a`.
Commit: `5311b9b` — merge + adapter, already committed on this branch.

**Environment status: ready.** `npm ci` needed a workaround (documented below) but the
app-build path, the test suite and the typecheck all ran to completion. 43 of 1054 tests
fail — all explained below, 41 are an infra limitation (native module ABI, not a code bug)
and 2 are a genuine, interesting merge incompatibility. 72 typecheck errors, 70 pre-existing
on `feat/integrations` (just shifted line numbers), 2 pre-existing inside the memory
branch's own test file. None of it touches the adapter.

## 1. Worktree + merge

```
git worktree add C:\Users\gerod\Dev\raven-nest\.claude\worktrees\memory-smoke -b smoke/memory-bridge feat/integrations
git merge feat/nest-memory-phase1
```

Exactly one conflict, in `.env.example` — both branches appended different lines at the
end (Slack OAuth keys vs. `MAIN_VITE_SUPABASE_URL` for the memory sync daemon). Resolved
by keeping both blocks, no further conflicts anywhere else in the merge.

## 2. The adapter

`electron/main.ts` used to have:

```ts
// Swapped for the real adapter over MemoryStore.save({source:'pty'}) once
// feat/nest-memory-phase1 merges. Until then the bridge runs and writes nowhere.
const memorySink: MemorySink = NULL_SINK
```

Replaced with a real `MemorySink` implementation over `MemoryStore`. It:

- Resolves `projectKey` from `input.cwd` the same way `memory-ipc-server.ts`'s
  `memory.save` case does (`projectKeyForCwd`): look up a git remote for the cwd
  (`getRemoteUrl`, already imported in `main.ts` for the ticket-loop code), feed it plus
  the cwd to `resolveProjectKey`, then register the project with `store.ensureProject`.
  An empty `cwd` (graph events whose repo never resolved to a local path — see
  `bridgeCtx.resolveRepo` a few lines below in `main.ts`) skips the remote lookup
  entirely and `resolveProjectKey` falls through to `GLOBAL_PROJECT_KEY`.
- Writes with `source: 'pty'` — the Layer C source reserved for this bridge.
- Passes `sourceRef`, `topicKey`, `tags`, `originAi`, `gitBranch` straight through from
  `MemorySaveInput` to `SaveInput` (identical shapes, no mapping needed).
- Forces `scope: 'personal'`, same rule `memory.save`'s IPC case applies to all
  auto-capture writes (§2.1 of the design doc).
- Gates on `memoryConnectionState.connected`, same flag `ptyManager.setMemoryIntegration`
  and `accountStore.configureMemory` already gate on elsewhere in `main.ts` — **the bridge
  writes nothing until the user clicks "Connect" under Settings → Nest Memory.**
- Fires `memory.daemon.scheduleMutationPush()` after a successful write (the same "on
  write" trigger `memory.save`'s IPC path fires via its `onMutation` callback), so a
  bridge-written observation actually gets pushed instead of waiting for the daemon's
  ~5-minute poll.
- Is wrapped in try/catch with a `console.warn` — never throws. It's called from the
  event-bus observer (`bridgeEvent`) and from IPC decision handlers (`bridgeDecision`),
  and an uncaught error there would take down whichever caller invoked it.

Also removed the now-unused `NULL_SINK` import.

## 3. `npm ci` — what failed and the workaround

`npm ci` plain fails outright: `better-sqlite3`'s own `install` script (`prebuild-install
|| node-gyp rebuild --release`) tries to compile from source against this machine's
Node v25.4.0 and dies with:

```
error MSB8020: No se pueden encontrar las herramientas de compilación para ClangCL
(Conjunto de herramientas de la plataforma = 'ClangCL'). ...
[...\node_modules\better-sqlite3\build\deps\locate_sqlite3.vcxproj]
```

This is the exact gotcha CLAUDE.md already flags: Node 25.4.0's official Windows build
reports `clang:1`, so node-gyp's generated project defaults to the ClangCL toolset, which
needs a Visual Studio component ("C++ Clang tools for Windows" / LLVM toolset) that isn't
installed. `npm ci` rolls back to an empty `node_modules` on any lifecycle-script failure,
so this isn't a partial-install problem — it aborts cleanly and needs a different approach
from the start.

**What I ran, in order:**

1. `npm ci --ignore-scripts` — installs all 427 packages without running any install/
   postinstall script. Succeeded.
2. `node-pty`: no rebuild at all. It ships prebuilt `.node` files directly in the package
   at `prebuilds/win32-x64/{pty,conpty,conpty_console_list}.node`, and its own loader
   (`lib/utils.js`) checks `build/Release` → `build/Debug` → `prebuilds/<platform>-<arch>`
   in that order — so it loads straight from the bundled prebuild with zero compilation.
   I still ran its own `install`/`postinstall` scripts by hand (`node scripts/prebuild.js`
   then `node scripts/post-install.js`, from inside `node_modules/node-pty`) since they're
   pure file-copy operations (no compiler invoked) and set up `conpty.dll`/`OpenConsole.exe`
   under `build/Release/conpty/`. Both exited 0.
3. `better-sqlite3`, Electron ABI (needed to run the app): `npx electron-rebuild -f -o
   better-sqlite3` — **succeeded** (`✔ Rebuild Complete`), produced a valid
   `build/Release/better_sqlite3.node` (NODE_MODULE_VERSION 130, Electron 33.4.11's ABI).
   Used `-o <module>` instead of `-w`, per the known `electron-rebuild -w` /
   `argv.w.split is not a function` bug when passed twice — the root's own `postinstall`
   script (`electron-rebuild -f -w node-pty -w better-sqlite3`) actually hits this bug
   itself since it passes `-w` twice, so don't run `npm run postinstall` as-is.
4. `better-sqlite3`, system Node ABI (needed to run tests under vitest, which runs under
   plain Node): `node ./node_modules/node-gyp/bin/node-gyp.js rebuild --release` from
   inside `node_modules/better-sqlite3` — **failed**, same `MSB8020 ClangCL` error as the
   original `npm ci` failure (this machine's Node v25.4.0 headers report `clang:1`
   regardless of which node-gyp binary invokes them).
   - Second attempt, forcing the classic MSVC toolset via `GYP_DEFINES="clang=0"` before
     the same command — **also failed**, identical error. gyp's toolset selection for this
     dependency project isn't reachable through that variable.
   - Per the "don't fight more than two attempts" instruction, stopped here. This needs
     either the missing Visual Studio LLVM/Clang component installed, or running the test
     suite under an older Node version whose official Windows build doesn't set
     `clang:1` — both are environment changes outside what I should do unprompted.
5. Left `better-sqlite3` on the **Electron-ABI build** (re-ran step 3 once more to restore
   it after the two failed Node-ABI attempts had wiped `build/`) — this is the build the
   packaged/dev **app** needs. Tests that load `better-sqlite3` directly under plain Node
   fail with an ABI mismatch as a result (see below) — that's the "app build works, test
   build doesn't" tradeoff the two builds not coexisting forces.

**Net effect:** the app's own native-module path (what `npm run dev` / a packaged build
needs) is in a working state. The system-Node ABI needed for `electron/__tests__/memory-
store.test.ts` and `electron/__tests__/memory-importers.test.ts` to run under vitest is
blocked on this machine by the missing VS Clang component — a real, unresolved gap, not
swept under the rug.

## 4. Test suite

`npm test` (`vitest run`): **1054 tests total — 1010 passed, 43 failed, 1 skipped** (120
test files: 110 passed, 9 failed). Roughly matches the ~925 (integrations) + memory
branch's own suite expectation.

### 41 failures — better-sqlite3 ABI mismatch (infra, not a code bug)

`electron/__tests__/memory-store.test.ts` (29/29 tests) and `electron/__tests__/memory-
importers.test.ts` (12/12 tests) fail immediately on load:

```
...\better-sqlite3\build\Release\better_sqlite3.node was compiled against a different
Node.js version using NODE_MODULE_VERSION 130. This version of Node.js requires
NODE_MODULE_VERSION 141.
```

130 = Electron 33.4.11's ABI (the build left in place, see §3 above); 141 = this machine's
system Node v25.4.0. Direct consequence of the blocked Node-ABI rebuild — not a bug in
either branch's code, and not something the merge introduced.

### 2 failures — genuine merge incompatibility (interesting)

`src/__tests__/components/Sidebar-integrations.test.tsx`, both of its tests:

```
TypeError: Cannot read properties of undefined (reading 'onStatus')
 ❯ src/hooks/useMemory.ts:51:19
     window.memory.onStatus(() => { void refresh() })
```

`Sidebar.tsx` renders `<SettingsPanel>`, and `SettingsPanel.tsx` (touched by the memory
branch) now calls `useMemory()`, which reads `window.memory` — the preload API
`feat/nest-memory-phase1` added (`electron/preload.ts`'s `contextBridge.exposeInMainWorld
('memory', {...})`). `Sidebar-integrations.test.tsx` is from `feat/integrations` and
predates that hook: its `beforeEach` mocks `window.updater` and a handful of other IPC
surfaces Sidebar was known to touch, but has no entry for `window.memory` (see the file's
own header comment: "Sidebar has many heavy deps ... We mock the problematic ones"). This
is a real, narrow gap the merge surfaces: any pre-existing Sidebar test now needs a
`window.memory` mock too. Fix (not applied here — out of scope for a disposable smoke
branch) would be adding a `window.memory` stub (`{ onStatus: vi.fn(), removeStatusListener:
vi.fn(), status: vi.fn(), connect: vi.fn(), ... }`, matching `useMemory.ts`'s surface) to
that test's `beforeEach`.

### 6 suite errors — pre-existing environment gap, not merge-related

`ConnectionsView`, `IntegrationsMarketplace-connect`, `IntegrationsMarketplaceView`,
`MyReposPanel-worker`, `worktrees-tutorial-button`, `IntegrationsHub` (all
`src/__tests__/components/*.test.tsx`) fail to even collect:

```
Error: supabaseUrl is required.
 ❯ src/lib/supabase.ts:7:20
```

This worktree has no `.env.local` (fresh `git worktree add`, secrets are gitignored and
never copied automatically), so `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are undefined
and `createClient(...)` at module-load time throws. This would fail identically on a fresh
`feat/integrations`-only checkout with no `.env.local` — unrelated to the memory merge.
Not fixed here (see §6, "what the user needs to do").

## 5. Typecheck — `npx tsc -b`

**72 errors**, none from the adapter. Cross-checked line-by-line against a clean
`feat/integrations` baseline (ran `npx tsc -b` in the sibling `.claude\worktrees\
integrations` worktree, 69 errors there):

- **60 errors identical** (same file, line, column, code) in both — untouched
  pre-existing gaps (`ImportMeta.env` not on the `ImportMeta` type — `tsconfig.node.json`
  doesn't pull in Vite's client types — and two `OpenDialogOptions` mismatches).
- **9 more** are the *same* pre-existing `main.ts` errors, just at different line numbers
  because the merge (independently of my adapter) added ~370 lines to `main.ts` before my
  edit's own insertion point.
- **1 more** (`main.ts:206`, `ImportMeta.env`) is a genuinely new call site —
  `getMemorySupabaseUrl()`, added by the merge itself (not my adapter), does `import.meta
  .env.MAIN_VITE_SUPABASE_URL`. Same root-cause tsconfig gap as the other 9, just a new
  place it's triggered from.
- **2 more**, both in `electron/__tests__/memory-daemon.test.ts` (`fetchImpl` not
  assignable to `Partial<MemoryStore>`; a `vi.fn()` mock not assignable to the global
  `fetch` signature) — self-contained to that file, no shared type or import with
  anything from `feat/integrations`. Very likely pre-existing on `feat/nest-memory-phase1`
  alone (not independently verified by building that branch from scratch — its worktree
  has no `node_modules` and setting one up hits the same native-module wall as §3 — but
  the error content has zero connection to anything the merge touched).

Grepped the full error list for `memorySink`, `MemorySink`, `getRemoteUrl`,
`resolveProjectKey`, `GLOBAL_PROJECT_KEY`, `ensureProject`, `memory-store`, `memory-port`,
`memory-project-key` — **zero matches**. The adapter itself introduces no new type errors.

Cleaned up with `git add -A` (all merge-introduced sources were already staged from the
merge; verified no untracked `.ts`/`.tsx` existed before cleaning, only the composite
build's `.js`/`.d.ts`/`.map` output) then `git clean -fd` — 754 emitted artifacts removed,
tree back to source-only.

## 6. What the user needs to do to run the smoke by hand

**Do not just `npm run dev`.** This Claude session itself runs inside a Nest-hosted
account (`HOME` redirected to `...\accounts\claude\Gero Personal`), and Electron's
single-instance lock is unconditional (`app.requestSingleInstanceLock()`, no
`isPackaged` guard) — a naive `npm run dev` here will collide with whatever Nest
instance owns that `userData` dir and silently `app.quit()` (exit 0, no window, no
error dialog beyond a `gpu_disk_cache` warning). See the `running-nest-dev-alongside-
host` project memory for the full story.

1. **Copy a working `.env.local`** into this worktree — it has none (only the merged
   `.env.example`). E.g. from the sibling worktree:
   ```
   cp "C:\Users\gerod\Dev\raven-nest\.claude\worktrees\integrations\.env.local" "C:\Users\gerod\Dev\raven-nest\.claude\worktrees\memory-smoke\.env.local"
   ```
   Then add the `MAIN_VITE_SUPABASE_URL` line this branch's `.env.example` now documents
   (same value as `VITE_SUPABASE_URL`) if it's not already there, so the memory sync
   daemon can resolve it.

2. **Isolate storage** — don't point this smoke branch at your real `.raven-nest` data.
   Set `RAVEN_HOME` to a throwaway directory so the bridge's test writes don't land in
   your actual memory.db:
   ```powershell
   $env:RAVEN_HOME = "C:\Users\gerod\.raven-nest-smoke-memory-bridge"
   ```

3. **Launch with a dedicated `--user-data-dir`** (double `--` — the first is npm's, the
   second is electron-vite's passthrough) so it doesn't fight the single-instance lock
   with any other running Nest instance:
   ```
   npm run dev -- -- --user-data-dir="C:/Users/gerod/.raven-nest/accounts/claude/Gero Personal/AppData/Roaming/nest-memory-smoke"
   ```
   You'll need to sign in fresh (new `userData` = logged out).

4. **What to look at:**
   - Settings → the "Nest Memory" card. It starts disconnected ("Local memory active —
     cloud sync is a Pro feature" or a "Connect" button, plan-dependent). Click
     **Connect** — until this flips `memoryConnectionState.connected` to true, the
     adapter no-ops on every write (by design, §2 above).
   - Once connected, the card shows `{itemCount} items · synced` (or `· N pending`).
     Note the starting count.
   - Trigger a graph-orchestration write: open the Integrations/Graph board, start (or
     resume) a run, and **approve a gate** — that's the most direct trigger, since gate
     approval goes straight from the IPC handler (`main.ts` ~line 3428) through
     `bridgeDecision` into `memorySink.save()`. A node finishing (`node_done`) or a run
     closing also fires writes via `bridgeEvent`.
   - Watch the item count in Settings tick up after the approval. That's the actual
     signal the bridge worked end-to-end (in-process → `MemoryStore.save()` → SQLite →
     mutation_log → debounced push).
   - For a closer look at the row itself (source, project_key, content) without leaving
     the terminal: the local db is at `<RAVEN_HOME>\.raven-nest\memory\memory.db`. Since
     the system-Node build of `better-sqlite3` is blocked (§3), a plain `node -e
     "require('better-sqlite3')..."` script won't load it — run it under Electron's own
     Node instead (matches the ABI actually built): `ELECTRON_RUN_AS_NODE=1
     node_modules\electron\dist\electron.exe -e "..."`, or just query it from within a
     Claude Code pane inside the app itself via the `memory_search`/`memory_context` MCP
     tools (those go through the same in-process socket, same working binary).

## Files touched

- `electron/main.ts` — adapter (`memorySink`), removed unused `NULL_SINK` import.
- `.env.example` — merge conflict resolution (kept both branches' additions).
- Everything else in the diff is the untouched merge of `feat/nest-memory-phase1`.
