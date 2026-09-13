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
// Las lecturas viven en `memory-reads.ts` como funciones sobre `db`, no como métodos acá:
// el modo sin daemon abre la base en sólo lectura y no puede instanciar este store (el
// constructor migra y prende WAL, o sea escribe). Los métodos de abajo las envuelven para
// que haya UNA redacción de cada consulta.
import {
  contextObservations, getObservation, getObservationSummary, searchObservations, toSummary,
} from './memory-reads'
import { buildMemoryGraph, type MemoryGraph, type MemoryGraphQuery } from './memory-graph'
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
 * (`journal_mode = WAL`, `synchronous = FULL`, ver el constructor de MemoryStore):
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
/**
 * Task 13 (2026-09-09): ¿cambió algo que REPLICA a la nube?
 *
 * `content_hash` cubre título y contenido a la vez (lo calcula computeContentIdentity abajo
 * sobre los dos), así que alcanza con eso más los tags. Todo lo demás que save() tocaba en un
 * re-import es local y no viaja: `source_ref` no existe como columna del lado del servidor, y
 * `revision_count` / `duplicate_count` / `last_seen_at` ya estaban documentados como señales
 * de ranking que no se replican (ver el comentario de M23 en el Step 2 de save()).
 *
 * Sin este chequeo, un re-import de material idéntico generaba una mutación por fila. Y como
 * runLocalMemoryImport corre en cada arranque de la app, eso pasaba cada vez que se abría
 * Nest, por cada memoria importada.
 */
function hasReplicatedChange(
  existing: { content_hash: string; tags: string | null; type: string },
  incomingHash: string,
  incomingTags: string | null,
  incomingType: string
): boolean {
  // El tipo entra en la comparación desde el 2026-09-11. Sin él, un re-import que sólo
  // corrige la clasificación (la nota declaraba `decision` y la fila quedó en `pattern`) no
  // contaba como cambio y se descartaba en silencio — y como el re-import corre en cada
  // arranque, la fila se quedaba mal para siempre.
  return existing.content_hash !== incomingHash
    || existing.tags !== incomingTags
    || existing.type !== incomingType
}

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
  /**
   * Importadores: aplicar el `type` a una fila que YA existe, no sólo a una nueva.
   *
   * El camino de re-import identifica la fila por `(source, source_ref)` y actualiza
   * título, contenido, tags y hash — pero NUNCA el tipo. Eso estaba bien mientras el
   * importador estampaba un tipo fijo; desde que lee el que la nota declara, una nota que
   * declaraba `decision` se quedaba con el `pattern` que se le puso la primera vez, para
   * siempre. Y el re-import corre en CADA arranque (main.ts), así que "reimportar" no lo
   * arreglaba: no hay nada que correr a mano, simplemente no se aplicaba.
   *
   * Va sólo cuando la nota DECLARA un tipo. Sin declaración el importador cae a `pattern`,
   * y escribir ese default pisaría un tipo puesto a propósito por otra vía.
   */
  applyType?: boolean
  // Importers only, below. Both default to save()'s own generation/stamping behavior
  // when absent, so every non-import caller (MCP, hooks, pty, ui) is unaffected.
  syncId?: string | null // deterministic identity (see deriveImportSyncId) — see save()'s sync_id-match step
  createdAt?: number | null // original epoch-ms timestamp from the source system, not the import moment
  updatedAt?: number | null
  lastSeenAt?: number | null
}

/**
 * Spec 2026-09-11 — input de `crossProjectMemories()`. A diferencia de `SaveInput`/
 * `MemoryGraphQuery`, `limit` es obligatorio (no hay default razonable: la pantalla que
 * pide "todos los proyectos" sobre una tabla de miles de filas SIEMPRE tiene que decidir
 * un tamaño de página).
 */
export interface CrossProjectMemoryQuery {
  /** FTS5 (mismo saneo que search()). Vacío/ausente = listado plano por fecha. */
  query?: string
  /** Tamaño de página. Sin default: quien pagina siempre lo decide explícito. */
  limit: number
  /** Cursor devuelto como `nextCursor` por la página anterior. Ausente = primera página. */
  cursor?: string | null
  /** Igual semántica que `MemoryGraphQuery.includeSuperseded`. Default false. */
  includeSuperseded?: boolean
}

/** Una fila de `crossProjectMemories()` — lo que la fila de la lista necesita mostrar. */
/**
 * Una memoria ENTERA, con su `content`. Es lo que el grafo muestra al costado cuando tocás
 * un nodo; ni el grafo ni el listado traen el contenido (serían cientos de documentos por
 * consulta), asi que esta es la lectura puntual.
 *
 * Espejada a mano en `src/types.ts` — `src/` nunca importa de `electron/`.
 */
export interface MemoryObservationDetail {
  syncId: string
  projectKey: string
  scope: 'personal' | 'project' | 'team'
  type: string
  title: string
  /** `null` en un tombstone: borrar nulea el contenido (§3.1 del protocolo). */
  content: string | null
  tags: string[]
  topicKey: string | null
  gitBranch: string | null
  originAi: string | null
  authorDisplay: string | null
  createdAt: number
  updatedAt: number
  /** syncId de la memoria que reemplazó a esta, o null si es la vigente. */
  supersededBy: string | null
  revisionCount: number
}

