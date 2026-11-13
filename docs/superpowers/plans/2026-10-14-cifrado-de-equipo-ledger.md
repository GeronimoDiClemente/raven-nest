# SDD ledger — plan: docs/superpowers/plans/2026-10-14-cifrado-de-equipo.md

## Pre-flight scan

| Pair / Task | Produces | Consumes | Finding |
|---|---|---|---|
| T1 → T2-T6 | `team_keys`, `team_key_wraps` tables | T2 (`getTeamKeyState`), T3 (`activateTeamKey`), T4 (`authorizeTeamDevice`), T5 (join via `projects`), T6 (HTTP) | OK, columns match across all SQL in later tasks. |
| T2 → T3, T4 | `TeamKeysAuth`, `isTeamLeader(pool,userId,teamId)`, `getTeamKeyState(pool,auth,teamId,slot?)` | T3/T4 import and call with matching signature | OK |
| T2 → T5 | `TeamKeysAuth` (type only) | T5 imports `type TeamKeysAuth` from `./team-keys` | OK |
| T3/T4 → T6 | `activateTeamKey`, `authorizeTeamDevice` return shapes (`{ok:true}\|Fail<...>`) | T6 HTTP handlers destructure `.status`/`.error` on `!result.ok` | OK |
| T5 → T6 | `recryptTeamObservations` returns `{ok:true,applied,rejected}` | T6 forwards `result` as JSON body on success | OK |
| T7 → T8 | same file `memory-team-keys-client.ts` | T8 adds `recoverTeamWithCode` to it, imports `unwrapWithRecovery` | OK, sequential edits to one file — no conflict, same task lineage |
| T7 → T11 | `fetchTeamKeyState`, `activateTeamEncryption`, `adoptExistingTeamKey`, `authorizeTeamDeviceFromClient` | T11 main.ts imports all 4 by the same names | OK |
| T8 → T11 | `recoverTeamWithCode` | T11 imports it | OK |
| T9 → T11 | `EnvelopeContext.teamKeys?`, `memory-store.ts#teamIdForProjectKey` | T11 wires `getEnvelopeContext` to call `teamIdForProjectKey` + `teamMasterKeys` + `deriveKeys` | OK — this wiring was MISSING in the first draft, fixed before commit (see Ruling below) |
| T9 & T11 both touch `memory-store.ts` | T9 adds `teamIdForProjectKey`, T11 adds `localTeamRowsForTeam` | sequential, different methods | OK, no overlap, but implementer of T11 must read current file state (not assume T9's diff from a cached view) |
| T10 → T11 | `runTeamRecrypt(deps,teamId,master,rows,onProgress?)` | T11 calls `runTeamRecrypt(deps, teamId, master, rows)` (onProgress omitted, optional) | OK |
| T11 → T12 | 6 IPC channels: `status/activate/adopt/authorize/recover/recrypt` | T12 UI calls all 6 via `window.memory.teamEncryption*` | OK — `adopt` added in the same fix pass as the T9→T11 wiring gap |
| T12 → T13 | UI component, not consumed by e2e directly | T13 calls IPC directly via `page.evaluate`, same channel names as T11/preload | OK |
| T5 internal (test vs impl) | test asserted `project_seq > 1` (hardcoded) | impl's `allocateSeqRange` on a fresh project (seq_counter default 0) returns exactly 1 | **BUG FOUND AND FIXED** before dispatch — see Ruling below |
| Global Constraints vs all tasks | "no key_epoch", "no re-key on leave", "leader-only gates" | T1 (no key_epoch column), T3/T4/T5 (isTeamLeader gate), no task touches team_memberships on departure | OK, all tasks comply |
| Review Focus (5 lines) vs tasks | cross-team sync_id, wrong-scope sync_id, non-leader caller, concurrent activate, pending-device display | T5 tests (2 lines), T3/T4/T5 403 tests, T3 409 test, T9 undecryptable test | OK, all 5 have an owning test |

**Ruling 1 (pre-flight, plan defect, fixed before Task 1 dispatch):** Task 5's test
`'re-cifra una fila de equipo del propio proyecto del leader'` asserted
`project_seq > 1` as a hardcoded literal, but the test fixture also hardcodes the
pre-existing row's `project_seq` to `1`, and a freshly-created test project's
`seq_counter` starts at its schema default (0) — so `allocateSeqRange` on first
call also returns exactly `1`. The assertion would have failed on correct
implementation code, not caught a real bug. **Fixed**: capture the row's
`project_seq` immediately before calling `recryptTeamObservations`, and assert the
post-call value is strictly greater than that captured value. Committed to the
plan file directly (`80bdfb8`) before any implementer touched Task 5 — this is a
test-authoring fix, not a design change, and costs nothing if "wrong" (worst case,
a slightly more verbose assertion than necessary).

Scan is otherwise clean. Proceeding to Task 1.

## Task 1: Migración — team_keys y team_key_wraps

BASE: `80bdfb8`. Dispatched to a `general-purpose` subagent on `haiku` (mechanical,
complete code given verbatim in the brief).

Implementer reported **NEEDS_CONTEXT**: implemented both files and committed
(`db39677` "feat(cifrado-equipo): migración team_keys / team_key_wraps"), but could
not run the test — no Docker/Postgres reachable from its session. Report:
`.superpowers/sdd/2026-10-14-cifrado-de-equipo/task-1-report.md`.

Controller verification (not a fix — just supplying the missing Postgres the
implementer lacked): started Docker Desktop + `nest-memory-pg` container myself.
`npx vitest run __tests__/team-keys-migration.test.ts` with
`DATABASE_URL=postgres://postgres:nestmem@127.0.0.1:55432/nest_memory` → **3/3
passing**, matches the brief's expected output exactly.

Then ran the FULL server suite as the task's own Step 5 best-practice check
(`npx vitest run`, no `-t` filter) → Docker Desktop's engine dropped mid-run
(`ECONNREFUSED 127.0.0.1:55432` on the later test files; `docker ps` then failed
with `failed to connect to the docker API at npipe:...`) — Docker Desktop itself
had exited by the time the full suite got to file ~40/48. This is a **machine/Docker
Desktop stability issue on this Windows PC, not a code defect**: the one test this
task actually owns (`team-keys-migration.test.ts`) passed cleanly in isolation
before Docker fell over.

**Paused here at Gero's explicit request** ("seguimos después con esto, guardá
todo y matá los procesos"). Checked for dangling processes from this session
before stopping: Docker Desktop.exe and its backend are already NOT running (it
crashed on its own, nothing left to kill there); the earlier `npx vitest run`
call had already returned before the pause, so no hung process from it either.
Did NOT touch the large number of unrelated `node.exe` processes on this
machine (tasklist showed 100+) — none are attributable to this plan's work, and
bulk-killing them would be destructive to things outside this task's scope.

**To resume:**
1. Gero starts Docker Desktop by hand (it has been flaky twice in one session on
   this machine — may need a restart, not just a re-launch) and confirms it's
   stable before a long test run.
2. `docker start nest-memory-pg` (or recreate per `server/README.md` if the
   container is gone).
3. Re-run the FULL server suite once (`cd server && DATABASE_URL=... npx vitest
   run`) to get the real Step 5 verdict — the isolated Task 1 test already
   passed, this is just the "nothing else broke" confirmation the task asks for.
4. If full suite is clean: dispatch the Task 1 reviewer
   (`bash scripts/review-package ... <BASE=80bdfb8> <HEAD=db39677>` then
   `task-reviewer-prompt.md`) — Task 1 is NOT yet marked complete in this ledger.
5. Continue the task loop from Task 2 onward only after Task 1's review passes.

Task 1 status: **implemented and individually verified green, review not yet
dispatched** — do not mark `Task 1: complete` until the reviewer runs.

**Resumed 2026-10-14, Docker confirmed stable by Gero.** Started Docker Desktop +
`nest-memory-pg` again, waited for it to settle, then ran the full server suite
clean: **48/48 test files, 363/363 tests passing.** Generated the review package
(`review-80bdfb8..db39677.diff`) and dispatched the Task 1 reviewer on `sonnet`.

**Review verdict: ✅ Spec compliant, Task quality: Approved. No Critical/Important
findings.** Reviewer confirmed the brief's instruction to register the migration
in `db.ts` was itself wrong for this codebase (`migrate()` auto-discovers `.sql`
files by `readdirSync` + alphabetical sort, no manual array to edit) — the
implementer correctly made no `db.ts` change, and the reviewer verified this by
reading `db.ts` directly rather than trusting the report.

Minor findings (deferred, do not block):
- `Task 1: minor (deferred): task-1-report.md's own NEEDS_CONTEXT narrative mixes observed-vs-predicted results; harmless here since controller verified real GREEN independently.`
- `Task 1: minor (deferred): team_key_wraps.wrap_meta is nullable with no default — fine today (no writer yet), confirm a later task's writer always supplies it or add a default when it lands.`

Task 1: complete (commits 80bdfb8..db39677, review clean — 2 minors parked, no loop needed)

## Task 2: team-keys.ts — rol y lectura de estado

BASE: `db39677`. Dispatched to `general-purpose` on `haiku` (complete code given
verbatim in brief). Implementer reported **DONE**: commit `d814edf` "feat(cifrado-
equipo): rol de leader y lectura de estado de clave". Test evidence: 8/8 passing
(own test file), 371/371 full suite (up from 363 baseline, consistent with 8 new
tests, no regressions). Report: `task-2-report.md`.

