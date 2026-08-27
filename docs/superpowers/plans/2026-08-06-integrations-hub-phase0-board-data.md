# Integrations Hub — Phase 0, Plan 1: Board Data Layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, tested data layer that projects real tickets (H3), worktree state, and CI/review signals (H4) into board rows with a derived agent status and a derived org/personal scope — the backbone every Hub view renders.

**Architecture:** Three pure functions in one focused module (`src/integrations/board.ts`), no I/O, no React, no Electron. They consume the DTOs that already cross IPC (`Ticket`, `WorktreeMeta`, `WorktreeSignalDTO` from `src/types.ts`) plus a branch↔ticket link list (exposed from the main-side ticket-loop in Plan 2). Unit-tested under the vitest `node` project by dependency injection, matching the repo's engine-test pattern.

**Tech Stack:** TypeScript, Vitest (node project), existing types in `src/types.ts`.

**Scope note:** This plan ships the data layer only. Plan 2 = Integrations section shell + Table view (renders `projectBoard`). Plan 3 = connected layer (scope chip/filter/presence/jump). Plan 4 = rail (compact bot widget + Needs-you + Activity) + `@Nest` orchestration intents. Plan 5 = move/create-worktree picker + Recipes editor. Each is independently shippable.

---

## File Structure

- Create: `src/integrations/board.ts` — the three pure functions + exported types (`Scope`, `AgentStatus`, `BoardRow`, `BoardInputs`).
- Create: `src/__tests__/board.test.ts` — unit tests (runs under the vitest `node` project; no DOM).

`src/integrations/` already holds renderer-side integration code (`registry.ts`, `types.ts`, `ipcAdapter.ts`); the board projection lives beside them. Types are imported from `src/types.ts` (the renderer never imports from `electron/`).

---

### Task 1: `deriveScope` — org vs personal from the repo owner

**Files:**
- Create: `src/integrations/board.ts`
- Test: `src/__tests__/board.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/board.test.ts
import { describe, it, expect } from 'vitest'
import { deriveScope } from '../integrations/board'

describe('deriveScope', () => {
  it('is personal when there is no repo', () => {
    expect(deriveScope(null, 'gero')).toEqual({ kind: 'personal' })
  })
  it('is personal when the owner is the signed-in user (case-insensitive)', () => {
    expect(deriveScope('Gero/dotfiles', 'gero')).toEqual({ kind: 'personal' })
  })
  it('is org when the owner is not the user', () => {
    expect(deriveScope('RAVEN/raven-nest', 'gero')).toEqual({ kind: 'org', org: 'RAVEN' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/board.test.ts`
Expected: FAIL — `Failed to resolve import '../integrations/board'` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/integrations/board.ts
export type Scope = { kind: 'org'; org: string } | { kind: 'personal' }