export interface CrossProjectObservation {
  syncId: string
  projectKey: string
  /** `null` si el proyecto nunca se registró vía `ensureProject()` (fila huérfana). */
  projectDisplayName: string | null
  title: string
  type: ObservationType
  scope: 'personal' | 'project' | 'team'
  originAi: string | null
  authorDisplay: string | null
  updatedAt: number
  tags: string[]
}

export interface CrossProjectMemoryPage {
  items: CrossProjectObservation[]
  /** Cursor para pedir la página siguiente, o `null` si esta fue la última. Nunca se corta
   *  en silencio: `nextCursor !== null` es la única señal de "hay más" y siempre está. */
  nextCursor: string | null
}

interface CrossProjectRow {
  sync_id: string
  project_key: string
  project_display_name: string | null
  title: string
  type: string
  scope: string
  origin_ai: string | null
  author_display: string | null
  updated_at: number
  lamport: number
  tags: string | null
}

/** Input de `update()` (MCP `memory_update`). Todo excepto `syncId` es opcional: cada campo
 *  ausente conserva su valor actual — es un PATCH, no un reemplazo total. */
export interface UpdateMemoryInput {
  syncId: string
  title?: string
  content?: string
  /** `null` explícito borra los tags; `undefined` (ausente) los deja como están. */
  tags?: string[] | null
}

export interface UpdateMemoryResult {
  updated: boolean
  syncId?: string
  redacted?: boolean
  reason?: 'not_found' | 'deleted' | 'superseded' | 'unchanged'
}

export interface ObservationRow {
  sync_id: string
  project_key: string
  scope: string
  topic_key: string | null
  /**
   * El `topic_key` pasado por HMAC con la clave de la cuenta (memory-crypto.ts). Es lo
   * unico que el servidor ve del tema, y por lo tanto lo unico que trae una fila del pull:
   * una fila remota tiene `topic_key = null` y ESTE campo lleno. Una fila local tiene los
   * dos, o solo el claro si el cifrado no esta activado.
   */
  topic_key_hmac: string | null
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
        topic_key_hmac TEXT,
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

