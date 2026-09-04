// Local SQLite store — the single write path for Nest Memory. Owned exclusively by the
// sync daemon (electron/memory-daemon.ts) in Electron main. See
// docs/nest-memory-architecture.md §1.2 and §3.1 for the design this implements.
//
// better-sqlite3 is synchronous by design — every method here is synchronous. Callers
// (the IPC server, the daemon) are responsible for not blocking the event loop with a
// pathological query; in practice every query here is a single indexed lookup or a small
// FTS5 MATCH, sub-millisecond on the data volumes this product targets (§10 R-6).

import Database from 'better-sqlite3'
import { mkdirSync, existsSync, renameSync } from 'fs'
import { dirname, join } from 'path'
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

/**
 * Task 1 (plan de memoria por cuenta multi-dispositivo): calcula el path del store físico
 * de UNA cuenta. Pura, sin fs — no crea el directorio ni decide si hay que migrar un store
 * `_local` preexistente a esta cuenta; eso es responsabilidad de quien orqueste el swap
 * (electron/memory-account-switch.ts), que sí puede usar existsSync para esa decisión.
 *
 * `userId` null o string vacía (sesión sin cuenta logueada) cae en la partición `_local`,
 * separada de cualquier cuenta real — así una sesión anónima nunca comparte archivo con
 * una cuenta ni con otra.
 */
export function resolveStorePath(ravenHomeDir: string, userId: string | null): string {
  const account = userId && userId.trim() ? userId : '_local'
  return join(ravenHomeDir, '.raven-nest', 'memory', account, 'memory.db')
}

// Adversarial-review fix (smoke/memory-bridge), BUG 1 (ALTO): renameSync has no retry of
// its own. On Windows a transient EBUSY/EPERM (antivirus or an indexer — OneDrive included
// — holding a handle on the .db an instant after MemoryStore.close() released it) used to
// throw straight out of migrateLegacyStorePath, up through main.ts's unguarded call site,
// into the try/catch that sets `memory = null` — disabling the ENTIRE memory feature for
// the session over a one-off timing fluke, not a real failure. Same retry shape as
// renameDirWithRetry in memory-account-switch.ts (that file's sibling fix for the same
// class of Windows timing issue): a few short attempts, only for EBUSY/EPERM, anything else
// rethrows immediately.
const RENAME_RETRY_ATTEMPTS = 3
const RENAME_RETRY_DELAY_MS = 50

// migrateLegacyStorePath runs at module scope in main.ts (electron/main.ts ~line 267),
// synchronously, before `new MemoryStore(...)` and before any window exists — there is no
// event loop turn anything else is waiting on yet. Turning it async would mean wrapping
// that whole module-scope initialization block in an async IIFE, a much bigger structural
// change to main.ts for a one-time startup delay measured in tens of milliseconds. A
// synchronous sleep via Atomics.wait blocks this thread for real (no busy CPU spin, unlike
// a Date.now() poll loop) without turning any part of main.ts async — the lowest-risk shape
// for a fix that only ever fires while retrying a transient rename at startup.
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function renameSyncWithRetry(from: string, to: string): void {
  for (let attempt = 1; attempt <= RENAME_RETRY_ATTEMPTS; attempt++) {
    try {
      renameSync(from, to)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code !== 'EBUSY' && code !== 'EPERM') throw err
      if (attempt === RENAME_RETRY_ATTEMPTS) throw err
      sleepSync(RENAME_RETRY_DELAY_MS)
    }
  }
}