Review package generated (`review-db39677..d814edf.diff`), dispatched reviewer on
`sonnet` with explicit emphasis on `isTeamLeader`'s SQL condition and
`pendingDevices`' cross-member join, since this file is load-bearing for every
later task (3-6 import `isTeamLeader`/`TeamKeysAuth` by name).

**Review verdict: ✅ Spec compliant, Task quality: Approved.** The two load-bearing
checks (`isTeamLeader`'s `role='leader' AND status='active'`, and
`pendingDevices`' cross-ALL-members join, not just the caller's own devices) were
verified correct against the real `team_memberships`/`device_keys`/`devices`
schema (not just read in isolation). No Critical/Important findings.

Minor findings (deferred, do not block):
- `Task 2: minor (deferred): no test for a plain member (non-leader) successfully calling getTeamKeyState — logic verified correct by inspection, coverage gap only.`
- `Task 2: minor (deferred): no test for a revoked device being excluded from pendingDevices — query already handles it (d.revoked_at is null), coverage gap only.`

Task 2: complete (commits db39677..d814edf, review clean — 2 minors parked, no loop needed)

## Task 3: activateTeamKey — sólo el leader, una vez

BASE: `d814edf`. Dispatched to `general-purpose` on `haiku`. Implementer reported
**DONE**: commit `3311b00` "feat(cifrado-equipo): activateTeamKey, gateado a
leader". 12/12 passing (8 from Task 2 + 4 new). Report: `task-3-report.md`.

Controller note: IDE flagged `activateTeamKey` as "not exported" — verified
directly with grep, it IS exported at `team-keys.ts:91`. Stale IDE/TS-server
cache, same pattern as a Task 1 false alarm. Not a real issue.

Review package generated (`review-d814edf..3311b00.diff`), dispatched reviewer on
`sonnet` with explicit emphasis on the advisory-lock transaction boundary (the
Review Focus item this task exists to close) and the exact exported signature
(load-bearing for Task 6).

**Review verdict: ✅ Spec compliant, Task quality: Approved.** Advisory lock +
existence check + insert verified to be inside ONE transaction (correctly
serializes the race), 409 path verified to leave existing wraps untouched by
re-reading the DB after the second call. No Critical/Important findings.

Minor findings (deferred, do not block):
- `Task 3: minor (deferred): race test uses two sequential calls, not a true Promise.all concurrent pair — code review independently confirmed the lock would serialize a real concurrent pair too, stronger test left for future.`
- `Task 3: minor (deferred): "select ... for update" existence check is redundant once the advisory lock already serializes callers — harmless belt-and-suspenders, no action needed.`

Task 3: complete (commits d814edf..3311b00, review clean — 2 minors parked, no loop needed)

## Task 4: authorizeTeamDevice

BASE: `3311b00`. Dispatched to `general-purpose` on `haiku`. Implementer reported
**DONE**: commit `a9ebf8c`. 16/16 passing (12 existing + 4 new). Report:
`task-4-report.md`. Same stale IDE "not exported" false alarm as Tasks 1/3 —
verified by grep, it IS exported (team-keys.ts:143).

Review package generated (`review-3311b00..a9ebf8c.diff`), dispatched reviewer on
`sonnet` with explicit emphasis on the recovery-slot-never-overwritten guard
(the security-relevant invariant this task exists to enforce) and a named
⚠️-risk about mixed-batch behavior the brief's own test doesn't cover.

**Review verdict: ✅ Spec compliant, Task quality: Approved.** Reviewer read the
code directly and confirmed the recovery-guard rejects the WHOLE batch
(zero DB writes) when any wrap targets the recovery slot — not a silent partial
apply. 404/403 ordering and upsert conflict target verified correct. No
Critical/Important findings.