      -- Relaciones puestas A MANO entre dos memorias. Ver la migracion 5 para por que no
      -- alcanza con reusar topic_key.
      CREATE TABLE IF NOT EXISTS memory_links (
        a          TEXT NOT NULL,
        b          TEXT NOT NULL,
        note       TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (a, b)
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
/**
 * Convierte (proyecto, scope, tema) en el valor estable que viaja al servidor. Se INYECTA
 * — el store no importa memory-crypto.ts — para que siga sin saber nada de claves y para
 * que un test pueda usar una funcion legible en vez de un HMAC real.
 */
export type TopicHasher = (projectKey: string, scope: string, topicKey: string) => string

export const SCHEMA_VERSION = 7

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
  // Spec 2026-09-11 (pantalla de Memories legible): la lista cross-project
  // (`crossProjectMemories()` abajo) ordena por `updated_at DESC` a través de TODOS los
  // project_key a la vez — algo que `idx_obs_project_updated` no ayuda a resolver, porque
  // su columna líder es `project_key` (sirve para "las más recientes DE este proyecto", no
  // para "las más recientes de cualquiera"). Sin este índice, la variante sin término de
  // búsqueda (la que carga la pantalla al abrir, sin FTS que angoste el candidate set antes
  // de ordenar) fuerza a SQLite a un scan completo de `observations` + sort en un B-tree
  // temporal — se degrada linealmente (peor, con el sort) con el total de filas, no con el
  // tamaño de la página pedida. `deleted` como columna líder (selectividad basica: la
  // inmensa mayoría de las filas vivas están activas) + `updated_at DESC, lamport DESC` en
  // el mismo orden que el ORDER BY de la consulta le alcanza al planner para resolver
  // filtro+orden+LIMIT sin sort adicional (confirmado con EXPLAIN QUERY PLAN, ver el test
  // "usa el índice global, no un sort completo" en memory-store.test.ts). `superseded_by
  // IS NULL` (el filtro por default, ver buildMemoryGraph) queda afuera del índice a
  // propósito: es un filtro residual barato aplicado fila por fila mientras se recorre en
  // orden ya indexado, no una condición de igualdad que valga la pena indexar aparte.
  4: 'CREATE INDEX IF NOT EXISTS idx_obs_deleted_updated ON observations(deleted, updated_at DESC, lamport DESC);',
  // Relaciones puestas A MANO entre dos memorias.
  //
  // Hace falta una tabla propia y no alcanza con reusar `topic_key`: el indice
  // `idx_obs_topic` es UNICO por (project_key, scope, topic_key) entre las filas vivas, asi
  // que dos memorias del mismo proyecto NO PUEDEN compartir tema — guardar la segunda con el
  // mismo topic no crea una fila, REEMPLAZA a la primera por merge (outcome `topic_updated`,
  // verificado). O sea que "conectar dos" via topic borraria una de las dos.
  //
  // `a`/`b` ordenados al insertar (a < b) mas el UNIQUE: una relacion a mano no tiene
  // direccion --"esta va con esta"-- y sin el orden la misma relacion entraria dos veces.
  5: `CREATE TABLE IF NOT EXISTS memory_links (
        a          TEXT NOT NULL,
        b          TEXT NOT NULL,
        note       TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (a, b)
      );
      CREATE INDEX IF NOT EXISTS idx_links_b ON memory_links(b);`,

  // El cifrado manda `topic_key` por HMAC (spec §5.2), asi que la fila que vuelve del pull
  // no trae el tema sino su hash. `findActiveTopicOwnerByHmac` lo busca contra ESTA
  // columna; sin ella el supersede por topico no encuentra nunca al dueño local, quedan
  // dos filas activas sobre el mismo slot y `idx_obs_topic` tumba el pull entero.
  //
  // El plan la numeraba 4; va 6 porque `memory_links` ya se llevo la 5.
  6: (db) => {
    const columns = db.prepare('PRAGMA table_info(observations)').all() as Array<{ name: string }>
    if (!columns.some((c) => c.name === 'topic_key_hmac')) {
      db.exec('ALTER TABLE observations ADD COLUMN topic_key_hmac TEXT;')
    }
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_obs_topic_hmac
         ON observations(project_key, scope, topic_key_hmac)
       WHERE topic_key_hmac IS NOT NULL;`
    )
  },

  /**
   * El conjunto de memorias ilegibles pasa de un JSON en `meta` a una tabla.
   *
   * El JSON costaba un `JSON.parse` de hasta 5000 ids, un `includes` lineal y un
   * `JSON.stringify` completo POR FILA — y no sólo en las ilegibles: `clearUndecryptableFor`
   * corre en cada fila que SÍ abre, y parsea la lista entera para decidir que no hay nada que
   * hacer. Medido en esta máquina: 1872ms para marcar 5000, y 0,68ms por fila sana con la
   * lista llena. Un pull grande en una máquina sin la clave bloquea el proceso durante
   * segundos, y el tope de 5000 hacía que además el número que ve el usuario mintiera para
   * abajo en una cuenta más grande que eso.
   *
   * Con la tabla son un INSERT OR IGNORE y un DELETE por PK, y el conteo es un `count(*)`
   * sin tope.
   */
  7: (db) => {
    db.exec('CREATE TABLE IF NOT EXISTS undecryptable (sync_id TEXT PRIMARY KEY);')
    // Lo que ya estaba anotado en el JSON se conserva: si no, una máquina que todavía no
    // consiguió la clave abriría la tarjeta mostrando 0 memorias ilegibles justo después de
    // actualizar, y eso se lee como "ya está resuelto".
    const fila = db.prepare("SELECT value FROM meta WHERE key = 'undecryptable_ids'").get() as
      | { value?: string } | undefined
    let previos: string[] = []
    try {
      const parsed: unknown = JSON.parse(fila?.value ?? '[]')
      if (Array.isArray(parsed)) previos = parsed.filter((x): x is string => typeof x === 'string')
    } catch { /* un JSON roto no puede frenar la migración: se pierde el conteo, no datos */ }
    const insert = db.prepare('INSERT OR IGNORE INTO undecryptable (sync_id) VALUES (?)')
    for (const id of previos) insert.run(id)
    db.prepare("DELETE FROM meta WHERE key IN ('undecryptable_ids', 'undecryptable_rows')").run()
  }
}

export class MemoryStore {
  private db: Database.Database
  private lamportCounter = 0
  private currentUserId: string | null = null

  private topicHasher: TopicHasher | null = null

  /** `null` desactiva: sin cifrado activado, `topic_key_hmac` se queda en NULL. */
  setTopicHasher(hasher: TopicHasher | null): void {
    this.topicHasher = hasher
  }

  /**
   * El gemelo de `findActiveTopicOwner` para el camino cifrado. Existen los dos porque
   * conviven: `save()` local resuelve el topico por el tema en claro, y el pull lo resuelve
   * por el HMAC, que es lo unico que el servidor le manda.
   */
  findActiveTopicOwnerByHmac(
    projectKey: string,
    scope: string,
    topicKeyHmac: string,
    excludeSyncId: string
  ): ObservationRow | null {
    return (
      (this.db
        .prepare(
          `SELECT * FROM observations WHERE project_key = ? AND scope = ? AND topic_key_hmac = ?
           AND sync_id != ? AND deleted = 0 AND superseded_by IS NULL`
        )
        .get(projectKey, scope, topicKeyHmac, excludeSyncId) as ObservationRow) ?? null
    )
  }

  /**
   * Completa el HMAC de las filas que se guardaron ANTES de que existiera una clave — o
   * sea, todas, el dia de la activacion. Sin esto, el primer pull despues de activar no
   * encuentra a ningun dueño local y duplica todos los topicos.
   *
   * Idempotente: solo toca filas con tema en claro y sin HMAC.
   */
  backfillTopicHmacs(): number {
    const hasher = this.topicHasher
    if (!hasher) return 0
    const rows = this.db
      .prepare(
        `SELECT sync_id, project_key, scope, topic_key FROM observations
          WHERE topic_key IS NOT NULL AND topic_key_hmac IS NULL`
      )
      .all() as Array<{ sync_id: string; project_key: string; scope: string; topic_key: string }>
    const update = this.db.prepare('UPDATE observations SET topic_key_hmac = ? WHERE sync_id = ?')
    this.db.transaction(() => {
      for (const r of rows) update.run(hasher(r.project_key, r.scope, r.topic_key), r.sync_id)
    })()
    return rows.length
  }
  readonly schemaVersion: number = 0

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    // FULL y no NORMAL: NORMAL aguanta que se caiga la app o el SO, pero un corte de luz
    // puede perder las ultimas transacciones — y con memoria de equipo eso es contexto que
    // un companero nunca va a recibir. La base escribe poco y chico, y con WAL el costo de
    // FULL es muy inferior al de rollback-journal. Spec Layer 2 §8.3.
    this.db.pragma('synchronous = FULL')
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
  /**
   * Conecta dos memorias a mano. Sin dirección: "esta va con esta".
   *
   * Los ids se ordenan antes de insertar, y el PRIMARY KEY (a, b) hace el resto: conectar
   * A con B y después B con A es la MISMA relación, y sin el orden entraría dos veces y el
   * grafo dibujaría dos líneas donde hay una.
   */
  linkMemories(unId: string, otroId: string, note?: string | null): { ok: boolean; error?: string } {
    if (unId === otroId) return { ok: false, error: 'same_memory' }
    const [a, b] = unId < otroId ? [unId, otroId] : [otroId, unId]
    // Las dos tienen que existir: una relación hacia una memoria que no está dibujaría un
    // nodo fantasma, que es justo lo que toGraphData filtra del otro lado.
    const cuantas = this.db
      .prepare('SELECT COUNT(*) AS n FROM observations WHERE sync_id IN (?, ?) AND deleted = 0')
      .get(a, b) as { n: number }
    if (cuantas.n !== 2) return { ok: false, error: 'memory_not_found' }
    this.db
      .prepare('INSERT OR REPLACE INTO memory_links (a, b, note, created_at) VALUES (?, ?, ?, ?)')
      .run(a, b, note ?? null, Date.now())
    return { ok: true }
  }

  /** Deshace una relación puesta a mano. Silencioso si no existía: borrar algo que no está
   *  es el resultado que el llamador queria. */
  unlinkMemories(unId: string, otroId: string): { ok: boolean } {
    const [a, b] = unId < otroId ? [unId, otroId] : [otroId, unId]
    this.db.prepare('DELETE FROM memory_links WHERE a = ? AND b = ?').run(a, b)
    return { ok: true }
  }

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

  private metaSet(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value)
  }

  /**
   * Cuenta filas que llegaron cifradas y esta maquina no pudo abrir (spec §5.5.4). Vive en
   * `meta` y no en `mutation_log` porque NO es una mutacion nuestra: es algo que la nube
   * tiene y nosotros no podemos leer. El doctor las junta igual, que es lo que el usuario
   * necesita ver.
   */
  /**
   * La ultima `key_epoch` que esta maquina supo de la cuenta. Vive en `meta` y no en la red
   * porque quien la consulta es el gate de fallar-cerrado del push, que corre en el arranque
   * —antes del primer `fetchKeyState`— que es exactamente cuando el agujero original subia
   * todo en claro.
   *
   * Nunca BAJA: una epoca conocida que se olvida volveria a habilitar el push en claro, que
   * es lo que este valor existe para impedir.
   */
  rememberKeyEpoch(epoch: number): void {
    if (!Number.isFinite(epoch) || epoch <= this.knownKeyEpoch()) return
    this.metaSet('known_key_epoch', String(Math.floor(epoch)))
  }

  knownKeyEpoch(): number {
    return Number(this.metaGet('known_key_epoch') ?? 0)
  }

  /**
   * Registra que una fila llego cifrada y esta maquina no pudo abrirla (spec §5.5.4).
   *
   * Se guarda el CONJUNTO de `sync_id`, no un contador. Un contador monotono mentia de dos
   * formas a la vez: sumaba de nuevo las mismas filas en cada re-pull (y `resetPullCursors`
   * hace exactamente eso, a proposito), y nunca bajaba aunque la otra maquina borrara esas
   * memorias. El numero que la tarjeta le muestra al usuario tiene que ser cuantas memorias
   * no puede leer, no cuantas veces intento.
   */
  markUndecryptable(syncId: string): void {
    if (!syncId) return
    this.db.prepare('INSERT OR IGNORE INTO undecryptable (sync_id) VALUES (?)').run(syncId)
  }

  /** Se llama cuando una fila que estaba ilegible SI se pudo abrir. */
  clearUndecryptableFor(syncId: string): void {
    if (!syncId) return
    this.db.prepare('DELETE FROM undecryptable WHERE sync_id = ?').run(syncId)
  }

  /** Cuantas memorias distintas no se pueden leer en esta maquina. */
  undecryptableCount(): number {
    const fila = this.db.prepare('SELECT count(*) AS n FROM undecryptable').get() as { n: number }
    return Number(fila.n)
  }

  clearUndecryptable(): void {
    this.db.prepare('DELETE FROM undecryptable').run()
  }

  /**
   * Vuelve todos los cursores de pull a 0. Se usa despues de que esta maquina consigue la
   * clave: las filas que se saltearon por ilegibles ya quedaron atras del cursor y sin esto
   * no volverian nunca. El pull es idempotente (upsert por sync_id), asi que re-bajar todo
   * es seguro; el costo es una pasada de red, no datos duplicados.
   */
  /**
   * Vuelve a encolar TODA observacion viva como un upsert, para que el push la re-suba.
   * Es el mecanismo de la migracion del §5.5.3: lo que ya esta en la nube en claro se
   * pisa, por `sync_id`, con la version cifrada.
   *
   * Excepcion consciente a la regla de la Task 13 del plan de la fase 1 ("un re-import sin
   * cambios no re-loguea mutaciones"): aca el contenido no cambió, cambió el FORMATO en que
   * viaja, y esa es justamente la razon para re-loguear. Se llama una vez, a mano, desde la
   * activacion — nunca en un bucle automatico.
   *
   * Sin tombstones ni superseded: una fila borrada ya no tiene contenido que proteger, y
   * una superseded no la devuelve ninguna lectura.
   */
  requeueAllForPush(): number {
    const rows = this.db
      .prepare(
        `SELECT * FROM observations
          WHERE deleted = 0 AND superseded_by IS NULL
            AND (author_user_id IS NULL OR author_user_id = ?)
          ORDER BY updated_at`
      )
      .all(this.currentUserId ?? null) as ObservationRow[]
    this.db.transaction(() => {
      for (const row of rows) this.appendMutation('upsert', row)
    })()
    return rows.length
  }

  resetPullCursors(): void {
    this.db.prepare('UPDATE sync_state SET pull_cursor = 0').run()
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
    return toSummary(row)
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
          const tagsIncoming = input.tags ? JSON.stringify(input.tags) : bySourceRef.tags
          // El tipo sólo se pisa si el que importa lo declara (ver `applyType`).
          const typeIncoming = input.applyType ? input.type : bySourceRef.type
          // Task 13: un re-import de material que NO cambió no es una escritura. Antes esto
          // reescribía la fila y agregaba una mutación igual, y como runLocalMemoryImport
          // corre en CADA arranque de la app (main.ts) y el importer de markdown también
          // manda source_ref, cada apertura de Nest re-logueaba y re-pusheaba todo lo
          // importado. De paso subía revision_count (que pasaba a mentir) y updated_at y
          // lamport, con lo que la copia local ganaba LWW contra una copia de nube idéntica.
          if (!hasReplicatedChange(bySourceRef, hash, tagsIncoming, typeIncoming)) {
            return { syncId: bySourceRef.sync_id, outcome: 'source_ref_updated', redacted }
          }
          const updated: ObservationRow = {
            ...bySourceRef,
            title,
            content,
            tags: tagsIncoming,
            type: typeIncoming,
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
          const tagsIncoming = input.tags ? JSON.stringify(input.tags) : bySyncId.tags
          const nextSourceRef = input.sourceRef ?? bySyncId.source_ref
          // Task 13, misma regla que el Step 0. La diferencia acá es que este camino SÍ puede
          // traer un source_ref distinto (dos máquinas importando la misma fila de engram
          // desde sus propias bases). Ese campo es LOCAL — el servidor no tiene esa columna,
          // ver el párrafo de arriba — así que un cambio de source_ref solo se aplica a disco
          // y NO genera una mutación: no hay nada que replicar. Lo que se sigue sosteniendo es
          // que el source_ref del último escritor gana, para que ninguna fila muerta quede
          // ocupando el UNIQUE de idx_obs_source_ref.
          // `bySyncId.type` contra si mismo: este camino identifica por sync_id, y el tipo
          // es parte de la semilla con la que ese id se deriva (deriveImportSyncId), asi que
          // una fila encontrada aca ya tiene el tipo correcto por definicion. Pasarlo explicito
          // deja el contrato de hasReplicatedChange en un solo lugar en vez de dos firmas.
          if (!hasReplicatedChange(bySyncId, hash, tagsIncoming, bySyncId.type)) {
            if (nextSourceRef !== bySyncId.source_ref) {
              this.db
                .prepare('UPDATE observations SET source_ref = ? WHERE sync_id = ?')
                .run(nextSourceRef, bySyncId.sync_id)
            }
            return { syncId: bySyncId.sync_id, outcome: 'source_ref_updated', redacted }
          }
          const updated: ObservationRow = {
            ...bySyncId,
            title,
            content,
            tags: tagsIncoming,
            content_hash: hash,
            revision_count: bySyncId.revision_count + 1,
            updated_at: now,
            lamport: this.nextLamport(),
            source_ref: nextSourceRef,
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
        // El HMAC se calcula al escribir, no al pushear: `save()` es el unico lugar que ve
        // el tema en claro, y una vez guardada la fila el push solo tiene la columna.
        topic_key_hmac: input.topicKey && this.topicHasher
          ? this.topicHasher(input.projectKey, scope, input.topicKey)
          : null,
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
         (sync_id, project_key, scope, topic_key, topic_key_hmac, type, title, content, tags, source,
          origin_ai, origin_account, git_branch, author_user_id, author_display, content_hash,
          revision_count, duplicate_count, last_seen_at, created_at, updated_at, lamport, deleted,
          superseded_by, source_ref, server_seq)
         VALUES (@sync_id, @project_key, @scope, @topic_key, @topic_key_hmac, @type, @title, @content,
          @tags, @source, @origin_ai, @origin_account, @git_branch, @author_user_id, @author_display,
          @content_hash, @revision_count, @duplicate_count, @last_seen_at, @created_at, @updated_at,
          @lamport, @deleted, @superseded_by, @source_ref, @server_seq)`
      )
      .run(row)
  }