/**
 * Task 1 (plan de memoria por cuenta multi-dispositivo), Step 3d: migración de una sola vez
 * del store PLANO legado (`{home}/.raven-nest/memory/memory.db`, sin subcarpeta de cuenta —
 * el layout de antes de esta Task) al nuevo layout por-cuenta (`resolveStorePath(home,
 * null)` = `{home}/.raven-nest/memory/_local/memory.db`).
 *
 * Máquinas reales — incluida la que corrió esta implementación — YA TIENEN datos
 * capturados bajo el path viejo. Esta función tiene que correr ANTES de construir el
 * MemoryStore inicial (main.ts la llama ahí): si el primer arranque bajo el nuevo layout
 * simplemente abriera `resolveStorePath(home, null)`, encontraría una base vacía y el
 * historial real quedaría huérfano para siempre en el path legado, nunca más leído por
 * nada.
 *
 * No-op si el path nuevo YA existe (la migración ya corrió, o es una instalación nueva sin
 * legado que mover) o si no hay legado (`memory.db` no existe en el path plano viejo) — en
 * cualquiera de los dos casos no se toca ni se crea nada.
 *
 * Mueve el `.db` y, si están presentes, sus compañeros `-wal`/`-shm` de WAL mode (el
 * constructor de MemoryStore deja el store en `journal_mode = WAL`, así que una escritura
 * sin checkpointear puede vivir en cualquiera de los tres archivos — moverlos junto con el
 * `.db` es la única forma de no perder esas filas). Nunca borra nada: sólo `renameSync` (con
 * reintento, ver renameSyncWithRetry) por archivo, y sólo para los que efectivamente
 * existen.
 *
 * Adversarial-review fix, BUG 2 (CRÍTICO, pérdida de datos real): el `.db` se mueve AL
 * FINAL, no primero. Con el `.db` primero, si el proceso moría entre mover el `.db` y mover
 * el `-wal`, el próximo arranque veía `existsSync(newPath) === true` (el `.db` ya estaba
 * ahí) y el guard de arriba cortaba con `return` inmediato — sin mover jamás el `-wal`
 * legado que quedó atrás, que puede tener filas commiteadas pero no checkpointeadas
 * (`journal_mode = WAL`, `synchronous = NORMAL`, ver el constructor de MemoryStore):
 * huérfanas para siempre, en silencio. Con los compañeros primero y el `.db` al final, el
 * `.db` en el path nuevo es la señal de "migración completa" recién cuando de verdad lo
 * está: si el proceso muere ANTES de ese último paso, `existsSync(newPath)` sigue siendo
 * `false` en el próximo arranque, el guard no corta, y el loop reintenta desde el principio
 * — el `existsSync(from)` por archivo hace que reintentar sea un no-op para lo que ya se
 * movió (idempotente en la práctica). Si el proceso muere DESPUÉS de mover el `.db` (el
 * último paso), la migración ya estaba completa de verdad — no hay ventana de pérdida en
 * ningún punto del loop.
 *
 * Pura respecto al store: usa `fs` directo, nunca abre un `Database` — corre antes de que
 * exista ningún `MemoryStore` (evita abrir-para-migrar/cerrar/reabrir en el path nuevo) y es
 * trivialmente testeable sin levantar better-sqlite3 dos veces por test.
 */
export function migrateLegacyStorePath(ravenHomeDir: string): void {
  const legacyPath = join(ravenHomeDir, '.raven-nest', 'memory', 'memory.db')
  const newPath = resolveStorePath(ravenHomeDir, null)
  if (existsSync(newPath) || !existsSync(legacyPath)) return

  mkdirSync(dirname(newPath), { recursive: true })
  // Companions first, bare `.db` last — see the BUG 2 fix note above for why this order is
  // the whole point.
  for (const suffix of ['-wal', '-shm', '']) {
    const from = `${legacyPath}${suffix}`
    const to = `${newPath}${suffix}`
    if (existsSync(from)) renameSyncWithRetry(from, to)
  }
}

export function generateSyncId(prefix: 'obs' | 'sess' | 'prom'): string {
  return `${prefix}-${randomBytes(16).toString('hex')}`
}

