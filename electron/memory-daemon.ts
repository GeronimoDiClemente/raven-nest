// Sync scheduler — lives in Electron main, owns the only network connection to
// Supabase for memory replication. See docs/nest-memory-architecture.md §1.3, §4.
//
// Citation convention in this file: a bare `§X` refers to that architecture doc; `spec §X`
// refers to the sync-backend spec, docs/superpowers/specs/2026-08-31-memory-sync-backend-design.md.
//
// Deliberately takes its dependencies as plain functions/objects (no direct `electron`
// import) so the scheduling/backoff/apply logic is unit-testable with a mocked fetch and
// vitest fake timers, without spinning up a BrowserWindow or a real network call.

import { MemoryStore, type MutationLogRow } from './memory-store'
import type { Candado, ResultadoCandado } from './memory-sync-lock'
import { resolveLWW, resolveTopicCollision, type LWWRow } from './memory-merge'
import { GLOBAL_PROJECT_KEY } from './memory-project-key'
import { sealMutationPayload, openPulledRow, type EnvelopeContext } from './memory-envelope'
import { isCiphertext } from './memory-crypto'

/**
 * Una máquina de la cuenta de sync; `lastSeenAt` en ms. Espejo de la de `src/types.ts`: el
 * paquete portátil compila sólo `electron/` y no puede importar del renderer.
 */
export interface MaquinaDeLaCuenta {
  id: string
  name: string
  platform: string | null
  lastSeenAt: number | null
  current: boolean
}

const DEBOUNCE_MS = 3_000
const MAX_WAIT_MS = 30_000
const INTERVAL_MS = 5 * 60_000
const FOCUS_PULL_RATE_LIMIT_MS = 30_000
const BACKOFF_BASE_MS = 5_000
const BACKOFF_MAX_MS = 5 * 60_000
const QUIT_PUSH_BUDGET_MS = 2_000
const PUSH_BATCH_SIZE = 200
const PULL_PAGE_SIZE = 500
// §4.5 "hard cap 50 000, after which the daemon compacts the queue".
const QUEUE_HARD_CAP = 50_000
// Without this, a hung backend wedges the daemon until the app restarts. The
// in-flight dedupe caches the request promise, and a promise that never settles
// never runs its `.finally`, so pullInFlight/pushInFlight stay set forever and every
// subsequent call returns the same dead promise. 30s is generous for a push of 200
// mutations over a bad connection and is still a cutoff, not a wait.
const FETCH_TIMEOUT_MS = 30_000
// pause() waits for any in-flight push()/pull() to settle before the hot-swap orchestrator
// (memory-account-switch.ts) closes the old store and renames its directory. A push/pull
// that never settles (a fetch stuck past FETCH_TIMEOUT_MS would already be a bug, but
// defense in depth costs nothing here) must not wedge the swap forever.
const PAUSE_DRAIN_TIMEOUT_MS = 5_000

// 'plan_required' is distinct from 'error': it is not a credential problem (spec §9.3),
// the UI hangs its own Upgrade affordance off it (SettingsPanel.tsx), and — unlike a real
// auth failure — it must never trip the three-strikes breaker or stop the daemon. See
// classifyAuthFailure() and its call sites in push()/pull()/status() below.
export type DaemonStatus = 'idle' | 'syncing' | 'paused' | 'error' | 'plan_required'

// A per-mutation rejection is TERMINAL or REVERSIBLE, and
// treating them the same loses data. Terminal (missing_sync_id, observation_too_large,
// team_scope_not_allowed, or anything unrecognized) can never succeed with this exact
// payload — markPushed() records it and moves on so it doesn't loop forever. Reversible is
// a plan limit the user can lift by paying or freeing space (server/src/push.ts's two
// PASADA-1/PASADA-2 rejections) — losing the mutation here is losing it at the exact moment
// of the sale: the Free user who pays for their second repo would get a cloud project with
// nothing in it, because everything they wrote while capped was already discarded. Blocked
// via store.blockMutations() instead — held, not retried every cycle, until status()'s
// unblock check (see doStatus() below) says the limit no longer applies.
//
// `project_not_shared_with_team` es reversible POR DEFINICION — el usuario comparte el
// proyecto (POST /v1/projects/share) y el mismo payload aplica — y tratarlo como terminal
// haria que el handoff que el usuario creyo compartir se descartara para siempre, incluso
// despues de compartir el proyecto. `team_scope_not_allowed` SI se queda terminal: ahi el plan de la
// cuenta no admite `scope: 'team'`, y la fila ya se guardo local como corresponde.
//
// Spec §9.4: `team_encryption_required` lo devuelve el servidor cuando una fila de
// equipo llega en claro a un equipo con `team_keys`. Reversible por definición: el mismo
// payload, sellado con la clave de equipo, aplica en cuanto este device la adopte.
export const REVERSIBLE_REJECTIONS = new Set(['project_limit_reached', 'quota_exceeded', 'project_not_shared_with_team', 'team_encryption_required'])

/** Spec 2b-1: el motivo con el que el servidor rechaza un proyecto por encima del tope del plan. */
export const MOTIVO_TOPE_DE_PROYECTOS = 'project_limit_reached'

/** Lo que libera `onTeamKeysChanged()`: la retención local (`team_key_missing`, el
 * gate de `doPush`) y el rechazo equivalente del servidor. */
export const TEAM_KEY_HOLD_REASONS = ['team_key_missing', 'team_encryption_required'] as const

/** Tope de la readopción automática dentro de `doStatus`: un `/v1/teams/key` colgado no puede
 * trabar el status (y con él el push, que lo espera). */
const TEAM_READOPT_TIMEOUT_MS = 10_000

export interface PushResultItem {
  sync_id: string
  outcome: 'applied' | 'superseded' | 'rejected'
  project_seq: number
  error?: string
}

/** spec §5.3.1: one entry in the status roster — keys and display names, never rows. */
export interface StatusRosterProject {
  project_key: string
  display_name?: string
  /** Con qué equipo está compartido este proyecto en el servidor. Ausente en un
   * servicio viejo. */
  team_id?: string | null
}

export interface StatusResponseBody {
  device_id?: string
  user_id?: string
  plan?: string
  next_poll_ms?: number
  server_time?: string
  quota?: { used_bytes: number; max_bytes: number }
  /** Spec 2b-1 §4.2: el tope de proyectos del plan. Ausente en un servicio viejo: "no sé". */
  limits?: { max_projects?: unknown }
  /** Spec 2b-2 §4.7: el proyecto elegido para seguir sincronizando, o null. Ausente = servicio viejo. */
  kept_project_key?: string | null
  /** Spec 2b-2 §4.7: la cuenta tiene más proyectos propios que el tope del plan. */
  over_limit?: boolean
  /**
   * Absent entirely on an older service or the pre-roster stub — that means "no discovery
   * available", not an error, so `status()` must treat a missing field as a no-op rather
   * than a failure.
   */
  projects?: StatusRosterProject[]
  /**
   * La época de claves de la cuenta: 0 = no tiene el cifrado activo. Ausente en un servicio
   * viejo, que es un caso distinto de `0` y se trata distinto — ver `doStatus`.
   */
  key_epoch?: number
  /** Equipos con cifrado activo donde soy miembro, y si ESTE device tiene envoltura.
   * Ausente en un servicio viejo: "no sé", no "ninguno" — no borra lo que el store ya sabe. */
  encrypted_teams?: Array<{ team_id: string; has_wrap: boolean }>
}

export interface PulledRow extends LWWRow {
  deleted: boolean
  topicKey: string | null
  /**
   * El HMAC del tema, que es lo unico que el servidor ve de el (spec §5.2). Lo completa
   * `openPulledRow` (memory-envelope.ts): `null` cuando no hay claves, el valor que vino
   * cuando la fila llega cifrada, y el recalculado cuando la fila es anterior a la
   * migracion y todavia trae el tema en claro.
   */
  topicKeyHmac?: string | null
  scope: string
  /** Local project_key (client-derived hash) — see mapRawPulledRow. */
  projectKey: string
  supersededBy: string | null
  title?: string
  content?: string | null
  type?: string
  tags?: string[]
  originAi?: string
  originAccount?: string
  gitBranch?: string
  authorUserId?: string
  authorDisplay?: string
  contentHash?: string
  projectSeq?: number
  /** El equipo de la fila según el SERVIDOR (sólo `scope: 'team'`). Ausente en un
   * servicio viejo. `openPulledRow` lo usa para elegir la clave de equipo. */
  teamId?: string
}

export interface MemoryDaemonDeps {
  store: MemoryStore
  /** Base of the sync service, not necessarily Supabase. See spec §5.4. */
  getSyncBaseUrl: () => string | null
  getToken: () => string | null
  getDeviceId: () => string | null
  isOnline: () => boolean
  fetchImpl?: typeof fetch
  /**
   * Las claves de cifrado de la cuenta, o `null` si el cifrado no esta activado en esta
   * maquina. Opcional: sin esta dep, el daemon empuja y baja en claro.
   *
   * Es una FUNCION y no un valor: el usuario puede activar el cifrado con la app abierta y
   * el daemon tiene que ver la clave nueva sin que nadie lo reinicie.
   */
  getEnvelopeContext?: () => EnvelopeContext | null
  /**
   * Si la CUENTA tiene el cifrado activo, independientemente de si ESTA máquina tiene la
   * clave. Es lo que permite fallar cerrado.
   *
   * Sin esto, cualquier camino que deje `getEnvelopeContext()` en `null` —una máquina sin
   * autorizar, un `safeStorage` que no abrió, un swap de cuenta que no recargó las claves—
   * hace que `sealMutationPayload` devuelva el payload TAL CUAL y el daemon suba título,
   * contenido y tags en texto plano a una nube que el usuario cree cifrada.
   */
  isEncryptionExpected?: () => boolean
  /**
   * §6.3 del spec `2026-09-13-nest-memory-portable-design.md`: toma el candado de
   * sincronización de esta base. Si otro lo tiene, este daemon NO sincroniza — las
   * escrituras locales siguen encolándose en el `mutation_log` y no se pierde nada.
   *
   * Cierra el caso de dos daemons sobre la misma cuenta: la app instalada y un build de
   * desarrollo comparten `~/.raven-nest`, o sea dos copias del token y dos pushers
   * compitiendo (contra la decisión 2 de la arquitectura).
   *
   * Opcional: sin esta dep el daemon sincroniza sin candado.
   */
  adquirirCandado?: () => ResultadoCandado
  /**
   * Spec §9.4: `doStatus` lo llama con los equipos cifrados del status, y lo ESPERA
   * (con tope) antes de seguir. Es donde main.ts readopta las claves de equipo que esta máquina
   * ya tiene envueltas, ANTES del pull y del push del mismo drain. Sin esto la clave de equipo
   * (que vive sólo en memoria) recién volvería cuando el usuario abriera la tarjeta.
   */
  onEncryptedTeams?: (teams: Array<{ teamId: string; hasWrap: boolean }>) => Promise<void> | void
  onStatusChange?: (status: DaemonStatus, detail?: string) => void
}

/** Exponential backoff with jitter — pure, no timers, easy to unit test in isolation. */
export class Backoff {
  private attempt = 0

  next(): number {
    const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** this.attempt)
    this.attempt = Math.min(this.attempt + 1, 10) // cap growth, avoid unbounded exponent
    const jitter = Math.floor(exp * 0.2 * Math.random())
    return exp + jitter
  }

  reset(): void {
    this.attempt = 0
  }

  get attemptCount(): number {
    return this.attempt
  }
}

/**
 * Races `settle` against a timer, same shape as memory-ipc-server.ts's own `withTimeout`
 * (for memory.search's pull-through fallback) — replicated here
 * rather than imported because that one is a module-private helper in a different file
 * with its own reasoning about what it wraps. Never rejects: resolves `true` when
 * `settle` finished first (fulfilled OR rejected — pause() only cares that the in-flight
 * work is DONE, not how it ended) and `false` when the timeout fired first, so the caller
 * can log a warning without the drain wait ever hanging indefinitely.
 */