  private applyRowUpdate(row: ObservationRow): void {
    this.db
      .prepare(
        // `type` entra en el SET desde el 2026-09-11. No estaba, asi que un camino que
        // construia la fila actualizada con un tipo distinto --el re-import que corrige la
        // clasificacion que la nota declara-- armaba bien el objeto y despues el SQL lo
        // descartaba en silencio. Los demas llamadores parten de la fila existente y no
        // tocan el tipo, asi que para ellos esto escribe el mismo valor que ya tenian.
        `UPDATE observations SET
           title = @title, content = @content, tags = @tags, type = @type, content_hash = @content_hash,
           topic_key_hmac = @topic_key_hmac,
           revision_count = @revision_count, updated_at = @updated_at, lamport = @lamport,
           deleted = @deleted, superseded_by = @superseded_by, source_ref = @source_ref,
           duplicate_count = @duplicate_count, last_seen_at = @last_seen_at, server_seq = @server_seq
         WHERE sync_id = @sync_id`
      )
      .run(row)
  }

  search(projectKey: string, query: string, limit = 10): ObservationSummary[] {
    return searchObservations(this.db, projectKey, GLOBAL_PROJECT_KEY, query, limit)
  }

  // `updated_at` is a JS `Date.now()` ms-epoch value — two writes in the same
  // millisecond (routine in a fast test, and not impossible for a chatty agent
  // session) tie under a bare `ORDER BY updated_at DESC`, and SQLite doesn't
  // guarantee ties resolve in write order. `lamport` exists precisely to give a
  // total order beyond wall-clock resolution (it's a strictly-increasing counter,
  // §4.3), so it's the correct secondary sort key wherever recency ordering matters.
  context(projectKey: string, limit = 10): ObservationSummary[] {
    return contextObservations(this.db, projectKey, GLOBAL_PROJECT_KEY, limit)
  }


