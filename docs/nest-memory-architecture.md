# Nest Memory — Architecture Design

> Status: **Design proposal** (not implemented)
> Author: architecture pass, 2026-07-30
> Scope: Raven Nest's own cloud-backed agent memory system — first-party IP.

---

## 0. Executive summary

Nest Memory gives every AI CLI running inside Nest (Claude Code, Codex, Gemini, and any
future CLI) a **shared, persistent, cross-device memory** that the user never has to
manage. One click in Settings → Account connects it. From then on, memory is captured
automatically while the user works, and replicated to the user's cloud partition in the
background. There is no sync button and there never will be one.

Five load-bearing decisions:

| # | Decision | Why |
|---|----------|-----|
| 1 | **One local store per user, not per AI account.** `{ravenHome}/.raven-nest/memory/memory.db` | Memory belongs to the human, not to the CLI. Claude learns something, Codex should know it. This is the single biggest differentiator vs. per-tool memory plugins. |
| 2 | **The sync daemon lives in the Electron main process.** | Main is the only place with app lifecycle, network state, `safeStorage`, and a single-writer guarantee. N CLI processes each syncing would mean N token copies and N racing pushers. |
| 3 | **The MCP server is a thin stdio shim; the daemon owns SQLite.** | One write path → one place to trigger sync, one place to enforce redaction, and no native SQLite binding shipped into child processes. |
| 4 | **Auto-capture always writes `personal` scope. Promotion is always manual.** | The Cursor Memories backlash was about implicit sharing. Private by default, explicit promotion, visible diff before anything becomes team-readable. |
| 5 | **Tokens carry identity, not baked-in authorization.** | Team membership changes constantly. Authorization is evaluated per request against current membership, so removing a member takes effect on the next call — no stale scopes in a long-lived token. |

Engram (github.com/Gentleman-Programming/engram) is **reference only**. Nest Memory
borrows a handful of proven concepts — globally-unique client-generated replication IDs,
an append-only mutation log, `topic_key` as the merge unit, per-project enrollment, MCP as
the agent-facing surface — and shares no code, no schema, and no dependency with it.

---

## 1. Component overview

```
┌────────────────────────────────── Electron main process ──────────────────────────────────┐
│                                                                                            │
│   pty-manager.ts ──► spawns pane PTY with HOME={accountDir} + NEST_MEMORY_* env            │
│         │                                                                                   │
│   memory-provisioner.ts ──► writes MCP config + hooks into {accountDir} (per AI type)      │
│         │                                                                                   │
│   ┌─────▼──────────────┐      ┌──────────────────┐      ┌────────────────────────────┐     │
│   │  memory-daemon.ts  │◄────►│  memory-store.ts │◄────►│ memory.db (SQLite + FTS5)  │     │
│   │  (sync scheduler)  │      │  (single writer) │      │  ~/.raven-nest/memory/     │     │
│   └─────┬──────────────┘      └──────────────────┘      └────────────────────────────┘     │
│         │                              ▲                                                    │
│         │                              │ local IPC (named pipe / unix socket)               │
│         │                     ┌────────┴───────────┐                                        │
│         │                     │ memory-ipc-server  │                                        │
│         │                     └────────┬───────────┘                                        │
└─────────┼──────────────────────────────┼────────────────────────────────────────────────────┘
          │ HTTPS (Bearer nmk_…)         │
          │                     ┌────────▼───────────┐   spawned by each AI CLI, one per session
          │                     │ nest-memory-mcp    │   (stdio MCP server, stateless shim)
          │                     └────────┬───────────┘
          │                              │ stdio MCP
          │                     ┌────────▼───────────┐
          │                     │ claude / codex /   │
          │                     │ gemini CLI in pane │
          │                     └────────────────────┘
          │
┌─────────▼──────────────────────────── Supabase ────────────────────────────────────────────┐
│  edge fn: memory-token (issue/rotate/revoke)   edge fn: memory-sync (push/pull/bootstrap)   │
│  Postgres: memory_projects, memory_observations, memory_project_shares, memory_tokens,      │
│            memory_devices, memory_promotions   +  RLS (dashboard path) + SECURITY DEFINER    │
│            RPCs (daemon path)                                                                │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1.1 Local MCP server (`nest-memory-mcp`)

An MCP server over stdio, spawned by each AI CLI from the CLI's own MCP config. It holds
**no state and no database handle**. Every tool call is forwarded over a local IPC channel
to the daemon in Electron main:

- Windows: named pipe `\\.\pipe\nest-memory-{userSid}`
- macOS/Linux: unix socket `{ravenHome}/.raven-nest/memory/daemon.sock` (mode 0600)

The shim reads `NEST_MEMORY_SOCKET`, `NEST_MEMORY_ACCOUNT`, and `NEST_MEMORY_AI` from its
env (injected by `pty-manager.ts`, inherited by the CLI, inherited by the shim), and sends
its own `process.cwd()` on every call so the daemon can resolve the project.

**Recommended implementation language: TypeScript on Node.**

| | TypeScript / Node | Go |
|---|---|---|
| Runtime shipped | none — reuse `process.execPath` with `ELECTRON_RUN_AS_NODE=1` | +6 static binaries (win/mac/linux × x64/arm64) in `extraResources` |
| Cold start | ~50–70 ms | ~5 ms |
| Build matrix | none (already in the electron-vite build) | new CI stage, cross-compilation, code signing on macOS |
| Type sharing | shares `src/types.ts` with the daemon | duplicated protocol types, drift risk |
| Team fit | the whole repo is TS | second language for one 400-line binary |

The shim is spawned **once per CLI session**, not per tool call, so the ~60 ms startup cost
is paid once and is invisible. Since the shim contains no SQLite, no FTS, and no crypto —
it is literally a JSON-RPC pipe adapter — Go's advantages do not apply here. **Go would be
justified only if we later ship a headless `nest-memory` CLI for use outside the app**;
keeping the daemon protocol language-neutral (newline-delimited JSON) preserves that
option. Engram chose Go because it *is* the standalone binary; ours is not.

MCP tool surface (details in §2.1): `memory_search`, `memory_context`, `memory_save`,
`memory_update`, `memory_get`, `memory_suggest_promotion`.

### 1.2 Local SQLite store (`memory-store.ts`)

- **Driver:** `better-sqlite3` (synchronous, fastest for a single-writer main-process store,
  bundles FTS5). Requires adding it to the existing `postinstall` rebuild:
  `electron-rebuild -f -w node-pty -w better-sqlite3`.
  `node:sqlite` is *not* an option: Electron 33 ships Node 20.18, and `node:sqlite` landed
  in Node 22.5.
- **Location:** `{ravenHome()}/.raven-nest/memory/memory.db`, WAL mode, `synchronous=NORMAL`.
  Deliberately **outside** any `{accountDir}` so it is not redirected by the per-account
  HOME rewrite and is shared by every AI account.
- **Authority:** the local store is authoritative. The terminal works with the network
  unplugged, forever. Cloud is replication, not the source of truth.

### 1.3 Background sync daemon (`memory-daemon.ts`) — in Electron main

Justification for main-process (not per-CLI, not a separate service process):

1. **Credentials.** Only main can call `safeStorage.encryptString` (already wired at
   `electron/main.ts:1779`). A per-CLI daemon would need the memory token copied into every
   pane's environment — a token in `process.env` of a shell the user types into is a leak
   waiting for the first `env | grep -i token`.
2. **Single writer.** Debounce, batching, and the `mutation_log` push cursor only work if
   exactly one process advances them. N panes = N racing pushers on the same rows.
3. **Lifecycle signals.** `browser-window-focus`, `online`/`offline`, and app-quit are
   main-process events. They are the sync triggers (§4.1) — **not** `before-quit` itself,
   see the correction there; the *signal class* (main-process lifecycle events) is still
   the point being made here.
4. **Outlives panes.** The offline queue must survive a pane restart, a CLI crash, and a
   `worktree:remove` that kills every PTY in a directory (`pty-manager.ts:211`).
5. **Already the choke point.** `pty-manager.ts:39-57` is where HOME/USERPROFILE/GEMINI_CLI_HOME
   are rewritten per AI account. Memory provisioning belongs in the same place, for the same
   reason: it is the one function every AI pane passes through.

The daemon is a module inside main, not a child process. It runs on a timer plus an event
bus; SQLite calls are synchronous and sub-millisecond, and the HTTP calls are `await`ed off
the hot path.

### 1.4 Supabase backend

Reuses the existing production project (auth, `profiles` with `plan` + Stripe, `teams`,
`team_members`, RLS, edge functions, `nest://` deep link). Two new edge functions and six
new tables — schema in §3.2.

Two access paths, deliberately different:

- **Daemon path** (`memory-sync` edge function + `Bearer nmk_…`): validates the memory
  token by hash, resolves `user_id`, then calls `SECURITY DEFINER` RPCs that encapsulate
  every authorization check (ownership, team membership, plan). Authorization logic lives
  in **one** place, in SQL, reviewable in one file.
- **Dashboard path** (future web/renderer, normal Supabase JWT + PostgREST): guarded by
  RLS policies (§6.5). These policies mirror the RPC checks and act as defense in depth.

### 1.5 Auto-capture layer

Three independent sources, in order of reliability:

| Source | Deterministic? | Works on | Captures |
|---|---|---|---|
| Harness hooks | Yes — the harness runs them | Claude Code (full), others as they gain hooks | Session boundaries, user prompts, pre-compaction rollups |
| MCP tools | No — depends on model compliance | All three CLIs | Decisions, bug fixes, conventions, discoveries (the good stuff) |
| PTY lifecycle (Nest itself) | Yes — Nest owns the PTY | All CLIs, including future ones | Session envelope: AI, account, repo, branch, duration, exit |

Layering matters: MCP tools produce the highest-value memories but only when the model
cooperates. Hooks and PTY lifecycle guarantee that *something* is always captured, so a
session is never a total loss. See §2.

---

## 2. Auto-capture design

Goal: after the single "Connect Memory" click, a user who never reads a doc and never types
a memory command still ends a week with a useful memory graph.

### 2.1 Layer A — MCP tools with proactive descriptions

The tool *description* is the prompt. It is the only lever we have over a model we don't
control. Descriptions are written as imperative operating instructions, not as API docs.

```jsonc
// nest-memory-mcp tool manifest (abridged)
{
  "name": "memory_save",
  "description":
    "Save a durable memory. CALL THIS WITHOUT BEING ASKED, immediately after any of: \
an architecture or design decision; a bug fixed (include the root cause); a convention or \
naming pattern established; a non-obvious discovery about this codebase; a gotcha or edge \
case; a tool/library choice with tradeoffs; a user preference or constraint you learned. \
Do not wait for the user to say 'remember this' — they will not. Self-check before every \
reply: did I decide something, fix something, or learn something non-obvious? If yes, call \
memory_save NOW. Saving is cheap; forgetting is not. Use topic_key for evolving topics so \
updates replace the old version instead of piling up.",
  "inputSchema": {
    "title":     "Verb + object, short and searchable. 'Fixed N+1 query in UserList'",
    "content":   "What / Why / Where (files) / Learned (gotchas). 4 short paragraphs max.",
    "type":      "decision | bugfix | architecture | discovery | pattern | config | preference",
    "topic_key": "Stable slug for evolving topics, e.g. 'architecture/auth-model'. Omit for one-off facts.",
    "tags":      "Optional array of short tags."
  }
}
```