Minor finding (deferred, does not block):
- `Task 4: minor (deferred): no test exercises the "on conflict ... do update" branch (re-authorizing an already-wrapped device slot) — SQL verified correct by reading, just not exercised at runtime.`

Task 4: complete (commits 3311b00..a9ebf8c, review clean — 1 minor parked, no loop needed)

## Task 5: recryptTeamObservations — la pieza de seguridad central del plan

BASE: `a9ebf8c`. Dispatched to `general-purpose` on `sonnet` (NOT the usual cheap
tier for this plan — this is the one task the spec marks as the central
security risk, bumped a tier to reduce fix-loop risk on it). Implementer
reported **DONE**: commit `239c8a1`. 7/7 new, 386/386 full suite, typecheck
clean. Report: `task-5-report.md`.

Implementer self-review caught a RECURRENCE of the same `project_seq` fixture
bug as Ruling 1 (the shared `obs()` helper, not the one test I'd fixed in the
plan text) — verified it with an isolated script against real Postgres, fixed
the test fixture only (not production code), documented in the report. Good
catch — this is exactly the kind of thing a careful implementer should find.
Same stale-IDE "not exported" false alarm as every prior task — verified by
grep, it IS exported (team-keys-recrypt.ts:21).

Review package generated (`review-a9ebf8c..239c8a1.diff`). Given this is the
plan's single highest-risk task, dispatched the reviewer on `opus` (most
capable available model, not the usual `sonnet` for this plan) with explicit
instruction to trace every code path by reading the full file directly, not
just the diff context, and to independently run the focused adversarial test
file if useful.

**Review verdict: ✅ Spec compliant, Task quality: Approved. Core security
property VERIFIED by tracing every code path** — no write happens without the
combined `project.team_id = teamId AND scope = 'team'` check in the same
guarded `select ... for update`, row locked by its PK, `author_id`/`scope`/
`type` never appear in the UPDATE. No Critical findings.

**One Important finding, NOT parked — entered the fix loop:**
"`origin_account`/`content_hash`/`topic_key` remain readable on the server for
team rows even after 'migration' — spec §4 limits the rewrite to
title/content/tags, but Task 9's `sealMutationPayload` seals FIVE fields
(title, content, project_display_name, content_hash, origin_account) for
ONGOING team pushes. `origin_account` contains the user's email (documented
leak, already fixed for personal in `server/README.md:32`)."

**Ruling A (load-bearing, fix loop round 1 dispatched):** Expand
`recryptTeamObservations`'s item shape + UPDATE to also carry/write
`content_hash` and `origin_account` (required fields, `null`-able), matching
the ongoing-push SEALED_FIELDS set for these two columns. Resumed the SAME
Task 5 implementer (round 1, same agent, same model) via SendMessage with the
full finding and exact change list. Why now and not later: Task 6 (HTTP
route) and Task 10 (client migration orchestration) haven't been dispatched
yet — fixing the item shape now means they get written against the correct
contract from the start, instead of needing their own rework later.

**Ruling C (accepted v1 gap, documented, not fixed):** `topic_key`'s
retroactive migration (clear → HMAC) is explicitly OUT of this fix's scope.
Unlike content_hash/origin_account (simple symmetric re-encryption, same
mechanism as title/content), topic_key requires HMAC and the server uses it
for supersede-by-equality matching on EXISTING rows — retroactively changing
it for historical team rows risks disturbing already-settled supersede
relationships in a way this plan doesn't have scope to reason through safely.
Lower sensitivity than an email (short user-chosen topic strings) justifies
deferring this, same tier as the already-accepted "no rotation" v1 limitation.
**Surface this to Gero in the final rulings summary** — it's a real, if minor,
gap in the "nobody can read team memories" promise for historical data.