  /**
   * Task 4: la observacion mas reciente de un tipo dado para un proyecto — usado para
   * reconstruir .nest/handoff.md en una maquina donde el worktree local no lo tiene
   * (type='handoff'), pero generico por si otro caso similar aparece despues.
   */
  latestByType(projectKey: string, type: ObservationType): ObservationSummary | null {
    const row = this.db
      .prepare(
        `SELECT * FROM observations
         WHERE project_key = ? AND type = ? AND deleted = 0 AND superseded_by IS NULL
         ORDER BY updated_at DESC, lamport DESC LIMIT 1`
      )
      .get(projectKey, type) as ObservationRow | undefined
    return row ? this.toSummary(row) : null
  }

  get(syncId: string): ObservationRow | null {
    return getObservation(this.db, syncId)
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
    /**
     * El HMAC que mando el servidor. Va tal cual: de un HMAC no se puede volver al tema,
     * asi que una fila remota se queda con `topic_key = null` y este campo lleno. La UI que
     * hoy muestra el tema en claro solo lo tiene para las filas escritas en esta maquina —
     * limitacion conocida y aceptada del camino B.
     */
    topicKeyHmac?: string | null
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
          /**
           * El HMAC que mando el servidor. Va tal cual: de un HMAC no se puede volver al
           * tema, asi que una fila remota se queda con `topic_key = null` y este campo
           * lleno. La UI que hoy muestra el tema en claro solo lo tiene para las filas
           * escritas en esta maquina — limitacion conocida y aceptada del camino B.
           */
          topic_key_hmac: row.topicKeyHmac ?? null,
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

  /**
   * Team Memory Layer 1, Parte 6 (lado cliente): promueve una observacion existente a
   * scope 'team' — la UNICA forma de que una fila salga de 'personal'/'project' (junto con
   * el endpoint POST /v1/projects/share del lado server, que decide si el PROYECTO puede
   * llevar filas 'team' — ver server/src/share.ts). No pasa por una cola de aprobacion: el
   * cambio de `observations.scope` es inmediato, sin gate humano en esta pasada (decision
   * ya tomada en el plan). De todos modos deja un registro en `promotion_queue` con
   * `status: 'approved'` — le da uso real a una tabla que hoy existe en el schema pero
   * nadie escribe, y queda como historial auditable de que se promovio y por que.
   * Idempotente por syncId: promover la misma fila dos veces (doble click, reintento de la
   * tool MCP) pisa la fila de `promotion_queue` en vez de violar su PK.
   *
   * No usa `applyRowUpdate()` (el UPDATE compartido de save()/deleteObservation()) a
   * proposito: esa funcion NO incluye `scope` en su SET list porque NINGUN otro caller
   * cambia el scope de una fila existente — agregarlo ahi tocaria una ruta compartida y ya
   * probada por una sola necesidad nueva. Un UPDATE acotado a esta funcion es mas seguro.
   *
   * No-op (`promoted: false`, sin tirar) si el syncId no existe o esta muerto (deleted o
   * superseded) — promover algo que ya no es la version activa no tiene sentido: nadie lo
   * ve, y la fila jamas pasaria los filtros `deleted = 0 AND superseded_by IS NULL` que
   * search()/context()/el pull team-scoped usan en todos lados.
   */
  promoteToTeam(syncId: string, reason?: string | null): { promoted: boolean } {
    const existing = this.get(syncId)
    if (!existing || existing.deleted !== 0 || existing.superseded_by !== null) {
      return { promoted: false }
    }

    const promote = this.db.transaction(() => {
      const now = Date.now()
      const lamport = this.nextLamport()
      this.db
        .prepare('UPDATE observations SET scope = ?, updated_at = ?, lamport = ? WHERE sync_id = ?')
        .run('team', now, lamport, syncId)
      this.appendMutation('promote', { ...existing, scope: 'team', updated_at: now, lamport })
      this.db
        .prepare(
          `INSERT INTO promotion_queue (sync_id, to_scope, reason, status, created_at)
           VALUES (?, 'team', ?, 'approved', ?)
           ON CONFLICT(sync_id) DO UPDATE SET
             to_scope = excluded.to_scope, reason = excluded.reason,
             status = excluded.status, created_at = excluded.created_at`
        )
        .run(syncId, reason ?? null, now)
    })
    promote()
    return { promoted: true }
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
   * Puente de datos del grafo navegable de memorias (ver electron/memory-graph.ts para la
   * consulta y las decisiones de diseño). Delegación fina: `buildMemoryGraph` es pura sobre
   * `Database.Database` justamente para poder testearla sin este wrapper de por medio.
   */
  memoryGraph(query: MemoryGraphQuery): MemoryGraph {
    return buildMemoryGraph(this.db, query)
  }

  /**
   * Spec 2026-09-11 (pantalla de Memories legible), sección "Datos que hay que construir":
   * la única consulta de lectura que faltaba. `search()`/`context()`/`latestByType()` toman
   * `projectKey` porque asumen un repo abierto; esta es la contraparte para "mostrame las
   * memorias de TODOS los proyectos juntas" que la pantalla necesita.
   *
   * - Ordena por `updated_at DESC, lamport DESC` — mismo criterio de desempate que
   *   search()/context() (ver su comentario más arriba: dos escrituras en el mismo
   *   milisegundo empatan bajo un ORDER BY updated_at puro).
   * - Pagina por cursor (keyset), no por offset. Justificación en el reporte de esta tarea:
   *   en resumen, esta tabla recibe escrituras continuas de agentes en background mientras
   *   el usuario navega la lista — un OFFSET numérico se corre (salta o repite filas) cada
   *   vez que algo nuevo se inserta por encima de la página que se está pidiendo; un cursor
   *   basado en la clave de orden (updated_at, lamport) de la última fila vista no.
   * - Excluye `deleted = 1` siempre, y `superseded_by` no nulo salvo `includeSuperseded` —
   *   idéntico criterio a `buildMemoryGraph` (memory-graph.ts), no uno paralelo.
   * - Devuelve `nextCursor: null` cuando esta fue la última página — el llamador nunca tiene
   *   que adivinar "¿esto es todo o hay más?" (igual espíritu que `MemoryGraph.truncated`:
   *   nunca cortar en silencio sin que el resultado lo diga).
   * - `query` es opcional: vacío o ausente es el listado plano (la pantalla al abrir, antes
   *   de escribir nada); si viene, reusa la tabla FTS5 `observations_fts` con el mismo
   *   patrón de saneo/frase exacta que `search()` — no un `LIKE`.
   */
  crossProjectMemories(input: CrossProjectMemoryQuery): CrossProjectMemoryPage {
    const limit = Math.max(1, Math.floor(input.limit))
    const includeSuperseded = input.includeSuperseded ?? false
    const rawQuery = input.query?.trim() ?? ''

    // Mismo saneo que search(): FTS5 no permite comillas dobles sueltas en una MATCH
    // expression sin romper su sintaxis de query; envolver en comillas fuerza frase exacta
    // en vez de dejar que los tokens se interpreten como operadores FTS5.
    const safeQuery = rawQuery ? rawQuery.replace(/["]/g, '') : ''
    // Un query no vacío que sanea a vacío (sólo comillas) es una búsqueda real que no puede
    // resolverse — devolver [] explícito, igual que search(), en vez de caer silenciosamente
    // al listado plano (eso mentiría: el usuario pidió buscar algo puntual).
    if (rawQuery && !safeQuery.trim()) {
      return { items: [], nextCursor: null }
    }

    const conditions: string[] = ['o.deleted = 0']
    const params: unknown[] = []
    if (!includeSuperseded) conditions.push('o.superseded_by IS NULL')

    if (input.cursor) {
      const [cursorUpdatedAtRaw, cursorLamportRaw] = input.cursor.split(':')
      const cursorUpdatedAt = Number(cursorUpdatedAtRaw)
      const cursorLamport = Number(cursorLamportRaw)
      // Un cursor corrupto/ajeno no debe tirar ni devolver la lista entera de nuevo — se
      // ignora y se sirve como si fuera la primera página, la falla más segura posible acá.
      if (Number.isFinite(cursorUpdatedAt) && Number.isFinite(cursorLamport)) {
        conditions.push('(o.updated_at < ? OR (o.updated_at = ? AND o.lamport < ?))')
        params.push(cursorUpdatedAt, cursorUpdatedAt, cursorLamport)
      }
    }

    const useFts = safeQuery.trim().length > 0
    const fromClause = useFts
      ? 'FROM observations o JOIN observations_fts f ON f.rowid = o.rowid LEFT JOIN projects p ON p.project_key = o.project_key'
      : 'FROM observations o LEFT JOIN projects p ON p.project_key = o.project_key'
    const matchCondition = useFts ? ['observations_fts MATCH ?'] : []
    const whereSql = [...matchCondition, ...conditions].join(' AND ')
    const allParams = useFts ? [`"${safeQuery}"`, ...params, limit + 1] : [...params, limit + 1]

    const rows = this.db
      .prepare(
        `SELECT o.sync_id, o.project_key, p.display_name AS project_display_name, o.title,
                o.type, o.scope, o.origin_ai, o.author_display, o.updated_at, o.lamport, o.tags
         ${fromClause}
         WHERE ${whereSql}
         ORDER BY o.updated_at DESC, o.lamport DESC
         LIMIT ?`
      )
      .all(...allParams) as CrossProjectRow[]

    // Se pide limit+1 a propósito: la fila de más (si existe) nunca se muestra, sólo prueba
    // que hay más allá de esta página — así el cursor se computa sobre la ÚLTIMA fila
    // REALMENTE devuelta, no sobre una que el llamador nunca vio.
    const page = rows.slice(0, limit)
    const hasMore = rows.length > limit
    const last = page[page.length - 1]
    const nextCursor = hasMore && last ? `${last.updated_at}:${last.lamport}` : null

    return {
      items: page.map((r) => ({
        syncId: r.sync_id,
        projectKey: r.project_key,
        projectDisplayName: r.project_display_name,
        title: r.title,
        type: r.type as ObservationType,
        scope: r.scope as 'personal' | 'project' | 'team',
        originAi: r.origin_ai,
        authorDisplay: r.author_display,
        updatedAt: r.updated_at,
        tags: r.tags ? (JSON.parse(r.tags) as string[]) : [],
      })),
      nextCursor,
    }
  }

  /**
   * MCP `memory_get` (docs/nest-memory-architecture.md §1.1): traer una memoria puntual por
   * su `sync_id`, para cuando un agente ya tiene el id (de un save/search previo) y quiere
   * su contenido completo. Envuelve `get()` con el mismo filtro `deleted = 0` que todo otro
   * método de lectura — una fila borrada está tombstoneada (`content` nulled, ver M12), así
   * que "no existe" es la respuesta correcta, no un objeto con contenido vacío. Una fila
   * SUPERSEDED sí se devuelve (a diferencia de search()/context()): acá el llamador pidió
   * ESTE id puntual, no "la versión vigente de este tema" — negárselo porque otra fila lo
   * reemplazó sería sorprendente para un caller que llega con el id en la mano.
   */
  getSummary(syncId: string): ObservationSummary | null {
    return getObservationSummary(this.db, syncId)
  }

  /**
   * MCP `memory_update` (docs/nest-memory-architecture.md §1.1): corrige una memoria
   * puntual ya guardada (título/contenido/tags) sin pasar por el merge-por-topic_key de
   * save() — ese mecanismo exige que las dos escrituras compartan `topic_key`, y esta tool
   * existe justo para la memoria que no tiene uno.
   *
   * Reusa el MISMO mecanismo de replicación que el Step 1 (topic upsert) de save():
   * `applyRowUpdate()` para el UPDATE en sitio, `content_hash` recalculado vía
   * `computeContentIdentity()` (con su redacción — M13 aplica igual acá que en cualquier
   * otra escritura), `revision_count` incrementado, `lamport` avanzado por `nextLamport()`,
   * y `appendMutation('upsert', updated)` para que el cambio entre al `mutation_log` y
   * replique como cualquier otra escritura. No es un mecanismo nuevo: es el mismo camino,
   * con una identidad de entrada distinta (syncId explícito en vez de topic_key).
   *
   * No-op (`updated: false`) — nunca tira — cuando: el syncId no existe, la fila está
   * borrada, o la fila está superseded (alguien más ya la reemplazó: escribir encima de la
   * perdedora de una colisión de topic sería un cambio que nadie vuelve a ver, igual
   * criterio que promoteToTeam()). También no-op cuando ningún campo pedido cambia el
   * contenido real (mismo content_hash y mismos tags) — evita un mutation_log row y un
   * push por una "corrección" que no corrige nada.
   */
  update(input: UpdateMemoryInput): UpdateMemoryResult {
    const existing = this.get(input.syncId)
    if (!existing) return { updated: false, reason: 'not_found' }
    if (existing.deleted !== 0) return { updated: false, reason: 'deleted' }
    if (existing.superseded_by !== null) return { updated: false, reason: 'superseded' }

    const nextTitleRaw = input.title ?? existing.title
    const nextContentRaw = input.content ?? (existing.content ?? '')
    const { title, content, redacted, hash } = computeContentIdentity(nextTitleRaw, nextContentRaw)
    const nextTags = input.tags !== undefined ? (input.tags ? JSON.stringify(input.tags) : null) : existing.tags

    if (hash === existing.content_hash && nextTags === existing.tags) {
      return { updated: false, reason: 'unchanged', syncId: existing.sync_id }
    }

    const updated: ObservationRow = {
      ...existing,
      title,
      content,
      tags: nextTags,
      content_hash: hash,
      revision_count: existing.revision_count + 1,
      updated_at: Date.now(),
      lamport: this.nextLamport(),
    }
    const txn = this.db.transaction(() => {
      this.applyRowUpdate(updated)
      this.appendMutation('upsert', updated)
    })
    txn()
    return { updated: true, syncId: updated.sync_id, redacted }
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

  /**
   * Spec §2.2: las sesiones que el bridge vio abrirse y todavia no cerro. Es la mitad
   * "lo que paso de verdad" del cruce de memory-sessions.ts — la otra mitad es
   * PtyManager.panesWithMemory(), o sea lo que Nest CREE que tiene memoria.
   */
  listOpenSessions(): Array<{
    id: string; pane_id: string | null; project_key: string
    ai_type: string | null; account: string | null; started_at: number
  }> {
    return this.db
      .prepare(
        'SELECT id, pane_id, project_key, ai_type, account, started_at ' +
          'FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC'
      )
      .all() as never
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
