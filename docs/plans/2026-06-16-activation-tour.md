# Activation Tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 4th onboarding tour `activation` that auto-launches on first run, walks the new user through opening a terminal, connecting repos and team collaboration, reusing the existing narrated tour engine untouched.

**Architecture:** `activation` is a static `TourDef` (5 Next-only steps) registered like the other three tours. The launcher (App.tsx) auto-fires it once on first run (`isInitialState && !tourSeen`), expands the sidebar so its items are good spotlight targets, and exposes re-entry via a "?" button on the `EmptyState` and Settings → Tutorial. The narrated engine `OnboardingTour` is not modified.

**Tech Stack:** React + TypeScript, Vitest, existing `src/tutorial/*` (TourDef/registry/OnboardingTour), `useTourSeen` hook.

**Spec:** `docs/specs/2026-06-16-activation-tour-design.md`

---

## File Structure

- **Create** `src/tutorial/tours/activation.ts` — the `activationTour: TourDef` (5 steps, bilingual copy).
- **Modify** `src/tutorial/registry.ts` — register `activationTour`.
- **Modify** `src/__tests__/tutorial/section-tours.test.ts` — contract coverage for `activation`.
- **Modify** `src/App.tsx` — `data-tour-id` on the EmptyState button; `openTutorial` helper; auto-launch effect; `EmptyState` "?" button + `onStartTutorial` prop.
- **Modify** `src/components/Sidebar.tsx` — `data-tour-id` on Team and My Repos items.
- **Modify** `src/components/SettingsPanel.tsx` — "Tutorial: Getting Started" entry.

**Testing note:** Only the tour definition is unit-testable (contract test, Task 1), matching how `my-repos`/`teams` shipped. The wiring (anchors, auto-launch, "?" button) is verified by `tsc`, grep and manual Electron checks — mounting the whole `App` in jsdom to test an auto-launch effect is not the repo's pattern. This is intentional, not an omission.

---

## Task 1: `activation` tour definition + contract test

**Files:**
- Create: `src/tutorial/tours/activation.ts`
- Modify: `src/tutorial/registry.ts`
- Test: `src/__tests__/tutorial/section-tours.test.ts`

- [ ] **Step 1: Update the contract test to expect `activation` (failing)**

Replace the entire contents of `src/__tests__/tutorial/section-tours.test.ts` with:

```ts
// src/__tests__/tutorial/section-tours.test.ts
import { describe, it, expect } from 'vitest'
import { getTour, listTourIds } from '../../tutorial/registry'
import type { TourId } from '../../tutorial/types'

const SECTION_TOURS: Record<string, string[]> = {
  activation: ['welcome', 'new-terminal', 'my-repos', 'team', 'outro'],
  'my-repos': ['header', 'add', 'nav', 'list', 'actions'],
  teams: ['header', 'switcher', 'repos', 'members', 'chat'],
}

describe('tours registry', () => {
  it('registers all four tours', () => {
    expect([...listTourIds()].sort()).toEqual(['activation', 'my-repos', 'teams', 'worktrees'])
  })

  for (const [id, ids] of Object.entries(SECTION_TOURS)) {
    describe(id, () => {
      const tour = getTour(id as TourId)

      it('is registered with the expected steps', () => {
        expect(tour).toBeDefined()
        expect(tour!.steps.map((s) => s.id)).toEqual(ids)
      })

      it('is bilingual, Next-only, and anchored to a data-tour-id', () => {
        for (const s of tour!.steps) {
          expect(s.title.en.length).toBeGreaterThan(0)
          expect(s.title.es.length).toBeGreaterThan(0)
          expect(s.body.en.length).toBeGreaterThan(0)
          expect(s.body.es.length).toBeGreaterThan(0)
          expect(s.advanceOnClick).toBeUndefined()
          expect(s.advanceOnAction).toBeUndefined()
          expect(s.anchor).toMatch(/^\[data-tour-id="/)
        }
      })
    })
  }
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/__tests__/tutorial/section-tours.test.ts`
Expected: FAIL — `registers all four tours` fails (`activation` not in `listTourIds()`) and the `activation` describe fails (`getTour('activation')` is `undefined`).

- [ ] **Step 3: Create the tour definition**

Create `src/tutorial/tours/activation.ts`:

```ts
// src/tutorial/tours/activation.ts
import { type TourDef } from '../types'

/**
 * First-run onboarding ("aha moment"). Narrated / Next-only over the live app.
 * Auto-launches once on first run; the launcher expands the sidebar so the
 * My Repos / Team items are good spotlight targets. Static for every plan: a
 * trial user (effective plan 'team' for 15 days) sees the My Repos / Team steps
 * without hitting the paywall; for a post-trial Free user those steps act as an
 * upgrade funnel. Never enters a modal and never advances on action.
 */
export const activationTour: TourDef = {
  id: 'activation',
  steps: [
    {
      id: 'welcome',
      anchor: '[data-tour-id="empty-new-terminal"]',
      title: { en: 'Welcome to Nest', es: 'Bienvenido a Nest' },
      body: {
        en: "Your multi-AI terminal workspace. You've got 15 days of Team to try everything — here's a 30-second tour.",
        es: 'Tu workspace de terminales multi-IA. Tenés 15 días de Team para probar todo — acá va un tour de 30 segundos.',
      },
      placement: 'bottom',
    },
    {
      id: 'new-terminal',
      anchor: '[data-tour-id="empty-new-terminal"]',
      title: { en: 'Open your first agent', es: 'Abrí tu primer agente' },
      body: {
        en: 'Start a real terminal running Claude, Codex, Gemini or any CLI agent. This is where the work happens.',
        es: 'Arrancá una terminal real con Claude, Codex, Gemini o cualquier agente CLI. Acá pasa todo.',
      },
      placement: 'bottom',
    },
    {
      id: 'my-repos',
      anchor: '[data-tour-id="sidebar-myrepos"]',
      title: { en: 'Your repos', es: 'Tus repos' },
      body: {
        en: 'Connect GitHub or GitLab and bring your repositories. Link a local folder to open a terminal in any of them.',
        es: 'Conectá GitHub o GitLab y traé tus repositorios. Linkeá una carpeta local para abrir una terminal en cualquiera.',
      },
      placement: 'right',
    },
    {
      id: 'team',
      anchor: '[data-tour-id="sidebar-team"]',
      title: { en: 'Work as a team', es: 'Trabajen en equipo' },
      body: {
        en: 'Invite your teammates and collaborate in the same terminals in real time.',
        es: 'Invitá a tu equipo y colaboren en las mismas terminales en tiempo real.',
      },
      placement: 'right',
    },
    {
      id: 'outro',
      anchor: '[data-tour-id="empty-new-terminal"]',
      title: { en: "You're set", es: 'Listo' },
      body: {
        en: 'Reopen any tour anytime from the "?" buttons or Settings → Tutorial. Now open a terminal and dive in.',
        es: 'Reabrí cualquier tour cuando quieras desde los botones "?" o Settings → Tutorial. Ahora abrí una terminal y a darle.',
      },
      placement: 'bottom',
    },
  ],
}
```

- [ ] **Step 4: Register the tour**

Replace the contents of `src/tutorial/registry.ts` with:

```ts
// src/tutorial/registry.ts
import type { TourDef, TourId } from './types'
import { worktreesTour } from './tours/worktrees'
import { myReposTour } from './tours/my-repos'
import { teamsTour } from './tours/teams'
import { activationTour } from './tours/activation'

/** All registered tours. */
const tours: Record<string, TourDef> = {
  [worktreesTour.id]: worktreesTour,
  [myReposTour.id]: myReposTour,
  [teamsTour.id]: teamsTour,
  [activationTour.id]: activationTour,
}

export function getTour(id: TourId): TourDef | undefined {
  return tours[id]
}

export function listTourIds(): TourId[] {
  return Object.keys(tours) as TourId[]
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- src/__tests__/tutorial/section-tours.test.ts`
Expected: PASS — all describes green, including `activation`.

- [ ] **Step 6: Commit**

```bash
git add src/tutorial/tours/activation.ts src/tutorial/registry.ts src/__tests__/tutorial/section-tours.test.ts
git commit -m "feat(tutorial): activation tour definition + contract test"
```

---

## Task 2: `data-tour-id` anchors for the activation steps

**Files:**
- Modify: `src/App.tsx` (EmptyState button, ~1305)
- Modify: `src/components/Sidebar.tsx` (Team item ~536, My Repos item ~578)

- [ ] **Step 1: Add the anchor to the EmptyState "+ New Terminal" button**

In `src/App.tsx`, find the `EmptyState` function (~1297) and add `data-tour-id="empty-new-terminal"` to the primary button:

```tsx
      <button className="btn-primary" data-tour-id="empty-new-terminal" onClick={onNewPane}>
        + New Terminal
      </button>
```

- [ ] **Step 2: Add the anchor to the Team sidebar item**

In `src/components/Sidebar.tsx`, find the Team item div (~536, the one with `onClick={onTeamsOpen}`) and add `data-tour-id="sidebar-team"`:

```tsx
        <div
          className="sidebar-item sidebar-item-panel sidebar-item-team"
          data-tour-id="sidebar-team"
          style={{ cursor: 'pointer', position: 'relative' }}
          onClick={onTeamsOpen}
          title={pendingInvitesCount > 0 ? `Team — ${pendingInvitesCount} pending invite${pendingInvitesCount === 1 ? '' : 's'}` : 'Team'}
        >
```

- [ ] **Step 3: Add the anchor to the My Repos sidebar item**

In `src/components/Sidebar.tsx`, find the My Repos item div (~578, the one with `title="My Repos"`) and add `data-tour-id="sidebar-myrepos"`:

```tsx
        <div
          className="sidebar-item sidebar-item-panel sidebar-item-team"
          data-tour-id="sidebar-myrepos"
          style={{ cursor: 'pointer' }}
          onClick={plan === 'pro' || plan === 'team' || plan === 'enterprise' ? onMyReposOpen : onUpgrade}
          title="My Repos"
        >
```

- [ ] **Step 4: Verify all three anchors exist and match the tour**

Run: `git grep -n 'data-tour-id="empty-new-terminal"\|data-tour-id="sidebar-team"\|data-tour-id="sidebar-myrepos"' src/App.tsx src/components/Sidebar.tsx`
Expected: 3 matches — one per anchor. They must exactly equal the `anchor` strings used in `src/tutorial/tours/activation.ts`.

- [ ] **Step 5: Typecheck**

Run: `npx tsc -p tsconfig.web.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/Sidebar.tsx
git commit -m "feat(tutorial): add data-tour-id anchors for activation tour"
```

---

## Task 3: `openTutorial` helper + Settings entry

**Files:**
- Modify: `src/App.tsx` (helper near ~359; Sidebar prop at ~1050)
- Modify: `src/components/SettingsPanel.tsx` (~275)

- [ ] **Step 1: Add the `openTutorial` helper**

In `src/App.tsx`, immediately after the `tutorialTour` state declaration (~359), add:

```tsx
  // Launching `activation` expands the sidebar first, so its My Repos / Team
  // items are visible (with labels) as spotlight targets. Other tours are
  // launched from a view where their anchors are already on screen.
  const openTutorial = useCallback((id: import('./tutorial/types').TourId) => {
    if (id === 'activation') setSidebarExpanded(true)
    setTutorialTour(id)
  }, [])
```

- [ ] **Step 2: Route the Sidebar's `onOpenTutorial` through the helper**

In `src/App.tsx`, replace the `onOpenTutorial` prop on `<Sidebar>` (~1050):

```tsx
        onOpenTutorial={openTutorial}
```

(was `onOpenTutorial={(id) => setTutorialTour(id)}`)

- [ ] **Step 3: Add the Settings → Tutorial entry for activation**

In `src/components/SettingsPanel.tsx`, in the `tab === 'tutorial'` block, add a button after the existing "Tutorial: Worktrees" button (~275):

```tsx
                  <button className="sp-action-btn" onClick={() => onOpenTutorial?.('activation')}>
                    Tutorial: Getting Started
                  </button>
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p tsconfig.web.json --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/SettingsPanel.tsx
git commit -m "feat(tutorial): openTutorial helper + Settings entry for activation"
```

---

## Task 4: Auto-launch on first run + EmptyState "?" button

**Files:**
- Modify: `src/App.tsx` (import; `useTourSeen` instance + ref near ~359; effect after `isInitialState` ~904; EmptyState component + its render ~1060/1297)

- [ ] **Step 1: Import `useTourSeen`**

In `src/App.tsx`, add near the other hook imports (top of file, alongside the `./hooks/*` imports):

```tsx
import { useTourSeen } from './hooks/useTourSeen'
```

- [ ] **Step 2: Instantiate the seen flag + a one-shot ref**

In `src/App.tsx`, right below the `openTutorial` helper added in Task 3 (~359), add:

```tsx
  const activationSeen = useTourSeen('activation')
  const activationTried = useRef(false)
```

- [ ] **Step 3: Add the auto-launch effect**