**Separately, same review surfaced a bug in Task 9's NOT-YET-DISPATCHED plan
text** (not this task's diff): `sealMutationPayload`/`openPulledRow`'s
topic_key HMAC derivation used `ctx.keys` (always the PERSONAL key)
unconditionally instead of the scope-resolved `keys` variable — would have
silently broken team-scope topic/supersede matching across different authors
(each team member's personal key differs). **Fixed directly in the plan text**
(commit `b5c6b68`, before Task 9 was ever dispatched — zero implemented code
affected) and added a new test case to Task 9's test block
("el HMAC de tópico de una fila team usa la clave de EQUIPO, no la personal de
quien llama") to lock in the correct behavior for whoever implements Task 9.

**Fix round 1 applied**: resumed the same implementer agent, commit `b244139`
"fix(cifrado-equipo): recryptTeamObservations también re-cifra content_hash/
origin_account". Focused test 7/7, full suite 386/386, typecheck clean.
Dispatched scoped re-review on `sonnet` (`review-239c8a1..b244139.diff`,
explicitly scoped to the ONE fix commit, ignoring the two intervening
controller-authored doc-only plan commits in the same range).

**Re-review verdict: All findings addressed, no new Critical/Important
breakage.** Verified the guard was not loosened — content_hash/origin_account
only reachable through the SAME already-gated per-row transaction, proven by
a real re-read of the DB row after the call (not just the API response).

Task 5: fix round 1/5 (1 addressed, 0 open; commits a9ebf8c..b244139)
Task 5: complete (commits a9ebf8c..b244139, 1 fix round, review clean)

## Task 6: Rutas HTTP — /v1/teams/key*

BASE: `b244139`. Dispatched to `general-purpose` on `sonnet` (integration task,
known ambiguity flagged in the brief about the real HTTP test-server-start
pattern — needs judgment, not pure transcription). Implementer reported
**DONE**: commit `699becc`. 5/5 new, 391/391 full suite (up from 386), tsc
clean. Report: `task-6-report.md`. Resolved the flagged ambiguity correctly:
real pattern is `createApp(pool)` + manual `.listen(0, '127.0.0.1', cb)`, not
the brief's placeholder `startHttpServer` name.

Same stale-IDE "unused import" false alarm as every prior task — verified by
grep, all four functions ARE called (http.ts:294/303/312/321).

Review package generated (`review-b244139..699becc.diff`), dispatched reviewer
on `sonnet` with explicit emphasis on auth/rate-limit/404 wiring not shadowing
existing routes, and confirming the test hits a real listening server.

**Review verdict: ✅ Spec compliant, Task quality: Approved. One Important
finding, NOT parked — entered the fix loop:** zero HTTP-level test coverage
for `POST /v1/teams/key/recrypt` (the security-critical route) — only
verified by static code reading. Ruled: fix now, same implementer, test-file
only (http.ts itself untouched, correctly wired per the original review).

Fix round 1 applied: commits `699becc` (original) + `1dc103e` "test(cifrado-
equipo): cubrir /v1/teams/key/recrypt y missing_team_id en HTTP". 8/8 focused,
394/394 full suite. Dispatched scoped re-review on `sonnet`
(`review-699becc..1dc103e.diff`). Same stale-IDE false alarm pattern on the
new test helper — verified by grep, used at line 139.

**Re-review verdict: All findings addressed, no new Critical/Important
breakage.** `http.ts` confirmed untouched by the fix. Recrypt route now
verified end-to-end (real row, real HTTP call, real response assertion), plus
the 403 case and one `missing_team_id` case.

Task 6: fix round 1/5 (1 addressed, 0 open; commits 699becc..1dc103e)
Task 6: complete (commits b244139..1dc103e, 1 fix round, review clean)

**Server side (Tasks 1-6) done.** Moving to client side (Tasks 7-12) + final e2e (13).

## Task 7: memory-team-keys-client.ts — activar/adoptar/autorizar, puro

BASE: `1dc103e`. Dispatched to `general-purpose` on `haiku` (pure module,
mirrors existing shipped `memory-keys-client.ts`, complete code given).
Implementer reported **DONE**: commit `475528d`, 3/3 passing. Report:
`task-7-report.md`.

**Before dispatching the reviewer, ran the REAL CI typecheck myself** (not
just trusting a green vitest run) and found a genuine, non-stale defect: 7
TS2345 errors, all in the new test file, zero elsewhere. The mock's
`fetchImpl` was typed too narrowly (`url: string`) for `typeof fetch` (which
accepts `URL | RequestInfo`), and `init.headers?.['X-Device-Test']` indexed
`HeadersInit` without a cast. The already-shipped sibling file this task
mirrors (`memory-keys-client.test.ts:19-79`) solves both with an `as unknown
as typeof fetch` cast and a header cast — my own plan text just didn't
include them for the new file. Fixed the plan text (commit `3e9166b`) and
resumed the implementer with the precise fix + an explicit instruction to
run the REAL `tsc -p tsconfig.node.json` command (not the root `tsc
--noEmit`, which CLAUDE.md warns checks nothing) as the actual verification.

Fix round 1 applied: commit `a89710b`. Controller independently re-ran
`tsc -p tsconfig.node.json --noEmit --composite false` — **0 errors,
confirmed clean myself**, not just trusting the report. Dispatched reviewer
on `sonnet` (`review-1dc103e..a89710b.diff`, told to ignore the intervening
docs-only `3e9166b` commit and review `475528d`+`a89710b` together).

**Review verdict: ✅ Spec compliant, Task quality: Approved.** Verified
exports/signatures match exactly, v1 no-epoch constraint genuinely honored
(diffed against the personal sibling file, which DOES carry epoch concepts —
confirms this file deliberately doesn't), and the 3 tests drive REAL
X25519/AES-GCM crypto across two independent device identities, not
self-referential mocking. No Critical/Important findings.

Minor findings (deferred, do not block):
- `Task 7: minor (deferred): publicKeys map in test fixture is dead code, inherited verbatim from the brief's own draft — prune in a follow-up pass.`
- `Task 7: minor (deferred): fetchTeamKeyState's query-string building assumes team_id always supplies a leading '?' — correct today, slightly fragile if reused elsewhere.`

Task 7: fix round 1/5 (1 addressed — typecheck — 0 open; commits 1dc103e..a89710b)
Task 7: complete (commits 1dc103e..a89710b, 1 fix round, review clean — 2 minors parked)

## Task 8: Código de recuperación de equipo

BASE: `a89710b`. Dispatched to `general-purpose` on `haiku`, explicitly briefed
on Task 7's real-typecheck lesson (told to run `tsc -p tsconfig.node.json`
before claiming DONE, not just vitest). Implementer reported **DONE**: commit
`6d9e8fa`, 5/5 passing, both real typecheck commands clean per their own
report. Controller independently re-ran both — 0 errors confirmed myself.
Same stale-IDE false alarms as every prior task — verified by grep.

Review package generated (`review-a89710b..6d9e8fa.diff`), dispatched reviewer
on `sonnet` with explicit emphasis on tracing the actual code path to confirm
a wrong recovery code throws BEFORE any publish call fires.

**Review verdict: ✅ Spec compliant, Task quality: Approved.** Traced the
actual control flow: `unwrapWithRecovery` is synchronous and throws inside a
try/catch BEFORE the publish line is ever reached; the wrong-code test proves
this via a real side-effect check (`adoptExistingTeamKey` returns null
afterward), not just "it threw". Implementer also correctly caught and fixed
a wrong assumption in my own brief text (claimed the mock fixture didn't need
changes — it did, for `wrap_meta`/salt plumbing) without side effects on
prior tests. No Critical/Important findings.

Minor findings (deferred, do not block):
- `Task 8: minor (deferred): missing-recovery-slot guard throws a plain Error instead of MemoryUnwrapError — not spec-required, just a consistency nicety for callers wanting to distinguish failure types.`
- `Task 8: minor (deferred): the plan brief's claim that the mock fixture didn't need changes was wrong — implementer caught and fixed it correctly; note for whoever reads this plan later.`

Task 8: complete (commits a89710b..6d9e8fa, review clean — 2 minors parked)

## Task 9: cablear el cifrado real en memory-envelope.ts

BASE: `6d9e8fa`. Dispatched to `general-purpose` on `sonnet` (the single
wiring point affecting ALL team-scope push/pull, plus the topic_key fix found
earlier in the plan — bumped a tier from the usual cheap transcription tier).
Explicitly briefed on the topic_key correctness point (already fixed in the
brief's code) and told not to reintroduce it, and on the real-typecheck
lesson. Implementer reported **DONE**: commit `565fb71`. 6/6 focused, FULL
electron suite 2050/2050 (6 skipped, 0 failed — no regression to personal
encryption). Both real typechecks 0 errors per their own report. Report:
`task-9-report.md`.

Controller independently re-ran both real typecheck commands — 0 errors
confirmed myself. Verified via grep that the topic_key fix landed correctly
(`keys`, not `ctx.keys`, at both call sites) and `esDeEquipo` is genuinely
gone. Same stale-IDE false alarms as every prior task.

Review package generated (`review-6d9e8fa..565fb71.diff`), dispatched reviewer
on `sonnet` with explicit instruction to read the full file (not just diff
context) given this is the single wiring point for all team push/pull
encryption and touches an existing, shipped personal-encryption function.

**Review verdict: ✅ Spec compliant, Task quality: Approved.** Traced both
`sealMutationPayload`/`openPulledRow` directions by hand, confirmed the
topic_key correctness property genuinely holds (not just lexically), and
confirmed personal-scope/`ctx===null` behavior is byte-for-byte unchanged. No
Critical/Important findings.

**One ⚠️ item, investigated and confirmed as a REAL load-bearing gap —
entered the fix loop:** nothing in `electron/` ever writes `projects.team_id`
in the LOCAL SQLite database — the only existing `team_id` write anywhere
(`main.ts:3790-3814`'s `shareProjectWithTeam` handler) only POSTs to the
SERVER's Postgres `projects.team_id`, confirmed by its own comment and by
reading `server/src/share.ts`. This means `teamIdForProjectKey()` (this
task's own new method) would return `null` forever, and team push/pull
encryption would silently never activate — not a bug in what Task 9 built,
but a missing write-path elsewhere that Task 9's new read-path is the FIRST
thing to depend on (the original team-sharing feature never needed the local
column populated).

**Ruling (load-bearing, fix loop round 1 dispatched):** add `setLocalTeamId`
to `memory-store.ts` and call it from `main.ts`'s existing
`shareProjectWithTeam` success path, right alongside the existing
`unblockMutations`/`scheduleMutationPush` calls. Resumed the Task 9
implementer with the precise addition. Why now: Task 10 (migration
orchestration) and Task 11 (IPC wiring, also touches this exact area of
`main.ts`) haven't been dispatched yet.

Fix round 1 applied: commit `ce5148c` "fix(cifrado-equipo): escribir
projects.team_id local al compartir con equipo". Focused 1/1, full electron
suite 2051/2051 (up from 2050). Controller independently re-ran both real
typechecks — 0 errors confirmed. Dispatched scoped re-review on `sonnet`
(`review-565fb71..ce5148c.diff`).

**Re-review verdict: All findings addressed, no new Critical/Important
breakage.** Write/read verified to match exactly (same table/column/key),
confirmed called from the real success path (not orphaned), round-trip test
includes a negative case (unrelated project_key still null).

Task 9: fix round 1/5 (1 addressed, 0 open; commits 565fb71..ce5148c)
Task 9: complete (commits 6d9e8fa..ce5148c, 1 fix round, review clean)

## Task 10: migración retroactiva del lado del cliente

BASE: `ce5148c`. Dispatched to `general-purpose` on `haiku`, briefed on the
Ruling A content_hash/origin_account addition already baked into the brief,
and the real-typecheck lesson. Implementer reported **DONE**: commit
`bcb8f25`, 2/2 passing, both real typechecks 0 errors per their own report.
Report: `task-10-report.md`.

Controller independently re-ran both real typechecks — 0 errors confirmed.
This time the implementer PROACTIVELY applied the fetch-mock cast pattern
learned from Task 7's earlier fix (verified via grep: `as unknown as typeof
fetch` present) — the lesson carried forward without needing a repeat fix
round. Same stale-IDE false alarms as every prior task.

Review package generated (`review-ce5148c..bcb8f25.diff`), dispatched reviewer
on `sonnet` with explicit emphasis on the snake_case/camelCase field mapping
to the server contract and the null-passthrough convention for all three
newly-added fields.

**Review verdict: ❌ Issues found — TWO Critical findings, both MY bugs in the
plan text, faithfully transcribed by the implementer:**
1. `const keys: MemoryKeys = { field: master, topic: master }` — raw master
   used directly as the AES-GCM key instead of `deriveKeys(master)`. Every
   other device decrypts with the DERIVED key, so every row this function
   touches would become permanently undecryptable (GCM tag mismatch). The
   existing test only checked the `nmc1:` prefix, never a real round-trip
   decrypt, so it never caught this.
2. No `res.ok` check — a server 400 (whole-batch rejection) silently reads
   as `applied: 0, rejected: 0` with `onProgress` still reporting the batch
   as done.

Fixed the plan text directly (commit `9ded3a7`): `deriveKeys(master)`, a
`res.ok` throw, and two new/strengthened tests (a real `decryptField`
round-trip that would have caught the key bug, and a 400-throws test).
Resumed the Task 10 implementer with the exact fix (fix loop round 1).

Fix round 1 applied: commit `c2437ec`. 3/3 passing (including the new
round-trip decrypt test and the 400-throws test). Controller independently
re-ran both real typechecks — 0 errors confirmed, and verified via grep that
`deriveKeys(master)` and the `res.ok` check are both genuinely in the code.
Dispatched scoped re-review on `sonnet` (`review-bcb8f25..c2437ec.diff`,
told to ignore the intervening docs-only `9ded3a7` commit).

**Re-review verdict: All findings addressed, no new Critical/Important
breakage.** Both confirmed by direct code reading: the round-trip test
genuinely goes through `decryptField(deriveKeys(master), ...)` with matching
AAD (would fail if the raw-master bug were reintroduced), and the res.ok
throw happens strictly before any counter increment.

Task 10: fix round 1/5 (1 addressed — data-corruption bug + silent-failure
bug, 0 open; commits bcb8f25..c2437ec)
Task 10: complete (commits ce5148c..c2437ec, 1 fix round, review clean)

## Task 11: IPC — main.ts + preload.ts + types.ts

**Preflight fix before dispatch**: Task 11's Step 3 (connect `teamKeys` to the
real `getEnvelopeContext` — the single most load-bearing wiring point in the
whole plan, without it Task 9 never actually runs) was written as a floating
note between Step 2 and the old Step 3, not as its own checkbox step. An
implementer following the checklist literally could skip it entirely, with
zero errors anywhere to catch the omission. Promoted to its own Step 3,
renumbered the rest 4-8 (commit `f57aee3`).

BASE: `f57aee3`. Dispatched to `general-purpose` on `sonnet` (integration
task touching a large existing file, Step 3 explicitly flagged as the
critical connection to verify by tracing, not just copy-pasting).
Implementer reported **DONE**: commit `11a7831`. Full suite 3647/3647 (6
skipped, 0 failed), both real typechecks 0 errors per their own report.
Report: `task-11-report.md`.

Controller independently re-ran both real typechecks — 0 errors confirmed.
Verified via grep that `localTeamRowsForTeam` genuinely exists and is used
(same stale-IDE false alarm pattern as every prior task).

Given this is THE activation task for the entire 13-task plan (if Step 3's
wiring is subtly wrong, everything else stays fully tested but inert in the
real app), dispatched the reviewer on `opus` — same tier as Task 5 — with
explicit instruction to trace the full call chain by reading the actual
file, not trust the implementer's narrative of having traced it.
(`review-f57aee3..11a7831.diff`)

**Review verdict: ❌ Needs fixes.** Step 3's wiring itself was traced end to
end and confirmed CORRECT (`getEnvelopeContext` → `sealMutationPayload`/
`openPulledRow` → `ctx.teamKeys?.()` → `teamIdForProjectKey` →
`teamMasterKeys` → `deriveKeys(master)`, genuinely connected). But:

- **Critical (my bug, not the implementer's deviation):** `adopt`/`recover`
  don't call `resetPullCursors()`/`clearUndecryptable()`/`onNetworkRegain()`
  after setting the team key — my own plan comment FALSELY claimed this
  wasn't needed for team scope; the reviewer traced `memory-daemon.ts` and
  confirmed undecryptable rows DO advance the cursor, same as personal. Real
  consequence: an authorized device never actually sees the team's
  historical content.
- **Important:** `activate`/`adopt`/`recover` check `!memoryKeys` (device
  keypair, always exists) instead of `!memoryKeys?.master` (the actual
  personal encryption prerequisite the spec §2 requires) — a leader without
  personal encryption on could activate team encryption and silently push
  team content in clear.
- **Important:** `recrypt` handler has no error handling — `runTeamRecrypt`
  throws on any server rejection, and Task 12's UI wrapper has no catch →
  unhandled rejection, zero user-facing error.
- **Important (lower):** `status` handler doesn't catch `fetchTeamKeyState`
  errors, inconsistent with the personal handler's defensive style.
- **Minor:** `teamMasterKeys` never cleared on disconnect/account switch.

Resumed the implementer with all of the above except the reviewer's ⚠️ item
(no fail-closed gate / proactive re-adopt at app startup — a cleartext-leak
window between launch and whenever the UI next mounts, same bug CLASS that
already bit personal encryption once per CLAUDE.md). **Ruling**: that one is
NOT a quick fix — closing it properly means `sealMutationPayload` needs to
distinguish "team never encrypted" from "team encrypted but this device
hasn't adopted yet," which is a design change to Task 9, not this task.
Documented as an explicit, deferred v1.1 limitation in the spec (commit
`a2fd570`) rather than silently patched or silently parked — this needs to
reach Gero in the final rulings summary, it's genuinely security-relevant.

Fix round 1 applied: commits `11a7831` (original) + `3be27fa`. Full suite
3647/3647 unchanged (no regressions). Controller independently re-ran both
real typechecks — 0 errors confirmed — and grepped the actual code for all
five fixes (resetPullCursors, memoryKeys?.master guard, teamMasterKeys.clear)
— all genuinely present. Dispatched scoped re-review on `opus` (same tier as
the original, given the stakes), `review-11a7831..3be27fa.diff`, told to
ignore the intervening docs-only `a2fd570` spec commit and to NOT re-flag the
deliberately-deferred fail-closed-gate item.

**Re-review verdict: all 5 findings addressed, no new Critical/Important
breakage.** Cursor-reset order of operations traced precisely (always after
the master key is set, only on the success path, never on a thrown error).
Confirmed `resetPullCursors()` has no WHERE clause, so it covers team
partitions too. Two new Minors found (non-blocking):

- `Task 11: minor (deferred): status handler's catch fallback returns exactly the "not activated" shape its own comment says it must never return — personal encryption solved this with a separate estadoRemotoLeido flag; team's offline UI could show a misleading "Activate" button on an already-encrypted team. Bounded damage: server rejects with 409 before touching anything.`
- `Task 11: minor (deferred): since the team key isn't persisted, every adopt-on-launch triggers a FULL resetPullCursors()/clearUndecryptable() across the whole account (not just team partitions) — re-downloads everything on every app start once a team is encrypted. Correct but costly; worth scoping the reset to team: partitions specifically, or persisting the key, as a fast-follow alongside the already-deferred fail-closed-gate item.`

Task 11: fix round 1/5 (5 addressed, 0 open; commits 11a7831..3be27fa)
Task 11: complete (commits f57aee3..3be27fa, 1 fix round, review clean — 2 new minors parked)

## Task 12: TeamEncryptionCard.tsx — UI, gateada por rol

BASE: `3be27fa`. Dispatched to `general-purpose` on `haiku` (mirrors existing
shipped `MemoryEncryptionCard.tsx`, complete code given). Implementer
reported **DONE**: commit `1fd55d6`, 4/4 passing, both real typechecks 0
errors per their own report. Report: `task-12-report.md`.

Controller independently re-ran both real typechecks — 0 errors confirmed —
and confirmed the card is genuinely mounted (`MemoriesWorkspace.tsx:19,274`).
**Found and fixed a real plan defect**: the brief's draft test imported
`@testing-library/user-event`, which is NOT an installed dependency of this
repo (confirmed: not in `package.json`, not in `node_modules`). The
implementer correctly caught this themselves and used `fireEvent` from
`@testing-library/react` instead — verified by running the actual test file
myself (4/4 real pass). Fixed the plan text to match (commit `4554255`). Same
stale-IDE false alarms as every prior task (now referencing the OLD,
already-fixed import).

Review package generated (`review-3be27fa..1fd55d6.diff`), dispatched reviewer
on `sonnet` with explicit emphasis on the leader/member role gate (the one
access-control property this UI must get right) and the auto-adopt effect.

**Review verdict: ✅ Spec compliant, role gate correct and consistently
applied, no Critical findings.** Two Important findings — both real security-
UX regressions versus the sibling `MemoryEncryptionCard.tsx` pattern, both
MY bugs (missing from the plan text, not implementer deviations):
1. No device fingerprint shown before authorizing a pending device — the
   concrete UI mitigation this repo's CLAUDE.md documents for a real,
   named attack (server substitutes a device's public key; without a visual
   fingerprint check, the victim adopts it without any warning).
2. No "remote state unknown" gate — personal encryption refuses to offer
   "Activate" if the status fetch couldn't be confirmed (activating blind
   can fork the key and strand devices); team had no equivalent.

**Ruling**: fix now, same implementer, spanning TWO files (`main.ts`'s status
handler needs to surface `estadoRemotoLeido`/`huellaPropia`/
`huellasPorDevice`, plus `types.ts` and `TeamEncryptionCard.tsx` to consume
them) — both fixes mirror an already-proven, already-shipped pattern in the
personal sibling file, low risk, and this is the last UI-touching task before
the final e2e.

Fix round 1 applied: commits `1fd55d6` (original) + `a70ba00`. Focused 6/6.
Implementer's report flagged "unrelated failures in other modules" on the
full suite — **investigated myself rather than trusting the claim**: all
failures were `better-sqlite3` native-binding ABI mismatches (documented
CLAUDE.md gotcha, needs `npm run native:node` before tests). Ran that myself,
re-ran the full suite clean: **3498/3504 passed, 6 skipped, 0 failed** —
confirmed the claim was accurate, not a cover for a real regression.
Controller independently re-ran both real typechecks — 0 errors confirmed.
Dispatched scoped re-review on `sonnet` (`review-1fd55d6..a70ba00.diff`, told
to ignore the intervening docs-only `4554255` plan commit, and informed the
full-suite claim was already independently verified clean).

**Re-review verdict: both original findings addressed, but ONE NEW Important
issue found in round 1's own diff:** `huellaPropia` (this device's OWN
fingerprint) is computed and typed but never rendered anywhere — only the
LEADER's half of the fingerprint-verification loop (seeing each pending
device's fingerprint) was wired; the pending DEVICE's half (reading its own
fingerprint to relay out-of-band) is missing, so the two-party comparison
the mitigation depends on isn't actually achievable. Dispatched fix round 2
to the same implementer (plus a cheap dead-code cleanup in main.ts).

Fix round 2 applied: commit `3bcc151`. Focused 7/7, full suite 361 files/3654
tests passing (this time run with the native binding already fixed).
Controller independently re-ran both real typechecks — 0 errors — and
confirmed `huellaPropia` genuinely renders (`TeamEncryptionCard.tsx:16,177,183`).
Dispatched scoped re-review round 2 on `sonnet` (`review-a70ba00..3bcc151.diff`).

**Re-review verdict: All findings addressed, no new Critical/Important
breakage.** `huellaPropia` renders in the correct branch with a correct null
guard, exact visual match to the personal sibling, and a real test exercises
it. Dead-code removal confirmed genuinely dead.

Task 12: fix round 1/5 (2 addressed, 0 open; commits 1fd55d6..a70ba00)
Task 12: fix round 2/5 (1 addressed, 0 open; commits a70ba00..3bcc151)
Task 12: complete (commits 3be27fa..3bcc151, 2 fix rounds, review clean)

## Task 13: integración real de punta a punta (el último task)

BASE: `3bcc151`. Dispatched to `general-purpose` on `sonnet` (real e2e
infrastructure — Docker, local server, real Electron build/launch — plus
judgment to adapt e2e 13's helpers rather than reinvent them). Briefed
explicitly on the native-binding gotcha (needs `native:electron` to build/run
the app, not the `native:node` swap used for vitest earlier in this session).

**PAUSED mid-task at Gero's request ("frena guardá todo y seguimos mañana").**
Stopped the implementer agent via TaskStop while it was mid-debugging (last
message: "Good, debug server is up. Now rerun the test and inspect the
server's pull-debug log" — it had NOT reached a passing test yet). It had
uncommitted WIP across 4 files — committed as-is, unreviewed, clearly labeled
WIP (`babd099`):
- `e2e/16-cifrado-de-equipo.spec.ts` (new, untracked) — does NOT pass yet,
  has undefined names (`preservarHome`, `envDeHomePreservado`) it never got
  to define.
- `e2e/helpers/harness.ts` — additive, backward-compatible extension
  (`homeDir` reuse across `launchHarness` calls + `teardown({keepHomeDir})`)
  to relaunch the SAME local identity across two launches without losing
  safeStorage/DPAPI-derived keys. Looks sound on a read-through, but
  UNREVIEWED — treat as a hypothesis until Task 13 actually passes with it.
- `electron/memory-daemon.ts`, `server/src/pull.ts` — diagnostic logging
  gated behind `NEST_E2E_PULL_DEBUG`, inert without that env var. Probably
  needs removing before Task 13's real review, once the test is green.

**Cleanup performed before pausing** (processes left behind by the
interrupted test run, none of them the user's real app):
- Killed 10 orphaned `electron.exe` processes — all running
  `dist-electron/memory-mcp.js` (the MCP subprocess `promoverPorMcp` spawns
  per test iteration), none running the real app (`main.js`); confirmed via
  command-line inspection before killing. **Side effect**: this also
  disconnected this session's own `nest_memory` MCP tool (it shares the same
  process family) — not data loss, just a dropped local connection.
- Killed the orphaned local sync server process on port 8099.
- Left `nest-memory-pg` Docker container running (cheap, local-only,
  consistent with how it's been left across every earlier pause this
  session).
- `git status` clean after the WIP commit.

**To resume tomorrow:** read this ledger entry, then `git log -1` to confirm
`babd099` is HEAD, then re-read `e2e/13-equipo-dos-cuentas.spec.ts` and the
new `e2e/16-cifrado-de-equipo.spec.ts` together to pick up the thread — the
e2e needs `docker start nest-memory-pg`, the local server on :8099
(`PORT=8099 npx tsx src/index.ts` from `server/`), and `npm run
native:electron` before building/running the app (this session ended with
the Node-flavored native binding active, from earlier `vitest` runs).

## 2026-10-15 — Task 13 retomado
- e2e/16 pasa (2x repeat), e2e/13 4 passed, 3655 unit, typechecks 0. Commits `6e9ab96` (fix carrera reset de cursores vs pull en vuelo + saca logging NEST_E2E_PULL_DEBUG) y `0a849ae` (e2e/16).
- BUG ABIERTO: B sólo descifra si compartió su copia del proyecto (clave de equipo se busca por `projects.team_id` local). e2e/16 tiene WORKAROUND + `test.fixme` que lo reproduce. Decisión de Gero pendiente: (a) server manda team_id en pull, (b) probar todas las claves, (c) marcar proyectos al adoptar.
- Sin review todavía de Task 13 ni review final de rama.

## 2026-10-15 — fixes de la code review de Tasks 13–14
Commits: `a8872f1` (cliente: I1, M1, M2, M6, M7 + §9.4), `78d0492` (servidor: M4), `9836262` (e2e/16: I2 + unitario de la espera a la readopción).
- I1: fila de equipo ilegible con `team_id` del servidor ya NO marca el equipo; contra servicio viejo entra como provisorio (`meta.encrypted_team_ids_provisional`), el primer status con `encrypted_teams` lo descarta y libera `team_key_missing`. Lo confirmado por el servidor no se olvida. `encryptedTeamIds()` = unión.
- M1: `team_encryption_required` con `team_id` local → equipo confirmado + fila como `team_key_missing`. Sin `team_id` local queda como rechazo. Se mantuvo "confirmado" como pidió el controller; edge documentado en §9.4: si el `team_id` local está viejo justo en ese rechazo, se confirma el equipo equivocado.
- M2: `meta.undecryptable_team_ids` (`'*'` = equipo desconocido); `hayIlegiblesDeEquipos(adoptados)`; se limpia con `clearUndecryptable()`. Sin subir SCHEMA_VERSION. El cruce sync_id→observación que sugería la review no es posible: las ilegibles no se aplican localmente.
- M4: `viajaSellado` mira title, content, project_display_name, content_hash, origin_account + tags.
- M6: borrado el `if (gen) return body` muerto. M7: pendiente con generación de store, aplicado en `resume()` si el store se conservó.
- I2: la memoria pos-arranque se escribe con la app CERRADA (MemoryStore del paquete compilado); poll mira `rejected_pushes`. Mutaciones verificadas: sin gate + sin readopción → e2e cae ("rechazada"); readopción sin await → el e2e NO lo detecta (la readopción gana la carrera), lo cubre el unitario nuevo.
- Verificación: typechecks 0/0, npm test 3688 ok + 1 flaky de carga (`llavero-real`, pasa aislado), server 409/409, e2e/16 x2 ok, e2e/13 4/4.
- Follow-ups NO hechos (decisión del controller, el cifrado de equipo nunca salió): **M3** contador de resets de cursores entre procesos (`pullCursorResetCount` es por instancia); **M5** clientes pre-Task 14 que tratan `team_encryption_required` como terminal.
- Abierto: re-share de un proyecto con filas selladas entre equipos (de diseño, §9.4). El MCP del paquete en modo `nest` escribe sin `setCurrentUser`: en una instalación con dueño las filas quedan "sin reclamar" y la app no las empuja (fuera de alcance, sin verificar en la app real).

## 2026-10-15 — Task 15: arreglos de la review final
Commits: `e391524` (plan), `39d8d88` (server C2/C1/I1/I2/minors), `787228c` (cliente C2), `d902be4` (migración desde lo pendiente, primera versión), `e3abcd7` (I4 personal + equipo), `59b3a03` (main + tarjeta: I3, C1 UI, minors), `e5275d9` (C1 rehecho: recrypt-pending con contenido), `3b3b2e1` (e2e/16), `a1ace4b` (docs + I5).
- C2: team_keys.verifier = sha256(proof), proof = HMAC(maestra, "nest-memory/team-proof-v1/<team_id>"). authorize/recrypt exigen proof (403 must_hold_team_key). El GET muestra el verifier; el cliente rechaza (TeamKeyMismatchError) toda maestra que no coincide: adopt, readopción de arranque, recover. authorize sigue con upsert (con prueba).
- C1 DESVÍO: el plan decía "buscar local por sync_id + un pull". e2e/16 mostró que el pull sólo baja project_keys que el device ya tiene → una fila de un repo que el leader no clonó no llega nunca. recrypt-pending devuelve el contenido (leader-only, de a 200) y migrateTeam sella esa versión. Documentado en plan y spec.
- I1: already_sealed / stale (lamport); recrypt no toca lamport. I2: content null. I3: migración automática al activar, lotes 200/1 MiB, 429 con Retry-After, parciales + error; limiter propio 60/min. I4: huella mostrada viaja al IPC (personal y equipo). I5: gitignore restaurado (*/* + !*/shots/), progress.md sigue ignorado.
- Minors: team_id no-uuid → 400; activate exige slot recovery y slot device = auth.deviceId; tarjeta pide cifrado personal primero; member no ve recovery.
- Verificación: typechecks 0/0, npm test 3712 passed (6 skipped), server 430/430 + tsc, e2e/16 x2 ok, e2e/13 4/4, e2e/04 2/2.
- Abierto: re-share entre equipos, M3, M5 (sin tocar). Un operador con escritura en la base puede reemplazar envoltura+verifier juntos (mitigado sólo por huellas). enrollDeviceKey borra key_wraps personales al cambiar la pública pero NO team_key_wraps (no pedido, sin tocar).

## 2026-10-15 — Task 15b: arreglos de la review de Task 15
Commits: `753e0c9` (I1 + plan), `8e2f602` (server: I2, Minor 1, Minor 2), `a191c1e` (cliente I2, Minor 3, Minor 4), `6598b8f` (spec/docs/e2e/16, Minor 5).
- Los 7 hallazgos verificados contra el código: todos reales, ninguno falso.
- I1: enrollDeviceKey borra también `team_key_wraps where slot = device_id` (todos los equipos; 'recovery' no se toca) en el mismo if/transacción.
- I2: recrypt-pending devuelve project_key + topic_key; el cliente manda hmacTopicKey(clave de equipo, project_key, 'team', tema) — test fija que es idéntico a sealMutationPayload de una fila nueva. Server: topic null queda null; con tema y sin HMAC → `missing_topic_key` (sigue pendiente); topic_key con forma no-HMAC → 400 invalid_fields; colisión con fila viva = push.ts (advisory lock `${projectId}:team:${hmac}`, resolveTopicCollision por updatedAt→lamport→syncId, perdedor superseded_by, la otra con seq nuevo). OJO: el criterio es el de push (client_updated_at primero), no "menor lamport" como sugería el pedido.
- Minor 1: predicado único enClaro() (title, content, content_hash, origin_account, tags ≠ [] y ≠ ["nmc1:…"]); topic_key fuera a propósito (HMAC indistinguible de un tema de 32 hex; se sella en la misma escritura que el title).
- Minor 2: pending corta por ~1 MiB con sum() over (order by sync_id) sobre la página keyset; siempre ≥1 fila.
- Minor 3: GET /v1/teams/key suma `isLeader`; main usa `pendientesSiEsLeader` (sólo activated + isLeader + hasMaster). Desvío: la info de rol sale del servidor (no hay rol en main).
- Minor 4: deriveKeys/teamKeyProof adentro del try de migrateTeam.
- Minor 5: documentado en spec §2.1.
- e2e/16 extendido con una memoria con topic_key (verificado que cae con remaining=1 si el cliente no manda el HMAC).
- Verificación: typechecks 0/0; npm test 3719 passed / 6 skipped (1ª corrida: 5 timeouts de jsdom por carga, 2ª limpia); server 445/445; e2e/16 x2 ok; e2e/13 4/4. Server :8099 levantado y matado; binding final = electron.
- Abierto (NO tocado, pide decisión): el topic hasher LOCAL (`applyTopicHasher` en main.ts) usa la clave PERSONAL también para filas `scope: 'team'`, así que el `topic_key_hmac` local de una fila de equipo propia no coincide con el HMAC de equipo que baja del pull → el supersede LOCAL entre autores no se encuentra. El del servidor sí funciona. Pre-existente. También pre-existente: recrypt toma el lock de la fila y después el del proyecto (allocateSeqRange); push toma proyecto→fila. Orden inverso = deadlock posible bajo concurrencia (Postgres aborta uno; el cliente reintenta en la próxima corrida).