/**
 * Deterministic sync_id for an imported observation, derived from WHAT the observation
 * IS — projectKey + scope + type + content_hash (the exact hash computeContentIdentity /
 * save() use for the dedupe window, Step 2 below) + topicKey — never from WHERE it came
 * from.
 *
 * WHY content, not source identity: the previous formula (sha256 of
 * "<source>:<sourceRef>", e.g. "import:engram:<engram's own sync_id>") failed in live
 * multi-device testing — the SAME observation content exists in two machines' engram.db
 * files under two DIFFERENT engram sync_ids (engram never guarantees a stable id across
 * separate installs), so each machine derived a DIFFERENT Nest sync_id for identical
 * content. The `memory:connect` flow is import -> push -> pull (memory-daemon.ts), so at
 * import time the local store does NOT yet contain the other device's rows — only the
 * SERVER's upsert-by-sync_id (PK sync_id, no content dedup) can catch this, and only if
 * both devices hand it the same PK. Verified in production: 261 duplicate content groups
 * from this exact failure mode.
 *
 * WHY source is excluded (not just de-emphasized): the product requirement is
 * importer-agnostic identity — a user who imports the same fact via engram on one
 * machine and via some other memory system (or a plain markdown export) on another must
 * ALSO converge on one row, not two. Baking the importer name into the seed (as the old
 * formula did) would defeat that by construction. The source's own row id and any
 * timestamp are excluded for the same reason: neither identifies WHAT the content is —
 * both are the source system's own conventions, outside Nest's control, and would make
 * two imports of the identical fact diverge for reasons that have nothing to do with the
 * fact itself.
 *
 * WHY topicKey IS included (fix for a real collision, not a hypothetical): two import
 * rows sharing (projectKey, scope, type, content_hash) but carrying DIFFERENT topic_key
 * values used to derive the SAME sync_id, because the seed ignored topic_key entirely.
 * save()'s Step 0.5 (sync_id-match) update path only overwrites title/content/tags/
 * content_hash/source_ref — it never touches topic_key — so the second import's topic
 * classification was silently dropped while its source_ref clobbered the first import's,
 * and alternating re-imports (e.g. on reconnect) ping-ponged source_ref back and forth on
 * one row instead of ever producing two. Same content under different topics is
 * deliberately DISTINCT identity: a topic_key is a user-meaningful classification of the
 * content, not incidental metadata, so two different classifications of otherwise-
 * identical text are two different facts as far as identity is concerned. Cross-device
 * convergence still holds with topicKey in the seed — both devices read the same
 * topic_key off the same source data (the same engram row, the same markdown heading), so
 * they derive the same seed and therefore the same sync_id, exactly as before.
 * `topicKey` is normalized to `''` for null/undefined so a no-topic row's seed reduces to
 * exactly the pre-fix formula — no-topic import identity is unchanged by this fix; only
 * topic-bearing rows get a new derived id (accepted pre-release: no production data
 * depends on today's topic-bearing ids yet).
 *
 * Accepted phase-1 edge (unchanged in spirit from before): this is a pure function of
 * (projectKey, scope, type, content_hash, topicKey) with no per-user salt, so two
 * different Nest users importing byte-identical content under the same topic (e.g. a
 * shared CLAUDE.md file, or one user copying another's ~/.engram directory) derive the
 * SAME sync_id. The server's PK-plus-RLS model rejects the second user's insert outright
 * rather than silently merging two people's memories — the failure mode is "the second
 * user's import errors on that one row," not data leakage — which is acceptable for phase
 * 1. A real per-user salt would remove the collision if this becomes a problem in
 * practice.
 */
export function deriveImportSyncId(
  projectKey: string,
  scope: 'personal' | 'project' | 'team',
  type: string,
  contentHash: string,
  topicKey?: string | null
): string {
  const topic = topicKey ?? ''
  // Empty-topic seed is byte-identical to the pre-fix formula (see doc comment above) —
  // a no-topic row's derived id is unchanged by this fix. A topic-bearing row gets a
  // seed segment that no no-topic row can ever collide with (an empty topicKey never
  // produces the literal string 'topic=...').
  const seed = topic
    ? `${projectKey}:${scope}:${type}:topic=${topic}:${contentHash}`
    : `${projectKey}:${scope}:${type}:${contentHash}`
  const digest = createHash('sha256').update(seed).digest('hex')
  return `obs-${digest.slice(0, 32)}`
}

export function contentHash(title: string, content: string | null): string {
  const normalized = `${title.trim().toLowerCase()}\n${(content ?? '').trim().toLowerCase()}`
  return createHash('sha256').update(normalized).digest('hex')
}

/**
 * Redacts title/content and hashes the result — the exact sequence save() needs to
 * arrive at the content_hash it persists and dedupes against (Step 2 below). Extracted
 * out of save() (not left inline) so import identity (deriveImportSyncId above) can call
 * this SAME function before save() even runs — an importer must know the content_hash to
 * derive a syncId to pass INTO save() — and therefore can never drift from the hash
 * save() independently arrives at for the same raw title/content.
 */