function withTimeout(settle: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms)
    settle.then(
      () => { clearTimeout(timer); resolve(true) },
      () => { clearTimeout(timer); resolve(true) }
    )
  })
}

function parseServerTimestamp(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  // Should not happen with well-formed server data — never throw from a mapping
  // function over network input; falling back to "now" keeps this row applyable
  // (worst case it loses an LWW tie it should have won) instead of crashing the pull.
  return Date.now()
}

/**
 * The store persists `tags` as a JSON string in a TEXT column, and a queued mutation's
 * payload is a raw snapshot of that row, so without this the push sends a string where
 * the contract expects an array (spec §5.2) and the pull discards anything that isn't
 * already an Array — tags would be lost in both directions with no error at all.
 */
function normalizeTags(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((t): t is string => typeof t === 'string')
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.filter((t): t is string => typeof t === 'string')
    } catch { /* not JSON — treat as no tags */ }
  }
  return undefined
}

/**
 * The RPCs return `to_jsonb(o)` — real Postgres column names (snake_case) and real
 * Postgres types (timestamptz -> an ISO 8601 string, not a ms-epoch number). Reading
 * camelCase fields straight off that raw object yields `undefined` everywhere and no row
 * is ever applied; this is the mapping layer, plus timestamp parsing. `project_key` is not
 * a native column on memory_observations (the table only has the cloud `project_id` UUID)
 * — the memory-sync edge function denormalizes the caller's local `project_key` onto every
 * row before returning them (see
 * supabase/functions/memory-sync/index.ts's pull handler), specifically so this mapping
 * never needs a separate id->key lookup.
 */
export function mapRawPulledRow(raw: Record<string, unknown>): PulledRow {
  return {
    syncId: String(raw.sync_id ?? ''),
    updatedAt: parseServerTimestamp(raw.client_updated_at),
    lamport: Number(raw.lamport ?? 0),
    deleted: Boolean(raw.deleted),
    topicKey: (raw.topic_key as string | null | undefined) ?? null,
    scope: String(raw.scope ?? 'personal'),
    projectKey: String(raw.project_key ?? ''),
    supersededBy: (raw.superseded_by as string | null | undefined) ?? null,
    title: raw.title != null ? String(raw.title) : undefined,
    content: raw.content == null ? null : String(raw.content),
    type: raw.type != null ? String(raw.type) : undefined,
    tags: normalizeTags(raw.tags),
    originAi: (raw.origin_ai as string | undefined) ?? undefined,
    originAccount: (raw.origin_account as string | undefined) ?? undefined,
    gitBranch: (raw.git_branch as string | undefined) ?? undefined,
    // Without this every pulled row lands with `author_user_id = null` regardless of who
    // authored it, which defeats `countUnclaimedRows()`/`pendingMutations()` (telling "no
    // author" apart from "an author who isn't me", see memory-store.ts's
    // `author_user_id IS NULL` filters). `author_id` (not `author_user_id`) matches the
    // wire field name the server would use for the raw column (see server/src/push.ts's
    // `observations.author_id`) — same convention as `author_display` right below.
    authorUserId: (raw.author_id as string | undefined) ?? undefined,
    authorDisplay: (raw.author_display as string | undefined) ?? undefined,
    contentHash: (raw.content_hash as string | undefined) ?? undefined,
    projectSeq: raw.project_seq != null ? Number(raw.project_seq) : undefined,
    ...(typeof raw.team_id === 'string' && raw.team_id !== '' ? { teamId: raw.team_id } : {}),
  }
}

export class MemoryDaemon {
  private readonly deps: MemoryDaemonDeps
  private debounceTimer: NodeJS.Timeout | null = null
  private maxWaitTimer: NodeJS.Timeout | null = null
  private intervalTimer: NodeJS.Timeout | null = null
  private backoffTimer: NodeJS.Timeout | null = null
  private lastFocusPullAt = 0
  private consecutiveAuthFailures = 0
  private backoff = new Backoff()
  // Not `status`: that name belongs to the public `status()` method (§5.3.1,
  // GET /v1/sync/status). The field and the method are unrelated: this one is the daemon's
  // idle/syncing/paused/error indicator surfaced via getStatus()/onStatusChange, not the
  // sync service's health-check response.
  private currentStatus: DaemonStatus = 'idle'
  private currentDetail: string | undefined
  private running = false
  // Set for the duration of a hot-swap (pause() -> ... -> resume()).
  // Every trigger entry point that can schedule a NEW push/pull (as opposed to one
  // already in flight, which pause() drains separately) must no-op while this is true —
  // otherwise a timer or a chained setImmediate() can fire mid-swap and touch a store
  // that is mid-close/mid-rename or already reassigned to a different account's file.
  private swapping = false
  // Set after 3 consecutive auth failures. Stopping only the BACKOFF chain isn't enough —
  // every OTHER trigger (a fresh on-write debounce, pane-exit, window focus, the 5-minute
  // interval) calls push()/pull() directly and would hit the revoked-token endpoint again.
  // This flag is checked at the top of both push() and pull(), so every entry point is
  // gated the same way. Cleared by
  // onNetworkRegain() — the reconnect flow's actual "the user acted" signal.
  private authBlocked = false
  // The plan last reported by status(), used only to detect a CHANGE — a project
  // cap the client has no way to evaluate itself (unlike a byte quota, it doesn't know the
  // new plan's limit), so any change is treated as "might have lifted project_limit_reached"
  // and unblocks on spec. Worst case the very next push is rejected again and re-blocks it.
  // Starts undefined so the very FIRST status() response never counts as "a change".
  private lastSeenPlan: string | undefined
  // La ultima cuota que reporto el servidor. El cliente NO la calcula: los limites de
  // nube los hace cumplir el servicio y el cliente los muestra.
  // Se retiene entre respuestas porque un `status` sin el campo significa "no vino este
  // tick", no "el usuario ya no tiene cuota".
  private lastQuota: { used_bytes: number; max_bytes: number } | null = null
  // Spec 2b-1 §4.2: el tope de proyectos que informó el servidor y las keys del roster (sin
  // __global__). Los dos son de la cuenta del store actual: `setStore` los vacía (D10).
  private lastLimits: { max_projects: number } | null = null
  private lastCloudProjectKeys: string[] | null = null
  // Spec 2b-2 §4.7: qué proyecto eligió seguir sincronizando quien bajó de plan, y si la cuenta
  // está por encima del tope. De la cuenta del store actual: `setStore` los vacía.
  private lastKeptProjectKey: string | null = null
  private lastOverLimit = false
  // Concurrent triggers (e.g. a debounced push firing at the same moment as the 5-minute
  // interval's drain) would otherwise fire independent overlapping requests — double POSTs
  // of the same batch, or a later pull's cursor write racing an earlier one's. These
  // in-flight promises are returned to a second caller instead of starting a
  // second request.
  private pushInFlight: Promise<void> | null = null
  private pullInFlight: Promise<void> | null = null
  // status()'s own network fetch is awaited, so it has to be tracked like push()/pull() or
  // it is invisible to pause()'s drain-wait (see pause() below). drain() calls status()
  // BEFORE pull()/push(), so the window this closes is: pause() called while a drain()'s
  // status() fetch is still in the air and pushInFlight/pullInFlight are both still null —
  // without it pause() would see an empty in-flight list and return immediately, and the
  // swap would close/rename the store while status()'s eventual `this.deps.store`-reading
  // continuation was still pending against it. Same set/clear-in-finally shape as
  // pushInFlight/pullInFlight, just for status().
  /**
   * Si ya hubo un `status` exitoso en esta sesión. `scheduleMutationPush()` (debounce de 3s
   * sobre CADA escritura del MCP) y `onQuit()` llaman `push()` directo, sin pasar por el
   * drain, así que sin esto el primer push de un arranque puede salir antes de que el daemon
   * sepa si la cuenta cifra.
   */
  private primerStatusOk = false

  /**
   * El candado de §6.3 mientras lo tengamos. Se pide una sola vez y después se refresca:
   * pedirlo en cada push obligaría a leer y escribir el archivo por operación, y el que lo
   * tiene no necesita volver a preguntar.
   */
  private candado: Candado | null = null

  private statusInFlight: Promise<StatusResponseBody | null> | null = null
  // §11.4 / spec §5.3.1: the server's call, not a client constant. `status()` reads
  // `next_poll_ms` off every response and, when it names a different number, reschedules
  // the interval to it via applyPollInterval(). Starts at the hard-coded fallback because
  // nothing has answered a status() call yet.
  private pollIntervalMs = INTERVAL_MS

  constructor(deps: MemoryDaemonDeps) {
    this.deps = deps
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.scheduleIntervalTimer()
  }

  /** Re-armed by applyPollInterval() whenever the server's next_poll_ms changes. */
  private scheduleIntervalTimer(): void {
    if (this.intervalTimer) clearInterval(this.intervalTimer)
    this.intervalTimer = setInterval(() => void this.drain(), this.pollIntervalMs)
  }

  stop(): void {
    this.running = false
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    if (this.maxWaitTimer) clearTimeout(this.maxWaitTimer)
    if (this.intervalTimer) clearInterval(this.intervalTimer)
    if (this.backoffTimer) clearTimeout(this.backoffTimer)
    this.debounceTimer = this.maxWaitTimer = this.intervalTimer = this.backoffTimer = null
    // §6.3: soltarlo acá y no dejarlo vencer por ttl. Si no, la otra instancia (o el
    // paquete portátil) espera hasta un minuto para empezar a sincronizar por nada.
    this.soltarCandado()
  }

  /**
   * The daemon side of a hot-swap. Called by the swap orchestrator
   * (memory-account-switch.ts) BEFORE it closes the current store — stops scheduling any
   * new push/pull (via `swapping`, checked by every trigger entry point below) and waits
   * for whatever push/pull is already in flight to settle, so the swap's close()+rename
   * never races a request still reading/writing the old file.
   *
   * Bounded by PAUSE_DRAIN_TIMEOUT_MS: a push/pull that never settles must not wedge the
   * swap forever — this resolves regardless, just with a
   * warning logged, and the swap proceeds. Idempotent-ish in the sense that calling it
   * again while already swapping just re-drains whatever is in flight at that moment; the
   * orchestrator's own mutex (queued in main.ts) is what actually prevents overlapping
   * swaps, not this method.
   */
  async pause(): Promise<void> {
    this.swapping = true
    this.stop() // running = false + clears the 4 timers (debounce/maxWait/interval/backoff)

    const inFlight: Array<Promise<unknown>> = []
    if (this.pushInFlight) inFlight.push(this.pushInFlight)
    if (this.pullInFlight) inFlight.push(this.pullInFlight)
    if (this.statusInFlight) inFlight.push(this.statusInFlight)
    if (inFlight.length === 0) return

    const settledInTime = await withTimeout(Promise.allSettled(inFlight), PAUSE_DRAIN_TIMEOUT_MS)
    if (!settledInTime) {
      console.warn(
        '[memory-daemon] pause(): timed out after %dms waiting for an in-flight push/pull to settle — proceeding with the swap anyway',
        PAUSE_DRAIN_TIMEOUT_MS
      )
    }
  }

  /**
   * The other half of pause() — clears `swapping` and restarts the
   * interval timer. `start()` is already idempotent (no-ops if `running` is true), so
   * this is safe to call even if something else already restarted the daemon.
   */
  resume(): void {
    this.swapping = false
    this.start()
    const pendiente = this.teamKeysPendientesDeGeneracion
    this.teamKeysPendientesDeGeneracion = null
    if (pendiente !== null && pendiente === this.generacionDeStore) this.onTeamKeysChanged()
  }

