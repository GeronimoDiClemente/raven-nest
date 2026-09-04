// Task 1 (plan de memoria por cuenta multi-dispositivo), Step 3c: the orchestrator that
// actually hot-swaps the local memory store when the logged-in account changes. Lives in
// Electron main next to memory-daemon.ts / memory-ipc-server.ts, but — same DI discipline
// as those two — takes daemon/ipcServer as narrow `Pick<...>` interfaces and never imports
// `electron` itself, so it is fully unit-testable with plain fakes and a real MemoryStore
// over a tmp dir, no BrowserWindow or native pipe/socket involved.
//
// See docs/superpowers/... design "Task 1 — una base de memoria por cuenta" §2 for the
// sequence this implements (suspend ipc -> pause daemon -> close old store -> rename/open
// -> wire in -> resume daemon -> resume ipc), and the adversarial review's hallazgo 1 for
// why the original version of this file was broken: it threw out of the fallback branch,
// which left `daemon`/`ipcServer` wired to an already-closed store forever. That is the
// single most important property of swapMemoryStore(): it NEVER throws, and the wire-in
// step (daemon.setStore + ipcServer.setStore) runs EXACTLY ONCE, unconditionally, on every
// reachable path — success, fallback, and fallback-that-also-fails.

import { existsSync, mkdirSync, renameSync } from 'fs'
import { dirname, basename } from 'path'
import { MemoryStore, resolveStorePath } from './memory-store'
// Type-only: neither memory-daemon.ts nor memory-ipc-server.ts imports `electron`, and a
// type-only import doesn't pull their runtime code in either — matches the same reasoning
// memory-ipc-server.ts already documents on its own `import type { MemoryDaemon }` line.
import type { MemoryDaemon } from './memory-daemon'
import type { MemoryIpcServer } from './memory-ipc-server'

// Correction #3 (adversarial review, ALTO): a directory rename on Windows can hit a
// transient EBUSY/EPERM from an antivirus or OneDrive indexing the folder mid-move — not a
// real failure, just bad timing. Retry a few times with a short wait before giving up.
const RENAME_RETRY_ATTEMPTS = 3
const RENAME_RETRY_DELAY_MS = 50

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Renames a directory, retrying a transient EBUSY/EPERM up to RENAME_RETRY_ATTEMPTS times
 * (correction #3). Any other error code (e.g. ENOENT — the source vanished, which should
 * never happen given the caller's own existsSync check right before calling this, but
 * defense in depth costs nothing) is NOT retried and rethrows immediately — swapMemoryStore
 * catches it exactly like any other swap failure and falls back.
 */
async function renameDirWithRetry(from: string, to: string): Promise<void> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= RENAME_RETRY_ATTEMPTS; attempt++) {
    try {
      renameSync(from, to)
      return
    } catch (err) {
      lastErr = err
      const code = (err as NodeJS.ErrnoException)?.code
      if (code !== 'EBUSY' && code !== 'EPERM') throw err
      if (attempt < RENAME_RETRY_ATTEMPTS) {
        console.warn(
          '[memory-account-switch] renameDirWithRetry: %s on attempt %d/%d moving %s -> %s, retrying in %dms',
          code, attempt, RENAME_RETRY_ATTEMPTS, from, to, RENAME_RETRY_DELAY_MS
        )
        await sleep(RENAME_RETRY_DELAY_MS)
      }
    }
  }
  throw lastErr
}

/**
 * The subset of MemoryDaemon / MemoryIpcServer this orchestrator needs — same style as
 * memory-ipc-server.ts's own `MemoryIpcServerDaemon = Pick<MemoryDaemon, 'pull' | 'isOnline'>`,
 * narrow enough that tests can pass a plain object implementing only these methods instead
 * of constructing (or fully mocking) the real classes.
 */
export interface SwapContext {
  store: MemoryStore
  daemon: Pick<MemoryDaemon, 'pause' | 'resume' | 'setStore'>
  ipcServer: Pick<MemoryIpcServer, 'suspend' | 'resume' | 'setStore'>
  currentStorePath: string
}

export interface SwapResult {
  store: MemoryStore
  currentStorePath: string
  /** Set when the swap (and its fallback) hit a problem — the app keeps running with
   *  SOME working store regardless, this is just a signal for the caller to surface. */
  error?: string
}