export function computeContentIdentity(
  title: string,
  content: string
): { title: string; content: string; redacted: boolean; hash: string } {
  const { text: safeTitle } = redact(title)
  const { text: safeContent, redacted } = redact(content)
  return { title: safeTitle, content: safeContent, redacted, hash: contentHash(safeTitle, safeContent) }
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
  // Importers only, below. Both default to save()'s own generation/stamping behavior
  // when absent, so every non-import caller (MCP, hooks, pty, ui) is unaffected.
  syncId?: string | null // deterministic identity (see deriveImportSyncId) — see save()'s sync_id-match step
  createdAt?: number | null // original epoch-ms timestamp from the source system, not the import moment
  updatedAt?: number | null
  lastSeenAt?: number | null
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
  /** La cuenta de Nest que la escribió. Null en filas anteriores al sellado. */
  author_user_id?: string | null
  seq: number
  sync_id: string
  op: 'upsert' | 'delete' | 'promote'
  payload: string
  created_at: number
  pushed_at: number | null
  // M21: set when the server reported this specific mutation as 'rejected' (plan limit,
  // revoked access, etc.) — surfaced once rather than silently discarded.
  last_error: string | null
  // Task 8 (smoke/memory-bridge): non-null only for a REVERSIBLE server rejection
  // (project_limit_reached, quota_exceeded — see memory-daemon.ts's REVERSIBLE_REJECTIONS).
  // Distinct from `pushed_at`: a blocked row is NOT pushed (it was never delivered) and
  // NOT pending (retrying it every cycle would just get rejected again) — it sits here
  // until unblockMutations() clears it.
  blocked_reason: string | null
}

export interface MarkPushedEntry {
  seq: number
  /** Non-null only for a server-reported 'rejected' outcome — see M21. */
  error?: string | null
}

const BASE_SCHEMA = `
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
    `

/**
 * C3: version of the local schema, persisted in `PRAGMA user_version`.
 *
 * To add a step: raise this constant, add the MIGRATIONS entry keyed by the NEW number,
 * and never touch an already-published step. Every step runs inside a transaction and
 * should STILL be idempotent: SQLite does not roll back an ALTER TABLE if the process
 * dies halfway through a multi-statement `exec`.
 *
 * Version 1 is the base schema exactly as it shipped in Phase 1. A database created
 * before this change reports user_version = 0 just like an empty one, and adopting it is
 * correct precisely because all of step 1 is CREATE ... IF NOT EXISTS: running it over an
 * already-populated database writes nothing and does not touch a single row.
 */
export const SCHEMA_VERSION = 3

// Task 8 (smoke/memory-bridge): the memory dir syncs across two machines (C3's whole
// reason for existing), so a v1 database opened by a build that knows v2 is the routine
// upgrade path for every existing user, not an edge case.
//
// A FUNCTION step, not a plain SQL string like step 1: unlike `CREATE TABLE`/`CREATE
// INDEX`, SQLite's `ALTER TABLE ... ADD COLUMN` has no `IF NOT EXISTS` clause at all —
// confirmed against this repo's own better-sqlite3 (`near "EXISTS": syntax error`), not
// assumed. C3's docstring above requires every step to survive a re-run (SQLite does not
// roll back an ALTER on a mid-transaction crash), so idempotency has to be done by hand:
// check `pragma table_info` first, and only ALTER if the column is actually missing.
const MIGRATIONS: Record<number, string | ((db: Database.Database) => void)> = {
  1: BASE_SCHEMA,
  2: (db) => {
    const columns = db.prepare('PRAGMA table_info(mutation_log)').all() as Array<{ name: string }>
    if (!columns.some((c) => c.name === 'blocked_reason')) {
      db.exec('ALTER TABLE mutation_log ADD COLUMN blocked_reason TEXT;')
    }
  },
  // La memoria es de una CUENTA DE NEST. El store es uno por máquina, así que hay que
  // poder decir de quién es cada fila: `meta` guarda al dueño y `mutation_log` lleva el
  // autor para que el push no arrastre lo de otra cuenta.
  3: (db) => {
    db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);')
    const columns = db.prepare('PRAGMA table_info(mutation_log)').all() as Array<{ name: string }>
    if (!columns.some((c) => c.name === 'author_user_id')) {
      db.exec('ALTER TABLE mutation_log ADD COLUMN author_user_id TEXT;')
    }
  },
}