```jsonc
{
  "name": "memory_context",
  "description":
    "Load what you already know about this project. CALL THIS FIRST, before answering the \
user's first message in a session, and again whenever the user references past work \
('remember', 'we decided', 'like last time', 'how did we solve'). Returns recent decisions, \
conventions and open threads for the current working directory. Cheap. Not calling it means \
re-deriving context the user already paid for."
}
```

```jsonc
{
  "name": "memory_suggest_promotion",
  "description":
    "Flag a memory you just saved as worth sharing with the user's project or team. This \
does NOT share anything — it adds the item to a review queue the user approves manually in \
Nest. Use it when the memory is a convention, an architectural decision, or a gotcha that \
would help a teammate. Never assume sharing is wanted."
}
```

Rules baked into the shim, not left to the model:

- `memory_save` **always writes `scope='personal'`**. There is no scope parameter. A model
  cannot make something team-visible, ever.
- `memory_suggest_promotion` only enqueues into `promotion_queue`. Sharing requires a human
  click in the Nest UI (§7.3).
- Every write passes the redaction filter (§6.6) before it touches disk.

### 2.2 Layer B — harness hooks, injected by Nest

**Claude Code** has the richest hook surface, and Nest controls its HOME, so we install:

| Hook | What Nest installs it to do |
|---|---|
| `SessionStart` | Open a `sessions` row; return `additionalContext` containing the top-N relevant memories for this cwd + an instruction to call `memory_context` before the first reply. |
| `UserPromptSubmit` | Record the prompt text into the open session (provenance + "what was asked"). Never leaves the local store unless the session produces a memory. |
| `PreCompact` | Force a session rollup before context is lost. This is the highest-value hook: compaction is exactly when memory would otherwise be destroyed. |
| `Stop` / `SessionEnd` | Close the session; enqueue a rollup job (§2.4). |
| `SubagentStop` | Pass the subagent's output through a passive extractor that pulls out structured learnings and saves them, deduped. Subagents do the most exploration and save the least — this recovers work that would otherwise evaporate. |

**The save nudge.** `UserPromptSubmit` also tracks time-since-last-save for the session. If
a session is older than 5 minutes and nothing has been saved in the last 15, the hook injects
a short `systemMessage`: *"No memory saved in 15 minutes. If you made a decision, fixed a
bug, or learned something non-obvious, call `memory_save` now."* Cooldown 15 min, so it can
fire at most a few times per session. This is a deterministic counter-pressure against R-1
(model non-compliance) and it costs nothing when the model is already behaving. It is the
single highest-leverage trick available, because it converts "hope the model complies" into
"remind the model exactly when it hasn't".

**Tool-loading discipline.** Only six tools load eagerly: `memory_context`, `memory_search`,
`memory_save`, `memory_update`, `memory_get`, `memory_suggest_promotion`. Anything
administrative (stats, timeline, merge, doctor) is deferred behind tool search. A large tool
manifest dilutes attention and makes the model *less* likely to call the two that matter.

Each hook is a one-line command invoking the shim in hook mode:

```jsonc
{ "type": "command",
  "command": "nest-memory hook session-start",
  "timeout": 5 }
```

`nest-memory` resolves to Electron's own binary with `ELECTRON_RUN_AS_NODE=1` and an
absolute path to the bundled shim — no PATH pollution, no npm install, no user action.

**Codex** and **Gemini CLI** have no equivalent hook system today. They get Layer A + Layer C.
When they ship hooks, the provisioner gains a new adapter; nothing else changes.

### 2.3 Layer C — PTY lifecycle capture (harness-agnostic)

Nest already knows when a pane is created and when it exits (`pty-manager.ts` emits `exit`,
`main.ts:711`), what the cwd is (`cwd-reader.ts` reads the live process cwd on all three
platforms), what repo and branch it is on (`git:info` at `main.ts:223`), and which AI and
account it belongs to. On pane exit the daemon writes a session envelope observation:

> *Session: claude / account "Bautista" / raven-nest @ main / 42 min / 1 pane*

This is metadata only. **Terminal output is never persisted as memory by default** — it is
noisy, it is full of secrets, and it is the single fastest way to lose user trust. Opt-in
transcript capture is deliberately deferred past Phase 3 (see §10).

### 2.4 Session rollup

When a session closes (Stop hook, PreCompact hook, or PTY exit), the daemon has: the
prompts, the memories saved during the session, and the envelope. It writes one
`type='session'` observation with `topic_key = 'session/{project}/{date}/{n}'` summarizing
goal, discoveries, and next steps. Rollup is **template-based, not model-based** in Phase 1
(concatenate + trim) — calling a model from the daemon would need an API key we don't have
and would cost money the user didn't agree to. Phase 3 can offer optional local
summarization.

### 2.5 Provisioning: how Nest injects config into each account

New module `electron/memory-provisioner.ts`, called from `AccountStore.save()`,
`AccountStore.migrateClaudeAccounts()` (startup), and defensively from `PtyManager.create()`
before spawn.

