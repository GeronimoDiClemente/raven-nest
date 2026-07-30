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

export function contentHash(title: string, content: string): string {
  const normalized = `${title.trim().toLowerCase()}\n${content.trim().toLowerCase()}`
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
  content: string
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
        content        TEXT NOT NULL,
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
        pushed_at  INTEGER
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

  private appendMutation(op: 'upsert' | 'delete' | 'promote', row: ObservationRow): void {
    this.db
      .prepare('INSERT INTO mutation_log (sync_id, op, payload, created_at) VALUES (?, ?, ?, ?)')
      .run(row.sync_id, op, JSON.stringify(row), Date.now())
  }

  private toSummary(row: ObservationRow): ObservationSummary {
    return {
      syncId: row.sync_id,
      title: row.title,
      content: row.content,
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
        const bySourceRef = this.db
          .prepare('SELECT * FROM observations WHERE source = ? AND source_ref = ? AND deleted = 0')
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
          return { syncId: updated.sync_id, outcome: 'topic_updated', redacted }
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
         ORDER BY o.updated_at DESC LIMIT ?`
      )
      .all(`"${safe}"`, projectKey, GLOBAL_PROJECT_KEY, limit) as ObservationRow[]
    return rows.map((r) => this.toSummary(r))
  }

  context(projectKey: string, limit = 10): ObservationSummary[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM observations
         WHERE (project_key = ? OR project_key = ?) AND deleted = 0 AND superseded_by IS NULL
         ORDER BY updated_at DESC LIMIT ?`
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
    content: string
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
    const existing = this.get(row.syncId)
    const now = Date.now()
    if (existing) {
      this.db
        .prepare(
          `UPDATE observations SET title = ?, content = ?, tags = ?, updated_at = ?, lamport = ?,
           deleted = ?, superseded_by = ?, server_seq = ? WHERE sync_id = ?`
        )
        .run(
          row.title,
          row.content,
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
        title: row.title,
        content: row.content,
        tags: row.tags ? JSON.stringify(row.tags) : null,
        source: 'import',
        origin_ai: row.originAi ?? null,
        origin_account: row.originAccount ?? null,
        git_branch: row.gitBranch ?? null,
        author_user_id: row.authorUserId ?? null,
        author_display: row.authorDisplay ?? null,
        content_hash: row.contentHash ?? contentHash(row.title, row.content),
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

  getBySourceRef(source: string, sourceRef: string): ObservationRow | null {
    return (
      (this.db
        .prepare('SELECT * FROM observations WHERE source = ? AND source_ref = ?')
        .get(source, sourceRef) as ObservationRow) ?? null
    )
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) as c FROM observations WHERE deleted = 0').get() as { c: number }
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

  markPushed(seqs: number[]): void {
    if (seqs.length === 0) return
    const now = Date.now()
    const stmt = this.db.prepare('UPDATE mutation_log SET pushed_at = ? WHERE seq = ?')
    const txn = this.db.transaction((ids: number[]) => {
      for (const seq of ids) stmt.run(now, seq)
    })
    txn(seqs)
  }

  pruneAckedMutations(olderThanMs = 7 * 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - olderThanMs
    const result = this.db
      .prepare('DELETE FROM mutation_log WHERE pushed_at IS NOT NULL AND pushed_at < ?')
      .run(cutoff)
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