In `src/App.tsx`, immediately after the `isInitialState` definition (`const isInitialState = panes.length === 0`, ~904), add:

```tsx
  // First-run onboarding: when the workspace boots empty and the user has never
  // seen the activation tour, launch it once. markSeen() runs here (on show),
  // not on close, so Skip and Done behave the same: it never auto-reappears.
  useEffect(() => {
    if (activationTried.current) return
    if (!isInitialState) return
    activationTried.current = true
    if (activationSeen.seen) return
    activationSeen.markSeen()
    openTutorial('activation')
  }, [isInitialState, activationSeen, openTutorial])
```

- [ ] **Step 4: Give `EmptyState` an `onStartTutorial` prop + "?" button**

In `src/App.tsx`, replace the `EmptyState` function (~1297) with:

```tsx
function EmptyState({ onNewPane, onStartTutorial }: { onNewPane: () => void; onStartTutorial: () => void }) {
  return (
    <div className="empty-state">
      <button
        onClick={onStartTutorial}
        title="Getting started"
        aria-label="Getting started tour"
        style={{
          position: 'fixed',
          top: 16,
          right: 16,
          width: 28,
          height: 28,
          borderRadius: '50%',
          border: '1px solid var(--border, #2a2a2a)',
          background: 'transparent',
          color: 'var(--text-muted, #888)',
          cursor: 'pointer',
          fontSize: 14,
          lineHeight: 1,
          zIndex: 5,
        }}
      >
        ?
      </button>
      <div className="empty-logo">
        <img src={logoUrl} alt="Nest" className="empty-logo-img" />
      </div>
      <h1 className="empty-title">Nest</h1>
      <p className="empty-subtitle">Multi-AI Terminal Workspace by RAVEN</p>
      <button className="btn-primary" data-tour-id="empty-new-terminal" onClick={onNewPane}>
        + New Terminal
      </button>
      <p className="empty-hint">or press <kbd>{window.platform?.isWin ? 'Ctrl+T' : '⌘T'}</kbd></p>
    </div>
  )
}
```

(Note: keeps the `data-tour-id` from Task 2 on the primary button.)

- [ ] **Step 5: Pass `onStartTutorial` where EmptyState is rendered**

In `src/App.tsx`, update the EmptyState render (~1060):

```tsx
          <EmptyState onNewPane={addNextPane} onStartTutorial={() => openTutorial('activation')} />
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc -p tsconfig.web.json --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat(tutorial): auto-launch activation on first run + EmptyState help button"
```

---

## Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all green (the previous baseline plus the updated `section-tours` contract).

- [ ] **Step 2: Typecheck the web project**

Run: `npx tsc -p tsconfig.web.json --noEmit`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Manual Electron check (record results)**

Run `npm run dev`, then:
1. **Auto-launch:** with a fresh profile (or after `localStorage.removeItem('nest:tour-seen:activation'); location.reload()` in DevTools), confirm the tour auto-launches on the empty workspace and the **sidebar is expanded**.
2. **Steps:** all 5 steps anchor correctly — `welcome`/`new-terminal`/`outro` on the "+ New Terminal" button, `my-repos`/`team` on the sidebar items (labels visible). Copy is in English.
3. **No re-launch:** close the tour with Skip, reload — it does **not** auto-launch again.
4. **Re-entry:** the "?" button (top-right of the EmptyState) reopens it; Settings → Tutorial → "Tutorial: Getting Started" reopens it; both expand the sidebar.

---

## Self-Review (done while writing)

- **Spec coverage:** lanzamiento (Task 4), 5 pasos estáticos sin ramificar (Task 1), expandir sidebar al lanzar (Task 3 `openTutorial` + Task 4 effect), anchors (Task 2), Settings + "?" (Tasks 3-4), persistencia `markSeen` on-show (Task 4 effect), test de contrato (Task 1). All covered.
- **Type consistency:** `openTutorial(id: TourId)`, `activationTour.id === 'activation'`, anchors `empty-new-terminal`/`sidebar-team`/`sidebar-myrepos` identical between Task 1 (tour) and Task 2 (markup) and verified by grep in Task 2 Step 4. `useTourSeen` returns `{ seen, markSeen }` — matches usage.
- **Out of scope (per spec):** plan branching, entering modals, advanceOnClick/Action, dedicated Worktrees step, touching the engine. None introduced.
- **`capture/` cleanup:** out of scope (separate task per spec).
