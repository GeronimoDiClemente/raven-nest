// Local SQLite store — the single write path for Nest Memory. Owned exclusively by the
// sync daemon (electron/memory-daemon.ts) in Electron main. See
// docs/nest-memory-architecture.md §1.2 and §3.1 for the design this implements.
//
// better-sqlite3 is synchronous by design — every method here is synchronous. Callers
// (the IPC server, the daemon) are responsible for not blocking the event loop with a
// pathological query; in practice every query here is a single indexed lookup or a small
// FTS5 MATCH, sub-millisecond on the data volumes this product targets (§10 R-6).

import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { randomBytes, createHash } from 'crypto'
import { redact } from './memory-redaction'
import { GLOBAL_PROJECT_KEY } from './memory-project-key'
import type {
  ObservationSource,
  ObservationSummary,
  ObservationType,
  SaveMemoryResult,
} from './memory-protocol'

const DEDUPE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export function generateSyncId(prefix: 'obs' | 'sess' | 'prom'): string {
  return `${prefix}-${randomBytes(16).toString('hex')}`
}

export function contentHash(title: string, content: string | null): string {
  const normalized = `${title.trim().toLowerCase()}\n${(content ?? '').trim().toLowerCase()}`
  return createHash('sha256').update(normalized).digest('hex')
}

export interface SaveInput {
  projectKey: string
  scope?: 'personal' | 'project' | 'team' // Phase 1: auto-capture always forces 'personal' at the call site
  topicKey?: string | null
  type: ObservationType
  title: string
  content: string
  tags?: string[]
  source: ObservationSource
  originAi?: string | null
  originAccount?: string | null
  gitBranch?: string | null
  authorUserId?: string | null
  authorDisplay?: string | null
  sourceRef?: string | null // import identity — see §5.3 idempotency guard 1
}

export interface ObservationRow {
  sync_id: string
  project_key: string
  scope: string
  topic_key: string | null
  type: string
  title: string
  // M12: nullable so a tombstone can actually null the content, per §3.1 "A delete sets
  // deleted=1, nulls content". The column was previously NOT NULL, which made that rule
  // impossible to implement — deleteObservation() below is the only writer that sets
  // this to null.
  content: string | null
  tags: string | null
  source: string
  origin_ai: string | null
  origin_account: string | null
  git_branch: string | null
  author_user_id: string | null
  author_display: string | null
  content_hash: string
  revision_count: number
  duplicate_count: number
  last_seen_at: number | null
  created_at: number
  updated_at: number
  lamport: number
  deleted: number
  superseded_by: string | null
  source_ref: string | null
  server_seq: number | null
}

export interface MutationLogRow {
  seq: number
  sync_id: string
  op: 'upsert' | 'delete' | 'promote'
  payload: string
  created_at: number
  pushed_at: number | null
  // M21: set when the server reported this specific mutation as 'rejected' (plan limit,
  // revoked access, etc.) — surfaced once rather than silently discarded.
  last_error: string | null
}

export interface MarkPushedEntry {
  seq: number
  /** Non-null only for a server-reported 'rejected' outcome — see M21. */
  error?: string | null
}

