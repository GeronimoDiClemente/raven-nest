# Per-device local repo paths — v1.2 design

**Status**: approved (brainstorming) — pending implementation plan
**Target release**: `v1.2.0`
**Bugfix scope**: also fixes the "Teams crashes when local folder is missing" regression.

## Problem

Today, the absolute local path of a cloned repo is persisted in Supabase, keyed only by user (per-account, NOT per-device):

- **My Repos** — `user_repos.local_path` (one string per `(user_id, repo)`).
- **Teams** — two layers: `team_repos.local_path` (team-shared) and `team_repo_local_paths.local_path` keyed by `(team_repo_id, user_id)`.

When the same account signs in on a second machine (different OS, different home dir, remote desktop, etc.), the path read from Supabase points to the original machine and does not exist on the current one. The current behaviour diverges between the two surfaces:

- **My Repos** detects `pathUtils.exists(path) === false` and opens a Clone/Link dialog (correct UX).
- **Teams** does the same in the happy path, but `TeamsWorkspace.handleOpenTerminal` calls `window.git.getRemoteUrl(repo.local_path)` **without** a try/catch (`src/components/TeamsWorkspace.tsx:239`). When git fails (folder exists but isn't a repo, git binary missing, permission error), the unhandled rejection breaks the handler before `setCloneTarget(repo)` is reached → the user clicks "Terminal" and nothing happens, or the global `ErrorBoundary` is triggered. Reported in the field as "Teams crashes silently".

## Goal

- Local repo paths become **per-device**. A user signed into account X on PC1 and PC2 can have different paths (or no path) on each, and the app never assumes one machine's path applies on another.
- When an account signs in on a machine that has never seen Nest, every repo appears in My Repos/Teams **without** a local path. The user is offered Clone or Link existing folder, exactly like a brand-new repo.
- Teams handles the missing-folder/missing-git case with the same Clone/Link dialog as My Repos. No silent failure, no `ErrorBoundary`.
- Existing v1.1.x users keep their current local path on their primary machine (one-shot migration).
- v1.1.x clients keep working unchanged during the transition — the new client does not write to the deprecated Supabase columns.

## Non-goals

- Sharing paths across devices (e.g. "show me where I cloned this on my other machine"). Out of scope; the model is strictly per-device.
- Generating a stable device identifier. We do not need one — `app.getPath('userData')` is already per-OS-user-per-machine, so the local store implicitly identifies the device.
- Dropping the deprecated Supabase columns. That happens in a separate v1.3 release once v1.1.x usage is residual.
- Changing the lifecycle of `team_repos` (still shared at team level — only paths leave Supabase).

## Architecture

Three layers:

```
┌─────────────────────────────────────────────────────────┐
│ Renderer (React)                                        │
│   useUserRepos / useTeamRepos                           │
│     - reads metadata (id, full_name, url, …) from       │
│       Supabase                                          │
│     - reads localPath from window.localPaths.getAll()   │
│     - writes localPath via window.localPaths.set/delete │
└────────────────────────┬────────────────────────────────┘
                         │ contextBridge (preload)
                         │   window.localPaths.{get,set,delete,
                         │                       getAll,
                         │                       getMigrationFlag,
                         │                       setMigrationFlag}
┌────────────────────────┴────────────────────────────────┐
│ Main (Electron)                                         │
│   electron/local-paths-store.ts                         │
│     - JSON file: app.getPath('userData')/local-paths.json│
│     - shape: { paths: {repoId: path}, migrations: {…} } │
│   electron/main.ts                                      │
│     - ipcMain.handle('localPaths:…')                    │
│                                                         │
│ Migration runs in renderer (App.tsx hook) — uses the    │
│ already-authenticated supabase-js client.               │
└─────────────────────────────────────────────────────────┘
```

### Conceptual model

- **Device** = one Nest install (one `userData` directory). No explicit device-id; the store's existence on that filesystem implicitly identifies it.
- **Local path** = `(user, device, repo_id)` → `path | null`. Lives only in the local store of that device.
- Supabase keeps the repo **list** (`user_repos`, `team_repos`) without path. The columns `user_repos.local_path`, `team_repos.local_path`, and the entire `team_repo_local_paths` table become **deprecated** (read-only during the v1.2 migration window, dropped in v1.3). Note: `team_repos.local_path` was the legacy "team-shared" path; the new client never writes to it and the migration does not import from it (it was not user-attributed and could be set by any team member).

### Module boundaries

- `local-paths-store.ts` only knows `repoId → path` and `flagKey → value`. It does not know about Supabase, teams, or users — it is a generic key-value store.
- Migration logic lives in `src/hooks/useLocalPathsMigration.ts` (renderer). The store has no Supabase awareness.
- The React hooks (`useUserRepos`, `useTeamRepos`) keep their outward API: callers still see `repo.local_path: string | null`. The change is internal.

## Components

### New files

- `electron/local-paths-store.ts` — pattern matches `electron/worktree-store.ts` and `electron/preset-store.ts`.
  ```ts
  // API (sketch)
  initLocalPathsStore(): void
  getLocalPath(repoId: string): string | null
  setLocalPath(repoId: string, path: string): void
  deleteLocalPath(repoId: string): void
  getAllLocalPaths(): Record<string, string>
  getMigrationFlag(key: string): string | null
  setMigrationFlag(key: string, value: string): void
  ```
- `src/hooks/useLocalPathsMigration.ts` — runs once per `(user_id, flag-version)` at boot, after auth is ready. Imports paths from Supabase, validates with `pathUtils.exists`, writes to the local store, sets the flag.

### Modified files

#### Main
- `electron/main.ts` — register `ipcMain.handle('localPaths:get'|'localPaths:set'|'localPaths:delete'|'localPaths:getAll'|'localPaths:getMigrationFlag'|'localPaths:setMigrationFlag')`. Call `initLocalPathsStore()` during app initialization.
- `electron/preload.ts` — expose `window.localPaths` via `contextBridge.exposeInMainWorld`.
- `src/types.ts` — type declarations for `window.localPaths`.

#### Renderer
- `src/hooks/useUserRepos.ts`:
  - Drop `local_path` from the Supabase select. The migration hook reads it separately and only once.
  - Merge `localPaths[repo.id]` into the returned `repos`.
  - `updateLocalPath(repoId, path)` → call `window.localPaths.set` / `window.localPaths.delete`. **Never** writes to `user_repos.local_path` anymore.
  - `removeRepo` also calls `window.localPaths.delete(repoId)` after deleting the Supabase row.
- `src/hooks/useTeamRepos.ts`:
  - Same as above.
  - `userLocalPaths` is built from the local store filtered by team repo IDs.
  - The fallback to `repo.local_path` (team-shared) is removed.
- `src/components/TeamsWorkspace.tsx`:
  - **Bug fix**: wrap the `window.git.getRemoteUrl(userPath)` call (line 239 today) in try/catch, matching `MyReposPanel.tsx:145-164`. On throw, fall through to `setCloneTarget(repo)`.
  - Remove the team-shared `repo.local_path` fallback branch.
- `src/components/MyReposPanel.tsx`:
  - Already opens the right dialog. Only verify the new `repo.local_path` source is wired correctly. No behaviour change.
- `src/App.tsx`:
  - Mount `useLocalPathsMigration()` once after auth is ready and before opening Teams/My Repos.

#### Supabase (no changes this release)
- `user_repos.local_path` stays. v1.2.x clients never write to it. v1.1.x clients keep using it.
- `team_repo_local_paths` table stays. Same logic.
- v1.3 will drop both. Out of scope here.

## Data flow

### Read (UI render)

```
MyReposPanel mount
  → useUserRepos.refresh()
      ├─ supabase.from('user_repos').select(id, repo_full_name, repo_url, provider, ...)
      └─ window.localPaths.getAll() → Record<repoId, path>
  → repos.map(r => ({ ...r, local_path: localPaths[r.id] ?? null }))
```

Identical shape for `useTeamRepos`.

### Write (link / clone / unlink)

```
user picks a folder
  → handleLinkExisting(repo)
  → window.git.pickRepoFolder(repo.repo_url) → folder | null
  → updateLocalPath(repo.id, folder)
      ├─ window.localPaths.set(repo.id, folder)   // IPC
      └─ optimistic state merge (local_path = folder)
```

Unlink: same with `delete` instead of `set`.

### One-shot migration

```
App mount (after auth ready)
  → useLocalPathsMigration()
      1. flagKey = `paths-v1:${currentUser.id}`
         if (window.localPaths.getMigrationFlag(flagKey) === 'done') return
      2. const userRepoRows = await supabase
            .from('user_repos').select('id, local_path').not('local_path', 'is', null)
      3. const teamPathRows = await supabase
            .from('team_repo_local_paths')
              .select('team_repo_id, local_path')
              .eq('user_id', currentUser.id)
      4. for each row with a path:
           if (await window.pathUtils.exists(path))
             window.localPaths.set(row.id ?? row.team_repo_id, path)
      5. window.localPaths.setMigrationFlag(flagKey, 'done')
```

Notes:
- The migration **never** writes to Supabase. The columns stay readable for v1.1.x clients.
- The flag is keyed by `user_id` so two accounts on the same machine each migrate once.
- If step 2 or 3 throws, the flag is **not** set. The next boot retries. No partial state corruption.

### Storage file shape

`<userData>/local-paths.json`:

```json
{
  "paths": {
    "<repoId>": "<absolutePath>"
  },
  "migrations": {
    "paths-v1:<userId>": "done"
  }
}
```

Atomicity: write to `.tmp` then rename, same pattern as `electron/preset-store.ts`.

## Error handling

| Source | Failure mode | Behaviour |
|---|---|---|
| `TeamsWorkspace.handleOpenTerminal` calling `getRemoteUrl` | Promise rejects (git missing, folder is not a repo, perms) | **(fix)** caught by new try/catch → falls into `setCloneTarget(repo)` → user sees Clone/Link dialog. Identical to MyReposPanel. |
| `window.localPaths.set` | IPC throw, fs write fail | `console.warn`, hook does not update state. UI keeps the previous path. Next refresh retries. |
| `window.localPaths.getAll` | fs read fail, JSON parse fail | Store renames the corrupt file to `local-paths.<ts>.corrupt.bak`, returns `{}`. Renderer sees no paths → offers Link/Clone on each repo. Non-destructive. |
| Migration: Supabase select fails | Network, RLS, etc. | Flag **not** set. Next boot retries. `console.warn`. |
| Migration: row has an invalid path | `pathUtils.exists` returns false (or throws — treated as false) | Row skipped, migration continues with the rest. |
| `pathUtils.exists` throws | Network mount unreachable | Treated as `false`. No crash. |

## Testing

### Automated

`electron/__tests__/local-paths-store.test.ts` (new):
- `getLocalPath` returns `null` for unknown repo
- `setLocalPath` + `getLocalPath` round-trip
- `deleteLocalPath` removes the entry
- `getAllLocalPaths` returns the full map
- Corrupted JSON → renames to `.corrupt.<ts>.bak` and returns `{}`
- `getMigrationFlag` / `setMigrationFlag` round-trip

`src/__tests__/hooks/useLocalPathsMigration.test.ts` (new) — uses mocked `supabase` and `window.localPaths`:
- Skips entirely if flag is already `done`
- Imports rows from `user_repos.local_path` when `pathUtils.exists → true`
- Skips rows when `pathUtils.exists → false`
- Imports `team_repo_local_paths` filtered by `user_id`
- Sets the flag only on full success
- Does NOT set the flag if a Supabase select throws

`src/__tests__/components/TeamsWorkspace-open-terminal.test.tsx` (new) — regression for the crash:
- Mock `window.pathUtils.exists → true`, `window.git.getRemoteUrl` throws
- Assert: handler does not propagate, `cloneTarget` is set, dialog renders

### Manual smoke (cross-OS — required for tag)

See section "Pre-release QA checklist" below.

## Pre-release QA checklist (required before tagging v1.2.0)

Run on Windows + Mac + Linux, minimum one machine per OS.

**Golden path**
- [ ] Fresh install (no migration): add a repo in My Repos → link a folder → open terminal → restart app → path persists.
- [ ] Same for Teams.
- [ ] Path deleted from disk manually → Terminal opens Clone/Link dialog, no crash.
- [ ] Path points to a different repo (remote mismatch) → Clone/Link dialog.

**Migration**
- [ ] Boot with a valid `user_repos.local_path` in Supabase AND folder present on disk → path imported, visible in UI.
- [ ] Boot with path in Supabase but folder missing on disk → not imported, UI offers Link/Clone.
- [ ] Already-migrated boot (flag set) → no re-read from Supabase.
- [ ] Manually delete `userData/local-paths.json` → next boot re-runs migration (expected).
- [ ] Two accounts on the same machine → each migrates once, keyed by user_id.

**Cross-version compatibility**
- [ ] PC1 on v1.1.x + PC2 on v1.2.0, same account: PC1 keeps working unchanged. PC2 shows imported paths but writes only to local store.
- [ ] PC1 (v1.1.x) changes a path → PC2 (v1.2.0) does NOT pick it up (expected — paths are per-device).

**Controlled failures**
- [ ] Supabase unreachable during migration → app boots, UI shows no paths, flag NOT set, next boot retries.
- [ ] Corrupted `local-paths.json` → renamed to `.corrupt.<ts>.bak`, store empty, no crash.
- [ ] Automated Teams crash-regression test passes.

**Specific reproduction of the original report**
- [ ] Clone repo on a second PC with Gero's account → open Teams → no crash, Clone/Link dialog appears.
- [ ] Same for My Repos.

**Build & install**
- [ ] CI build passes for Win/Mac/Linux.
- [ ] Auto-updater path v1.1.x → v1.2.0 succeeds on one machine.
- [ ] Mac DMG signed + stapled (same process as v1.1.2+).

## Rollout

1. PR to `main` with all changes and automated tests green.
2. `code-review:code-review` agent + manual review.
3. Build a pre-release candidate (`v1.2.0-rc.1`): install manually on at least one machine per OS, run the QA checklist end-to-end.
4. If checklist passes: tag `v1.2.0` and trigger the official `Build (Windows, Mac, Linux)` workflow (see CLAUDE.md "Hacer una release").
5. If something breaks: fix → `v1.2.0-rc.2` → repeat.
6. **Rollback strategy**: v1.1.x clients keep working — the deprecated Supabase columns are never written by v1.2.0, so downgrading any single machine to v1.1.x is safe. The local store persists across downgrade/upgrade, so a v1.2.0 user who downgrades and re-upgrades does not lose data.

## Alternatives considered

- **Per-device storage in Supabase with `device_id`**: would let users see "what path did I use on PC X" cross-device. Rejected: more schema, more code, no concrete user need, weakens privacy (paths exposed in the cloud).
- **Local + Supabase mirror**: same downsides plus a sync model. Rejected for the same reasons.
- **Lazy migration** (only when My Repos/Teams opens): less predictable, first click slower, harder to reason about. Rejected in favour of the one-shot at boot.
- **Drop Supabase columns in the same release**: simpler schema state, but blocks rollback and breaks v1.1.x clients that don't auto-update immediately. Deferred to v1.3.
- **Key the local store by `repo_full_name`** (instead of `repo_id`): portable across delete/re-add, but conflates My Repos and Teams entries for the same upstream. We pick `repo_id` to match the existing data model.

## Open questions

None at design time. Implementation plan will surface any.