  /**
   * The actual "hot" part of the hot-swap — reassigns the store this
   * daemon reads/writes without recreating the daemon (which would lose backoff state,
   * pending timers' closures, etc.). Must only be called while paused (swapping === true)
   * so no in-flight push/pull is mid-request against the OLD store when this reassigns
   * `deps.store` out from under it — the orchestrator's ordering (pause -> close old ->
   * rename/reopen -> setStore -> resume) is what guarantees that, not this method itself.
   */
  /**
   * Cada swap de cuenta avanza la generación. Es lo que permite descartar la respuesta de un
   * pull que salió con la cuenta ANTERIOR: `pause()` espera el drain sólo 5s y el timeout del
   * fetch es 30s, así que con una red lenta el swap ocurre con un pull en vuelo, y sus filas
   * —con el `author_user_id` de la cuenta vieja— terminarían escritas en la base de la nueva.
   */
  private generacionDeStore = 0

  setStore(store: MemoryStore): void {
    this.deps.store = store
    this.generacionDeStore += 1
    // La cuenta nueva tiene su propia época, y todavía no la preguntamos. Dejarlo en true
    // haría que el primer push de la cuenta nueva salga sin saber si cifra.
    this.primerStatusOk = false
    // El tope y el roster son de la cuenta anterior: mostrarlos con la nueva sería mostrarle
    // repos ajenos hasta el próximo status.
    this.lastLimits = null
    this.lastCloudProjectKeys = null
    this.lastKeptProjectKey = null
    this.lastOverLimit = false
    // El plan visto también es de la cuenta anterior: compararlo con el de la nueva haría
    // pasar por "cambio de plan" lo que es sólo un cambio de cuenta.
    this.lastSeenPlan = undefined
  }

  private setStatus(status: DaemonStatus, detail?: string): void {
    this.currentStatus = status
    this.currentDetail = detail
    this.deps.onStatusChange?.(status, detail)
  }

  getStatus(): DaemonStatus {
    return this.currentStatus
  }

  /**
   * El código del último cambio de estado ('offline', 'needs_key', 'lock_held', ...).
   *
   * Se retiene porque el evento `onStatusChange` pasa UNA vez: quien abre Settings o la
   * pantalla Memories después pregunta por `memory:status`, que es un camino distinto, y
   * sin esto vería un estado sin motivo.
   */
  getStatusDetail(): string | undefined {
    return this.currentDetail
  }

  /**
   * §6.3: ¿le toca sincronizar a ESTE proceso? Sin la dep del candado, siempre sí. Con la
   * dep, lo pide una vez y después lo refresca.
   *
   * Cuando otro lo tiene, el estado queda en `paused` con quién lo tiene adentro del
   * detalle. No es `error`: no hay nada roto ni nada que reintentar más rápido, y las
   * escrituras locales siguen encolándose. Es la diferencia entre "no puedo" y "no me
   * toca", y mostrarlo como error mandaría al usuario a buscar un problema que no existe.
   */
  private meTocaSincronizar(): boolean {
    const { adquirirCandado } = this.deps
    if (!adquirirCandado) return true

    if (this.candado) {
      // Un drain largo no se lo tiene que dejar robar por antigüedad desde otra máquina.
      if (this.candado.heartbeat()) return true
      // Ya se lo robaron: entre dos intervalos pasan más de 60 s sin heartbeat, y otra
      // máquina lo ve vencido. Seguir empujando sería sincronizar dos a la vez. Se vuelve
      // a pedir, que casi siempre termina en `lock_held` hasta que el otro lo suelte.
      this.candado = null
    }

    const r = adquirirCandado()
    if (r.ok) {
      this.candado = r.lock
      return true
    }

    // Un CÓDIGO, igual que 'offline' / 'needs_key' / 'not_in_beta' / 'auth'. El texto que
    // lee el usuario lo arma el renderer: acá adentro un literal de UI se saltearía el
    // i18n del repo, y además el daemon no tiene por qué saber cómo se dice esto.
    console.info('[memory-daemon] candado tomado por pid %d en %s — no sincronizo', r.holder.pid, r.holder.host)
    this.setStatus('paused', 'lock_held')
    return false
  }

  private soltarCandado(): void {
    this.candado?.release()
    this.candado = null
  }

  /**
   * Un daemon sin `start()` —el del paquete portátil— tiene operaciones sueltas, y el
   * candado protege una operación, no una sesión. Lo suelta al terminar la última que
   * esté en vuelo, incluidas las que encadena solo (`setImmediate` en push y pull):
   * esas corren DESPUÉS del `stop()` de quien las disparó, y sin esto se quedarían con el
   * candado hasta que el proceso muriera — horas, con un MCP abierto en el editor.
   */
  private soltarCandadoSiQuedoOcioso(): void {
    if (this.running || this.pushInFlight || this.pullInFlight) return
    this.soltarCandado()
  }

  /** La ultima cuota reportada por el servidor, o null si todavia no reporto ninguna. */
  getQuota(): { used_bytes: number; max_bytes: number } | null {
    return this.lastQuota
  }

  /** El último tope de proyectos que informó el servidor, o null si todavía no informó ninguno. */
  getLimits(): { max_projects: number } | null {
    return this.lastLimits
  }

  /** Las keys del último roster de la nube, sin `__global__`; null si todavía no llegó ninguno. */
  getCloudProjectKeys(): string[] | null {
    return this.lastCloudProjectKeys
  }

  /** El proyecto elegido para seguir sincronizando (spec 2b-2), o null. */
  getKeptProjectKey(): string | null {
    return this.lastKeptProjectKey
  }

  /** Si la cuenta tiene más proyectos en la nube que los que su plan sincroniza (spec 2b-2). */
  isOverLimit(): boolean {
    return this.lastOverLimit
  }

  /**
   * El ultimo plan que reporto `status()`, o undefined si todavia no contesto ninguno.
   * Expuesto para el gate de equipo (prender el hilo de equipo con un plan que no permite
   * `scope: 'team'` produce filas que el servidor rechaza y el daemon descarta como
   * terminales). Undefined significa "no se sabe", NO "no permitido" — ver
   * `planAllowsTeamSharing`.
   */
  getPlan(): string | undefined {
    return this.lastSeenPlan
  }

  // Exposed so memory-ipc-server.ts's pull-through search fallback (a zero-result
  // memory_search triggers an immediate pull()) can decide WITHOUT calling pull() at all
  // whether one is worth attempting — pull() already no-ops when offline (doPull()'s own
  // isOnline() check), but skipping the call entirely on a disconnected/offline machine
  // avoids even the Promise/timeout machinery around it, and lets callers (and their
  // tests) assert "no pull attempted" instead of "a pull was attempted and no-opped".
  isOnline(): boolean {
    return this.deps.isOnline()
  }