/**
 * Hot-swaps the local memory store to the one owned by `userId` (or the `_local`
 * anonymous partition when `userId` is null/empty — see resolveStorePath). Correction #1
 * (adversarial review, CRITICO): this function NEVER throws. It always returns a valid
 * `SwapResult` with a non-null `store`, and `ctx.daemon.setStore` / `ctx.ipcServer.setStore`
 * are always called with that exact store — success, fallback, or the fallback also
 * failing — so daemon/ipcServer can never end up pointing at an already-closed store.
 *
 * Serialization (correction #2 — a mutex around calls to this function so a rapid
 * logout+login can't run two swaps concurrently) is the CALLER's responsibility
 * (electron/main.ts's queued call site), not this function's — swapMemoryStore assumes it
 * is never invoked a second time before the first call's promise has settled.
 */
export async function swapMemoryStore(
  ctx: SwapContext,
  ravenHomeDir: string,
  userId: string | null,
  // Task 2 (adopcion con aviso): `_local` puede tener memorias sin dueno de una sesion
  // anterior sin cuenta. Antes de reclamarlas EN SILENCIO, el renderer le pregunta al
  // usuario ("encontramos N memorias, son tuyas?") — ver MemoryStore.countUnclaimedRows()
  // y el IPC 'memory:checkPendingAdoption'. `adopt=false` es la respuesta "no": el swap
  // sigue adelante (la cuenta igual necesita SU base), pero sin mover `_local` — esos datos
  // quedan intactos y siguen invisibles para esta cuenta, recuperables mas adelante si
  // alguien vuelve a decidir que si son suyas (nada se borra nunca).
  adopt = true
): Promise<SwapResult> {
  const targetPath = resolveStorePath(ravenHomeDir, userId)

  // No-op: same file already open and wired in — nothing to suspend, pause, close, or
  // rename. Deliberately checked BEFORE touching ipc/daemon at all (design §2).
  if (targetPath === ctx.currentStorePath) {
    return { store: ctx.store, currentStorePath: ctx.currentStorePath }
  }

  // Order matters here and in the `finally` below (correction #7): suspend ipc first (stop
  // accepting new requests), THEN pause the daemon (drain in-flight push/pull) — and on the
  // way back out, resume the daemon before ipc, so the daemon is ready before the door to
  // new requests reopens.
  await ctx.ipcServer.suspend()
  await ctx.daemon.pause()

  // Definite-assignment assertions (`!`): every reachable path through the try/catch below
  // — success, fallback, and fallback-that-also-fails — assigns both before the `finally`
  // reads them, but TS's flow analysis can't prove that through two levels of nested
  // try/catch on its own.
  let finalStore!: MemoryStore
  let finalPath!: string
  let error: string | undefined

  try {
    // Windows will not rename/delete a file with an open handle (unlike POSIX), so the old
    // store's native handle has to be released before ANY rename or reopen attempt below —
    // success or fallback alike. A close() failure here (a checkpoint error, say) is
    // unusual but must not abort the swap; the rename/reopen attempt right after is the
    // real signal of whether the swap can proceed.
    try {
      ctx.store.close()
    } catch (closeErr) {
      console.warn('[memory-account-switch] failed to close the old store cleanly, continuing anyway', closeErr)
    }

    // Tracks whether we actually moved the `_local` directory onto the target account's
    // path below, so the fallback branch (if the reopen fails) knows where the real data
    // now lives: at `targetPath` if a rename happened, or still at the untouched
    // `ctx.currentStorePath` if it didn't.
    let renamed = false

    try {
      const targetDir = dirname(targetPath)
      const currentDir = dirname(ctx.currentStorePath)
      // "Does this account already have its own base?" is this orchestrator's call, not
      // resolveStorePath's (see that function's own doc comment) — a plain existsSync of
      // the target .db file.
      const targetAlreadyHasStore = existsSync(targetPath)
      // Adversarial review, BUG 1 (alto, Windows-specific): the .db check above says
      // nothing about the CONTAINER directory. On Windows, renaming a directory ONTO one
      // that already exists — even an empty one — fails EVERY time with EPERM; POSIX
      // silently replaces an empty destination, so this only bites on Windows. That EPERM
      // looks identical to the transient antivirus/OneDrive EBUSY/EPERM that
      // renameDirWithRetry exists to ride out, so all 3 retries burn through and still
      // fail — it's not transient, it never resolves without someone deleting the leftover
      // directory by hand. Check for that leftover directory explicitly and skip the
      // rename entirely when it's there.
      const targetDirAlreadyExists = existsSync(targetDir)
      // Rename only applies moving FROM the anonymous `_local` partition INTO a real
      // account for the first time — never the other direction (logging out to `_local`
      // must never move an account's data), and never between two already-established
      // real accounts (nothing to claim there; each already has its own file).
      const movingFromLocalToRealAccount =
        Boolean(userId && userId.trim()) && basename(currentDir) === '_local' && existsSync(currentDir)

      if (!targetAlreadyHasStore && !targetDirAlreadyExists && movingFromLocalToRealAccount && adopt) {
        // WAL mode leaves -wal/-shm files next to the .db (memory-store.ts's constructor
        // sets `journal_mode = WAL`) — a directory-level rename moves all three together
        // atomically, which per-file renames could not guarantee under a mid-move crash.
        mkdirSync(dirname(targetDir), { recursive: true })
        await renameDirWithRetry(currentDir, targetDir)
        renamed = true
      }
      // else: the target account already has its own store (a returning device/session),
      // the target's directory already exists without a .db in it (BUG 1 — some leftover
      // empty folder; degrade gracefully to a fresh base there instead of failing the swap
      // outright), the source wasn't `_local` at all (switching between two real accounts),
      // or `adopt` is false (the user said "not mine" to the pending-adoption dialog) —
      // nothing to move; MemoryStore's own constructor creates the directory if this is
      // genuinely a brand-new file (or reuses the existing empty one).

      finalStore = new MemoryStore(targetPath)
      // §2: claims/adopts NULL-authored rows on the FIRST real account to ever open this
      // exact file — a no-op (claimed: false) on a file that already has an owner.
      const claim = finalStore.setCurrentUser(userId)
      if (claim.claimed) {
        console.log(
          '[memory-account-switch] store at %s reclamado por la cuenta %s — filas adoptadas: %d',
          targetPath, userId, claim.adopted
        )
      }
      finalPath = targetPath
    } catch (swapErr) {
      // THIS is the hallazgo the adversarial review flagged as broken in the original
      // design: throwing here left daemon/ipcServer wired to the already-closed
      // `ctx.store` forever. Never throw — fall back to reopening wherever the data
      // actually is right now, and report the failure via `error` instead.
      error = describeError(swapErr)
      console.error(
        '[memory-account-switch] swap to %s failed, falling back to the previous store', targetPath, swapErr
      )

      // If the rename already happened, the real bytes live at `targetPath` now — the
      // fallback has to reopen THERE, not at the (no longer existing) old `_local` path.
      // Only when nothing was moved is `ctx.currentStorePath` still the right place.
      const fallbackPath = renamed ? targetPath : ctx.currentStorePath

      try {
        finalStore = new MemoryStore(fallbackPath)
        finalPath = fallbackPath
      } catch (fallbackErr1) {
        console.warn(
          '[memory-account-switch] fallback reopen of %s failed, retrying once', fallbackPath, fallbackErr1
        )
        try {
          finalStore = new MemoryStore(fallbackPath)
          finalPath = fallbackPath
          error = `${error}; fallback reopen initially failed but succeeded on retry`
        } catch (fallbackErr2) {
          // The fallback ALSO failed, twice — the extreme case the adversarial review
          // asked to be handled explicitly rather than left to throw. There is no
          // MemoryStore left that we know how to construct. Degrade rather than throw:
          // keep wiring in the already-closed `ctx.store` object so daemon/ipcServer
          // never end up pointing at `undefined` (a TypeError on their very next call is
          // strictly worse than a store that will itself error loudly on its next real
          // operation). This is a catastrophic, expected-unreachable outcome — both the
          // target account's file AND two attempts at the ORIGINAL file failed to open —
          // so a closed store limping through until the app restarts is the honest
          // remainder, not a silent success.
          console.error(
            '[memory-account-switch] fallback reopen of %s ALSO failed twice — degrading to the closed old store object',
            fallbackPath, fallbackErr2
          )
          error = `${error}; fallback reopen failed twice: ${describeError(fallbackErr2)}`
          finalStore = ctx.store
          // BUG 2 (adversarial review, medio): NOT ctx.currentStorePath. If `renamed` is
          // true, the directory that used to live at ctx.currentStorePath is gone — it was
          // already moved to targetPath before either reopen attempt ran. fallbackPath is
          // the value that already accounts for that (`renamed ? targetPath :
          // ctx.currentStorePath`, computed above); reusing ctx.currentStorePath here would
          // report a path that no longer exists on disk.
          finalPath = fallbackPath
        }
      }
    }
  } finally {
    // Wire-in: exactly once, unconditional, reached by every path above — success,
    // fallback, and fallback-that-also-failed (correction #1). `finalStore`/`finalPath`
    // are assigned on every one of those paths by the time control reaches here.
    ctx.daemon.setStore(finalStore)
    ctx.ipcServer.setStore(finalStore)
    // Correction #7: daemon ready before the door to new requests reopens.
    ctx.daemon.resume()
    ctx.ipcServer.resume()
  }

  return { store: finalStore, currentStorePath: finalPath, error }
}