export class MemoryStore {
  private db: Database.Database
  private lamportCounter = 0
  private currentUserId: string | null = null
  readonly schemaVersion: number = 0

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
    let current = this.db.pragma('user_version', { simple: true }) as number
    // Refuse a database from the FUTURE. The loop below simply doesn't run when
    // `current > SCHEMA_VERSION`, so the old behaviour was to no-op, adopt the higher
    // number as `schemaVersion` and then write against a schema this build has never
    // heard of. That is not hypothetical here: the memory dir is synced across two
    // machines, so the day SCHEMA_VERSION becomes 2 the machine still on 1 opens a v2
    // database. Throwing is caught by main.ts's existing try/catch around the memory
    // subsystem, which degrades to "memory disabled for this session" — the safe outcome.
    if (current > SCHEMA_VERSION) {
      throw new Error(`memory-store: database schema v${current} is newer than this build (v${SCHEMA_VERSION}) — update Nest`)
    }
    for (let next = current + 1; next <= SCHEMA_VERSION; next++) {
      const step = MIGRATIONS[next]
      if (!step) throw new Error(`memory-store: missing migration step ${next}`)
      this.db.transaction(() => {
        if (typeof step === 'string') this.db.exec(step)
        else step(this.db)
        this.db.pragma(`user_version = ${next}`)
      })()
      current = next
    }
    ;(this as { schemaVersion: number }).schemaVersion = current
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
      .prepare('INSERT INTO mutation_log (sync_id, op, payload, created_at, author_user_id) VALUES (?, ?, ?, ?, ?)')
      .run(row.sync_id, op, JSON.stringify(row), Date.now(), row.author_user_id ?? this.currentUserId ?? null)
  }

  private metaGet(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  /** La cuenta de Nest dueña de este store, o null si todavía no entró ninguna. */
  getOwnerUserId(): string | null {
    return this.metaGet('owner_user_id')
  }

  /**
   * Declara qué cuenta de Nest está usando el store. Sella las escrituras que vienen y
   * acota el push: `pendingMutations()` sólo devuelve lo de esta cuenta.
   *
   * **La primera cuenta que entra reclama el store y adopta las filas sin autor.** Es lo
   * correcto para la única máquina que existe hoy —una persona, todo lo capturado antes de
   * loguearse es suyo— y es también lo que hace que un usuario que ya venía usando la
   * memoria local no pierda nada al conectar. Una SEGUNDA cuenta en la misma máquina no
   * adopta nada: sus escrituras se sellan con lo suyo y lo ajeno le queda invisible al
   * push. Sin esto, su daemon empujaba a su nube las memorias de la primera.
   *
   * Esto NO es aislamiento completo: en local las dos cuentas siguen leyendo la misma
   * base. El aislamiento de verdad es una base por cuenta, que es el paso siguiente.
   */
  setCurrentUser(userId: string | null): { claimed: boolean; adopted: number } {
    this.currentUserId = userId
    if (!userId) return { claimed: false, adopted: 0 }

    const owner = this.getOwnerUserId()
    if (owner !== null) return { claimed: false, adopted: 0 }

    const claim = this.db.transaction(() => {
      this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('owner_user_id', userId)
      const obs = this.db
        .prepare('UPDATE observations SET author_user_id = ? WHERE author_user_id IS NULL')
        .run(userId)
      const log = this.db
        .prepare('UPDATE mutation_log SET author_user_id = ? WHERE author_user_id IS NULL')
        .run(userId)
      return (obs.changes ?? 0) + (log.changes ?? 0)
    })
    return { claimed: true, adopted: claim() }
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
   * The write-path resolution from §3.1, extended for import identity: source_ref identity
   * (imports only, guard 1 of §5.3) -> sync_id identity (imports only, survives a local
   * wipe + reconnect — see deriveImportSyncId) -> topic_key upsert -> content dedupe
   * window -> insert.
   */
  save(input: SaveInput): SaveMemoryResult {
    const scope = input.scope ?? 'personal'
    const { title, content, redacted, hash } = computeContentIdentity(input.title, input.content)
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

      // Step 0.5 (imports only): identity by caller-supplied (deterministic) sync_id.
      // This exists specifically for the wipe/reconnect gap Step 0 above cannot close: the
      // server has no source_ref column, so a row pulled back down by
      // applyIncomingObservation() after a local wipe carries the original sync_id but
      // source_ref = null — Step 0's (source, source_ref) lookup can never find it again.
      // A deterministic sync_id (see deriveImportSyncId) is the only surviving identity
      // link, so this step is what turns "re-import after wipe+reconnect" back into a
      // no-op update instead of either a duplicate insert (bug 2) or a PRIMARY KEY
      // collision at the Step 3 insert below (a caller-supplied sync_id that already
      // belongs to an active row must never reach a plain INSERT).
      if (input.syncId) {
        const bySyncId = this.get(input.syncId)
        if (bySyncId && bySyncId.deleted === 0 && bySyncId.superseded_by === null) {
          const updated: ObservationRow = {
            ...bySyncId,
            title,
            content,
            tags: input.tags ? JSON.stringify(input.tags) : bySyncId.tags,
            content_hash: hash,
            revision_count: bySyncId.revision_count + 1,
            updated_at: now,
            lamport: this.nextLamport(),
            source_ref: input.sourceRef ?? bySyncId.source_ref,
          }
          this.applyRowUpdate(updated)
          this.appendMutation('upsert', updated)
          return { syncId: updated.sync_id, outcome: 'source_ref_updated', redacted }
        }
        // Mirrors the C3 fallthrough above: an INACTIVE row (superseded/tombstoned)
        // already occupies this sync_id (it IS the primary key, so this is a certainty,
        // not a possibility) — resolve to its active winner and report a duplicate
        // without touching it, for the same reason as Step 0's fallthrough.
        if (bySyncId) {
          const winner = this.resolveToActiveWinner(bySyncId)
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

      // Step 2: content dedupe window — same (project, scope, type, topic_key) + hash
      // within 7 days. `topic_key IS ?` (not `=`) so two no-topic rows (both NULL) still
      // match each other, matching SQLite's NULL-safe comparison semantics.
      //
      // Finding-1 fix: this used to omit topic_key from the match entirely, so a
      // topic-bearing import whose Step 0/0.5/1 identity checks above correctly found NO
      // existing row for ITS topic would still get silently folded into a content-only
      // "duplicate" of a DIFFERENT topic's row here — defeating the very identity fix
      // deriveImportSyncId makes (see its doc comment): "same content under different
      // topics is deliberately DISTINCT identity" has to hold at every step of this
      // waterfall, not just at sync_id derivation, or two topic-bearing rows with
      // byte-identical text would still collapse into one via this step instead of the
      // Step 0.5 collision the topicKey-aware sync_id was meant to prevent.
      const dupe = this.db
        .prepare(
          `SELECT * FROM observations
           WHERE project_key = ? AND scope = ? AND type = ? AND content_hash = ?
             AND topic_key IS ? AND deleted = 0 AND superseded_by IS NULL AND created_at >= ?`
        )
        .get(input.projectKey, scope, input.type, hash, input.topicKey ?? null, now - DEDUPE_WINDOW_MS) as
        | ObservationRow
        | undefined
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
        // Importers pass a deterministic id (deriveImportSyncId) so a later re-import can
        // find this exact row via the sync_id-match step above instead of inserting a
        // duplicate; every other caller gets a fresh random one, as before.
        sync_id: input.syncId ?? generateSyncId('obs'),
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
        author_user_id: input.authorUserId ?? this.currentUserId ?? null,
        author_display: input.authorDisplay ?? null,
        content_hash: hash,
        revision_count: 0,
        duplicate_count: 0,
        // Bug 1 fix: an importer passes the ORIGINAL timestamps from its source system so
        // imported history keeps its real dates instead of collapsing to the import
        // moment (verified in production: 1992 rows landing within the same second).
        // Every other caller (MCP/hook/pty/ui saves have no prior history to preserve)
        // omits these and gets `now`, exactly as before.
        last_seen_at: input.lastSeenAt ?? now,
        created_at: input.createdAt ?? now,
        updated_at: input.updatedAt ?? now,
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
    /**
     * C2: the `sync_id` of a LOCAL row that lost the topic collision against this incoming
     * one. It is marked `superseded_by = row.syncId` BEFORE the incoming row is written and
     * inside the SAME transaction, because `idx_obs_topic` does not allow two active rows
     * on the same (project_key, scope, topic_key): writing first and superseding after is
     * not a slower ordering, it is an impossible one.
     *
     * No mutation is queued for this supersede. The server applies the same rule on its
     * side (spec §8.1) and the superseded row comes back on the pull, so this is
     * convergence on a fact the server already knows, not a new fact from this device.
     * Queueing it would make both ends send each other the same supersede forever.
     */
    supersedeLocal?: string | null
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

    const applyAll = this.db.transaction(() => {
      // C2: supersede the losing local row BEFORE writing the incoming one, in the same
      // transaction — see the doc comment on `supersedeLocal` above for why this order
      // is not optional.
      if (row.supersedeLocal && row.supersedeLocal !== row.syncId) {
        this.db
          .prepare('UPDATE observations SET superseded_by = ? WHERE sync_id = ? AND superseded_by IS NULL')
          .run(row.syncId, row.supersedeLocal)
      }

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
    })
    applyAll()
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

  /**
   * Task 2 (adopcion con aviso): lo que el renderer necesita para preguntar "encontramos N
   * memorias de tus proyectos X, Y — ¿son tuyas?" ANTES de que setCurrentUser() las adopte
   * en silencio. Mismos filtros que count() (deleted=0, no superseded) para no mostrarle al
   * usuario un numero que no coincide con lo que despues ve en la app.
   */
  countUnclaimedRows(): { count: number; projects: string[] } {
    const countRow = this.db
      .prepare('SELECT COUNT(*) as c FROM observations WHERE author_user_id IS NULL AND deleted = 0 AND superseded_by IS NULL')
      .get() as { c: number }
    if (countRow.c === 0) return { count: 0, projects: [] }
    const projectRows = this.db
      .prepare(
        `SELECT DISTINCT p.display_name FROM observations o
         JOIN projects p ON p.project_key = o.project_key
         WHERE o.author_user_id IS NULL AND o.deleted = 0 AND o.superseded_by IS NULL
         ORDER BY p.display_name`
      )
      .all() as Array<{ display_name: string }>
    return { count: countRow.c, projects: projectRows.map((r) => r.display_name) }
  }

  // ── Mutation log / offline queue (§4.5) ──────────────────────────────────

  // Task 8: excludes `blocked_reason IS NOT NULL` — a reversibly-rejected mutation is
  // neither pushed nor eligible for the next retry cycle (that would just re-reject it
  // against the same still-standing limit). It comes back via unblockMutations().
  pendingMutations(limit = 200): MutationLogRow[] {
    return this.db
      .prepare('SELECT * FROM mutation_log WHERE pushed_at IS NULL AND blocked_reason IS NULL AND author_user_id IS ? ORDER BY seq ASC LIMIT ?')
      .all(this.currentUserId, limit) as MutationLogRow[]
  }

  pendingMutationCount(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as c FROM mutation_log WHERE pushed_at IS NULL AND blocked_reason IS NULL AND author_user_id IS ?')
      .get(this.currentUserId) as { c: number }
    return row.c
  }

  /**
   * Task 8: a REVERSIBLE server rejection (project_limit_reached, quota_exceeded) is not
   * discarded the way markPushed() discards a terminal one. Leaves `pushed_at` NULL — it
   * was never delivered — and stamps `blocked_reason` so pendingMutations() stops
   * offering it up every cycle. Also records the reason as `last_error`, same convention
   * markPushed() already uses for a rejected-but-terminal mutation, so `SELECT * FROM
   * mutation_log` shows a consistent "why" column regardless of which state a row is in.
   */
  blockMutations(entries: Array<{ seq: number; reason: string }>): void {
    if (entries.length === 0) return
    const stmt = this.db.prepare('UPDATE mutation_log SET blocked_reason = ?, last_error = ? WHERE seq = ?')
    const txn = this.db.transaction((rows: Array<{ seq: number; reason: string }>) => {
      for (const e of rows) stmt.run(e.reason, e.reason, e.seq)
    })
    txn(entries)
  }

  blockedMutations(): MutationLogRow[] {
    return this.db
      .prepare('SELECT * FROM mutation_log WHERE blocked_reason IS NOT NULL ORDER BY seq ASC')
      .all() as MutationLogRow[]
  }

  /**
   * Re-admits blocked mutations whose reason no longer applies back into
   * pendingMutations(). Scoped by reason, not "unblock everything": a project-limit
   * block lifting says nothing about a quota block also lifting.
   */
  unblockMutations(reasons: string[]): void {
    if (reasons.length === 0) return
    const placeholders = reasons.map(() => '?').join(',')
    this.db
      .prepare(`UPDATE mutation_log SET blocked_reason = NULL WHERE blocked_reason IN (${placeholders})`)
      .run(...reasons)
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