/** Org vs personal from a "owner/repo" full name. `null` repo → personal. */
export function deriveScope(repoFullName: string | null, personalLogin: string): Scope {
  if (!repoFullName) return { kind: 'personal' }
  const owner = repoFullName.split('/')[0]
  if (!owner || owner.toLowerCase() === personalLogin.toLowerCase()) {
    return { kind: 'personal' }
  }
  return { kind: 'org', org: owner }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/board.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add src/integrations/board.ts src/__tests__/board.test.ts
git commit -m "feat(hub): deriveScope — org vs personal from repo owner"
```

---

### Task 2: `deriveStatus` — the board agent status

Derives the amber/yellow/green status shown per task. `needs_you` wins (it pulls the human in); `idle`/`needs_input` heuristics are epic B and intentionally out of scope here.

**Files:**
- Modify: `src/integrations/board.ts`
- Test: `src/__tests__/board.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to src/__tests__/board.test.ts
import { deriveStatus } from '../integrations/board'

describe('deriveStatus', () => {
  it('needs_you when changes are requested', () => {
    expect(deriveStatus('in_review', 'done', { ci: 'success', changesRequested: true })).toBe('needs_you')
  })
  it('needs_you when CI failed', () => {
    expect(deriveStatus('in_progress', 'done', { ci: 'failure', changesRequested: false })).toBe('needs_you')
  })
  it('done when the ticket is done and no red signal', () => {
    expect(deriveStatus('done', 'done', { ci: 'success', changesRequested: false })).toBe('done')
  })
  it('working while the worktree setup is running', () => {
    expect(deriveStatus('in_progress', 'running', null)).toBe('working')
  })
  it('todo when the ticket is todo and has no worktree', () => {
    expect(deriveStatus('todo', null, null)).toBe('todo')
  })
  it('working when in progress with no worktree yet', () => {
    expect(deriveStatus('in_progress', null, null)).toBe('working')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/board.test.ts`
Expected: FAIL — `deriveStatus is not a function` (not exported yet).

- [ ] **Step 3: Write minimal implementation**

```ts
// append to src/integrations/board.ts
import type { TicketState, WorktreeMeta, WorktreeSignalDTO } from '../types'

export type AgentStatus = 'todo' | 'working' | 'needs_you' | 'done'

/**
 * Board status per task. Precedence: a red signal (changes requested / CI
 * failure) always surfaces as `needs_you`; then ticket `done`; then an active
 * worktree is `working`; a todo ticket with no worktree is `todo`; anything
 * else in flight is `working`. `idle`/`needs_input` are epic B, not here.
 */
export function deriveStatus(
  ticketState: TicketState,
  setupState: WorktreeMeta['setupState'] | null,
  signal: { ci: WorktreeSignalDTO['ci']; changesRequested: boolean } | null,
): AgentStatus {
  if (signal && (signal.changesRequested || signal.ci === 'failure')) return 'needs_you'
  if (ticketState === 'done') return 'done'
  if (setupState === 'running') return 'working'
  if (setupState == null) return ticketState === 'todo' ? 'todo' : 'working'
  return 'working'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/board.test.ts`
Expected: PASS (9 passing total).

- [ ] **Step 5: Commit**

```bash
git add src/integrations/board.ts src/__tests__/board.test.ts
git commit -m "feat(hub): deriveStatus — board agent status from ticket + worktree + signals"
```

---

### Task 3: `projectBoard` — join tickets ↔ worktrees ↔ signals into rows

**Files:**
- Modify: `src/integrations/board.ts`
- Test: `src/__tests__/board.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to src/__tests__/board.test.ts
import { projectBoard, type BoardInputs } from '../integrations/board'
import type { Ticket, WorktreeMeta, WorktreeSignalDTO } from '../types'

const ticket = (key: string, state: Ticket['state'], title = key): Ticket => ({
  key, providerId: `id-${key}`, title, url: `https://x/${key}`, state, context: '',
})
const wt = (branch: string, repoPath: string, setupState: WorktreeMeta['setupState'] = 'running'): WorktreeMeta => ({
  repoPath, rootRepoPath: repoPath, branch, setupState,
  declaredPorts: [], detectedPorts: [], createdAt: 0, updatedAt: 0,
})

describe('projectBoard', () => {
  it('joins a linked ticket to its worktree, signal, scope and status', () => {
    const inp: BoardInputs = {
      tickets: [{ pluginId: 'github', ticket: ticket('#189', 'in_review', 'Race board') }],
      worktrees: [wt('gero/189-race', '/repos/raven-nest')],
      signals: [{ repoPath: '/repos/raven-nest', ci: 'success', changesRequested: true, prNumber: 42 }],
      links: [{ branch: 'gero/189-race', ticketKey: '#189' }],
      personalLogin: 'gero',
      repoFullName: () => 'RAVEN/raven-nest',
    }
    const [row] = projectBoard(inp)
    expect(row).toMatchObject({
      key: '#189', pluginId: 'github', title: 'Race board', branch: 'gero/189-race',
      worktreePath: '/repos/raven-nest', repoFullName: 'RAVEN/raven-nest',
      scope: { kind: 'org', org: 'RAVEN' }, status: 'needs_you',
      ci: 'success', changesRequested: true, prNumber: 42,
    })
  })

  it('handles an unlinked ticket: no worktree, personal scope, status from ticket state', () => {
    const inp: BoardInputs = {
      tickets: [{ pluginId: 'github', ticket: ticket('#221', 'todo') }],
      worktrees: [], signals: [], links: [],
      personalLogin: 'gero', repoFullName: () => null,
    }
    const [row] = projectBoard(inp)
    expect(row).toMatchObject({
      key: '#221', branch: null, worktreePath: null, repoFullName: null,
      scope: { kind: 'personal' }, status: 'todo', changesRequested: false, ci: null, prNumber: null,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/board.test.ts`
Expected: FAIL — `projectBoard is not a function` / `BoardInputs` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to src/integrations/board.ts
export interface BoardRow {
  key: string
  title: string
  url: string
  providerId: string
  pluginId: string
  ticketState: TicketState
  status: AgentStatus
  branch: string | null
  worktreePath: string | null
  repoFullName: string | null
  scope: Scope
  ci: WorktreeSignalDTO['ci'] | null
  changesRequested: boolean
  prNumber: number | null
}

export interface BoardInputs {
  /** tickets from every connected provider (TicketsBridge.list per plugin). */
  tickets: Array<{ pluginId: string; ticket: Ticket }>
  /** all worktrees (worktree-store). */
  worktrees: WorktreeMeta[]
  /** CI/review signals keyed by worktree repoPath (SignalsBridge.list). */
  signals: WorktreeSignalDTO[]
  /** branch↔ticket links from the main ticket-loop (H3). */
  links: Array<{ branch: string; ticketKey: string }>
  /** signed-in GitHub login, to tell org from personal. */
  personalLogin: string
  /** repoPath → "owner/repo" full name (or null if unknown). */
  repoFullName: (repoPath: string) => string | null
}

/** Pure join: one BoardRow per ticket, enriched with its linked worktree/signal. */
export function projectBoard(inp: BoardInputs): BoardRow[] {
  const branchByKey = new Map(inp.links.map((l) => [l.ticketKey, l.branch]))
  const wtByBranch = new Map(inp.worktrees.map((w) => [w.branch, w]))
  const sigByPath = new Map(inp.signals.map((s) => [s.repoPath, s]))

  return inp.tickets.map(({ pluginId, ticket }) => {
    const branch = branchByKey.get(ticket.key) ?? null
    const wt = branch ? wtByBranch.get(branch) ?? null : null
    const sig = wt ? sigByPath.get(wt.repoPath) ?? null : null
    const full = wt ? inp.repoFullName(wt.repoPath) : null
    return {
      key: ticket.key,
      title: ticket.title,
      url: ticket.url,
      providerId: ticket.providerId,
      pluginId,
      ticketState: ticket.state,
      status: deriveStatus(
        ticket.state,
        wt?.setupState ?? null,
        sig ? { ci: sig.ci, changesRequested: sig.changesRequested } : null,
      ),
      branch,
      worktreePath: wt?.repoPath ?? null,
      repoFullName: full,
      scope: deriveScope(full, inp.personalLogin),
      ci: sig?.ci ?? null,
      changesRequested: sig?.changesRequested ?? false,
      prNumber: sig?.prNumber ?? null,
    }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/board.test.ts`
Expected: PASS (11 passing total).

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npx vitest run`
Expected: PASS — existing suite green + the new `board.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/integrations/board.ts src/__tests__/board.test.ts
git commit -m "feat(hub): projectBoard — join tickets/worktrees/signals into board rows"
```

---

## Self-Review

- **Spec coverage:** Implements the board data model behind spec §5.2 (board data sources) and §5.3 (scope derivation). Table/Worktrees rendering (§5.2 UI), presence/filter/jump (§5.3 UI), rail/bot (§5.4/§6), picker (§7), Recipes (§9) are explicitly deferred to Plans 2–5 (noted in the scope note).
- **Placeholders:** none — every step has complete code and an exact run command.
- **Type consistency:** `Scope`/`AgentStatus`/`BoardRow`/`BoardInputs` are defined in Task 1–3 and reused consistently; inputs use the real `Ticket`/`WorktreeMeta`/`WorktreeSignalDTO`/`TicketState` from `src/types.ts`. `WorktreeSignalDTO` has no `reviewRequested` field, so `BoardRow` deliberately omits it (review.requested is a separate event handled in a later plan).
- **Open dependency for Plan 2:** the `links` (branch↔ticketKey) and `repoFullName(repoPath)` inputs must be supplied by a small main-side addition (expose the ticket-loop's tracked branch→ticket map + repo full-name lookup over IPC). That wiring is Plan 2, Task 1.