**Per-AI config targets** (all inside `{accountDir}`, which is that pane's HOME):

| AI | MCP config | Hooks |
|---|---|---|
| `claude` | `{accountDir}/.claude.json` → `mcpServers.nest_memory` | `{accountDir}/.claude/settings.json` → `hooks` |
| `codex` | `{accountDir}/.codex/config.toml` → `[mcp_servers.nest_memory]` | n/a |
| `gemini` | `{GEMINI_CLI_HOME}/settings.json` → `mcpServers.nest_memory` (`GEMINI_CLI_HOME` = `{accountDir}/gemini`, set at `pty-manager.ts:53-57`) | n/a |

**Env injected at `PtyManager.create()`** (alongside the existing HOME rewrite):

```ts
env.NEST_MEMORY_SOCKET  = daemonSocketPath()
env.NEST_MEMORY_ACCOUNT = `${aiType}:${accountName}`
env.NEST_MEMORY_AI      = aiType
env.NEST_MEMORY_PANE    = paneId
env.NEST_MEMORY_ENABLED = connected ? '1' : '0'
```

`pty-manager.create()` currently takes `(paneId, cmd, accountDir, repoPath, shell)` and does
not know the account *name* or AI type — `accountDir` is `.../accounts/{aiType}/{name}`, so
both are derivable by parsing, but a small signature change to pass them explicitly is
cleaner and is the only change needed in that file.

**⚠ The shared-config hazard (verified in code).**
`account-store.ts:83-105` symlinks (or, on Windows without Developer Mode, *hardlinks*)
`~/.claude/settings.json` into each Claude account. If the provisioner naively writes hooks
into `{accountDir}/.claude/settings.json`, it mutates the user's **global** `~/.claude/settings.json`
— polluting every Claude Code session on the machine, inside Nest or not. That is
unacceptable.

Two mitigations, in preference order:

1. **Preferred — never touch `settings.json`.** Launch Claude with an additional settings
   file that Nest owns exclusively:
   `claude --settings {accountDir}/.nest/memory-settings.json`, injected into `cmd` at
   `pty-manager.create()`. Nest's file contains only the memory hooks; the user's settings
   are untouched and the file can be regenerated on every launch. **Open question O-1:
   confirm current Claude Code supports `--settings` with an additive merge.**
2. **Fallback — copy-on-write.** Before writing, call the existing
   `isSharedWithGlobal(src, dest)` helper (`account-store.ts:41`, which correctly detects
   both symlinks and hardlinks via inode comparison). If the file is shared, detach that
   *single* file (copy, then write), and surface a one-time notice in the Connect Memory
   card: "Nest made this account's Claude settings independent so it could enable memory."
   Never silently mutate a shared file.

Provisioning is **idempotent and reversible**. Disconnecting memory removes the
`mcpServers.nest_memory` entry, removes the Nest hook block (matched by a
`"_nest": "memory"` marker key), and deletes `{accountDir}/.nest/`.

---

## 3. Data model

### 3.1 SQLite (local, authoritative)

```sql
-- ── Core records ────────────────────────────────────────────────────────────
CREATE TABLE observations (
  sync_id       TEXT PRIMARY KEY,       -- 32 hex chars, crypto.randomBytes(16). Client-generated,
                                        -- globally unique, never reassigned. THE replication identity.
  project_key   TEXT NOT NULL,          -- see §3.3; '__global__' for project-less memories
  scope         TEXT NOT NULL           -- 'personal' | 'project' | 'team'
                CHECK (scope IN ('personal','project','team')),
  topic_key     TEXT,                   -- stable slug; NULL = one-off fact
  type          TEXT NOT NULL,          -- decision|bugfix|architecture|discovery|pattern|config|preference|session
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  tags          TEXT,                   -- JSON array
  source        TEXT NOT NULL,          -- 'mcp' | 'hook' | 'pty' | 'import' | 'ui'
  origin_ai     TEXT,                   -- claude | codex | gemini | ...
  origin_account TEXT,
  git_branch    TEXT,
  author_user_id TEXT,                  -- Supabase uid once connected; NULL while local-only
  author_display TEXT,                  -- denormalized snapshot; survives account deletion
  content_hash  TEXT NOT NULL,          -- sha256(normalized title || '\n' || content) — dedupe + import idempotency
  revision_count INTEGER NOT NULL DEFAULT 0, -- bumped when a topic_key upsert rewrites this row
  duplicate_count INTEGER NOT NULL DEFAULT 0,-- bumped when an identical save is absorbed instead of inserted
  last_seen_at  INTEGER,                -- last time this memory was re-observed (ranking signal)
  created_at    INTEGER NOT NULL,       -- ms epoch
  updated_at    INTEGER NOT NULL,       -- ms epoch; LWW key
  lamport       INTEGER NOT NULL DEFAULT 0, -- monotonic per device; LWW tiebreak
  deleted       INTEGER NOT NULL DEFAULT 0, -- 1 = tombstone (content nulled, row retained)
  superseded_by TEXT,                   -- sync_id of the winner when a topic_key merge demoted this row
  source_ref    TEXT,                   -- external id from an importer (engram id, file path + heading)
  server_seq    INTEGER                 -- last server sequence this row was seen at; NULL = never synced
);

CREATE UNIQUE INDEX idx_obs_topic
  ON observations(project_key, scope, topic_key)
  WHERE topic_key IS NOT NULL AND deleted = 0 AND superseded_by IS NULL;

CREATE INDEX idx_obs_project_updated ON observations(project_key, updated_at DESC);
CREATE UNIQUE INDEX idx_obs_source_ref ON observations(source, source_ref)
  WHERE source_ref IS NOT NULL;

CREATE VIRTUAL TABLE observations_fts USING fts5(
  title, content, tags,
  content='observations', content_rowid='rowid', tokenize='unicode61'
);
-- + the three standard AFTER INSERT/UPDATE/DELETE triggers keeping FTS in sync.

-- ── Replication ─────────────────────────────────────────────────────────────
CREATE TABLE mutation_log (            -- append-only; the offline queue IS this table
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_id    TEXT NOT NULL,
  op         TEXT NOT NULL,            -- 'upsert' | 'delete' | 'promote'
  payload    TEXT NOT NULL,            -- full row snapshot as JSON (self-contained: replaying
                                       -- the log reproduces state without reading observations)
  created_at INTEGER NOT NULL,
  pushed_at  INTEGER                   -- NULL = pending. Push = SELECT … WHERE pushed_at IS NULL ORDER BY seq
);
CREATE INDEX idx_mutlog_pending ON mutation_log(seq) WHERE pushed_at IS NULL;

CREATE TABLE sync_state (              -- one row per replicated partition
  partition_key   TEXT PRIMARY KEY,    -- project_key, or '__account__' for account-level metadata
  cloud_project_id TEXT,
  pull_cursor     INTEGER NOT NULL DEFAULT 0,  -- last project_seq applied
  last_push_seq   INTEGER NOT NULL DEFAULT 0,
  last_success_at INTEGER,
  last_error      TEXT,
  failure_count   INTEGER NOT NULL DEFAULT 0
);

-- ── Projects & sessions ─────────────────────────────────────────────────────
CREATE TABLE projects (
  project_key  TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  root_path    TEXT,
  remote_url   TEXT,
  enrolled     INTEGER NOT NULL DEFAULT 1,  -- user can opt a repo out of memory entirely
  team_id      TEXT,                        -- non-NULL = shared with a team
  created_at   INTEGER NOT NULL
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  pane_id     TEXT, project_key TEXT NOT NULL,
  ai_type     TEXT, account TEXT, git_branch TEXT,
  started_at  INTEGER NOT NULL, ended_at INTEGER,
  prompt_count INTEGER NOT NULL DEFAULT 0,
  rolled_up   INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE session_prompts (          -- local only, never replicated, 30-day retention
  session_id TEXT NOT NULL, at INTEGER NOT NULL, text TEXT NOT NULL
);

-- ── Manual promotion & imports ──────────────────────────────────────────────
CREATE TABLE promotion_queue (
  sync_id    TEXT PRIMARY KEY,
  to_scope   TEXT NOT NULL,            -- 'project' | 'team'
  reason     TEXT,                     -- agent's rationale, shown to the user
  status     TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  created_at INTEGER NOT NULL
);

CREATE TABLE import_runs (
  id          TEXT PRIMARY KEY,
  source      TEXT NOT NULL,           -- 'engram' | 'claude-md' | 'agents-md' | 'gemini-md'
  source_path TEXT NOT NULL,
  cursor      TEXT,                    -- resume point (last engram rowid / last file processed)
  imported    INTEGER NOT NULL DEFAULT 0,
  skipped     INTEGER NOT NULL DEFAULT 0,
  state       TEXT NOT NULL,           -- running | done | failed | cancelled
  started_at  INTEGER NOT NULL, finished_at INTEGER, error TEXT
);
```

**The write path is a three-step resolution, not a blind insert.** Every `memory_save`
resolves in this order:

1. **`topic_key` upsert.** If `topic_key` is set and an active row exists for
   `(project_key, scope, topic_key)`, **rewrite that row in place** — new title/content,
   `revision_count += 1`, `updated_at = now`, **same `sync_id`**. Evolving topics stay one
   living document instead of accumulating 40 near-identical rows. Keeping the `sync_id`
   means the update replicates as a plain LWW upsert with no merge ambiguity.
2. **Content dedupe window.** No `topic_key` match → look for an active row with the same
   `content_hash` in the same `(project_key, scope, type)` within a 7-day window. On a hit,
   bump `duplicate_count` and `last_seen_at` and **return the existing `sync_id`** — an agent
   that saves the same fact three times in one session produces one memory, not three. The
   repeat is a *ranking signal*, not noise.
3. **Insert.** Only if both miss.

This is the difference between a memory store that stays useful at 10 000 items and one that
becomes an unsearchable pile. It also makes `memory_save` genuinely safe to call
aggressively — which is exactly what the tool descriptions in §2.1 tell the model to do.

**Tombstones are not a separate table.** A delete sets `deleted=1`, nulls `content`, bumps
`updated_at`, and appends a `delete` mutation. The row keeps its `sync_id` and timestamp, so
delete-vs-update merges use exactly the same LWW rule as everything else — no special case.
Tombstones are purged locally after 90 days *and* after `server_seq IS NOT NULL` (i.e. the
delete has been confirmed cloud-side).

### 3.2 Postgres (cloud, replica)

```sql
-- Projects a user has enrolled. Sharing is a property of the project, not the row.
CREATE TABLE memory_projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  project_key   text NOT NULL,
  display_name  text NOT NULL,
  remote_url    text,
  team_id       uuid REFERENCES teams ON DELETE SET NULL,   -- NULL = private to owner
  seq_counter   bigint NOT NULL DEFAULT 0,                  -- per-project monotonic cursor source
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, project_key)
);

CREATE TABLE memory_observations (
  sync_id        text PRIMARY KEY,                          -- client-generated, same value as SQLite
  user_id        uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,  -- author
  project_id     uuid NOT NULL REFERENCES memory_projects ON DELETE CASCADE,
  scope          text NOT NULL CHECK (scope IN ('personal','project','team')),
  topic_key      text,
  type           text NOT NULL,
  title          text NOT NULL,
  content        text NOT NULL,
  tags           jsonb NOT NULL DEFAULT '[]',
  origin_ai      text, origin_account text, git_branch text,
  author_display text NOT NULL,                             -- snapshot; survives member removal
  content_hash   text NOT NULL,
  client_created_at timestamptz NOT NULL,
  client_updated_at timestamptz NOT NULL,                   -- LWW key
  lamport        bigint NOT NULL DEFAULT 0,                  -- LWW tiebreak
  deleted        boolean NOT NULL DEFAULT false,
  superseded_by  text REFERENCES memory_observations(sync_id) ON DELETE SET NULL,
  project_seq    bigint NOT NULL,                            -- pull cursor; assigned under advisory lock
  server_updated_at timestamptz NOT NULL DEFAULT now(),
  -- personal rows are unique per author; project/team rows are unique per project
  topic_owner    uuid GENERATED ALWAYS AS
                   (CASE WHEN scope = 'personal' THEN user_id
                         ELSE '00000000-0000-0000-0000-000000000000'::uuid END) STORED
);

CREATE UNIQUE INDEX memory_obs_topic_uniq
  ON memory_observations (project_id, scope, topic_owner, topic_key)
  WHERE topic_key IS NOT NULL AND deleted = false AND superseded_by IS NULL;
CREATE INDEX memory_obs_pull ON memory_observations (project_id, project_seq);
CREATE INDEX memory_obs_author ON memory_observations (user_id, server_updated_at DESC);

CREATE TABLE memory_project_shares (
  project_id uuid REFERENCES memory_projects ON DELETE CASCADE,
  team_id    uuid REFERENCES teams ON DELETE CASCADE,
  shared_by  uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, team_id)
);

CREATE TABLE memory_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  device_id    uuid NOT NULL REFERENCES memory_devices ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,        -- sha256 hex. The plaintext is NEVER stored.
  token_prefix text NOT NULL,               -- 'nmk_' + first 6 chars, for display only
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at   timestamptz,                 -- NULL = no expiry; rotation is explicit
  revoked_at   timestamptz
);

CREATE TABLE memory_devices (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name       text NOT NULL,                 -- os.hostname()
  platform   text NOT NULL,
  app_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);

CREATE TABLE memory_promotions (            -- audit trail; never deleted
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_id    text NOT NULL,
  from_scope text NOT NULL, to_scope text NOT NULL,
  by_user    uuid NOT NULL REFERENCES auth.users ON DELETE SET NULL,
  at         timestamptz NOT NULL DEFAULT now()
);
```

### 3.3 Scope model, project keys, and ID strategy

**Scope** — three tiers, one direction:

```
personal ──manual──► project ──manual──► team
(private,           (private, but the     (visible to every active
 all my devices)     shareable unit)       member of project's team)
```

- **Auto-capture writes `personal`. Always. Without exception.** There is no code path in
  which a model or a hook can produce a non-personal row.
- `project` is still private to the author. It marks a memory as "about this codebase, not
  about me" — the promotion candidate pool. Splitting it out from `team` gives the user a
  cheap intermediate step and gives us the unit to bulk-share later.
- `team` requires: Teams plan, project shared with a team, explicit per-item confirmation
  showing the exact text and the exact audience (§7.3).
- A member leaving does **not** delete their `team` rows. `author_display` is a snapshot, so
  attribution survives even if the auth user is deleted.

**Project key** — derived, stable, and privacy-preserving:

1. If the repo has an `origin` remote → normalize (`git@github.com:o/r.git` and
   `https://github.com/o/r` both → `github.com/o/r`) → `project_key = sha256(normalized)[0:16]`.
   `git:info` (`main.ts:223`) already does this normalization for GitHub; extend it to
   GitLab/generic remotes.
2. Else → `sha256(lowercase(absolute root path))[0:16]`, with `root_path` stored locally
   only (never uploaded — a path can contain a real name or a client name).
3. No repo at all → `'__global__'`.

Hashing means the cloud never learns repo names unless the user opts into a display name.
`display_name` defaults to the folder name and is user-editable.

**ID strategy** — `sync_id = '{prefix}-' + randomBytes(16).toString('hex')` where prefix is
`obs` / `sess` / `prom`. 128 bits of entropy, generated on the client at write time. The
typed prefix costs 5 bytes and makes every log line, every payload, and every support ticket
self-describing — worth it.

- Why client-generated: the row must be identifiable **before** it ever reaches the server,
  because it lives in an offline queue that may not drain for days. A server-assigned id
  would require a local-id → server-id mapping table and a rewrite pass — the exact
  complexity that makes offline-first sync engines fail.
- Why not UUIDv4 string: same entropy, more bytes on the wire and in every index. Why not
  ULID/UUIDv7: sortability is tempting, but time-prefixed ids leak creation time in shared
  team rows and give no benefit since ordering comes from `project_seq`.
- Collision probability at 128 bits is not a real consideration; the PK constraint is the
  backstop.

---

## 4. Sync protocol

Non-negotiable property: **the user never initiates a sync and never sees a sync control.**

### 4.1 Triggers

| Trigger | Behavior |
|---|---|
| **On write** | `mutation_log` insert schedules a push. Debounce **3 s**, max-wait **30 s** (a chatty session still gets a push every 30 s). |
| **Interval** | Every **5 min** while the app is running: push pending + pull. |
| **Window focus** | `browser-window-focus` → immediate pull (this is the "I just walked to my other machine" case). Rate-limited to once per 30 s. |
| **Network regain** | `online` event / first successful request after failures → immediate full drain of the queue. |
| **Pane exit** | Session rollup written → push. |
| **App quit** | An explicit `finalizeMemoryBeforeQuit()` call — **not** the `before-quit` event, see below. One push attempt with a **2 s budget**, then quit regardless. Never block the user's exit — the queue is durable. |

**Correction (folded back after merging main v1.3.2, which added
`docs/GUIA-TESTEO-BAUTISTA.md`):** this section originally specified `before-quit` as the
app-quit trigger. That is wrong for this codebase and the fix landed in
`electron/main.ts` — documented here so the mistake isn't reintroduced. `before-quit`
fires on **every** quit attempt, including ones the app itself cancels afterward: on
macOS, `win.on('close')` calls `event.preventDefault()` and hides the window to the tray
instead of exiting, but `before-quit` has already fired by that point. Doing daemon
teardown there means it runs on a false alarm, not just on a genuine exit. Separately,
this app's actual exit paths — the tray "Salir"/"Quit" item, and `updater:install` — call
`app.exit(0)` (or trigger `autoUpdater.quitAndInstall()`, which calls `app.quit()`
internally but is followed by a hard `app.exit(0)` safety net on macOS), and
**`app.exit()` never emits `before-quit`/`will-quit` at all**. Combined, that means a
`before-quit` listener is simultaneously too eager (fires on cancelled quits) and
unreliable (doesn't fire on real ones). The daemon's quit-time push is wired into an
explicit `finalizeMemoryBeforeQuit()` function (an `isReallyQuittingMemory` flag guards
against a double call), invoked only from the tray quit handler (awaited — nothing
time-constrained there, so it gets the full 2 s budget) and from `updater:install`
(fire-and-forget, since that path already has its own tighter, differently-motivated
force-exit deadline that predates and is unrelated to memory).
| **Backoff** | On failure: exponential 5 s → 5 min, jittered, capped. 3 consecutive auth failures → surface `error` state in the UI and stop retrying until the user acts. |

### 4.2 Push

```
POST /functions/v1/memory-sync/push
Authorization: Bearer nmk_…
{ "device_id": "…", "mutations": [ { seq, sync_id, op, payload }, … ] }   // ≤ 200 per batch
```

Server, inside `memory_sync_push(p_user_id uuid, p_mutations jsonb)` (SECURITY DEFINER):

1. `pg_advisory_xact_lock(hashtext(project_id::text))` — **per-project serialization**.
2. For each mutation: resolve/create the project (checking plan + ownership), then upsert by
   `sync_id` applying the LWW rule (§4.3), then `seq_counter = seq_counter + 1` and stamp
   `project_seq`.
3. Return `[{ sync_id, outcome: 'applied'|'superseded'|'rejected', project_seq }]` + the new
   per-project cursor.

Client marks `pushed_at` for accepted mutations. Rejected ones (plan limit, revoked access)
are marked pushed with a local `last_error` so they don't loop forever, and surfaced once.

**Why the advisory lock matters:** with a plain `BIGSERIAL` (the obvious implementation, and
the one engram uses for its global mutation journal), transaction A can take sequence 100 and
commit *after* transaction B takes 101 and commits. A puller reading in the window between
the two commits records cursor 101 and **permanently misses row 100** — a silently lost
memory, the worst possible failure mode for this product. The per-project advisory lock makes
sequence assignment and commit visibility agree. Contention is negligible: pushes are
debounced to at most one per 3 s per device, and a project has a handful of writers.

**Apply ordering.** A pulled batch is reordered before application so foreign-key
preconditions hold: project upserts → observation upserts → observation deletes. Any
mutation whose precondition is still unmet (e.g. a `superseded_by` pointing at a row from a
later batch) is parked in a small deferred table and retried after the next pull, rather than
failing the batch. Batch-level failure on one bad row would stall the cursor forever.

### 4.3 Conflict policy — LWW per `topic_key`, append-first

Two distinct conflicts:

**(a) Same `sync_id` on both sides** (same logical record edited on two devices).
Winner = `max(client_updated_at)`; tie → `max(lamport)`; tie → lexicographically greater
`sync_id`. Fully deterministic — every replica computes the same winner without
coordination. The loser's content is discarded (it is the same record; the user edited it
twice).

**(b) Different `sync_id`, same `(project, scope, topic_owner, topic_key)`**
(two devices independently created "the" memory for `architecture/auth-model`).
This is the common offline case, and **destroying one side would lose real work.** So:
apply the same ordering to pick a winner, then set the loser's `superseded_by = winner.sync_id`
instead of deleting it. The unique index excludes superseded rows, so the constraint holds.
Search shows the winner; the UI offers "2 earlier versions" and a merge action. **Nothing is
ever silently lost** — that is the append-first rule.

**(c) Delete vs update.** A tombstone is just a row with `deleted=1`, so rule (a) applies: a
delete at T2 beats an update at T1; an update at T2 *resurrects* over a delete at T1. This
is intentional — the user's most recent intent wins.

There is **no user-facing conflict UI**, ever. Convergence is automatic.

### 4.4 Pull

```
POST /functions/v1/memory-sync/pull
{ "cursors": { "<project_id>": 1042, … }, "limit": 500 }
→ { "rows": [...], "cursors": { "<project_id>": 1187 }, "has_more": false }
```

Apply each row locally with the same LWW rule (an incoming row can lose to a local unpushed
edit — in which case the local edit stays queued and wins on the next push). Advance
`sync_state.pull_cursor` only after the batch commits, in the same SQLite transaction as the
row writes. A crash mid-pull re-fetches the batch; application is idempotent by `sync_id`.

### 4.5 Offline queue

The queue *is* `mutation_log WHERE pushed_at IS NULL`. Durable, ordered, survives crash and
restart. Bounds: soft warning in the UI at 10 000 pending; hard cap 50 000, after which the
daemon compacts the queue by collapsing multiple `upsert` ops for the same `sync_id` into
the latest one (safe: `payload` is a full snapshot). Pushed rows are pruned after 7 days.

### 4.6 Multi-device merge walkthrough

Setup: Ana has Nest on a **desktop** (D) and a **notebook** (N), both connected, same repo
`github.com/acme/api` → `project_key = a1b2…`.

1. **Mon, office, D online.** Claude saves `topic_key='architecture/auth-model'` →
   `sync_id=AAA`, `updated_at=Mon 10:00`. Push → `project_seq=41`. Cloud: {AAA@41}.
2. **Mon evening, N boots on a train (offline).** N last pulled at seq 30, so it does *not*
   have AAA. Codex on N saves the same topic → `sync_id=BBB`, `updated_at=Mon 19:00`.
   Local unique index is satisfied (AAA absent). Mutation queued, push fails, queue holds.
3. **Mon later, D still online.** Ana refines the note. AAA updated, `updated_at=Mon 21:00`,
   `lamport` bumped. Push → `project_seq=42`. Cloud: {AAA@42}.
4. **Tue morning, N gets wifi.** `online` fires → drain.
   - **Push first?** No — the daemon pulls first when `pull_cursor` is behind, so the merge
     happens against fresh state. Pull returns AAA@42. N now has AAA (from cloud) and BBB
     (local, unpushed). Local topic collision → rule (b): AAA (Mon 21:00) beats BBB
     (Mon 19:00) → `BBB.superseded_by = AAA`. Both rows kept.
   - Push drains the queue: BBB upsert arrives at the server carrying
     `superseded_by=AAA` → applied at seq 43, excluded from the unique index. No error.
5. **Tue, D pulls** at cursor 42 → receives BBB@43 with `superseded_by=AAA`. D stores it as
   a superseded variant.
6. **Converged.** Both devices show one active memory for `architecture/auth-model` (AAA,
   the Mon-21:00 text) plus a "1 earlier version" affordance holding Ana's train-ride note.
   Zero prompts, zero lost writes, zero user actions.

Edge case worth stating: if step 2 and step 3 had **identical** `updated_at`, `lamport`
breaks the tie; if lamport also ties, `sync_id` ordering does. Every replica reaches the same
answer independently.

---

## 5. First-connect migration

The first connect is a **one-way local → cloud seeding**, so the cloud is never empty and the
user's history isn't stranded. It must be resumable, idempotent, and cancellable.

### 5.1 Flow

```
[user clicks Connect Memory]
  1. renderer: supabase.functions.invoke('memory-token', { action:'issue', device })
       → { token: 'nmk_…', device_id, token_id }         (plaintext returned exactly once)
  2. renderer → main:  ipc 'memory:connect' (token, device_id)
  3. main: safeStorage.encryptString(token) → {ravenHome}/.raven-nest/memory/credential.bin (0600)
  4. daemon: POST /memory-sync/bootstrap → { has_cloud_data, projects, observations }
        ├── has_cloud_data == false  →  SEED PATH   (this device is the origin)
        └── has_cloud_data == true   →  ADOPT PATH  (second device — pull first)
  5. run import adapters (§5.2) — always, both paths, BEFORE any push
  6. SEED: push everything in mutation_log order, batched, with progress
     ADOPT: pull everything first, then merge local, then push the delta
  7. provision MCP + hooks into every existing account (§2.5); mark connected
```

### 5.2 Import adapters

All adapters are read-only against their sources and write through the normal
`memory-store` path (so redaction, FTS, and `mutation_log` all apply).

**A. Engram SQLite importer** (`{accountDir}/.engram/engram.db`)

- **Discovery:** glob `{ravenHome}/.raven-nest/accounts/*/*/.engram/engram.db` — this
  catches every AI account, not just Claude. (Verified present on this machine at
  `~/.raven-nest/accounts/claude/Bautista/.engram/engram.db` (13 MB) and in the `codex` and
  `gemini` account dirs.) Also check `{ravenHome}/.engram/engram.db`.
- **Safe read:** an engram MCP process may hold the DB with a live WAL (a 4 MB `-wal` file
  is present right now). Copy `engram.db`, `-wal` and `-shm` to a temp dir, open the copy
  read-only, and never write to the original. Copying a 13 MB DB is instant; contending with
  a live writer is not worth the risk.
- **Mapping** (against the verified engram `observations` schema — `id`, `sync_id`,
  `session_id`, `type`, `title`, `content`, `tool_name`, `project`, `scope`, `topic_key`,
  `normalized_hash`, `revision_count`, `duplicate_count`, `last_seen_at`, `pinned`,
  `created_at`, `updated_at`, `deleted_at`):
  - `topic_key` carries over **verbatim** — it is the same concept and the same merge unit.
  - `title`, `content`, `type`, `created_at`, `updated_at`, `revision_count`,
    `duplicate_count`, `last_seen_at` map 1:1.
  - `project` (a lowercased basename in engram) resolves to a Nest `project_key` by matching
    it against the user's known repos; unmatched → `__global__`.
  - `deleted_at IS NOT NULL` rows are **skipped**, not imported as tombstones — importing
    another system's deletions adds nothing.
  - `scope` is forced to `personal` for everything, including engram rows marked `project`.
    Engram's `project` scope is still private-to-the-user; Nest's is a promotion tier. Mapping
    it across would silently pre-stage thousands of memories for sharing. **The user
    re-decides sharing in Nest's model, from zero.**
  - `source='import'`, `source_ref='engram:{engram sync_id}'` (the sync_id, not the local
    autoincrement `id` — it is the stable identity and survives the user re-importing from a
    different machine's engram DB).
  - Not imported: `user_prompts` (ours are local-only and 30-day retained; importing someone's
    prompt history into a cloud-replicated store is not defensible), `memory_relations`,
    `sessions`, embeddings.
- **Schema drift:** read the source's own migration/version marker; if the schema is newer
  than what the adapter knows, import only the columns it recognizes and log a warning
  rather than aborting. The adapter must degrade, not fail — engram is a moving target we do
  not control.

**B. Claude memory / markdown importer**

Sources, in order:
- `{ravenHome}/.claude/CLAUDE.md` (global)
- `{accountDir}/.claude/CLAUDE.md` for each account — **note these are frequently symlinks
  or hardlinks to the global file** (`account-store.ts:17-23`); dedupe by `content_hash` so a
  file shared by five accounts is imported once.
- `{accountDir}/.claude/memory/*.md`, `MEMORY.md` where present
- Per-repo `CLAUDE.md` / `AGENTS.md` in each enrolled project root

**Chunking:** split on `##` / `###` headings. Each chunk = one observation, `title` = heading
text, `topic_key = 'imported/{source}/{slug(heading path)}'`, `type='pattern'` by default.
A chunk smaller than 40 chars is skipped. Whole-file import is avoided: a 3 000-line
CLAUDE.md as one memory is useless for retrieval.

**C. Codex / Gemini importers** — `AGENTS.md`, `GEMINI.md`, same chunker. Phase 2.

### 5.3 Idempotency

Three independent guards, so re-running an import (crash, retry, reconnect, second device)
can never duplicate:

1. `UNIQUE (source, source_ref)` — the same engram row or the same file+heading maps to the
   same observation forever. Re-import = update, not insert.
2. `content_hash` — identical text from two paths (the symlinked CLAUDE.md case) collapses.
3. `import_runs.cursor` — a crashed import resumes from the last committed batch instead of
   restarting.

And the seeding push is idempotent by `sync_id` at the server, so a network retry that
already succeeded server-side is a no-op.

### 5.4 Progress UI

The card transitions through explicit, honest states — no fake progress bars:

```
Importing memory
  ✔ Engram (claude/Bautista) — 1 284 items
  ✔ Engram (codex/Work)      — 96 items
  ⟳ CLAUDE.md files          — 41 / 63
  ○ Uploading                — pending
                                       [Cancel]
```

Then `Uploading 1 421 / 3 902 …`. Cancel is always available; cancelling revokes the token,
leaves every local row intact, and returns the card to `disconnected`. **Nothing about the
local store depends on being connected** — that is the offline-first guarantee restated.

### 5.5 Second device — the ADOPT path

When `bootstrap` reports existing cloud data, the device **pulls before it pushes**. Reasons:

- The user's expectation on a new laptop is "my memory is here", within seconds. Pull-first
  delivers that; push-first would show an empty list while a slow upload runs.
- Merging local-only rows *against* the cloud state resolves topic collisions once, locally,
  before anything is transmitted — instead of the server having to arbitrate a large batch
  of colliding topics.
- It prevents a second seeding pass: the local importer may find the *same* engram DB
  content on a synced-folder setup; pull-first means those rows already exist by `sync_id`
  or collapse by `content_hash`.

UI copy differs accordingly: *"Downloading your memory — 3 902 items"* rather than
*"Importing"*.

---

## 6. Identity & security

### 6.1 Memory tokens

`memory-token` edge function, authorized by the caller's normal Supabase JWT
(`auth.uid()` from the `Authorization` header — same pattern as `github-oauth`):

| Action | Effect |
|---|---|
| `issue` | Registers/updates a `memory_devices` row, mints a token, returns plaintext **once**. |
| `list` | Returns devices + `token_prefix` + `last_used_at`. Never the token. |
| `revoke` | Sets `revoked_at` for one token or all of a user's tokens. |
| `rotate` | Revokes + issues in one transaction (used on suspected compromise). |

Token format: `nmk_` + `base64url(randomBytes(32))`. Stored server-side as
**`sha256(token)` only**; `token_prefix` (first 6 chars) is kept for display. Lookup is a
direct index hit on `token_hash`, so no timing-comparison concerns.

### 6.2 Client-side storage

- Written by **main**, via `safeStorage.encryptString`, to
  `{ravenHome}/.raven-nest/memory/credential.bin`, mode 0600.
- **Not** in `localStorage`. The existing preload helper (`preload.ts:185`) stores encrypted
  blobs in renderer `localStorage`, which is fine for renderer-scoped secrets but wrong here:
  the daemon runs in main and the renderer has no business holding a sync credential.
- **Not** in `process.env` of any PTY. Panes get a socket path, never a token.
- If `safeStorage.isEncryptionAvailable()` is false (some Linux setups without a keyring),
  memory connect is **refused** with a clear message. Storing it in plaintext "just this
  once" is how the `profiles.github_token` debt happened.

### 6.3 Explicitly not repeating the `github_token` mistake

`profiles.github_token` currently holds an OAuth token in plaintext (`github-oauth/index.ts`
writes it; `useGitHub.ts:26` selects it into the renderer). Nest Memory does the opposite in
all three respects:

1. **Never store a usable secret server-side** — only a SHA-256 hash.
2. **Never select the secret into the renderer** — the plaintext exists exactly once, in the
   `issue` response, and goes straight to main.
3. **Independent revocation** — revoking memory access does not touch the user's session, and
   signing out does not silently keep a live credential on disk (disconnect wipes
   `credential.bin`).

### 6.4 Revocation, including team member removal

Two mechanisms, and the distinction matters:

- **Token revocation** kills a *device*. Used on: user clicks Disconnect, user removes a
  device from the (future) device list, rotation, suspected compromise.
- **Authorization revocation** kills *access to data*. This is what team removal needs — and
  it is handled by **not encoding permissions in the token at all**. `memory_sync_push/pull`
  re-evaluates, on every single call:

  ```sql
  -- can this user read this project's team-scoped rows, right now?
  EXISTS (SELECT 1 FROM team_members tm
          JOIN memory_projects mp ON mp.team_id = tm.team_id
          WHERE mp.id = p_project_id AND tm.user_id = p_user_id AND tm.status = 'active')
  ```

  A member removed at 10:00:00 loses read access on their next sync call, with no token
  bookkeeping, no revocation list, and no stale-scope window. Baking `team_id` scopes into a
  long-lived token would create exactly that window.

- **Belt and braces:** the `team_members` DELETE / `status <> 'active'` trigger *also* revokes
  that user's tokens for devices whose only enrolled projects belong to that team, and bumps
  `profiles.memory_token_epoch`. Tokens carry the epoch they were minted at; a mismatch forces
  re-issue. This is the hard-kill lever for the "we must cut this person off now" case.
- **Their contributions persist**, as required: `team` rows keep `user_id` and the
  `author_display` snapshot, and the UI labels them *"contributed by X (former member)"*.
  Deleting a user cascades their `memory_observations`, so removal-from-team and
  account-deletion are deliberately different operations — leaving a team must not delete
  team knowledge.

### 6.5 RLS sketch (dashboard / PostgREST path)

```sql
ALTER TABLE memory_projects     ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_tokens       ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_devices      ENABLE ROW LEVEL SECURITY;

-- Projects: owner, or a member of the team the project is shared with.
CREATE POLICY memory_projects_read ON memory_projects FOR SELECT USING (
  owner_id = auth.uid()
  OR team_id IN (SELECT team_id FROM team_members
                 WHERE user_id = auth.uid() AND status = 'active')
);

-- Observations: your own rows always; team-scoped rows of shared projects.
CREATE POLICY memory_obs_read ON memory_observations FOR SELECT USING (
  user_id = auth.uid()
  OR (scope = 'team' AND project_id IN (
        SELECT mp.id FROM memory_projects mp
        JOIN team_members tm ON tm.team_id = mp.team_id
        WHERE tm.user_id = auth.uid() AND tm.status = 'active'))
);

-- Writes are Pro/Team only, mirroring the existing plan-gate pattern
-- (20260502120100_plan_gates_rls.sql).
CREATE POLICY memory_obs_insert ON memory_observations FOR INSERT WITH CHECK (
  user_id = auth.uid() AND user_has_plan(auth.uid(), ARRAY['pro','team'])
);
CREATE POLICY memory_obs_update ON memory_observations FOR UPDATE
  USING (user_id = auth.uid());          -- only the author edits their row

-- Tokens: readable by owner but the hash column is never selected by the client;
-- expose a view (id, token_prefix, device, last_used_at, revoked_at) instead.
CREATE POLICY memory_tokens_own ON memory_tokens FOR SELECT USING (user_id = auth.uid());
```

Note the deliberate asymmetry with the existing tables: read policies allow team visibility,
write policies never do. A teammate can read a promoted memory; only its author can change
it. This avoids the RLS-recursion class of bugs that migrations 019/020 had to fix, because
no policy on `memory_observations` references another policy-protected table beyond the
already-hardened `team_members` helper pattern.

### 6.6 Content safety

- **Redaction before persist.** Every write passes a secret scrubber. Reuse and extend the
  pattern already in `setup-runner.ts:23`:
  `/(?:^|[\s=:])(?:token|key|password|secret|api[_-]?key|bearer|authorization)\s*[=:]\s*\S+/gi`,
  plus provider-specific prefixes (`sk-`, `ghp_`, `gho_`, `xox[baprs]-`, `AKIA`,
  `-----BEGIN .* PRIVATE KEY-----`, JWT shape). Matches are replaced with `<redacted>` and
  the observation is tagged `redacted`.
- **Never persist raw terminal output** as memory (§2.3).
- **Path deny-list** for importers: `.env*`, `*.pem`, `*credentials*`, `*.key`, anything
  under `.git/`.
- **Local prompt retention:** `session_prompts` is local-only, never replicated, purged at
  30 days.
- **Right to delete:** disconnect offers "also delete my cloud memory", which issues a
  cascade delete server-side. Local data is never deleted by disconnecting.

---

## 7. Plan gating & Teams flow

### 7.1 `PLAN_LIMITS` wiring

Extend `src/lib/stripe.ts`:

```ts
export interface PlanLimits {
  /* … existing … */
  memoryLocal:        boolean   // always true — Free keeps full local memory
  memoryCloud:        boolean   // Pro+: replication + multi-device
  memoryTeamShare:    boolean   // Team only: promote to team scope
  maxMemoryProjects:  number    // free: Infinity (local), pro: 50, team: 200
  maxCloudObservations: number  // pro: 50_000, team: 250_000 — soft caps, warn at 80 %
}
```

- `free`: `{ memoryLocal: true, memoryCloud: false, memoryTeamShare: false }`
- `pro`: `{ memoryLocal: true, memoryCloud: true, memoryTeamShare: false }`
- `team`: all true.
- `enterprise` (added on main after this doc was first written, sales-led/invoiced —
  `src/lib/stripe.ts`'s `ENTERPRISE_MIN_SEATS`/`ENTERPRISE_CONTACT_EMAIL`): treated as
  team-or-better for memory — `memoryCloud`/`memoryTeamShare: true`, caps set to
  effectively unlimited (`Infinity` client-side, max-bigint server-side in
  `memory_max_projects_for_plan`/`memory_max_observations_for_plan`). This is a judgment
  call made while merging main's v1.3.x plan-tier changes into this branch, not a
  product decision — **needs founder/sales confirmation** before a real enterprise
  customer hits a memory feature, same status as the other open questions in §10.

**Free keeps full local memory on purpose.** It is the demo. A user who has accumulated 800
useful memories locally and then sees "sync across devices — Pro" converts; a user who was
given nothing has nothing to lose.

Client gating uses the existing `useProfile()` + `UpgradeModal` pattern (note `useProfile`
grants an effective `team` plan during the 14-day trial — memory should honor that, which it
does for free by reading the computed plan). Server gating is independent and authoritative:
`user_has_plan(auth.uid(), ARRAY['pro','team'])` is checked inside `memory_sync_push`, so a
free user with the anon key cannot push by calling the function directly — the same class of
bypass migration `20260502120100` closed for `shared_mcp_configs`.

### 7.2 Share a project with a team

Mirrors `shared_mcp_configs` exactly — that table is the permission-model template
(`owner_id` + nullable `team_id` + owner-manages / team-reads policies):

1. Owner opens Memory → project → **Share with team** (visible only when
   `memoryTeamShare === true` and the user owns a team).
2. Confirmation dialog states plainly: *"Team members will see memories you promote to Team
   scope in this project. Your personal memories stay private."*
3. Sets `memory_projects.team_id` + inserts `memory_project_shares`.
4. Members' daemons discover the project on their next pull (bootstrap returns shared
   projects too) and begin receiving `scope='team'` rows only.

Unsharing sets `team_id = NULL`; members stop receiving new rows and local copies are
tombstoned on their devices via a `revoke` mutation. **The already-downloaded content on a
former member's disk cannot be recalled** — say so honestly in the dialog rather than
implying otherwise.

### 7.3 Manual promotion UX (personal → project → team)

The single most trust-sensitive interaction in the product. Rules:

- **Never automatic. Never batched-by-default. Never a toggle buried in settings.**
- The promotion dialog shows the **exact final text** that will become visible and the
  **exact audience** by name: *"Ana, Bruno, +3 members of Acme Web"*.
- Redacted spans are highlighted, so the user sees what was scrubbed before it goes out.
- Bulk promotion exists (checkbox selection) but still shows the full list and requires one
  confirmation for the batch.
- Agent-suggested promotions land in a **review queue** (`promotion_queue`), surfaced as an
  unobtrusive badge — never a modal, never a nag.
- Every promotion writes a `memory_promotions` audit row. Demotion (team → personal) is
  allowed and audited, with the honest caveat above.

### 7.4 Attribution & provenance

Every observation carries `origin_ai`, `origin_account`, `git_branch`, `source`, and
`author_display`. Team-visible rows render as:

> **Use tanstack-query for all server state** · promoted by Ana · from Claude Code · `feat/auth` · 3 days ago

Provenance is not decoration: when a teammate reads a memory, "which AI produced this, on
what branch, from whose session" is exactly what determines whether they trust it.

### 7.5 Subscription lapse & downgrade

Founder requirement: a lapsed subscription must never be able to hold a user's memory
hostage. What happens when `plan` drops from `pro`/`team` back to `free` (payment failure,
cancellation, trial end):

1. **Cloud sync stops — data does not disappear.** `memoryCloud` flips to `false` in
   `PLAN_LIMITS` for the user's new plan. The daemon stops pushing and stops pulling
   (`memory_sync_push`/`pull` also reject server-side via the same `user_has_plan` gate
   used elsewhere — see §7.1 — so this is enforced twice, not just client-side). The local
   store is completely unaffected: **Free tier is local-only, and local-only is the full
   product minus replication**, not a crippled trial. This is the same "local is
   authoritative" property from §1.2 doing double duty as the downgrade safety net.
2. **Final export, always available.** Because the local SQLite store is already
   near-complete (auto-capture always writes locally first, cloud is a replica — §1.2), a
   lapsed user does **not** need a special "data recovery" flow for the common case: their
   memory is already on disk. Two gaps this doesn't cover, both handled the same way:
   - **A device that reinstalled Nest** (local `memory.db` is gone) after the lapse.
   - **A second device that was never fully synced** before the lapse (offline queue never
     drained, or the device was set up right as the subscription ended).

   For both, the lapsed user keeps **read-only grace access** to the cloud replica — the
   `memory-sync/pull` and a new `memory-sync/export` action stay reachable with a `free`
   plan (gated separately from `push`, which stays blocked) for the retention window in
   point 3. `export` streams every observation the user owns (all scopes they authored,
   across every project) as newline-delimited JSON, i.e. a bulk `pull` with no cursor and
   no batch limit, written straight into the local `memory.db` via the normal apply path
   (idempotent by `sync_id`, so re-running it is safe). Framed as **"one last sync," not a
   new export feature** — it reuses the pull/apply machinery in §4.4 rather than adding a
   new format. A plain "Export as JSON" affordance in the disconnected-Free card state
   (§8.1) additionally dumps the same data to a file on demand, independent of cloud
   grace-period status, so the user is never dependent on network access or on Nest's
   servers once they have pulled: **local SQLite you can read with any tool is the actual
   export.**
3. **Cloud retention after lapse — OPEN QUESTION, needs founder confirmation.** How long
   does the cloud replica stay in read-only grace access before it is purged? Proposed
   default, **not yet approved**: **90 days read-only, then hard delete.** Rationale for the
   default: long enough to cover a realistic "reinstalled my laptop two months later" case
   and a lapsed-then-renewed win-back window; short enough to bound storage cost for
   inactive accounts (R-8). Mirrors the tombstone purge window already used elsewhere in
   this design (§3.1) for consistency, not because the two are technically related. A
   renewed subscription before the window closes simply resumes normal push/pull with no
   data loss. **This proposal must be confirmed by the founder before Phase 1 ships the
   downgrade path** — it determines a `deleted_at`/purge job in `memory_projects` or a
   per-user `plan_lapsed_at` column, which is a schema decision, not just a policy one.

---

## 8. UI touchpoints

### 8.1 Connect Memory card — Settings → Account

Sibling of the existing GitHub / GitLab cards (`SettingsPanel.tsx:214-259`), same
`sp-card` / `sp-card-row` markup, same `sp-btn-purple` / `sp-btn-danger` buttons.

| State | Left | Right |
|---|---|---|
| `disconnected` (Pro+) | 🧠 **Nest Memory** — *Sync your AI memory across devices* | `Connect` |
| `disconnected` (Free) | 🧠 **Nest Memory** — *Local memory active · 1 284 items* · `Cloud sync is a Pro feature` | `Upgrade` → `UpgradeModal` |
| `connecting` | spinner · *Connecting…* | `Cancel` |
| `migrating` | per-source checklist + counts + progress bar (§5.4) | `Cancel` |
| `connected` | ✓ **Nest Memory** · *3 902 items · 4 projects · synced 2 min ago · this device: "BAUTI-PC"* | `Disconnect` |
| `paused` (offline) | ⏸ *Offline — 12 changes will sync when you're back* | — (**not** an error, no button) |
| `error` | ⚠ *Couldn't sync — {reason}* | `Retry` |

`paused` is a distinct state on purpose. Showing a red error because a user is on a plane
teaches them the feature is fragile. Offline is the expected state, not a failure.

### 8.2 Ambient status

A 6 px dot in the existing `ResourceBar`: solid (synced), pulsing (syncing), hollow
(offline), amber (error → click opens the card). No text, no count, no notification. The
whole point is that the user forgets it exists.

### 8.3 Memory dashboard (Phase 3)

A panel alongside the existing side panels (Snippets/MCP/Workspaces): search (FTS5, instant),
filter by project / scope / AI / type / date, item detail with provenance, promote / demote /
delete, per-project enrollment toggle, review queue for agent-suggested promotions, device
list with per-device revoke.

---

## 9. Phased delivery

### Phase 1 — MVP: auto-capture + cloud replication, single device

**Scope:** SQLite store; MCP shim with `memory_save` / `memory_search` / `memory_context`;
Claude Code hooks (SessionStart, Stop, PreCompact); provisioner for the `claude` AI type;
Connect Memory card; engram + CLAUDE.md importers; push/pull for `scope='personal'`;
Pro gating.

**Not in scope:** Codex/Gemini MCP config, multi-device conflict handling, teams,
dashboard, promotion UI.

**Acceptance criteria**
1. A user with a fresh Nest and an existing engram DB clicks Connect once; within 60 s the
   card shows `connected` with an item count ≥ the engram row count, and
   `select count(*) from memory_observations` in Postgres matches the local count.
2. Starting a Claude pane, having a conversation containing a decision, and closing the pane
   produces ≥ 1 new `type='decision'` observation **without any memory-related user action**,
   visible in Postgres within 30 s of the pane closing.
3. Killing the network mid-session: the terminal remains fully usable, memories keep being
   written locally, the card shows `paused`, and reconnecting drains the queue with zero
   duplicates (verified by `count(*)` before/after).
4. A Free-plan user sees local capture working and `Connect` replaced by `Upgrade`; a direct
   `memory-sync/push` call with their token returns `403 plan_required`.
5. Disconnecting removes `mcpServers.nest_memory` and the Nest hook block from every account,
   deletes `credential.bin`, revokes the token, and leaves every local row intact.
6. **The user's global `~/.claude/settings.json` is byte-identical before and after
   connect/disconnect.** (Regression test for the symlink hazard, §2.5.)

**Local test plan**
- `supabase start` (local stack) + `supabase db reset` with the new migrations +
  `supabase functions serve memory-token memory-sync`. Point the app at the local stack via
  `VITE_SUPABASE_URL`.
- Vitest unit tests on the pure merge/LWW functions and the markdown chunker — no DB needed;
  these are the highest-risk-per-line code in the system.
- Vitest integration tests against a temp SQLite file for store + mutation log + import
  idempotency (run the engram importer twice, assert identical counts).
- Fixture engram DB checked into `electron/__tests__/fixtures/` (small, synthetic — not a
  copy of anyone's real memory).
- Playwright e2e (`e2e/`, already configured) driving the Connect card through
  disconnected → migrating → connected against the local stack.

### Phase 2 — Multi-device

**Scope:** ADOPT path (pull-first bootstrap); `superseded_by` merge + "earlier versions" UI;
per-project cursors and advisory-locked sequence assignment; device registry + per-device
revoke; Codex and Gemini MCP provisioning; PTY-lifecycle session envelopes; dashboard v1
(search + list + delete).

**Acceptance criteria**
1. Two app instances with different `RAVEN_HOME` values, same Supabase user: device B's
   first connect shows *"Downloading your memory"* and reaches parity with device A's item
   count, with **zero** duplicated `content_hash` values.
2. The §4.6 walkthrough executed literally (B offline, both edit the same `topic_key`, B
   reconnects) converges on both devices to the same active row + the same 1 superseded row,
   with no prompt and no lost content.
3. Deleting an item on A tombstones it on B within one pull cycle; editing it on B *after*
   the delete resurrects it on both.
4. Codex and Gemini panes both produce observations that Claude's `memory_context` can read
   back — proving the cross-CLI shared store.

**Local test plan**
- `RAVEN_HOME=C:\tmp\nest-device-a` and `…-device-b`, two `npm run dev` instances. **This
  isolation hook already exists** (`raven-home.ts:33`, built for e2e) — no new plumbing.
- Scripted offline: block the Supabase host via a proxy env var or a `NEST_MEMORY_OFFLINE=1`
  test flag in the daemon's fetch wrapper.
- Property test for the merge function: generate random operation interleavings across two
  replicas, assert convergence (same active set + same superseded set) for every ordering.
  This is the correctness proof; do not ship Phase 2 without it.

### Phase 3 — Teams

**Scope:** `scope='project'` / `scope='team'`; promotion UI + review queue; project sharing
with a team; attribution rendering; member-removal revocation path; audit trail; Teams plan
gating.

**Acceptance criteria**
1. A promoted memory becomes visible to an active teammate within one pull cycle, and to
   nobody else — verified by a second user's client and by a direct PostgREST query with the
   third user's JWT returning zero rows.
2. Personal-scope rows in a shared project are **never** returned to a teammate. (Explicit
   negative test — this is the one bug that would end the feature.)
3. Removing a member: their next sync returns no team rows for that project; their prior
   contributions remain visible to the remaining members with *"former member"* attribution.
4. A Pro (non-Team) user cannot promote to `team` from the UI **and** cannot do it by calling
   the RPC directly.
5. Every promotion and demotion appears in `memory_promotions`.

**Local test plan**
- Three local Supabase users (owner, member, outsider) seeded via `supabase db seed`.
- RLS assertions run as each user with `set local role authenticated; set local request.jwt.claims = …`
  in a SQL test file — cheaper and more reliable than driving three app instances.
- One end-to-end pass with two app instances (two `RAVEN_HOME`s, two users) for the promotion
  dialog and the visibility timing.
- Alternative to local Supabase: a **branch of the production Supabase project**
  (`create_branch`), which gives real RLS behavior against real `teams`/`team_members` schema
  without touching production data.

---

## 10. Risks & open questions

### Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R-1 | **Model non-compliance.** The CLIs simply don't call `memory_save` often enough, and "automatic memory" is empty after a week. | **High** — this is the product | Three-layer capture (§1.5); the time-since-last-save nudge (§2.2) as deterministic counter-pressure; a small eager tool set so the two tools that matter aren't diluted; hooks and PTY lifecycle guarantee a floor. Instrument capture rate per AI in Phase 1 and treat < 1 memory/session as a P0. |
| R-2 | **Mutating the user's global `~/.claude` config** via the symlink/hardlink share. | **High** | `isSharedWithGlobal` check + `--settings` isolation; acceptance criterion #6 in Phase 1 is a byte-comparison regression test. |
| R-3 | **Secret leakage into memory** — an agent saves a memory containing an API key, which the user then promotes to a team. | **High** | Redaction on write (§6.6), highlighted redactions in the promotion dialog, never capturing raw terminal output. |
| R-4 | Sync bugs cause **duplicate or lost memories** — the fastest way to lose trust in a memory product. | High | Append-first (never delete a loser), property-based convergence tests, `content_hash` dedupe, idempotent-by-`sync_id` application. |
| R-5 | `better-sqlite3` native rebuild breaks the Windows/Mac CI (the repo already fights this with node-pty and `--config.npmRebuild=false`). **Confirmed concretely on a real Windows dev machine**: local dev genuinely needs the module built for TWO different ABIs — plain-Node (for `vitest`, which runs the test suite under the system Node, currently v24) and Electron's own bundled Node (v20.18 for Electron 33) for the running app — and both compile to the SAME `build/Release/*.node` path, so one build silently clobbers the other. `npm run postinstall` (`electron-rebuild -f -w node-pty -w better-sqlite3`) only ever produces the Electron-ABI build; a plain `npm rebuild better-sqlite3`/`node-gyp rebuild` produces the Node-ABI one. A dev switching between "run the tests" and "run the app" must re-run the matching command each time — there is no way to keep both on disk simultaneously without a wrapper script. Also hit: this Node's prebuilt toolchain reports `clang: 1` (Node's own Windows builds increasingly use clang-cl), so `node-gyp`/`@electron/rebuild` generate `PlatformToolset=ClangCL` project files by default — which fail outright on a Build Tools install that only has the base MSVC (`v143`) component, with no ClangCL/LLVM component. Building with the plain MSVC toolset instead (edit the generated `.vcxproj`'s `PlatformToolset` before the build step, or install VS's "C++ Clang Compiler for Windows" optional component) produces a working binary either way — MSVC-vs-clang-cl doesn't affect Node addon ABI compatibility, only compiler used. `electron-rebuild`'s CLI has a real bug too: passing `-w` twice throws (`argv.w.split is not a function`); use `-o <module>` (exclusive "only") instead of repeated `-w`, and note it will still attempt EVERY native module unless you do — `node-pty` specifically fails to build from source in this same environment (its bundled `winpty.gyp` shells out to a `GetCommitHash.bat` with a working-directory assumption that doesn't hold under the currently available gyp), which doesn't matter in practice because node-pty ships N-API prebuilds for win32-x64 that are already ABI-stable and load under both Node and Electron with no rebuild at all — exclude it from any electron-rebuild invocation and let it use its prebuild. | Medium | `npm run postinstall` (Electron ABI) before packaging/running the real app; `node ./node_modules/node-gyp/bin/node-gyp.js rebuild --release` (system Node ABI, with the MSVC-toolset vcxproj edit if `clang:1`) before `npx vitest run`. Fallback if this becomes too painful for the team: `sql.js`/WASM (slower, but no native step, no ABI split at all). |
| R-6 | **Storage growth.** A heavy user could produce 100k+ observations; FTS5 index plus WAL could reach hundreds of MB. | Medium | Session-envelope observations expire at 90 days; tombstone purge; soft caps with UI warning; per-project enrollment lets users exclude noisy repos. |
| R-7 | Engram schema drift breaks the importer. | Medium | Version-tolerant adapter that imports known columns and warns (§5.2). It runs once per user; a partial import beats a failed one. |
| R-8 | Cost: Supabase egress/storage for large team memory bases at a flat subscription price. | Medium | Soft caps in `PLAN_LIMITS`, enforced server-side; measure real usage in Phase 1 before committing to the Teams price. |
| R-9 | **Privacy perception.** "Nest reads my terminal" is a headline risk even though we don't. | Medium | Never capture terminal output; publish exactly what is captured; make the memory dashboard show every single stored item with its source. Transparency is the mitigation. |
| R-10 | MCP shim startup (~60 ms) × frequent CLI session churn feels sluggish. | Low | Shim starts once per session, not per call. Measure; escalate to a Go shim only if measurement says so. |
| R-11 | Advisory-lock serialization becomes a bottleneck for a large team on one hot project. | Low | Lock is per-project and held for the duration of one small batch. Revisit only past ~50 concurrent writers on one project. |
| R-12 | **Dedupe window is anchored to `created_at`, not last activity.** An item created 8+ days ago that was actively duplicate-hit as recently as yesterday falls outside the 7-day content-dedupe window (§3.1 step 2) on today's identical save, producing a fresh row instead of continuing to bump the existing one's `duplicate_count`. | Low | Accepted for Phase 1 — anchoring to `last_seen_at` instead would keep genuinely-dormant near-duplicates merging indefinitely, which has its own downside (an 8-month-old fact absorbing an unrelated coincidentally-identical new one). Revisit if real usage shows the current anchor produces visible duplicate clutter. |
| R-13 | **First-project-per-user INSERT can race.** `memory_resolve_project`'s check-then-insert (SELECT existing -> INSERT if absent) is not itself wrapped in the per-project advisory lock (the project doesn't have an `id` — and therefore no lock key — until the INSERT completes), so two near-simultaneous first pushes for the same new `project_key` from two devices could both pass the SELECT and race the INSERT, one hitting the `UNIQUE (owner_id, project_key)` constraint. | Low | Accepted for Phase 1 (single-device scope, §9) — the losing call gets a transient 500 and the daemon's normal backoff-and-retry (§4.1) succeeds on the next attempt since the project now exists. Worth a `SELECT ... FOR UPDATE` or an `ON CONFLICT DO NOTHING` upsert if Phase 2's multi-device scope makes this common enough to matter. |
| R-14 | **Importer deny-list substring match on `credentials` is over-broad.** `isDeniedImportPath` (§6.6) rejects any path containing "credentials" as a substring — a legitimate file like `my-credentials-app/CLAUDE.md` would be skipped even though it isn't itself a credentials file. | Low | Accepted: false-positive-skip (missing a legitimate import candidate) is the safe failure direction for a secret-avoidance deny-list; false-negative (importing an actual credentials file) is the one that must never happen. Revisit only if this causes a real user complaint about a specific legitimate path being skipped. |

### Open questions for the founder

- **O-1 — RESOLVED.** Claude Code supports an additional settings file via
  `--settings <file-or-json>`, and the CLI's own docs describe this as loading
  *additional* settings on top of the normal hierarchy — additive, not a
  replacement. This confirms the provisioner design in §2.5 uses the
  `--settings` isolation path as the **only** mechanism for injecting Nest's
  memory hooks: `claude --settings {accountDir}/.nest/memory-settings.json`,
  never a write to `{accountDir}/.claude/settings.json`. The copy-on-write
  fallback (`detachClaudeConfig`) remains in the codebase for the unrelated
  symlink-hazard case (a user's own edits to a shared file) but is **not**
  invoked by the memory provisioner. Because "additive" is a documentation
  claim, not something to take on faith, empirical verification that the
  hooks in the `--settings` file actually load and fire is a **Phase 1
  acceptance test** (see §9, Phase 1 acceptance criteria and the
  settings-isolation regression test) rather than a design gate — the
  provisioner ships against the documented behavior, and the test catches a
  CLI regression or a misunderstanding of the flag before it reaches a user.
- **O-2 — RESOLVED.** One memory pool per human, full stop. The founder's
  decision: work/personal separation is a property of the **project**, not of
  the AI account. A "Work" Codex account and a "Personal" Claude account both
  read and write the same local `memory.db`; there is no per-account
  partitioning and no per-account filter toggle. What actually separates
  "work" from "personal" is which **project** an agent is operating in —
  `memory_context` and `memory_search` only ever retrieve observations whose
  `project_key` matches the active project (plus explicitly project-less
  `__global__` memories, which are rare and user-visible). A decision recorded
  while working on `acme-api` does not surface in a session on a personal
  side project, not because of an account filter, but because the two have
  different `project_key`s. This removes option (c) from the original
  question — no account-scoped filter ships in Phase 1 or later — and
  confirms the "one pool per human" claim in §1 decision 1 as final, not
  provisional.
- **O-3 — Free tier ceiling.** Is Free's local memory truly unlimited, or capped (e.g. 500
  observations) to sharpen the upgrade pressure? Unlimited is the better funnel and the
  better story; a cap monetizes harder. Needs a decision before Phase 1 ships because it
  changes the card's copy and the gating code.
- **O-4 — Session rollup quality.** Template-based rollups (Phase 1) will be mediocre.
  Are we willing to (a) ship mediocre and iterate, (b) spend an LLM call per session on our
  own key (cost per user per day), or (c) ask the agent to write its own rollup via a
  `Stop`-hook prompt injection (free, but only works on Claude Code)? Recommendation: (c)
  where available, (a) elsewhere.
- **O-5 — Team memory ownership on departure.** When a member leaves, their promoted `team`
  memories persist (as specified). But if they leave the *company* and demand deletion under
  GDPR, do we delete team knowledge they authored, or anonymize the attribution and keep the
  content? Legally and product-wise these differ. Recommendation: anonymize by default,
  hard-delete on explicit legal request — but this needs a stated policy before Teams ships.
- **O-6 — Retention of prompts.** `session_prompts` is local-only with 30-day retention.
  Is 30 days right? It is the raw material for better rollups later, but it is also the most
  sensitive thing we store.
- **O-7 — Do we want a `nest-memory` standalone CLI** (usable outside the app, e.g. in CI or
  in a plain terminal)? If yes, the shim should be Go from the start and the daemon protocol
  becomes a public contract. If no, TypeScript is clearly correct. *Affects §1.1 immediately.*
- **O-8 — Local Supabase vs. production branch for development.** The repo has no
  `supabase/config.toml` for a local stack today. Standing one up is a half-day of setup that
  pays for itself immediately; using a production branch is faster to start but risks
  migration drift. Recommendation: local stack, because Phase 2 needs two devices hitting one
  backend repeatedly and that should never touch production.
- **O-9 — Enterprise tier memory entitlement.** Main added a 4th plan tier
  (`enterprise`, sales-led/invoiced, `src/lib/stripe.ts`) after this doc and its Supabase
  migration were first written. Merging main into this branch required an immediate
  answer just to keep enterprise accounts from being silently rejected by every memory
  plan gate (`user_has_plan` calls that only listed `pro`/`team`), so §7.1 now treats
  `enterprise` as team-or-better with effectively unlimited caps — a stopgap, not a
  reviewed decision. *Needs founder/sales confirmation*: should enterprise memory caps
  be genuinely unlimited, or a large negotiated number per contract (mirroring how
  `ENTERPRISE_MIN_SEATS`/`ENTERPRISE_FLOOR_PER_SEAT` already work for pane/seat pricing)?

---

## Appendix A — What we take from engram, and what we deliberately don't

Engram (Go, SQLite + FTS5, optional self-hosted Postgres cloud) was studied as prior art.
Findings below are from reading the actual source; nothing is shared with it.

### Concepts adopted (reimplemented from scratch)

| Concept | As engram does it | As Nest Memory does it |
|---|---|---|
| Portable replication ID | `sync_id` = `obs-` + 8 random bytes (64 bits), separate from the local autoincrement `id` | Same idea, `obs-` + **16** random bytes. 64 bits is thin once a team shares a namespace; 128 costs 16 characters. |
| Append-only outbox | `sync_mutations(seq, target_key, entity, entity_key, op, payload, acked_at)`; pending = `acked_at IS NULL` | `mutation_log(seq, sync_id, op, payload, pushed_at)`. Same shape, one entity type fewer. |
| `topic_key` as merge unit | In-place update of the newest matching `(topic_key, project, scope)` row, bumping `revision_count` | Identical semantics (§3.1 step 1) — this is the single best idea in engram's design. |
| Content dedupe with counters | `normalized_hash` + dedupe window, bumping `duplicate_count` instead of inserting | Adopted verbatim in concept (§3.1 step 2). Turns "save aggressively" from a liability into a ranking signal. |
| External-content FTS5 | `observations_fts` with `content='observations'` + 3 sync triggers | Same pattern — it is the correct way to do FTS5 in SQLite. |
| Deferred apply on FK miss | `sync_apply_deferred` parks mutations whose referenced row hasn't arrived | Same, for `superseded_by` references (§4.2). |
| Soft-delete tombstones | `deleted_at` column replicated as a normal upsert | Same (`deleted` flag), with the same "delete is just another LWW write" simplification. |
| Proactive tool descriptions | *"Call this PROACTIVELY after completing significant work — don't wait to be asked"* + a What/Why/Where/Learned content template embedded in the description | Same technique, same template (§2.1). It demonstrably works. |
| Small eager tool set | ~6 core tools eager, ~18 deferred behind tool search | Same discipline (§2.2). |
| Hook-injected protocol | `SessionStart` prints a memory protocol as `additionalContext`; post-compaction hook forces a recovery sequence | Same, plus the **time-since-last-save nudge** on `UserPromptSubmit` and **subagent output capture** on `SubagentStop` — the two highest-yield hooks engram ships. |
| Project detection order | git remote basename → git root basename → cwd basename, lowercased | Same *order*, but we hash the **full normalized remote** rather than using the basename. Two different `api` repos must not collide, and the cloud should not learn repo names (§3.3). |

### Deliberately different

- **One store per human, not one per HOME.** Engram's DB is `{HOME}/.engram/engram.db`. Under
  Nest's per-account HOME rewrite that yields *one isolated memory per AI account* — verified
  on this machine: separate `.engram/engram.db` files exist under the `claude`, `codex`, and
  `gemini` account dirs. Nest's entire thesis is that the panes are one workspace, so the
  memory is one pool (§1, decision 1).
- **Ordering is per-project and lock-serialized, not a global `BIGSERIAL`.** Engram's cloud
  assigns a single global sequence and resolves conflicts by application order. That is
  simple and deterministic, but a plain sequence has the commit-visibility gap described in
  §4.2, and a global sequence means every device pulls every project's traffic. Per-project
  advisory-locked sequences fix both.
- **Merge never discards.** Engram's `applyObservationUpsertTx` overwrites unconditionally on
  `sync_id` match. That is correct for same-`sync_id` edits, but Nest additionally handles the
  *different-`sync_id`, same-`topic_key`* collision by **superseding rather than deleting**
  (§4.3 rule b), so two devices that independently wrote the same topic offline lose nothing.
- **Enrollment is automatic, not opt-in.** Engram requires an explicit `EnrollProject` before
  a project syncs. That is one user action, and one is too many. Nest enrolls every project
  automatically and offers opt-*out* per project.
- **Real per-user identity.** Engram Cloud authenticates with a **single static shared bearer
  token** per deployment (`ENGRAM_CLOUD_TOKEN`, constant-time compared, no expiry, project
  allowlist by env var) — appropriate for self-hosting, unusable for multi-tenant SaaS. Nest
  issues per-user, per-device, hash-stored, individually revocable tokens bound to
  `auth.uid()`, with authorization evaluated per request against live team membership (§6).
- **No single-writer lease needed.** Engram carries `lease_owner`/`lease_until` in `sync_state`
  because multiple processes may autosync the same DB. Nest's daemon lives in the Electron
  main process and is structurally the only writer — the lease columns would be dead weight.
- **No user-facing memory commands at all.** Engram exposes `engram sync`, `engram cloud
  config`, enrollment commands, a dashboard. Nest exposes one button, once. Every additional
  affordance is a way for the "zero user actions" promise to leak.
- **Sharing is a first-class, audited, plan-gated product surface**, not a config flag.

**Zero code, schema, or runtime dependency is shared with engram.** The importer reads its
SQLite file the way any importer reads a foreign format: from the outside, read-only, on a
temp copy, version-tolerant.

---

## Appendix B — Files that will change or be created

| Path | Change |
|---|---|
| `electron/memory-store.ts` | **new** — SQLite schema, single-writer API, FTS search, redaction |
| `electron/memory-daemon.ts` | **new** — sync scheduler, push/pull, offline queue, backoff |
| `electron/memory-ipc-server.ts` | **new** — named pipe / unix socket server for the shim |
| `electron/memory-provisioner.ts` | **new** — per-AI MCP + hook injection into `{accountDir}` |
| `electron/memory-importers/` | **new** — `engram.ts`, `markdown.ts`, shared chunker |
| `electron/memory-mcp/` | **new** — the stdio shim (built as a separate electron-vite entry) |
| `electron/pty-manager.ts` | inject `NEST_MEMORY_*` env; accept `aiType` + `accountName` |
| `electron/account-store.ts` | call the provisioner from `save()` / `migrateClaudeAccounts()`; export `isSharedWithGlobal` |
| `electron/main.ts` | `memory:*` IPC handlers; daemon start on `ready`, teardown via `finalizeMemoryBeforeQuit()` wired into the tray quit handler and `updater:install` (**not** `before-quit` — see §4.1 correction); focus + online triggers |
| `electron/preload.ts` | `window.memory` bridge (connect, disconnect, status, list, promote) |
| `src/hooks/useMemory.ts` | **new** — card state, progress stream, actions |
| `src/components/SettingsPanel.tsx` | Nest Memory card in the Account tab |
| `src/components/MemoryPanel.tsx` | **new** (Phase 3) — dashboard |
| `src/lib/stripe.ts` | `PLAN_LIMITS` memory fields |
| `supabase/migrations/2026…_nest_memory.sql` | **new** — tables, indexes, RLS, RPCs, triggers |
| `supabase/functions/memory-token/` | **new** — issue / list / revoke / rotate |
| `supabase/functions/memory-sync/` | **new** — bootstrap / push / pull |
| `package.json` | `better-sqlite3` dep; `postinstall` rebuild `-w better-sqlite3` |