export class MemoryStore {
  private db: Database.Database
  private lamportCounter = 0

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.migrate()
    const row = this.db.prepare('SELECT MAX(lamport) as m FROM observations').get() as { m: number | null }
    this.lamportCounter = row?.m ?? 0
  }

  close(): void {
    this.db.close()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS observations (
        sync_id        TEXT PRIMARY KEY,
        project_key    TEXT NOT NULL,
        scope          TEXT NOT NULL CHECK (scope IN ('personal','project','team')),
        topic_key      TEXT,
        type           TEXT NOT NULL,
        title          TEXT NOT NULL,
        content        TEXT,
        tags           TEXT,
        source         TEXT NOT NULL,
        origin_ai      TEXT,
        origin_account TEXT,
        git_branch     TEXT,
        author_user_id TEXT,
        author_display TEXT,
        content_hash   TEXT NOT NULL,
        revision_count INTEGER NOT NULL DEFAULT 0,
        duplicate_count INTEGER NOT NULL DEFAULT 0,
        last_seen_at   INTEGER,
        created_at     INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL,
        lamport        INTEGER NOT NULL DEFAULT 0,
        deleted        INTEGER NOT NULL DEFAULT 0,
        superseded_by  TEXT,
        source_ref     TEXT,
        server_seq     INTEGER
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_obs_topic
        ON observations(project_key, scope, topic_key)
        WHERE topic_key IS NOT NULL AND deleted = 0 AND superseded_by IS NULL;

      CREATE INDEX IF NOT EXISTS idx_obs_project_updated ON observations(project_key, updated_at DESC);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_obs_source_ref ON observations(source, source_ref)
        WHERE source_ref IS NOT NULL;

      CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
        title, content, tags,
        content='observations', content_rowid='rowid', tokenize='unicode61'
      );

      CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
        INSERT INTO observations_fts(rowid, title, content, tags)
        VALUES (new.rowid, new.title, new.content, coalesce(new.tags, ''));
      END;
      CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
        INSERT INTO observations_fts(observations_fts, rowid, title, content, tags)
        VALUES('delete', old.rowid, old.title, old.content, coalesce(old.tags, ''));
      END;
      CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
        INSERT INTO observations_fts(observations_fts, rowid, title, content, tags)
        VALUES('delete', old.rowid, old.title, old.content, coalesce(old.tags, ''));
        INSERT INTO observations_fts(rowid, title, content, tags)
        VALUES (new.rowid, new.title, new.content, coalesce(new.tags, ''));
      END;

      CREATE TABLE IF NOT EXISTS mutation_log (
        seq        INTEGER PRIMARY KEY AUTOINCREMENT,
        sync_id    TEXT NOT NULL,
        op         TEXT NOT NULL,
        payload    TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        pushed_at  INTEGER,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_mutlog_pending ON mutation_log(seq) WHERE pushed_at IS NULL;

      CREATE TABLE IF NOT EXISTS sync_state (
        partition_key    TEXT PRIMARY KEY,
        cloud_project_id TEXT,
        pull_cursor      INTEGER NOT NULL DEFAULT 0,
        last_push_seq    INTEGER NOT NULL DEFAULT 0,
        last_success_at  INTEGER,
        last_error       TEXT,
        failure_count    INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS projects (
        project_key  TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        root_path    TEXT,
        remote_url   TEXT,
        enrolled     INTEGER NOT NULL DEFAULT 1,
        team_id      TEXT,
        created_at   INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id           TEXT PRIMARY KEY,
        pane_id      TEXT,
        project_key  TEXT NOT NULL,
        ai_type      TEXT,
        account      TEXT,
        git_branch   TEXT,
        started_at   INTEGER NOT NULL,
        ended_at     INTEGER,
        prompt_count INTEGER NOT NULL DEFAULT 0,
        rolled_up    INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS session_prompts (
        session_id TEXT NOT NULL,
        at         INTEGER NOT NULL,
        text       TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS promotion_queue (
        sync_id    TEXT PRIMARY KEY,
        to_scope   TEXT NOT NULL,
        reason     TEXT,
        status     TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS import_runs (
        id          TEXT PRIMARY KEY,
        source      TEXT NOT NULL,
        source_path TEXT NOT NULL,
        cursor      TEXT,
        imported    INTEGER NOT NULL DEFAULT 0,
        skipped     INTEGER NOT NULL DEFAULT 0,
        state       TEXT NOT NULL,
        started_at  INTEGER NOT NULL,
        finished_at INTEGER,
        error       TEXT
      );
    `)
  }

  private nextLamport(): number {
    this.lamportCounter += 1
    return this.lamportCounter
  }

  /**
   * Walks a `superseded_by` chain to the current active winner (§4.3 rule b — the loser
   * is kept, never deleted, so the chain is always followable). Bounded to guard against
   * a corrupt/cyclic chain, which should never occur by construction but must not hang
   * the process if it somehow does.
   */
  private resolveToActiveWinner(row: ObservationRow): ObservationRow {
    let current = row
    let hops = 0
    while (current.superseded_by && hops < 50) {
      const next = this.get(current.superseded_by)
      if (!next) break
      current = next
      hops += 1
    }
    return current
  }

  ensureProject(input: { projectKey: string; displayName: string; rootPath?: string | null; remoteUrl?: string | null }): void {
    const existing = this.db.prepare('SELECT project_key FROM projects WHERE project_key = ?').get(input.projectKey)
    if (existing) return
    this.db
      .prepare(
        `INSERT INTO projects (project_key, display_name, root_path, remote_url, enrolled, created_at)
         VALUES (?, ?, ?, ?, 1, ?)`
      )
      .run(input.projectKey, input.displayName, input.rootPath ?? null, input.remoteUrl ?? null, Date.now())
  }

  /** M17: enumerates known local projects so the daemon can pull with a per-project cursor for each. */
  listProjects(): Array<{ projectKey: string; displayName: string; enrolled: boolean }> {
    const rows = this.db.prepare('SELECT project_key, display_name, enrolled FROM projects').all() as Array<{
      project_key: string
      display_name: string
      enrolled: number
    }>
    return rows.map((r) => ({ projectKey: r.project_key, displayName: r.display_name, enrolled: r.enrolled === 1 }))
  }

  private appendMutation(op: 'upsert' | 'delete' | 'promote', row: ObservationRow): void {
    this.db
      .prepare('INSERT INTO mutation_log (sync_id, op, payload, created_at) VALUES (?, ?, ?, ?)')
      .run(row.sync_id, op, JSON.stringify(row), Date.now())
  }

  private toSummary(row: ObservationRow): ObservationSummary {
    return {
      syncId: row.sync_id,
      title: row.title,
      // search()/context() already filter deleted=0, so a tombstoned (null-content) row
      // never reaches here in practice — the fallback is defensive, not load-bearing.
      content: row.content ?? '',
      type: row.type as ObservationType,
      topicKey: row.topic_key,
      tags: row.tags ? (JSON.parse(row.tags) as string[]) : [],
      updatedAt: row.updated_at,
      originAi: row.origin_ai,
      gitBranch: row.git_branch,
    }
  }

  /**
   * The three-step write-path resolution from §3.1: source_ref identity (imports only,
   * guard 1 of §5.3) -> topic_key upsert -> content dedupe window -> insert.
   */
  save(input: SaveInput): SaveMemoryResult {
    const scope = input.scope ?? 'personal'
    const { text: title } = redact(input.title)
    const { text: content, redacted } = redact(input.content)
    const hash = contentHash(title, content)
    const now = Date.now()

    const txn = this.db.transaction((): SaveMemoryResult => {
      // Step 0 (imports only): identity by (source, source_ref).
      if (input.sourceRef) {
        // C3 fix: this lookup used to omit `AND superseded_by IS NULL`. Once a row lost
        // a topic-collision merge (superseded_by set by the daemon's pull-apply path,
        // §4.3 rule b), it was still the ONLY row addressable by this (source,
        // source_ref) pair — every future re-import silently rewrote the dead row,
        // whose content is permanently excluded from search()/context() by the
        // deleted=0/superseded_by IS NULL filters everywhere else. The importer would
        // "succeed" forever while the item stayed invisible.
        const bySourceRef = this.db
          .prepare('SELECT * FROM observations WHERE source = ? AND source_ref = ? AND deleted = 0 AND superseded_by IS NULL')
          .get(input.source, input.sourceRef) as ObservationRow | undefined
        if (bySourceRef) {
          const updated: ObservationRow = {
            ...bySourceRef,
            title,
            content,
            tags: input.tags ? JSON.stringify(input.tags) : bySourceRef.tags,
            content_hash: hash,
            revision_count: bySourceRef.revision_count + 1,
            updated_at: now,
            lamport: this.nextLamport(),
          }
          this.applyRowUpdate(updated)
          this.appendMutation('upsert', updated)
          return { syncId: updated.sync_id, outcome: 'source_ref_updated', redacted }
        }

        // Defined fallthrough (C3): no ACTIVE row for this source_ref, but an INACTIVE
        // one (superseded or tombstoned) may still hold it — idx_obs_source_ref is a
        // hard UNIQUE(source, source_ref) constraint that does NOT exclude inactive
        // rows, so falling through to a plain INSERT below would violate it. Instead,
        // resolve to whatever the current active winner of that lineage is (walking
        // superseded_by) and report it WITHOUT overwriting its content — the winner
        // already reflects the most-authoritative merge outcome, and an unchanged
        // reimport of old source material must not regress it. A genuinely new
        // source_ref (no row at all, active or not) falls through normally to steps 1-3.
        const inactiveMatch = this.db
          .prepare('SELECT * FROM observations WHERE source = ? AND source_ref = ?')
          .get(input.source, input.sourceRef) as ObservationRow | undefined
        if (inactiveMatch) {
          const winner = this.resolveToActiveWinner(inactiveMatch)
          return { syncId: winner.sync_id, outcome: 'duplicate', redacted }
        }
      }

      // Step 1: topic_key upsert — rewrite in place, same sync_id.
      if (input.topicKey) {
        const existing = this.db
          .prepare(
            `SELECT * FROM observations
             WHERE project_key = ? AND scope = ? AND topic_key = ? AND deleted = 0 AND superseded_by IS NULL`
          )
          .get(input.projectKey, scope, input.topicKey) as ObservationRow | undefined
        if (existing) {
          const updated: ObservationRow = {
            ...existing,
            title,
            content,
            tags: input.tags ? JSON.stringify(input.tags) : existing.tags,
            content_hash: hash,
            revision_count: existing.revision_count + 1,
            updated_at: now,
            lamport: this.nextLamport(),
            source_ref: input.sourceRef ?? existing.source_ref,
          }
          this.applyRowUpdate(updated)
          this.appendMutation('upsert', updated)
          return { syncId: updated.sync_id, outcome: 'topic_updated', redacted }
        }
      }

      // Step 2: content dedupe window — same (project, scope, type) + hash within 7 days.
      const dupe = this.db
        .prepare(
          `SELECT * FROM observations
           WHERE project_key = ? AND scope = ? AND type = ? AND content_hash = ?
             AND deleted = 0 AND superseded_by IS NULL AND created_at >= ?`
        )
        .get(input.projectKey, scope, input.type, hash, now - DEDUPE_WINDOW_MS) as ObservationRow | undefined
      if (dupe) {
        // M23 (accepted divergence, documented): this bump does NOT go through
        // appendMutation/mutation_log, so duplicate_count/last_seen_at do not replicate
        // to the cloud copy of this row. Deliberate, not an oversight — these are pure
        // ranking-signal fields (§3.1: "The repeat is a ranking signal, not noise"), not
        // part of LWW conflict resolution or displayed content, so a stale cloud copy of
        // them is harmless. Routing every dedupe hit through the mutation log would mean
        // an agent that calls memory_save with identical content N times in one session
        // (the exact "safe to call aggressively" behavior §3.1 wants to encourage)
        // produces N mutation_log rows and N pushes for a bump nobody but local ranking
        // reads — real write/network amplification for zero replicated-content benefit
        // (§10 R-8 cost). If duplicate_count/last_seen_at ever become user-visible or
        // cross-device signals, revisit this.
        this.db
          .prepare('UPDATE observations SET duplicate_count = duplicate_count + 1, last_seen_at = ? WHERE sync_id = ?')
          .run(now, dupe.sync_id)
        return { syncId: dupe.sync_id, outcome: 'duplicate', redacted }
      }

      // Step 3: insert.
      const row: ObservationRow = {
        sync_id: generateSyncId('obs'),
        project_key: input.projectKey,
        scope,
        topic_key: input.topicKey ?? null,
        type: input.type,
        title,
        content,
        tags: input.tags ? JSON.stringify(input.tags) : null,
        source: input.source,
        origin_ai: input.originAi ?? null,
        origin_account: input.originAccount ?? null,
        git_branch: input.gitBranch ?? null,
        author_user_id: input.authorUserId ?? null,
        author_display: input.authorDisplay ?? null,
        content_hash: hash,
        revision_count: 0,
        duplicate_count: 0,
        last_seen_at: now,
        created_at: now,
        updated_at: now,
        lamport: this.nextLamport(),
        deleted: 0,
        superseded_by: null,
        source_ref: input.sourceRef ?? null,
        server_seq: null,
      }
      this.insertRow(row)
      this.appendMutation('upsert', row)
      return { syncId: row.sync_id, outcome: 'inserted', redacted }
    })

    return txn()
  }

  private insertRow(row: ObservationRow): void {
    this.db
      .prepare(
        `INSERT INTO observations
         (sync_id, project_key, scope, topic_key, type, title, content, tags, source, origin_ai,
          origin_account, git_branch, author_user_id, author_display, content_hash, revision_count,
          duplicate_count, last_seen_at, created_at, updated_at, lamport, deleted, superseded_by,
          source_ref, server_seq)
         VALUES (@sync_id, @project_key, @scope, @topic_key, @type, @title, @content, @tags, @source,
          @origin_ai, @origin_account, @git_branch, @author_user_id, @author_display, @content_hash,
          @revision_count, @duplicate_count, @last_seen_at, @created_at, @updated_at, @lamport,
          @deleted, @superseded_by, @source_ref, @server_seq)`
      )
      .run(row)
  }

  private applyRowUpdate(row: ObservationRow): void {
    this.db
      .prepare(
        `UPDATE observations SET
           title = @title, content = @content, tags = @tags, content_hash = @content_hash,
           revision_count = @revision_count, updated_at = @updated_at, lamport = @lamport,
           deleted = @deleted, superseded_by = @superseded_by, source_ref = @source_ref,
           duplicate_count = @duplicate_count, last_seen_at = @last_seen_at, server_seq = @server_seq
         WHERE sync_id = @sync_id`
      )
      .run(row)
  }

  search(projectKey: string, query: string, limit = 10): ObservationSummary[] {
    const safe = query.replace(/["]/g, '')
    if (!safe.trim()) return []
    const rows = this.db
      .prepare(
        `SELECT o.* FROM observations o
         JOIN observations_fts f ON f.rowid = o.rowid
         WHERE observations_fts MATCH ? AND o.deleted = 0 AND o.superseded_by IS NULL
           AND (o.project_key = ? OR o.project_key = ?)
         ORDER BY o.updated_at DESC, o.lamport DESC LIMIT ?`
      )
      .all(`"${safe}"`, projectKey, GLOBAL_PROJECT_KEY, limit) as ObservationRow[]
    return rows.map((r) => this.toSummary(r))
  }

  // `updated_at` is a JS `Date.now()` ms-epoch value — two writes in the same
  // millisecond (routine in a fast test, and not impossible for a chatty agent
  // session) tie under a bare `ORDER BY updated_at DESC`, and SQLite doesn't
  // guarantee ties resolve in write order. `lamport` exists precisely to give a
  // total order beyond wall-clock resolution (it's a strictly-increasing counter,
  // §4.3), so it's the correct secondary sort key wherever recency ordering matters.
  context(projectKey: string, limit = 10): ObservationSummary[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM observations
         WHERE (project_key = ? OR project_key = ?) AND deleted = 0 AND superseded_by IS NULL
         ORDER BY updated_at DESC, lamport DESC LIMIT ?`
      )
      .all(projectKey, GLOBAL_PROJECT_KEY, limit) as ObservationRow[]
    return rows.map((r) => this.toSummary(r))
  }

  get(syncId: string): ObservationRow | null {
    return (this.db.prepare('SELECT * FROM observations WHERE sync_id = ?').get(syncId) as ObservationRow) ?? null
  }

  /** Read-only lookup used by the daemon's pull-apply path (§4.3) to detect topic collisions. */
  findActiveTopicOwner(projectKey: string, scope: string, topicKey: string, excludeSyncId: string): ObservationRow | null {
    return (
      (this.db
        .prepare(
          `SELECT * FROM observations WHERE project_key = ? AND scope = ? AND topic_key = ?
           AND sync_id != ? AND deleted = 0 AND superseded_by IS NULL`
        )
        .get(projectKey, scope, topicKey, excludeSyncId) as ObservationRow) ?? null
    )
  }

  /**
   * Applies an already-resolved incoming row from a cloud pull (§4.4). Unlike save(),
   * this does NOT run the topic/dedupe resolution — the caller (memory-daemon.ts) has
   * already applied the LWW/topic-collision rules from memory-merge.ts and is telling
   * this store exactly what the row should look like now. Upsert by sync_id, idempotent.
   */
  applyIncomingObservation(row: {
    syncId: string
    projectKey: string
    scope: string
    topicKey: string | null
    type: string
    title: string
    content: string | null
    tags?: string[] | null
    originAi?: string | null
    originAccount?: string | null
    gitBranch?: string | null
    authorUserId?: string | null
    authorDisplay?: string | null
    contentHash?: string
    updatedAt: number
    lamport: number
    deleted: boolean
    supersededBy?: string | null
    serverSeq?: number | null
  }): void {
    // C4 fix: this used to write `row.lamport` into the row without ever advancing
    // MemoryStore's own `lamportCounter`. A local save() right after a pull could then
    // hand out a lamport LOWER than one just received, so a same-timestamp LWW tie
    // between the two would pick the wrong winner and silently discard a newer local
    // edit. Standard Lamport clock discipline: on receiving a stamped value, the local
    // clock becomes at least that value, so every subsequent local write is guaranteed
    // to be ordered after everything this device has ever seen.
    this.lamportCounter = Math.max(this.lamportCounter, row.lamport)

    // M13 fix: pulled content previously went straight to disk unredacted. A secret an
    // agent saved on another device (before that device's own redaction ran — or from a
    // pre-redaction historical row) must not land in this store's plaintext either.
    // Defense in depth: redaction is meant to run once, at the point of original
    // authorship, but a second pass here costs nothing and closes the gap for any
    // upstream data that slipped through.
    const { text: safeTitle } = redact(row.title)
    const safeContent = row.content !== null ? redact(row.content).text : null

    const existing = this.get(row.syncId)
    const now = Date.now()
    if (existing) {
      this.db
        .prepare(
          `UPDATE observations SET title = ?, content = ?, tags = ?, updated_at = ?, lamport = ?,
           deleted = ?, superseded_by = ?, server_seq = ? WHERE sync_id = ?`
        )
        .run(
          safeTitle,
          safeContent,
          row.tags ? JSON.stringify(row.tags) : existing.tags,
          row.updatedAt,
          row.lamport,
          row.deleted ? 1 : 0,
          row.supersededBy ?? null,
          row.serverSeq ?? existing.server_seq,
          row.syncId
        )
    } else {
      this.insertRow({
        sync_id: row.syncId,
        project_key: row.projectKey,
        scope: row.scope,
        topic_key: row.topicKey,
        type: row.type,
        title: safeTitle,
        content: safeContent,
        tags: row.tags ? JSON.stringify(row.tags) : null,
        source: 'import',
        origin_ai: row.originAi ?? null,
        origin_account: row.originAccount ?? null,
        git_branch: row.gitBranch ?? null,
        author_user_id: row.authorUserId ?? null,
        author_display: row.authorDisplay ?? null,
        content_hash: row.contentHash ?? contentHash(safeTitle, safeContent),
        revision_count: 0,
        duplicate_count: 0,
        last_seen_at: now,
        created_at: now,
        updated_at: row.updatedAt,
        lamport: row.lamport,
        deleted: row.deleted ? 1 : 0,
        superseded_by: row.supersededBy ?? null,
        source_ref: null,
        server_seq: row.serverSeq ?? null,
      })
    }
  }

  /**
   * M12: originates a local delete/tombstone (§3.1 — "A delete sets deleted=1, nulls
   * content, bumps updated_at, and appends a delete mutation"). Not currently wired to
   * any MCP tool or UI affordance in Phase 1 (the doc's own Phase 1 tool scope is
   * memory_save/search/context only) — this is the capability existing so a tombstone
   * CAN be created and will replicate correctly through the existing mutation_log/push
   * path once something calls it. Returns false if the row doesn't exist or is already
   * deleted (idempotent no-op, not an error).
   */
  deleteObservation(syncId: string): boolean {
    const existing = this.get(syncId)
    if (!existing || existing.deleted) return false
    const updated: ObservationRow = {
      ...existing,
      content: null,
      updated_at: Date.now(),
      lamport: this.nextLamport(),
      deleted: 1,
    }
    this.applyRowUpdate(updated)
    this.appendMutation('delete', updated)
    return true
  }

  getBySourceRef(source: string, sourceRef: string): ObservationRow | null {
    return (
      (this.db
        .prepare('SELECT * FROM observations WHERE source = ? AND source_ref = ?')
        .get(source, sourceRef) as ObservationRow) ?? null
    )
  }

  count(): number {
    // M24 fix: superseded rows are kept (append-first, §4.3 rule b) but are not "active"
    // items — every other read path (search/context/idx_obs_topic) already excludes
    // them via `superseded_by IS NULL`. This count is shown to the user as an item count
    // (§8.1 Connect Memory card); including dead losers of a topic-collision merge
    // overstates it.
    const row = this.db.prepare('SELECT COUNT(*) as c FROM observations WHERE deleted = 0 AND superseded_by IS NULL').get() as { c: number }
    return row.c
  }

  // ── Mutation log / offline queue (§4.5) ──────────────────────────────────

  pendingMutations(limit = 200): MutationLogRow[] {
    return this.db
      .prepare('SELECT * FROM mutation_log WHERE pushed_at IS NULL ORDER BY seq ASC LIMIT ?')
      .all(limit) as MutationLogRow[]
  }

  pendingMutationCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as c FROM mutation_log WHERE pushed_at IS NULL').get() as {
      c: number
    }
    return row.c
  }

  /**
   * M21 fix: accepts either a bare seq (plain "mark pushed, no error") or `{seq, error}`
   * so the daemon can record a server-reported 'rejected' outcome's message per §4.2:
   * "Rejected ones ... are marked pushed with a local last_error so they don't loop
   * forever, and surfaced once." Previously this only ever took bare seqs and the
   * daemon discarded the server's per-mutation results entirely (`void body`), so a
   * rejected mutation was marked pushed with NO record of why — indistinguishable from a
   * normal success. Kept backward compatible with plain `number[]` so existing callers
   * (tests, simple call sites) are unaffected.
   */
  markPushed(entries: Array<number | MarkPushedEntry>): void {
    if (entries.length === 0) return
    const now = Date.now()
    const stmt = this.db.prepare('UPDATE mutation_log SET pushed_at = ?, last_error = ? WHERE seq = ?')
    const txn = this.db.transaction((rows: Array<number | MarkPushedEntry>) => {
      for (const e of rows) {
        if (typeof e === 'number') stmt.run(now, null, e)
        else stmt.run(now, e.error ?? null, e.seq)
      }
    })
    txn(entries)
  }

  pruneAckedMutations(olderThanMs = 7 * 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - olderThanMs
    const result = this.db
      .prepare('DELETE FROM mutation_log WHERE pushed_at IS NOT NULL AND pushed_at < ?')
      .run(cutoff)
    return result.changes
  }

  /**
   * M20: offline-queue maintenance. §4.5 "hard cap 50000, after which the daemon
   * compacts the queue by collapsing multiple upsert ops for the same sync_id into the
   * latest one (safe: payload is a full snapshot)". Keeps only the highest-seq PENDING
   * 'upsert' mutation per sync_id; 'delete'/'promote' ops are left untouched (each is
   * meaningful on its own, not a superseded snapshot of the same intent). Wired from
   * MemoryDaemon's drain() — see memory-daemon.ts.
   */
  compactMutationLog(): number {
    const result = this.db
      .prepare(
        `DELETE FROM mutation_log
         WHERE pushed_at IS NULL AND op = 'upsert'
           AND seq NOT IN (
             SELECT MAX(seq) FROM mutation_log WHERE pushed_at IS NULL AND op = 'upsert' GROUP BY sync_id
           )`
      )
      .run()
    return result.changes
  }

  // ── Sync state / cursors ─────────────────────────────────────────────────

  getSyncState(partitionKey: string): { pullCursor: number; lastPushSeq: number } {
    const row = this.db.prepare('SELECT * FROM sync_state WHERE partition_key = ?').get(partitionKey) as
      | { pull_cursor: number; last_push_seq: number }
      | undefined
    if (!row) return { pullCursor: 0, lastPushSeq: 0 }
    return { pullCursor: row.pull_cursor, lastPushSeq: row.last_push_seq }
  }

  setSyncState(partitionKey: string, update: Partial<{ pullCursor: number; lastPushSeq: number; lastSuccessAt: number; lastError: string | null; cloudProjectId: string }>): void {
    const current = this.db.prepare('SELECT * FROM sync_state WHERE partition_key = ?').get(partitionKey)
    if (!current) {
      this.db
        .prepare(
          `INSERT INTO sync_state (partition_key, cloud_project_id, pull_cursor, last_push_seq, last_success_at, last_error, failure_count)
           VALUES (?, ?, ?, ?, ?, ?, 0)`
        )
        .run(
          partitionKey,
          update.cloudProjectId ?? null,
          update.pullCursor ?? 0,
          update.lastPushSeq ?? 0,
          update.lastSuccessAt ?? null,
          update.lastError ?? null
        )
      return
    }
    const fields: string[] = []
    const values: unknown[] = []
    if (update.pullCursor !== undefined) { fields.push('pull_cursor = ?'); values.push(update.pullCursor) }
    if (update.lastPushSeq !== undefined) { fields.push('last_push_seq = ?'); values.push(update.lastPushSeq) }
    if (update.lastSuccessAt !== undefined) { fields.push('last_success_at = ?'); values.push(update.lastSuccessAt) }
    if (update.lastError !== undefined) { fields.push('last_error = ?'); values.push(update.lastError) }
    if (update.cloudProjectId !== undefined) { fields.push('cloud_project_id = ?'); values.push(update.cloudProjectId) }
    if (fields.length === 0) return
    values.push(partitionKey)
    this.db.prepare(`UPDATE sync_state SET ${fields.join(', ')} WHERE partition_key = ?`).run(...values)
  }

  // ── Sessions (§2.2, §2.4) ─────────────────────────────────────────────────

  openSession(input: { id: string; paneId?: string; projectKey: string; aiType?: string; account?: string; gitBranch?: string }): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, pane_id, project_key, ai_type, account, git_branch, started_at, prompt_count, rolled_up)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`
      )
      .run(input.id, input.paneId ?? null, input.projectKey, input.aiType ?? null, input.account ?? null, input.gitBranch ?? null, Date.now())
  }

  closeSession(id: string): void {
    this.db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL').run(Date.now(), id)
  }

  getSession(id: string): { id: string; project_key: string; started_at: number; ended_at: number | null } | null {
    return (this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as never) ?? null
  }

  markSessionRolledUp(id: string): void {
    this.db.prepare('UPDATE sessions SET rolled_up = 1 WHERE id = ?').run(id)
  }

  // ── Import runs (§5.3 idempotency guard 3) ───────────────────────────────

  getImportRun(source: string, sourcePath: string): { id: string; cursor: string | null; imported: number; skipped: number; state: string } | null {
    return (
      (this.db
        .prepare('SELECT * FROM import_runs WHERE source = ? AND source_path = ? ORDER BY started_at DESC LIMIT 1')
        .get(source, sourcePath) as never) ?? null
    )
  }

  startImportRun(input: { id: string; source: string; sourcePath: string }): void {
    this.db
      .prepare(
        `INSERT INTO import_runs (id, source, source_path, cursor, imported, skipped, state, started_at)
         VALUES (?, ?, ?, NULL, 0, 0, 'running', ?)`
      )
      .run(input.id, input.source, input.sourcePath, Date.now())
  }

  updateImportRun(id: string, update: { cursor?: string; imported?: number; skipped?: number; state?: string; error?: string }): void {
    const fields: string[] = []
    const values: unknown[] = []
    if (update.cursor !== undefined) { fields.push('cursor = ?'); values.push(update.cursor) }
    if (update.imported !== undefined) { fields.push('imported = ?'); values.push(update.imported) }
    if (update.skipped !== undefined) { fields.push('skipped = ?'); values.push(update.skipped) }
    if (update.state !== undefined) { fields.push('state = ?'); values.push(update.state) }
    if (update.error !== undefined) { fields.push('error = ?'); values.push(update.error) }
    if (update.state === 'done' || update.state === 'failed' || update.state === 'cancelled') {
      fields.push('finished_at = ?')
      values.push(Date.now())
    }
    if (fields.length === 0) return
    values.push(id)
    this.db.prepare(`UPDATE import_runs SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }
}