  /** §4.1 "On write" trigger — debounce 3s, max-wait 30s so a chatty session still pushes. */
  scheduleMutationPush(): void {
    if (this.swapping) return // no new timers while a store hot-swap is in flight
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      if (this.maxWaitTimer) { clearTimeout(this.maxWaitTimer); this.maxWaitTimer = null }
      void this.push()
    }, DEBOUNCE_MS)

    if (!this.maxWaitTimer) {
      this.maxWaitTimer = setTimeout(() => {
        this.maxWaitTimer = null
        if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null }
        void this.push()
      }, MAX_WAIT_MS)
    }
  }

  /** §4.1 "Window focus" trigger — rate-limited to once per 30s. */
  onWindowFocus(): void {
    if (this.swapping) return // no new pull while a store hot-swap is in flight
    const now = Date.now()
    if (now - this.lastFocusPullAt < FOCUS_PULL_RATE_LIMIT_MS) return
    this.lastFocusPullAt = now
    void this.pull()
  }

  /** §4.1 "Network regain" trigger — full drain. Also the "user acted" reset for authBlocked. */
  onNetworkRegain(): void {
    if (this.swapping) return // no new drain while a store hot-swap is in flight
    this.backoff.reset()
    this.consecutiveAuthFailures = 0
    this.authBlocked = false
    void this.drain()
  }

  /** main.ts lo llama cada vez que entra una clave de equipo a memoria (activar,
   * adoptar, recuperar, readopción de arranque): libera lo retenido y empuja ya. */
  onTeamKeysChanged(): void {
    if (this.swapping) {
      // Durante un swap no se toca el store (puede estar cerrándose), pero perder el aviso
      // dejaría lo retenido esperando a la próxima clave. Queda anotado con la generación de
      // store en que llegó, y `resume()` lo aplica sólo si el swap conservó ese store: si lo
      // cambió, la clave era de la cuenta anterior (main.ts vacía `teamMasterKeys` al cambiar).
      this.teamKeysPendientesDeGeneracion = this.generacionDeStore
      return
    }
    this.deps.store.unblockMutations([...TEAM_KEY_HOLD_REASONS])
    void this.push()
  }

  /** Generación de store en que llegó un `onTeamKeysChanged()` durante un swap, o null. */
  private teamKeysPendientesDeGeneracion: number | null = null

  /** §4.1 "Pane exit" trigger. */
  onPaneExit(): void {
    if (this.swapping) return // no new push while a store hot-swap is in flight
    void this.push()
  }

  /** §4.1 "App quit" trigger — best-effort push within a 2s budget, never blocks exit. */
  async onQuit(): Promise<void> {
    await Promise.race([
      this.push(),
      new Promise((resolve) => setTimeout(resolve, QUIT_PUSH_BUDGET_MS)),
    ]).catch(() => { /* quitting regardless */ })
  }

  private async drain(): Promise<void> {
    // Offline-queue maintenance, so the queue can't grow unbounded. Runs once per drain
    // cycle (interval tick or an explicit onNetworkRegain()) — cheap, and every trigger
    // eventually funnels through here or through push()/pull() directly, so this cadence
    // is frequent enough per §4.5.
    this.deps.store.pruneAckedMutations()
    if (this.deps.store.pendingMutationCount() > QUEUE_HARD_CAP) {
      this.deps.store.compactMutationLog()
    }
    // spec §5.3.1: drain() is reached from exactly the two triggers the spec names —
    // start()'s interval timer ("on each interval tick") and onNetworkRegain(), which is
    // what the memory:connect IPC handler calls after seeding known projects ("on
    // connect") — so calling status() here, before pull(), covers both without a second
    // call site. ensureProject() inside status() writes synchronously, so a project this
    // call just discovered is already in store.listProjects() by the time pull() (right
    // below) builds its cursors — not just "the next pull" as the spec describes, but
    // this very same drain cycle's pull.
    await this.status()
    await this.pull()
    await this.push()
  }

  /**
   * `fetch` settles as soon as the RESPONSE HEADERS arrive, so disarming the abort there
   * would happen before `await response.json()` had read a single byte. A server that
   * answers 200 + headers and then stalls the body would leave that `.json()` promise
   * pending forever — the same wedge FETCH_TIMEOUT_MS exists to close, one step later: the
   * in-flight dedupe caches a promise that never settles, so pushInFlight/pullInFlight stay
   * set and every later call returns the same dead promise.
   *
   * So the timer stays ARMED across the handoff and the caller disarms it with
   * `release()` only after the body is consumed (or after it decides not to read one).
   * An abort that fires while the body is still streaming errors the body stream, so
   * `response.json()` rejects and the caller's normal error path takes over instead of
   * hanging. `fetchImpl` keeps its exact contract — a plain fetch-shaped function — so
   * every test can still substitute it unchanged.
   */
  private async fetchWithTimeout(
    input: string,
    init: RequestInit
  ): Promise<{ response: Response; release: () => void }> {
    const impl = this.deps.fetchImpl ?? fetch
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const response = await impl(input, { ...init, signal: controller.signal })
      return { response, release: () => clearTimeout(timer) }
    } catch (err) {
      // Never reached the handoff, so nobody will ever call release() — disarm here.
      clearTimeout(timer)
      throw err
    }
  }

  /**
   * spec §9.3: on a 401/403 the server names the reason with `{ error: <code> }` —
   * `plan_required`, `not_in_beta`, or `unauthorized` — so push()/pull()/status() can
   * branch on WHY instead of lumping every 401/403 into "the token is bad". Consumes the
   * response body, so callers must not read it again afterwards (none of the 401/403
   * branches below do).
   *
   * Never throws: a non-JSON or empty body — e.g. a 403 from a proxy sitting in front of
   * the service rather than from the service itself — falls back to `'unauthorized'`,
   * the treatment for any unrecognized 401/403. That keeps the real auth breaker
   * (authBlocked) as the safe default: an unparseable body must never be
   * silently treated as a non-auth-failure code and skip the breaker.
   */
  private async classifyAuthFailure(
    response: Response
  ): Promise<'plan_required' | 'not_in_beta' | 'device_limit' | 'unauthorized'> {
    try {
      const body = (await response.json()) as { error?: unknown }
      if (body?.error === 'plan_required') return 'plan_required'
      if (body?.error === 'not_in_beta') return 'not_in_beta'
      // server/src/auth.ts returns this 403 when the authenticated device isn't among the
      // N oldest machines the plan's device cap allows. A perfectly valid token — the
      // account just registered one machine too many — so this must NOT count toward
      // consecutiveAuthFailures/authBlocked any more than plan_required or not_in_beta do.
      // Otherwise the extra machine reads "your credentials are revoked" and the daemon
      // stops retrying — even after a slot frees up, since authBlocked only clears on
      // onNetworkRegain(), not on its own.
      if (body?.error === 'device_limit_reached') return 'device_limit'
    } catch {
      // Not JSON, or no body at all — treat like any other unrecognized 401/403.
    }
    return 'unauthorized'
  }

  push(): Promise<void> {
    // Dedupe concurrent callers onto the same in-flight request.
    if (this.pushInFlight) return this.pushInFlight
    const run = this.doPush().finally(() => {
      this.pushInFlight = null
      this.soltarCandadoSiQuedoOcioso()
    })
    this.pushInFlight = run
    return run
  }

  private async doPush(): Promise<void> {
    // §6.3, antes de cualquier red: si otro tiene el candado, no sale nada. Las
    // mutaciones quedan en el `mutation_log` y las empuja quien lo tenga.
    if (!this.meTocaSincronizar()) return
    const { store, getSyncBaseUrl, getToken, isOnline } = this.deps
    // La cuenta con la que ESTE push sale. Si cambia en vuelo, el orquestador ya CERRÓ el
    // store viejo, así que `markPushed` sobre él tira "The database connection is not open"
    // — y como el `catch` también escribe en ese store, la excepción se escaparía de
    // `doPush`: `push()` rechaza, el estado queda en `syncing` para siempre y, con el
    // llamador `void this.push()`, es una unhandled rejection.
    const generacionAlSalir = this.generacionDeStore
    if (this.authBlocked) return // gate every entry point, not just the backoff chain
    if (!isOnline()) {
      this.setStatus('paused', 'offline')
      return
    }
    const url = getSyncBaseUrl()
    const token = getToken()
    if (!url || !token) return

    const pending = store.pendingMutations(PUSH_BATCH_SIZE)
    if (pending.length === 0) {
      this.setStatus('idle')
      return
    }

    // Fallar CERRADO. Si la cuenta tiene el cifrado activo y esta máquina no tiene la clave,
    // no se sube nada: subir en claro a una nube que el usuario cree cifrada es peor que no
    // sincronizar. La cola espera — nada se pierde — y el estado lo dice para que la UI pueda
    // ofrecer autorizar la máquina o usar el código de recuperación.
    /**
     * Antes de decidir si hay que cifrar, hay que SABER si la cuenta cifra. `push()` tiene
     * llamadores que no pasan por el drain —`scheduleMutationPush()` en cada escritura del
     * MCP, y `onQuit()`— así que el primer push de la sesión puede llegar acá antes del primer
     * `status`. `status()` dedupea por `statusInFlight`, así que si el drain ya lo disparó
     * esto se cuelga del mismo request en vez de hacer uno nuevo.
     *
     * Si el status falla, el push ESPERA. Seguir no ganaría nada —si el servicio está caído
     * el push falla igual— y el caso que importa es el otro: un 502 en el status (un
     * redeploy) y un push que sí entra, en una máquina que todavía no aprendió la época,
     * subiría título y contenido en claro a una cuenta cifrada. Esperar no pierde nada: la
     * cola es durable y el próximo drain vuelve a pedir el status.
     *
     * Sólo cuando hay gate que armar. Sin `isEncryptionExpected` cableado no hay nada que
     * saber —`seEsperaCifrado` sería false igual, más abajo— así que pedir un status sería
     * una request por nada. En la app real `main.ts` siempre lo pasa.
     */
    // También con filas de EQUIPO pendientes, haya o no gate personal cableado (el
    // paquete portátil no lo cablea): no se puede decidir sobre una fila de equipo sin saber
    // si su equipo cifra, y eso lo dice el status.
    const hayDeEquipo = pending.some((m) => {
      try { return (JSON.parse(m.payload) as { scope?: unknown }).scope === 'team' } catch { return false }
    })
    if (!this.primerStatusOk && (this.deps.isEncryptionExpected || hayDeEquipo)) {
      await this.status()
      // Cubre también el swap de cuenta durante la espera: `setStore` lo vuelve a false y un
      // status que vuelve con otra generación no lo levanta. Sin esto el gate leería
      // `knownKeyEpoch()` del store ya cerrado, fuera del `try`, y `push()` rechazaría.
      if (!this.primerStatusOk) return
    }

    /**
     * La pregunta es "¿tengo la maestra VIGENTE?", no "¿tengo UNA?". Rotar sube la época y
     * borra las envolturas (`delete from key_wraps` en el servidor), así que una máquina que
     * se quedó con la maestra anterior pasaría un gate que sólo mirara si hay maestra: subiría
     * filas que NINGUNA otra máquina puede abrir, con estado `idle` y sin un solo aviso. El
     * servidor no lo frena —no mira la época de los sobres—, así que es acá o en ningún lado.
     *
     * Es `<` y no `!==`: una maestra MÁS nueva que la época recordada no es un peligro, es un
     * store que todavía no se enteró (la época recordada sólo sube, ver `rememberKeyEpoch`).
     *
     * Los tres caminos que guardan una maestra (activar, adoptar, recuperar) guardan su época
     * al lado, así que `keyEpoch` es confiable acá.
     */
    const seEsperaCifrado = this.deps.isEncryptionExpected?.() ?? false
    const contexto = this.deps.getEnvelopeContext?.() ?? null
    if (seEsperaCifrado && (!contexto || contexto.keyEpoch < store.knownKeyEpoch())) {
      this.setStatus('error', 'needs_key')
      return
    }

    /**
     * Spec §9.4 — el gate fail-closed del push de EQUIPO. Una fila `scope: 'team'`
     * de un equipo que cifra, sin su clave en este device, NO sale: `sealMutationPayload` la
     * devolvería tal cual (en claro), indistinguible para el servidor de un equipo que nunca
     * cifró. Se RETIENE con `blockMutations` (mismo mecanismo reversible que
     * `project_not_shared_with_team`): no vuelve en cada ciclo, no frena al resto del lote, y
     * `onTeamKeysChanged()` la libera cuando la clave entra.
     *
     * El equipo sale de `projects.team_id` LOCAL a propósito: quien sube una fila de equipo es
     * quien compartió el proyecto, y `doStatus` lo mantiene al día desde el roster. Sin
     * `team_id` local, la fila sigue: o el servidor la rechaza (`project_not_shared_with_team`)
     * o, si está compartida desde otra máquina, su propio gate (`team_encryption_required`)
     * no la guarda.
     */
    const equiposCifrados = new Set(store.encryptedTeamIds?.() ?? [])
    const retenidas: Array<{ seq: number; reason: string }> = []
    const aSubir = equiposCifrados.size === 0 ? pending : pending.filter((m) => {
      let p: Record<string, unknown>
      try { p = JSON.parse(m.payload) as Record<string, unknown> } catch { return true }
      if (p.scope !== 'team') return true
      const projectKey = (p.project_key as string | undefined) ?? GLOBAL_PROJECT_KEY
      const teamId = store.teamIdForProjectKey(projectKey)
      if (!teamId || !equiposCifrados.has(teamId)) return true
      if (contexto?.teamKeys?.(projectKey)) return true
      retenidas.push({ seq: m.seq, reason: 'team_key_missing' })
      return false
    })
    if (retenidas.length > 0) store.blockMutations(retenidas)
    if (aSubir.length === 0) {
      this.setStatus('idle')
      // Lo retenido ya no vuelve en pendingMutations(): si quedaba otra cosa detrás, se sigue.
      // `setImmediate` por lo mismo que el encadenado de lotes de más abajo.
      if (retenidas.length > 0 && store.pendingMutationCount() > 0) {
        setImmediate(() => { if (!this.swapping) void this.push() })
      }
      return
    }

    this.setStatus('syncing')
    // Disarmed in this try's `finally`, i.e. only AFTER `response.json()` has
    // consumed the body — see fetchWithTimeout().
    let release: (() => void) | null = null
    try {
      const deviceId = this.deps.getDeviceId()
      // The cloud display_name: the edge function reads `payload.project_display_name`
      // (supabase/functions/memory-sync/index.ts, push handler) and without it falls back
      // to the raw project_key hash. store.save()/appendMutation() persist a plain
      // ObservationRow snapshot with no display-name field, so it's resolved HERE, at push
      // time, rather than by threading displayName through save()/applyRowUpdate/insertRow and
      // re-serializing every queued mutation_log payload: a project's display name can
      // change locally (rename, or ensureProject learning a remote_url later) after a
      // mutation was already queued, and a push-time join against the CURRENT
      // `projects` table is always fresh, whereas a value baked in at save() time could
      // go stale while still sitting in the offline queue. One listProjects() call per
      // batch is a single indexed-PK read per row, not a per-mutation query.
      const displayNameByProjectKey = new Map(store.listProjects().map((p) => [p.projectKey, p.displayName]))
      const { response, release: releaseTimer } = await this.fetchWithTimeout(`${url}/v1/sync/push`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: deviceId,
          mutations: aSubir.map((m: MutationLogRow) => {
            const payload = JSON.parse(m.payload) as Record<string, unknown>
            const projectKey = (payload.project_key as string | undefined) ?? GLOBAL_PROJECT_KEY
            // `source_ref` carries an absolute path with the user's real name
            // (memory-importers/markdown.ts) and the server doesn't even store it — it
            // would only end up in the logs of whatever proxy sits in between. Pruned
            // here, the end that controls the wire.
            const { source_ref: _dropped, ...rest } = payload
            // El cifrado va ULTIMO en la cadena, despues de la redaccion de secretos (que
            // corre en `save()`, del lado local) y despues del join del display name: si
            // fuera antes, cifrariamos un texto que la redaccion todavia no limpio, o
            // pisariamos con un nombre en claro un campo ya sellado.
            const enClaro = {
              ...rest,
              // `?? []`, not `?? null`: the push RPC does `tags = COALESCE(v_payload->'tags',
              // '[]'::jsonb)` (supabase/migrations/20260730000000_nest_memory.sql) using `->`,
              // which yields jsonb, not text. A present key holding JSON `null` is a jsonb null
              // *scalar*, not SQL NULL, so COALESCE never fires and the column would silently
              // store `null` instead of `[]` — contradicting its own `NOT NULL DEFAULT '[]'`.
              // Sending `[]` here matches what COALESCE would have produced without depending
              // on it firing, and keeps the key always present with the shape the wire expects.
              tags: normalizeTags(payload.tags) ?? [],
              project_display_name: displayNameByProjectKey.get(projectKey) ?? projectKey,
            }
            // `m.sync_id` y `payload.sync_id` NO se tocan: el ack del servidor se resuelve
            // por `sync_id` (`resultBySyncId`, mas abajo), asi que cifrarlo dejaria toda
            // mutacion sin acuse y la cola creceria para siempre.
            return {
              seq: m.seq,
              sync_id: m.sync_id,
              op: m.op,
              payload: sealMutationPayload(this.deps.getEnvelopeContext?.() ?? null, enClaro),
            }
          }),
        }),
      })
      release = releaseTimer

      if (response.status === 401 || response.status === 403) {
        const code = await this.classifyAuthFailure(response)
        if (code === 'plan_required') {
          // spec §9.3: the token is fine — the account's plan just doesn't include cloud
          // sync. NOT an auth failure: must not touch consecutiveAuthFailures/authBlocked,
          // or the daemon would stay dead (the authBlocked gate at every entry point)
          // even after the user upgrades, until the app is restarted. Leaving authBlocked
          // false keeps every trigger — the interval, window focus, on-write debounce,
          // pane exit — retrying normally, so sync resumes on its own the moment the
          // server starts accepting again, no restart required.
          this.setStatus('plan_required')
          return
        }
        if (code === 'not_in_beta') {
          // Also not a credential problem (spec §9.1's single-account allowlist), but
          // unlike plan_required there is nothing in the UI the user can click to fix it
          // — only an operator adding a row server-side helps. So this doesn't get its
          // own DaemonStatus; it stays a generic 'error' but with a distinct detail
          // ('not_in_beta', not 'auth'). What matters most: it must NOT touch the auth
          // breaker either. A perfectly valid token must never read to the user (or to
          // this daemon's own retry logic) as "your credentials are revoked" — it just
          // keeps quietly retrying on the normal interval until the allowlist changes.
          this.setStatus('error', 'not_in_beta')
          return
        }
        if (code === 'device_limit') {
          // Same shape as not_in_beta — no click-to-fix affordance in this UI (that would
          // be "remove another device"), so this stays a
          // generic 'error' with its own detail. Must not touch the auth breaker: the
          // token is fine, the account just has one machine too many registered, and a
          // freed slot should resume sync on its own via status()'s unblock check — not
          // require the user to notice "credentials revoked" and manually reconnect.
          this.setStatus('error', 'device_limit')
          return
        }
        this.consecutiveAuthFailures += 1
        if (this.consecutiveAuthFailures >= 3) {
          this.authBlocked = true
          this.setStatus('error', 'auth')
          return // stop retrying until the user acts, per §4.1
        }
        this.scheduleBackoffRetry(() => void this.push())
        return
      }
      if (!response.ok) throw new Error(`push failed: ${response.status}`)

      this.consecutiveAuthFailures = 0
      this.backoff.reset()
      const body = (await response.json()) as { results?: PushResultItem[] }
      // Si la cuenta cambió mientras esta respuesta viajaba, los recibos son de la cola de la
      // cuenta ANTERIOR y su store ya no está abierto. Se descartan: las mutaciones quedan
      // pendientes ahí, y el push es idempotente por `(device_id, seq)` del lado del
      // servicio, así que reintentarlas cuando se vuelva a esa cuenta no duplica nada.
      if (generacionAlSalir !== this.generacionDeStore) {
        this.setStatus('idle')
        return
      }
      const results = body.results ?? []

      // Per §4.2: accepted mutations are marked pushed. A rejected one is TERMINAL or
      // REVERSIBLE (see REVERSIBLE_REJECTIONS above) — terminal is marked pushed too, with
      // the reason, so it doesn't loop forever; reversible is blocked instead of marked pushed, so it
      // isn't discarded. A mutation with NO matching result (the whole call errored before
      // reaching it, or the server response is malformed) is left in the queue for retry.
      const resultBySyncId = new Map(results.map((r) => [r.sync_id, r]))
      const toMark: Array<number | { seq: number; error?: string | null }> = []
      const toBlock: Array<{ seq: number; reason: string }> = []
      // ¿Este push cambió el roster? Ver `rosterQuedoViejo` más abajo.
      const rosterConocido = this.lastCloudProjectKeys === null ? null : new Set(this.lastCloudProjectKeys)
      let aceptoUnProyectoNuevo = false
      let recibioElTope = false
      for (const m of aSubir) {
        let payloadSyncId: string | undefined
        let payloadProjectKey: string = GLOBAL_PROJECT_KEY
        try {
          const p = JSON.parse(m.payload) as { sync_id?: string; project_key?: string }
          payloadSyncId = p.sync_id
          payloadProjectKey = p.project_key ?? GLOBAL_PROJECT_KEY
        } catch { /* leave undefined */ }
        const result = payloadSyncId ? resultBySyncId.get(payloadSyncId) : undefined
        if (!result) continue // not acknowledged by the server — retry next cycle
        if (result.outcome !== 'rejected') {
          if (rosterConocido && payloadProjectKey !== GLOBAL_PROJECT_KEY && !rosterConocido.has(payloadProjectKey)) {
            aceptoUnProyectoNuevo = true
          }
          toMark.push(m.seq)
          continue
        }
        const reason = result.error ?? 'rejected'
        if (reason === MOTIVO_TOPE_DE_PROYECTOS) recibioElTope = true
        if (reason === 'team_encryption_required') {
          // El servidor acaba de decir que el equipo de este proyecto cifra. Se aprende como
          // CONFIRMADO (viene del servidor, no de una inferencia) y la fila queda retenida por
          // el gate (`team_key_missing`): si no, cada liberación (`onTeamKeysChanged`, un
          // share aprendido) la volvería a mandar en claro por TLS para que el servidor la
          // rechazara otra vez. Sin `team_id` local no hay equipo que anotar:
          // queda como rechazo, y el roster del próximo status la devuelve al gate.
          let pk = GLOBAL_PROJECT_KEY
          try { pk = (JSON.parse(m.payload).project_key as string | undefined) ?? GLOBAL_PROJECT_KEY } catch { /* default */ }
          const teamId = store.teamIdForProjectKey(pk)
          if (teamId) {
            store.rememberEncryptedTeams?.([teamId])
            toBlock.push({ seq: m.seq, reason: 'team_key_missing' })
            continue
          }
        }
        if (REVERSIBLE_REJECTIONS.has(reason)) toBlock.push({ seq: m.seq, reason })
        else toMark.push({ seq: m.seq, error: reason })
      }
      store.markPushed(toMark)
      store.blockMutations(toBlock)

      store.setSyncState('__account__', { lastSuccessAt: Date.now(), lastError: null })
      this.setStatus('idle')

      /**
       * En el drain del connect el status corre ANTES del push, así que un Free que conecta con
       * 2+ repos tendría el roster vacío hasta el próximo poll (15 min en Free): «0 of 1 · Local
       * only: api, web» con un repo ya en la nube. Se pide un
       * status sólo cuando el push CAMBIÓ el roster: aceptó un proyecto que el roster no tenía,
       * o recibió `project_limit_reached` con un roster que todavía no llega al tope (o sea,
       * viejo). Un rechazo con el roster ya en el tope no enseña nada: no se pide nada.
       */
      const tope = this.lastLimits?.max_projects
      const rosterQuedoViejo = aceptoUnProyectoNuevo ||
        (recibioElTope && tope !== undefined && (rosterConocido === null || rosterConocido.size < tope))
      if (rosterQuedoViejo && !this.swapping) {
        await this.status()
        // Esperar al status abre una ventana para un swap de cuenta: el encadenado de abajo
        // leería `pendingMutationCount()` del store viejo, ya cerrado.
        if (generacionAlSalir !== this.generacionDeStore) return
      }

      // Per §4 the daemon *drains* the queue, not one batch per trigger: without chaining, a
      // full PUSH_BATCH_SIZE batch would sit idle until the NEXT external trigger (5-min
      // interval, a fresh mutation debounce, etc.), and a large initial migration would take
      // tens of minutes. Chain the next batch immediately, but only when THIS batch made real
      // progress (`toMark` or `toBlock` non-empty, i.e. the server acknowledged at least
      // one mutation either way) — chaining on a zero-progress response (malformed body /
      // nothing matched) would hot-loop the same unacknowledged batch against the server
      // instead of leaving it to the existing retry/backoff path. `toBlock` counts as
      // progress too: if this whole batch got blocked by ONE project's limit,
      // there may still be pendingMutationCount() > 0 left over from OTHER projects that
      // have nothing to do with that limit — worth draining right away rather than waiting
      // for the next external trigger. `setImmediate` (not `queueMicrotask`) is deliberate:
      // doPush() is still executing here, so `push()`'s `.finally` hasn't cleared
      // `pushInFlight` yet — a microtask-scheduled call lands BEFORE that `.finally` runs
      // (queued earlier in the same microtask flush) and would see pushInFlight still set,
      // silently deduping into a no-op. A macrotask runs after the entire microtask
      // queue (including that `.finally`) has drained, so by the time it fires
      // pushInFlight is guaranteed clear and the chained push() actually starts a new
      // request instead of returning the just-finished promise.
      if ((toMark.length > 0 || toBlock.length > 0) && store.pendingMutationCount() > 0) {
        // This macrotask can still fire AFTER pause()'s drain-wait already
        // observed pushInFlight settle (the .finally() that clears pushInFlight runs as a
        // microtask before this setImmediate's macrotask does — see the comment above
        // for why this is a macrotask at all) but BEFORE the swap actually closes/renames
        // the store. Re-check swapping here, at the moment this callback actually runs, not
        // just at schedule time — a swap started in that exact window must not have this
        // chained push slip through against a store that's mid-swap.
        setImmediate(() => {
          if (this.swapping) return
          void this.push()
        })
      }
    } catch (err) {
      // Anotar el error NO puede ser lo que tumbe el push: si el store se cerró en el medio
      // (swap de cuenta), este `setSyncState` lanza y la excepción original se perdería
      // reemplazada por una de SQLite, escapándose del catch que existe para contenerla.
      try {
        store.setSyncState('__account__', { lastError: err instanceof Error ? err.message : String(err) })
      } catch { /* el store de la cuenta anterior ya no está: el error igual se reporta abajo */ }
      this.setStatus('error', err instanceof Error ? err.message : String(err))
      this.scheduleBackoffRetry(() => void this.push())
    } finally {
      release?.()
    }
  }

  /**
   * spec §5.3.1: the ONLY place a device can learn a project exists. `handlePull` returns
   * rows only for cursors the device already sent — correct, deliberate, and it's what
   * prevents the pull hot loop (see doPull's own `cursors` comment below) — so a project this
   * device has never seen locally can never appear in a pull response no matter how long
   * it waits, and a freshly installed device with an empty `projects` table would pull
   * nothing, forever, with no error and no symptom. `status()` closes that from the other
   * end: it fetches the account's roster (project keys and display names, never rows) and
   * registers anything not already known via `store.ensureProject()`. That project then
   * has a sync_state cursor of 0 and shows up in `store.listProjects()` — and therefore in
   * doPull()'s `cursors` — on the very next pull. No row is ever handed back for a cursor
   * the device didn't ask for, so nothing here reintroduces that hot loop.
   *
   * Uses the same fetchWithTimeout() push/pull already go through, so a hung status
   * endpoint can't wedge the daemon any differently than a hung push or pull could.
   */
  status(): Promise<StatusResponseBody | null> {
    // Same in-flight dedupe/tracking shape as push()/pull() — see statusInFlight's own
    // comment for why pause() needs it.
    if (this.statusInFlight) return this.statusInFlight
    const run = this.doStatus().finally(() => { this.statusInFlight = null })
    this.statusInFlight = run
    return run
  }

  /**
   * Spec 2b-2 §4.7/§4.8 (D14): elige qué proyecto sigue sincronizando quien quedó por encima
   * del tope. Al volver ok, lo retenido por `project_limit_reached` vuelve a la cola —el recién
   * elegido lo tenía retenido— y el push re-retiene lo que siga fuera; después se pide un
   * status para que la UI vea la elección. Nunca lanza.
   */
  async keepProject(projectKey: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const { getSyncBaseUrl, getToken, isOnline } = this.deps
    // Misma guarda que doStatus. Si la cuenta cambia mientras vuela el pedido, la
    // respuesta es de la cuenta anterior: no se toca la cola ni se pide status del store nuevo.
    const generacionAlSalir = this.generacionDeStore
    const url = getSyncBaseUrl()
    const token = getToken()
    if (!url || !token) return { ok: false, error: 'not_connected' }
    if (!isOnline()) return { ok: false, error: 'offline' }

    let release: (() => void) | null = null
    try {
      const { response, release: releaseTimer } = await this.fetchWithTimeout(`${url}/v1/projects/keep`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_key: projectKey }),
      })
      release = releaseTimer
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: unknown } | null
        return { ok: false, error: typeof body?.error === 'string' ? body.error : `HTTP ${response.status}` }
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      release?.()
    }

    if (generacionAlSalir !== this.generacionDeStore) return { ok: false, error: 'account_changed' }
    this.deps.store.unblockMutations([MOTIVO_TOPE_DE_PROYECTOS])
    // Un status que ya volaba salió ANTES de la elección y trae el elegido viejo: colgarse de
    // ese (el dedupe de `status()`) dejaría la UI con el proyecto anterior pegado hasta el
    // próximo poll. Se lo espera y se pide uno nuevo, que ya ve lo que el servidor guardó.
    if (this.statusInFlight) await this.statusInFlight.catch(() => null)
    // Esperar abre otra ventana para un cambio de cuenta: la elección ya quedó guardada en el
    // servidor, pero el status y el push serían del store nuevo.
    if (generacionAlSalir !== this.generacionDeStore) return { ok: true }
    await this.status()
    this.scheduleMutationPush()
    return { ok: true }
  }

  /**
   * Spec 2b-3: las máquinas de la cuenta (GET /v1/devices) para Settings › Account. Mismo
   * esqueleto que keepProject: si la cuenta cambia mientras vuela, la lista es de la anterior.
   * Nunca lanza.
   */
  async listDevices(): Promise<{ ok: true; devices: MaquinaDeLaCuenta[] } | { ok: false; error: string }> {
    const { getSyncBaseUrl, getToken, isOnline } = this.deps
    const generacionAlSalir = this.generacionDeStore
    const url = getSyncBaseUrl()
    const token = getToken()
    if (!url || !token) return { ok: false, error: 'not_connected' }
    if (!isOnline()) return { ok: false, error: 'offline' }

    let release: (() => void) | null = null
    try {
      const { response, release: releaseTimer } = await this.fetchWithTimeout(`${url}/v1/devices`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      })
      release = releaseTimer
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: unknown } | null
        return { ok: false, error: typeof body?.error === 'string' ? body.error : `HTTP ${response.status}` }
      }
      const body = (await response.json().catch(() => null)) as { devices?: unknown } | null
      if (generacionAlSalir !== this.generacionDeStore) return { ok: false, error: 'account_changed' }
      const crudas = Array.isArray(body?.devices) ? (body.devices as Record<string, unknown>[]) : []
      const devices: MaquinaDeLaCuenta[] = crudas.map((d) => {
        const visto = typeof d.last_seen_at === 'string' ? Date.parse(d.last_seen_at) : NaN
        return {
          id: String(d.id),
          name: String(d.name ?? ''),
          platform: typeof d.platform === 'string' ? d.platform : null,
          lastSeenAt: Number.isFinite(visto) ? visto : null,
          current: d.current === true,
        }
      })
      return { ok: true, devices }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      release?.()
    }
  }

  /**
   * Spec 2b-3: revoca otra máquina de la cuenta por id (POST /v1/devices/revoke). El servidor
   * rechaza la propia con `use_self_revoke`. Nunca lanza.
   */
  async revokeDevice(deviceId: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const { getSyncBaseUrl, getToken, isOnline } = this.deps
    const generacionAlSalir = this.generacionDeStore
    const url = getSyncBaseUrl()
    const token = getToken()
    if (!url || !token) return { ok: false, error: 'not_connected' }
    if (!isOnline()) return { ok: false, error: 'offline' }

    let release: (() => void) | null = null
    try {
      const { response, release: releaseTimer } = await this.fetchWithTimeout(`${url}/v1/devices/revoke`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      })
      release = releaseTimer
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: unknown } | null
        return { ok: false, error: typeof body?.error === 'string' ? body.error : `HTTP ${response.status}` }
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      release?.()
    }
    if (generacionAlSalir !== this.generacionDeStore) return { ok: false, error: 'account_changed' }
    return { ok: true }
  }

  private async doStatus(): Promise<StatusResponseBody | null> {
    const { store, getSyncBaseUrl, getToken, isOnline } = this.deps
    // Misma razón que en doPush: `unblockMutations` y `ensureProject` escriben, y el store
    // de la cuenta anterior está cerrado para cuando vuelve esta respuesta.
    const generacionAlSalir = this.generacionDeStore
    if (this.authBlocked) return null // gate every entry point, not just push/pull
    if (!isOnline()) return null
    const url = getSyncBaseUrl()
    const token = getToken()
    if (!url || !token) return null

    let release: (() => void) | null = null
    try {
      const { response, release: releaseTimer } = await this.fetchWithTimeout(`${url}/v1/sync/status`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      })
      release = releaseTimer

      if (response.status === 401 || response.status === 403) {
        const code = await this.classifyAuthFailure(response)
        if (code === 'plan_required') {
          // See doPush()'s identical branch — not an auth failure, breaker untouched.
          this.setStatus('plan_required')
          return null
        }
        if (code === 'not_in_beta') {
          // See doPush()'s identical branch — not a credential problem, breaker untouched.
          this.setStatus('error', 'not_in_beta')
          return null
        }
        if (code === 'device_limit') {
          // See doPush()'s identical branch — not a credential problem, breaker untouched.
          this.setStatus('error', 'device_limit')
          return null
        }
        // Feeds the SAME shared counter/flag doPush() trips on 401/403, rather than
        // keeping an independent one — status() must not gate push/pull any differently
        // than a push auth failure already does, and both push() and pull() already check
        // this exact flag at entry.
        this.consecutiveAuthFailures += 1
        if (this.consecutiveAuthFailures >= 3) {
          this.authBlocked = true
          this.setStatus('error', 'auth')
        }
        return null
      }
      if (!response.ok) return null

      const body = (await response.json()) as StatusResponseBody
      this.consecutiveAuthFailures = 0
      // El roster y los desbloqueos son de la cuenta que hizo el pedido. Se devuelve el body
      // —el llamador puede querer el plan o la cuota— pero no se escribe nada en un store
      // que ya no es el de esta cuenta.
      if (generacionAlSalir !== this.generacionDeStore) return body

      /**
       * ACÁ se arma el gate fail-closed del push, y tiene que ser acá.
       *
       * Las otras señales —los handlers de la tarjeta de cifrado, que sólo corren si el
       * usuario ABRE el overlay Memories, y `applyPulledRow` al ver una fila que no se puede
       * abrir— no corren en el camino normal de una máquina que todavía no tiene la clave.
       * Sin esto el gate no se arma y el push sube título y contenido EN CLARO a una cuenta
       * cifrada, con estado `idle`.
       *
       * Y no es una carrera: activar el cifrado no re-cifra lo ya subido, así que una cuenta
       * que venía sincronizando en claro deja al servidor lleno de filas legibles — la segunda
       * máquina nunca baja algo que no pueda abrir y la época se quedaría en 0 para siempre.
       *
       * `status` es el único camino que corre en TODO drain, antes del pull y del push.
       *
       * Un campo AUSENTE es un servicio viejo y significa "no sé", que no es lo mismo que
       * "0 = no cifra": se deja el valor que hubiera, para no desarmar un gate que otra señal
       * ya armó.
       */
      if (typeof body.key_epoch === 'number' && body.key_epoch > 0) {
        this.deps.store.rememberKeyEpoch(body.key_epoch)
      }
      this.primerStatusOk = true

      this.applyPollInterval(body.next_poll_ms)

      // Re-admit mutations blocked by a REVERSIBLE server rejection once the limit
      // that caused it no longer applies — see doPush()'s REVERSIBLE_REJECTIONS split.
      //
      // project_limit_reached can't be evaluated from numbers the client has: it doesn't
      // know the new plan's project cap, only that the plan CHANGED. So any plan change
      // (skipped on the very first status() response, where "changed" is meaningless)
      // unblocks it unconditionally — worst case the next push is rejected again and
      // re-blocks it, which is a wasted request, not a correctness problem.
      //
      // quota_exceeded IS a number the client has: `used_bytes < max_bytes` is checked
      // fresh on every status() response, plan change or not, rather than piggybacking on
      // the plan-change branch — an upgrade's relief shows up here automatically once the
      // server reports the new max_bytes, and deleting old memories to free space (with no
      // plan change at all) has to work exactly the same way.
      //
      // `project_not_shared_with_team` viaja con project_limit_reached por la misma razon:
      // el cliente no puede evaluarlo con numeros propios (el status roster no dice que
      // proyectos estan compartidos), y un cambio de plan es justo cuando una cuenta pasa
      // a poder compartir. El otro camino de desbloqueo —el directo— es el handler
      // `memory:shareProjectWithTeam` de main.ts, que desbloquea apenas el share vuelve ok.
      if (typeof body.plan === 'string') {
        if (this.lastSeenPlan !== undefined && body.plan !== this.lastSeenPlan) {
          store.unblockMutations(['project_limit_reached', 'project_not_shared_with_team'])
        }
        this.lastSeenPlan = body.plan
      }
      if (body.quota) {
        this.lastQuota = body.quota
        if (body.quota.used_bytes < body.quota.max_bytes) {
          store.unblockMutations(['quota_exceeded'])
        }
      }
      // Spec 2b-1 §4.2. Un campo ausente o roto es "no vino": se conserva el último conocido.
      const maxProjects = body.limits?.max_projects
      if (typeof maxProjects === 'number' && Number.isFinite(maxProjects) && maxProjects >= 0) {
        this.lastLimits = { max_projects: maxProjects }
      }
      // Spec 2b-2 §4.7. Un campo ausente es un servicio viejo: se conserva lo conocido.
      if (body.kept_project_key === null || typeof body.kept_project_key === 'string') {
        this.lastKeptProjectKey = body.kept_project_key
      }
      if (typeof body.over_limit === 'boolean') this.lastOverLimit = body.over_limit

      // A missing `projects` field means "no discovery available" — an older service, or
      // the pre-roster stub — not an error. Nothing to register, not a failure.
      if (Array.isArray(body.projects)) {
        // Spec 2b-1 §4.4: qué proyectos ocupan lugar en la nube. `__global__` no cuenta contra el
        // tope (server/src/push.ts), así que tampoco se muestra.
        this.lastCloudProjectKeys = body.projects
          .map((p) => p?.project_key)
          .filter((k): k is string => typeof k === 'string' && k !== '' && k !== GLOBAL_PROJECT_KEY)
        const known = new Set(store.listProjects().map((p) => p.projectKey))
        let aprendioUnShare = false
        for (const project of body.projects) {
          const projectKey = project?.project_key
          if (typeof projectKey !== 'string' || projectKey === '') continue
          // Espejo de `projects.team_id` del servidor. Sin esto, la OTRA máquina de quien
          // compartió nunca sabría a qué equipo van sus filas de equipo: las sellaría sin
          // clave (en claro) aunque tuviera la de equipo. Sólo se escribe si cambió (un roster
          // que no cambia sigue haciendo CERO escrituras por tick), y nunca se pisa con null:
          // dejar de compartir no existe en v1, y bajar a null desarmaría el gate. Va también
          // para los proyectos ya conocidos: el caso que importa es justo uno conocido.
          const teamIdRemoto = typeof project.team_id === 'string' && project.team_id !== '' ? project.team_id : null
          const aprenderShare = (): void => {
            if (teamIdRemoto && store.teamIdForProjectKey(projectKey) !== teamIdRemoto) {
              store.setLocalTeamId(projectKey, teamIdRemoto)
              aprendioUnShare = true
            }
          }
          if (known.has(projectKey)) { aprenderShare(); continue }
          // ensureProject() is itself idempotent, but the `known` check above means an
          // unchanging roster does ZERO writes per tick after the first, not just zero
          // EFFECTIVE ones — so a roster that never changes can't turn this into a
          // repeated-write (or repeated-pull) loop of its own.
          /**
           * El nombre que devuelve el servidor puede venir CIFRADO (`project_display_name`
           * está en `SEALED_FIELDS`), y desde acá NO se puede abrir:
           * el AAD ata cada ciphertext a SU observación (`fieldAad(syncId, field)`) y el
           * roster no trae ningún `sync_id`. Así que cuando viene cifrado se usa la
           * `project_key`, que es un hash pero es verdad.
           *
           * Sin esto, una máquina que todavía no conocía ese proyecto —una segunda PC, o la
           * misma después de un wipe— crearía el proyecto local llamado `nmc1:pQx8…`: el
           * usuario vería eso en la UI en lugar del nombre de su repo, y en el push siguiente
           * ese string se volvería a cifrar sobre sí mismo. Cada ciclo agregaría una capa.
           */
          const nombreRemoto = typeof project.display_name === 'string' ? project.display_name : ''
          const displayName = nombreRemoto && !isCiphertext(nombreRemoto) ? nombreRemoto : projectKey
          store.ensureProject({ projectKey, displayName })
          known.add(projectKey)
          aprenderShare()
        }
        // Compartido desde otra máquina: lo retenido por `project_not_shared_with_team` ya
        // aplica. Y `team_encryption_required` también vuelve a la cola: con el `team_id`
        // local al día, el gate de `doPush` la sella o la retiene como `team_key_missing`.
        if (aprendioUnShare) store.unblockMutations(['project_not_shared_with_team', 'team_encryption_required'])
      }

      /**
       * El destrabe por cambio de plan (más arriba) sólo ve un cambio que
       * ocurre DENTRO de este proceso. Un Free que paga Cloud y reinicia Nest, o que cambia a
       * una cuenta que ya es Cloud, arranca con `lastSeenPlan` undefined: el primer status no
       * cuenta como cambio y lo retenido por el tope quedaría retenido para siempre.
       *
       * Con el tope que informa el servidor no hace falta adivinar: si el roster (sin
       * `__global__`, que no ocupa lugar) tiene menos proyectos que el tope, hay lugar y lo
       * retenido vuelve a la cola. Converge solo: el push siguiente ocupa el lugar, el status
       * que le sigue ve el roster en el tope y deja de destrabar. Sin tope conocido (servicio
       * viejo) queda sólo el camino del cambio de plan.
       */
      const tope = this.lastLimits?.max_projects
      const roster = this.lastCloudProjectKeys
      if (tope !== undefined && roster !== null && roster.length < tope) {
        store.unblockMutations([MOTIVO_TOPE_DE_PROYECTOS])
      }

      // Spec §9.4: qué equipos cifran, sin depender de que se abra la UI.
      if (Array.isArray(body.encrypted_teams)) {
        const equipos = body.encrypted_teams
          .filter((t): t is { team_id: string; has_wrap: boolean } => typeof t?.team_id === 'string' && t.team_id !== '')
          .map((t) => ({ teamId: t.team_id, hasWrap: t.has_wrap === true }))
        // El campo presente es la fuente de verdad. Lo que lista queda confirmado para
        // siempre (como `known_key_epoch`); lo inferido de filas ilegibles (provisorio) se
        // descarta. Si eso soltó algún equipo, lo que el gate retuvo por él vuelve a la cola: el
        // gate de `doPush` re-evalúa y re-retiene lo que siga aplicando.
        const soltados = store.reconcileEncryptedTeamsFromStatus?.(equipos.map((e) => e.teamId)) ?? []
        if (soltados.length > 0) store.unblockMutations(['team_key_missing'])
        const hook = this.deps.onEncryptedTeams
        if (hook && equipos.length > 0) {
          // Esperado (para que la readopción gane al pull y al push de este drain) pero con
          // tope, y sin dejar que un throw del hook se lleve puesto el status (`withTimeout`
          // nunca rechaza). Después no se escribe nada en el store, así que no hace falta
          // re-chequear la generación.
          await withTimeout(Promise.resolve().then(() => hook(equipos)), TEAM_READOPT_TIMEOUT_MS)
        }
      }

      return body
    } catch {
      // Network/timeout failure, not an auth failure — nothing to count. Quiet by design:
      // pull() runs right after this inside drain() and reports its own error state; a
      // status() that also screamed here would just be noise on top of that.
      return null
    } finally {
      release?.()
    }
  }

  /**
   * §11.4: the interval is the server's call, not a client constant. Falls back to
   * whatever is already armed (the hard-coded INTERVAL_MS the first time) when the field
   * is absent or not a positive number — an older service or the stub before it grew this
   * field must not leave the daemon with no interval at all.
   */
  private applyPollInterval(nextPollMs: unknown): void {
    if (typeof nextPollMs !== 'number' || !Number.isFinite(nextPollMs) || nextPollMs <= 0) return
    const next = Math.floor(nextPollMs)
    if (next === this.pollIntervalMs) return
    this.pollIntervalMs = next
    if (this.running) this.scheduleIntervalTimer()
  }

  pull(): Promise<void> {
    // Dedupe concurrent callers onto the same in-flight request.
    if (this.pullInFlight) return this.pullInFlight
    const run = this.doPull().finally(() => {
      this.pullInFlight = null
      this.soltarCandadoSiQuedoOcioso()
    })
    this.pullInFlight = run
    return run
  }

  private async doPull(): Promise<void> {
    // §6.3: el pull también, y no sólo por cortesía — avanza los cursores de proyecto en
    // la base. Dos procesos bajando a la vez se pisan el cursor y uno se saltea filas.
    if (!this.meTocaSincronizar()) return
    const { store, getSyncBaseUrl, getToken, isOnline } = this.deps
    // La cuenta con la que ESTE pull sale. Si cambia antes de que vuelva la respuesta, las
    // filas que traiga son de otra cuenta y no se escriben.
    const generacionAlSalir = this.generacionDeStore
    if (this.authBlocked) return // gate every entry point
    if (!isOnline()) {
      this.setStatus('paused', 'offline')
      return
    }
    const url = getSyncBaseUrl()
    const token = getToken()
    if (!url || !token) return

    // Each known local project gets its own cursor, read from and written back to its own
    // sync_state partition (keyed by project_key, matching how push() scopes mutations per
    // project). A single account-wide cursor would leave every project past the first
    // never advancing (or advance the WRONG project's cursor), silently missing its rows.
    const projects = store.listProjects()
    // spec §5.3.1: `store.listProjects()` reflects only what this device already has
    // locally, so on its own a device that has never written anything would return here
    // on every pull, forever. status() runs immediately before this, in the same drain()
    // cycle (see drain()'s own comment), and registers every project in the account's
    // roster via ensureProject() BEFORE this line runs — so a fresh device's very first
    // drain() already has a non-empty `projects` here. It stays as a real early return
    // rather than falling through to an empty-cursors request: a project-less device (one that hasn't
    // connected, or whose account genuinely has no projects yet) would otherwise send
    // `{cursors: {}}` on every pull, which the server already treats as "nothing to
    // report" (pull.ts's own `keys.length === 0` short-circuit) — so removing this line
    // would trade a local no-op for a pointless round trip that accomplishes the exact
    // same nothing, working against §11.4's whole point (~99% of pulls come back empty;
    // don't make one on purpose when it's known in advance to be empty).
    if (projects.length === 0) return

    // Capturado junto con los cursores que salen en este request: ver el chequeo al volver.
    // `?.` porque los stores falsos de los tests unitarios no lo implementan.
    const resetsAlSalir = store.pullCursorResetCount?.() ?? 0
    const cursors: Record<string, number> = {}
    for (const project of projects) {
      cursors[project.projectKey] = store.getSyncState(project.projectKey).pullCursor
    }
    // Lo que viene de proyectos de OTRA persona compartidos con un equipo lleva sus propios
    // cursores, uno por proyecto de origen. Con el cursor del proyecto solo, una memoria de
    // equipo no llegaría nunca a quien ya tuviera más memorias propias en ese repo que el
    // autor (ver `pullConCursoresDeEquipo` en server/src/pull.ts). Se manda siempre, aunque
    // esté vacío: que el campo exista es lo que le dice al servicio que este cliente los lleva.
    const teamCursors = store.getTeamCursors()

    // Disarmed in this try's `finally`, i.e. only AFTER `response.json()` has
    // consumed the body — see fetchWithTimeout().
    let release: (() => void) | null = null
    try {
      const { response, release: releaseTimer } = await this.fetchWithTimeout(`${url}/v1/sync/pull`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cursors, team_cursors: teamCursors, limit: PULL_PAGE_SIZE }),
      })
      release = releaseTimer

      if (response.status === 401 || response.status === 403) {
        const code = await this.classifyAuthFailure(response)
        if (code === 'plan_required') {
          // See doPush()'s identical branch — not an auth failure, breaker untouched.
          this.setStatus('plan_required')
          return
        }
        if (code === 'not_in_beta') {
          // See doPush()'s identical branch — not a credential problem, breaker untouched.
          this.setStatus('error', 'not_in_beta')
          return
        }
        if (code === 'device_limit') {
          // See doPush()'s identical branch — not a credential problem, breaker untouched.
          this.setStatus('error', 'device_limit')
          return
        }
        // Feeds the same shared counter/flag push()/status() use: the three entry points
        // gate identically on `authBlocked`, so they have to agree on what counts toward
        // it — three revoked-token responses from pull() alone must trip the breaker too.
        this.consecutiveAuthFailures += 1
        if (this.consecutiveAuthFailures >= 3) {
          this.authBlocked = true
          this.setStatus('error', 'auth')
        }
        return
      }
      if (!response.ok) throw new Error(`pull failed: ${response.status}`)
      const body = (await response.json()) as {
        rows: Array<Record<string, unknown>>
        cursors: Record<string, number>
        team_cursors?: Record<string, Record<string, number>>
      }
      // Si la cuenta cambió mientras esta respuesta viajaba, estas filas son de OTRA cuenta:
      // se descartan enteras. El cursor tampoco se guarda — lo que no se aplicó tiene que
      // volver a pedirse, y lo va a pedir la cuenta a la que le corresponde.
      if (generacionAlSalir !== this.generacionDeStore) {
        this.setStatus('idle')
        return
      }
      for (const raw of body.rows) this.applyPulledRow(mapRawPulledRow(raw))

      // Alguien llamó `resetPullCursors()` con este request en vuelo (adoptar o recuperar una
      // clave, ver main.ts). Los cursores de esta respuesta son relativos a los que salieron
      // ANTES del reset: escribirlos lo deshace, y el drain de quien reseteó ya se acopló a
      // este mismo pull (dedupe), así que nadie vuelve a pedir lo que se salteó por ilegible.
      // Las filas sí se aplican (el upsert por sync_id es idempotente); los cursores no, y se
      // pide un pull nuevo, que sale con los cursores en 0. `setImmediate` por lo mismo que
      // el encadenado de abajo: `pullInFlight` recién se limpia en el `.finally` de `pull()`.
      if ((store.pullCursorResetCount?.() ?? 0) !== resetsAlSalir) {
        setImmediate(() => {
          if (this.swapping) return
          void this.pull()
        })
        return
      }

      const now = Date.now()
      // Tracked while writing back cursors below — used by the chain guard further down.
      let cursorAdvanced = false
      for (const [projectKey, cursor] of Object.entries(body.cursors ?? {})) {
        if (typeof cursor === 'number') {
          if (cursor > (cursors[projectKey] ?? 0)) cursorAdvanced = true
          // Hot-loop guard: the server (supabase/functions/memory-sync/index.ts's pull
          // handler) iterates EVERY account project, not just the ones THIS device sent a
          // cursor for, and defaults an unsent cursor to 0. sync_state has no FK to
          // `projects`, so persisting the cursor alone isn't enough: without a matching
          // `projects` row, listProjects() (and therefore the cursors built at the top of
          // every doPull(), including the next chained one) never includes it, the client
          // always resends 0, `cursorAdvanced` is always true, and with >= PULL_PAGE_SIZE
          // rows in that project the page chain below loops forever re-fetching the same
          // page. Registering the project here — BEFORE persisting its cursor — makes the
          // NEXT request send the cursor, so progress persists instead of resetting.
          // ensureProject() is idempotent and inserts enrolled=1; nothing reads `enrolled`
          // as a push/pull gate (see main.ts's own ensureProject call site), so this can't
          // change sync behavior for the project once it exists.
          if (!(projectKey in cursors)) {
            store.ensureProject({ projectKey, displayName: projectKey })
          }
          store.setSyncState(projectKey, { pullCursor: cursor, lastSuccessAt: now, lastError: null })
        }
      }
      // Un servicio que todavía no los conoce no devuelve el campo, y entonces no hay nada
      // que guardar: sigue mandando lo de equipo mezclado en `cursors`, como antes.
      for (const [projectKey, porOrigen] of Object.entries(body.team_cursors ?? {})) {
        for (const [source, cursor] of Object.entries(porOrigen ?? {})) {
          if (typeof cursor !== 'number') continue
          if (cursor > (teamCursors[projectKey]?.[source] ?? 0)) cursorAdvanced = true
          store.setTeamCursor(projectKey, source, cursor)
        }
      }
      store.setSyncState('__account__', { lastSuccessAt: now, lastError: null })
      this.consecutiveAuthFailures = 0
      this.backoff.reset()

      // Same as the push side: one page (limit: PULL_PAGE_SIZE) per trigger would leave a
      // backlog bigger than a page advancing only on the NEXT external trigger (the
      // 5-minute interval), one page every 5 minutes. Chain the next pull immediately when
      // this page came back full. Not `has_more`: the memory-sync edge function's pull
      // handler always returns `has_more: false` (unused on the server) — do not trust it.
      //
      // Guard: only chain when a cursor actually advanced. The edge function loops one
      // `memory_sync_pull` RPC call per LOCAL project and concatenates every project's
      // rows into a single `body.rows` array (supabase/functions/memory-sync/index.ts's
      // pull handler) — with more than one project, `body.rows.length === PULL_PAGE_SIZE`
      // is a coincidental SUM across projects, not proof any single project's page was
      // actually full. The RPC itself (`memory_sync_pull`, nest_memory migration) returns
      // `COALESCE(max(project_seq), p_cursor)` as the new cursor, so a project's cursor can
      // only stay put when that project returned zero rows — "a project returned >0 rows"
      // and "that project's cursor advanced" are the same fact reported two different
      // ways. Comparing each response cursor against the cursor WE SENT for that project
      // (captured in `cursors` above, before the fetch) is the honest per-project check:
      // it can't be fooled by the aggregate-length coincidence, and — same reasoning as the
      // push chain — it can't hot-loop, because a response that advances no project's cursor
      // can never chain again. `setImmediate` (not `queueMicrotask`), same reason as push:
      // doPull() is still executing here, so pull()'s `.finally` hasn't cleared
      // `pullInFlight` yet — a microtask-scheduled call would run before that
      // `.finally` and see `pullInFlight` still set, silently deduping into a no-op. A
      // macrotask fires only after the microtask queue (including that `.finally`) drains.
      // `>=` y no `===`: con cursores de equipo la respuesta son dos páginas juntas (lo
      // propio y lo ajeno, cada una con su `limit`), así que una página llena de cualquiera
      // de las dos deja el total en PULL_PAGE_SIZE o más.
      if (body.rows.length >= PULL_PAGE_SIZE && cursorAdvanced) {
        // Same race as the chained push in doPush() — re-check swapping at the
        // moment this macrotask actually runs, not just at schedule time.
        setImmediate(() => {
          if (this.swapping) return
          void this.pull()
        })
      }
    } catch (err) {
      store.setSyncState('__account__', { lastError: err instanceof Error ? err.message : String(err) })
      this.setStatus('error', err instanceof Error ? err.message : String(err))
    } finally {
      release?.()
    }
  }

  /**
   * Applies one pulled row locally using the same LWW rules a Postgres-side apply would
   * use (§4.3) — exposed as its own method so tests can drive it directly with
   * synthetic rows instead of a live server.
   */
  applyPulledRow(incoming: PulledRow): void {
    const { row: abierta, undecryptable } = openPulledRow(
      this.deps.getEnvelopeContext?.() ?? null,
      incoming
    )
    if (undecryptable) {
      // NO se aplica: guardar ciphertext en la base local llenaria la busqueda FTS5 y el
      // grafo de basura ilegible. Se cuenta y se sigue — el cursor tiene que avanzar
      // igual, porque frenarlo dejaria a este device sin sincronizar NADA, ni siquiera lo
      // que si puede leer. Cuando la maquina se autorice, `resetPullCursors()` las
      // vuelve a traer.
      // Por `sync_id`: la misma fila re-pulleada no se cuenta de nuevo. `resetPullCursors`
      // vuelve a traer todo a proposito, asi que contar aplicaciones haria que el numero
      // creciera sin que hubiera una sola memoria ilegible mas.
      this.deps.store.markUndecryptable(incoming.syncId)
      /**
       * VER una fila cifrada es la prueba de que la cuenta tiene el cifrado activo, y arma el
       * fail-closed del push sin depender de nadie.
       *
       * No puede depender del handler de estado de la tarjeta, que solo corre si el usuario
       * ABRE el overlay Memories: una maquina nueva que conecta la nube corre import + drain y
       * empujaria TODO en claro a una cuenta cifrada, justo en la maquina que importa: la que
       * no tiene la clave. Esta linea corre en el mismo drain, antes del push.
       */
      if (incoming.scope === 'team') {
        // Una fila de EQUIPO ilegible no dice que la CUENTA cifre. Armar la época personal
        // dejaría a un miembro sin cifrado personal con todo el push en `needs_key` para
        // siempre. Lo de equipo lo cubre el gate de equipo de doPush.
        //
        // Y tampoco PRUEBA que el equipo de la fila cifre. Si el
        // proyecto se re-compartió de T1 (cifra) a T2 (no cifra), el pull sirve las filas
        // viejas, selladas con T1, como de T2. Con `teamId` (servicio nuevo) el status trae
        // `encrypted_teams` y ésa es la fuente de verdad: de acá no se aprende nada. Sin
        // `teamId` (servicio viejo, que tampoco manda `encrypted_teams`) es la única señal que
        // hay, y entra como PROVISORIA: arma el gate, pero el primer status que sí sepa la
        // reemplaza.
        const teamId = incoming.teamId ?? this.deps.store.teamIdForProjectKey?.(incoming.projectKey) ?? null
        if (!incoming.teamId && teamId) this.deps.store.rememberProvisionalEncryptedTeams?.([teamId])
        // De qué equipo es lo ilegible, para que adoptar la clave de OTRO no re-baje todo.
        this.deps.store.markUndecryptableTeam?.(teamId ?? '*')
      } else {
        this.deps.store.rememberKeyEpoch(Math.max(1, this.deps.getEnvelopeContext?.()?.keyEpoch ?? 0))
      }
      return
    }
    // Si esta fila estaba marcada como ilegible y ahora abrio, sale de la lista: es como el
    // contador baja cuando la maquina consigue la clave.
    this.deps.store.clearUndecryptableFor(incoming.syncId)
    incoming = abierta

    const local = this.deps.store.get(incoming.syncId)
    if (local) {
      // Same sync_id on both sides, so comparing `.syncId` can never tell winner from
      // loser — compare object IDENTITY against the two candidates instead (§4.3 rule a).
      const localCandidate = { syncId: local.sync_id, updatedAt: local.updated_at, lamport: local.lamport }
      const incomingCandidate = { syncId: incoming.syncId, updatedAt: incoming.updatedAt, lamport: incoming.lamport }
      const winner = resolveLWW(localCandidate, incomingCandidate)
      if (winner !== incomingCandidate) return // local unpushed edit wins — stays queued
    }
    // Topic collision check against a DIFFERENT sync_id sharing the same topic slot.
    let supersededBy: string | null = null
    // If the incoming row WINS, the local one must be
    // superseded inside the same transaction as the insert; otherwise both stay active on
    // the same slot, idx_obs_topic blows up, the exception bubbles to doPull()'s catch,
    // the cursor never advances and the device never syncs again.
    let supersedeLocal: string | null = null
    // `&& !incoming.deleted`: a tombstone must NEVER take a topic slot away from a live
    // row. findActiveTopicOwner only returns live rows, so without this guard a pulled
    // tombstone that is merely NEWER than a live local row on the same
    // (project_key, scope, topic_key) marks that live row superseded_by = <the tombstone>.
    // The slot goes empty and the local memory disappears from search(), context() and
    // count(), all of which filter superseded_by IS NULL. A tombstone deletes its own
    // sync_id and nothing else.
    if ((incoming.topicKeyHmac || incoming.topicKey) && !incoming.deleted) {
      const existingTopicOwner = incoming.topicKeyHmac
        ? this.deps.store.findActiveTopicOwnerByHmac(
            incoming.projectKey || GLOBAL_PROJECT_KEY,
            incoming.scope,
            incoming.topicKeyHmac,
            incoming.syncId
          )
        : this.deps.store.findActiveTopicOwner(
            incoming.projectKey || GLOBAL_PROJECT_KEY,
            incoming.scope,
            // El `if` de arriba ya garantiza que si no hay HMAC hay tema en claro.
            incoming.topicKey!,
            incoming.syncId
          )
      if (existingTopicOwner) {
        const { winner, loser } = resolveTopicCollision(
          { syncId: existingTopicOwner.sync_id, updatedAt: existingTopicOwner.updated_at, lamport: existingTopicOwner.lamport },
          { syncId: incoming.syncId, updatedAt: incoming.updatedAt, lamport: incoming.lamport }
        )
        if (loser.syncId === incoming.syncId) supersededBy = winner.syncId
        else supersedeLocal = loser.syncId
      }
    }

    this.deps.store.applyIncomingObservation({
      syncId: incoming.syncId,
      projectKey: incoming.projectKey || '__global__',
      scope: incoming.scope,
      topicKey: incoming.topicKey,
      topicKeyHmac: incoming.topicKeyHmac ?? null,
      type: incoming.type ?? 'discovery',
      title: incoming.title ?? '',
      content: incoming.content ?? null,
      tags: incoming.tags,
      originAi: incoming.originAi,
      originAccount: incoming.originAccount,
      gitBranch: incoming.gitBranch,
      authorUserId: incoming.authorUserId,
      authorDisplay: incoming.authorDisplay,
      contentHash: incoming.contentHash,
      updatedAt: incoming.updatedAt,
      lamport: incoming.lamport,
      deleted: incoming.deleted,
      supersededBy,
      supersedeLocal,
      serverSeq: incoming.projectSeq,
    })
  }

  private scheduleBackoffRetry(fn: () => void): void {
    if (this.backoffTimer) clearTimeout(this.backoffTimer)
    const delay = this.backoff.next()
    this.backoffTimer = setTimeout(fn, delay)
  }
}
