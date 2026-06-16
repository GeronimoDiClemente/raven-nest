# Worktrees Tutorial — Interactive Hybrid + Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Worktrees tutorial into a guided-interactive experience: real create/diff flows, an interactive (no-PTY) workspace mock where the user drags a worktree to open a terminal and uses "Sync cwd", a richer multi-pane mock, a smaller tooltip, English engine buttons, and bilingual (English-default) tour copy.

**Architecture:** The sandbox already mounts the REAL Worktrees components inside a `BridgeProvider` (mocked bridge) — that isolation is sacred and untouched. We make the right-side workspace mock stateful (drop target + fake panes + Sync cwd), add an action-driven advance channel to `OnboardingTour` (`advanceSignal`), add 2 tour steps, shrink the tooltip, and localize all tutorial copy via a tutorial-scoped `i18n.ts` (no app-wide i18n, no new deps).

**Tech Stack:** React + TypeScript, Vitest (jsdom + node projects), Testing Library, HTML5 drag-and-drop with MIME `application/x-raven-worktree-path`.

**Spec:** `docs/specs/2026-05-27-tutorial-worktrees-interactive-design.md`

**Key design decision (signal shape):** the spec proposed `advanceSignal?: number`. To honor its stated guard ("only advances while on the step that expects it") without cross-step misfires, the signal carries the action id: `advanceSignal?: { action: string; nonce: number } | null`, and each action-driven `TourStep` declares `advanceOnAction?: string`. A step advances only when an incoming signal's `action` matches its `advanceOnAction`. `advanceOnClick` (clicks) and the `Next` button (always present) remain the other two advance paths.

**File map:**
- Create `src/lib/dragTypes.ts` — single source for the worktree drag MIME (DRY; today it's a private const in `App.tsx`).
- Create `src/tutorial/i18n.ts` — `Localized` type, `resolveTutorialLocale()`, `t()`.
- Modify `src/tutorial/types.ts` — `TourStep.title/body` become `Localized`; add `advanceOnAction?: string`.
- Modify `src/tutorial/OnboardingTour.tsx` — render localized copy, English engine labels, `advanceSignal` prop + action-advance effect.
- Modify `src/tutorial/tours/worktrees.ts` — 13 bilingual steps, reordered, 2 new steps.
- Modify `src/styles/global.css` — shrink `.tour-tooltip` and children ~20-30%.
- Modify `src/tutorial/DemoWorkspaceMock.tsx` — add stateful interactive `DemoWorkspace` (drop target, 2 seeded panes, Sync cwd); remove the static `DemoWorkspacePane`.
- Modify `src/tutorial/TutorialSandbox.tsx` — wire `DemoWorkspace`, `advanceSignal`, `selectedRepoPath`, `resolveBranch`.
- Modify `src/App.tsx:53` — import `WORKTREE_DRAG_MIME` from `./lib/dragTypes`.
- Tests: new `src/__tests__/tutorial/i18n.test.ts`, `src/__tests__/tutorial/worktrees-tour.test.ts`, `src/__tests__/components/demo-workspace-mock.test.tsx`, `src/__tests__/components/onboarding-tour-advance.test.tsx`; update `src/__tests__/components/worktrees-tutorial.test.tsx`.

**Vitest project routing (do not get this wrong):**
- `src/__tests__/tutorial/**/*.test.ts` → **jsdom** project (the node project explicitly excludes `tutorial/**`). `navigator` is available there.
- `src/__tests__/components/**/*.test.tsx` → **jsdom** project.

**Test commands** (this repo uses Vitest projects; run a single file with `--project`):
- jsdom file: `npx vitest run src/__tests__/tutorial/i18n.test.ts --project jsdom`
- Full suite: `npx vitest run`
- Typecheck: `npx tsc --noEmit`

---

## Task 1: Extract the worktree drag MIME into a shared module

**Files:**
- Create: `src/lib/dragTypes.ts`
- Modify: `src/App.tsx:53`

The interactive workspace mock (Task 5) must use the EXACT same MIME the real `WorktreesSection` drag source sets. Today the constant lives privately in `App.tsx`. Extract it so both read one definition.

- [ ] **Step 1: Create the shared module**

Create `src/lib/dragTypes.ts`:

```ts
// src/lib/dragTypes.ts

/**
 * dataTransfer MIME set when dragging a worktree row onto the workspace to open
 * a terminal in that worktree's folder. Shared by the real workspace drop
 * handler (App.tsx), the real WorktreesSection drag source, and the tutorial's
 * interactive workspace mock — keep them reading one definition.
 */
export const WORKTREE_DRAG_MIME = 'application/x-raven-worktree-path'
```

- [ ] **Step 2: Replace the private const in App.tsx with the import**

In `src/App.tsx`, delete line 53 (`const WORKTREE_DRAG_MIME = 'application/x-raven-worktree-path'`) and add the import alongside the other `./lib/...` imports near the top of the file:

```ts
import { WORKTREE_DRAG_MIME } from './lib/dragTypes'
```

Leave the two usages (`App.tsx:892`, `App.tsx:904`) unchanged — they now resolve to the imported constant.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (the symbol resolves; value is identical).

- [ ] **Step 4: Run the existing tutorial/app suites to confirm no regression**

Run: `npx vitest run src/__tests__/components/worktrees-tutorial.test.tsx src/__tests__/components/tutorial-isolation.test.tsx --project jsdom`
Expected: PASS (behavior unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dragTypes.ts src/App.tsx
git commit -m "refactor(tutorial): extract WORKTREE_DRAG_MIME to shared module"
```

---

## Task 2: Tutorial-scoped i18n module

**Files:**
- Create: `src/tutorial/i18n.ts`
- Test: `src/__tests__/tutorial/i18n.test.ts`

A lightweight, tutorial-only localization helper. English is the default (matching the app); Spanish only when the locale starts with `es`. No app-wide i18n, no dependency.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/tutorial/i18n.test.ts`:

```ts
// src/__tests__/tutorial/i18n.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { resolveTutorialLocale, t, type Localized } from '../../tutorial/i18n'

function setLanguage(value: string) {
  Object.defineProperty(navigator, 'language', { value, configurable: true })
}

afterEach(() => {
  setLanguage('en-US')
})

describe('resolveTutorialLocale', () => {
  it('returns es for Spanish locales', () => {
    setLanguage('es-AR')
    expect(resolveTutorialLocale()).toBe('es')
    setLanguage('es')
    expect(resolveTutorialLocale()).toBe('es')
  })

  it('returns en for everything else (English default)', () => {
    setLanguage('en-US')
    expect(resolveTutorialLocale()).toBe('en')
    setLanguage('pt-BR')
    expect(resolveTutorialLocale()).toBe('en')
    setLanguage('')
    expect(resolveTutorialLocale()).toBe('en')
  })
})

describe('t', () => {
  const phrase: Localized = { en: 'Create', es: 'Crear' }

  it('picks the string for the resolved locale by default', () => {
    setLanguage('es-AR')
    expect(t(phrase)).toBe('Crear')
    setLanguage('en-US')
    expect(t(phrase)).toBe('Create')
  })

  it('honors an explicit locale argument', () => {
    expect(t(phrase, 'es')).toBe('Crear')
    expect(t(phrase, 'en')).toBe('Create')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/tutorial/i18n.test.ts --project jsdom`
Expected: FAIL — cannot resolve `../../tutorial/i18n`.

- [ ] **Step 3: Implement the module**

Create `src/tutorial/i18n.ts`:

```ts
// src/tutorial/i18n.ts
//
// Tutorial-scoped localization. The app UI is English-only; the tutorial is the
// one place we localize, so this stays a tiny module (no app-wide i18n, no dep).

export type Locale = 'en' | 'es'

/** A string available in the tutorial's supported locales. */
export interface Localized {
  en: string
  es: string
}

/** 'es' only when the browser locale is Spanish; English otherwise (app default). */
export function resolveTutorialLocale(): Locale {
  const lang = (typeof navigator !== 'undefined' && navigator.language) || 'en'
  return lang.toLowerCase().startsWith('es') ? 'es' : 'en'
}

/** Pick the string for `locale` (defaults to the resolved locale). */
export function t(value: Localized, locale: Locale = resolveTutorialLocale()): string {
  return value[locale]
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/tutorial/i18n.test.ts --project jsdom`
Expected: PASS (5 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/tutorial/i18n.ts src/__tests__/tutorial/i18n.test.ts
git commit -m "feat(tutorial): tutorial-scoped i18n (English default, Spanish by locale)"
```

---

## Task 3: Bilingual + action-driven tour engine

**Files:**
- Modify: `src/tutorial/types.ts`
- Modify: `src/tutorial/OnboardingTour.tsx`
- Modify: `src/tutorial/tours/worktrees.ts`
- Test: `src/__tests__/tutorial/worktrees-tour.test.ts` (new), `src/__tests__/components/onboarding-tour-advance.test.tsx` (new), `src/__tests__/components/worktrees-tutorial.test.tsx` (update)

This is one cohesive change: the `TourStep` type, the engine that renders it, and the worktrees tour copy must change together to keep `tsc` green. `TutorialSandbox` does NOT pass `advanceSignal` yet (Task 6) — the prop is optional, so the engine falls back to `Next`/`advanceOnClick` until then.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/tutorial/worktrees-tour.test.ts`:

```ts
// src/__tests__/tutorial/worktrees-tour.test.ts
import { describe, it, expect } from 'vitest'
import { worktreesTour } from '../../tutorial/tours/worktrees'

describe('worktrees tour copy', () => {
  it('has 13 steps in the guided order', () => {
    expect(worktreesTour.steps.map((s) => s.id)).toEqual([
      'header', 'add', 'branch', 'presets', 'env', 'create', 'list',
      'diff', 'diff-panel', 'drag-terminal', 'sync-cwd', 'pr', 'menu',
    ])
  })

  it('every step provides both English and Spanish copy', () => {
    for (const step of worktreesTour.steps) {
      expect(step.title.en.length).toBeGreaterThan(0)
      expect(step.title.es.length).toBeGreaterThan(0)
      expect(step.body.en.length).toBeGreaterThan(0)
      expect(step.body.es.length).toBeGreaterThan(0)
    }
  })

  it('wires action-driven advance on the two interactive-mock steps', () => {
    const byId = Object.fromEntries(worktreesTour.steps.map((s) => [s.id, s]))
    expect(byId['drag-terminal'].advanceOnAction).toBe('drop')
    expect(byId['drag-terminal'].anchor).toBe('[data-tour-id="wt-list"]')
    expect(byId['sync-cwd'].advanceOnAction).toBe('sync')
    expect(byId['sync-cwd'].anchor).toBe('[data-tour-id="pane-sync-cwd-btn"]')
  })
})
```

Create `src/__tests__/components/onboarding-tour-advance.test.tsx`:

```tsx
// src/__tests__/components/onboarding-tour-advance.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { OnboardingTour } from '../../tutorial/OnboardingTour'
import type { TourStep } from '../../tutorial/types'

const steps: TourStep[] = [
  { id: 's1', anchor: '[data-tour-id="nope-1"]', title: { en: 'First', es: 'Primero' }, body: { en: 'Step one body', es: 'Cuerpo uno' } },
  { id: 's2', anchor: '[data-tour-id="nope-2"]', title: { en: 'Drop here', es: 'Soltá acá' }, body: { en: 'Drop step body', es: 'Cuerpo drop' }, advanceOnAction: 'drop' },
  { id: 's3', anchor: '[data-tour-id="nope-3"]', title: { en: 'Last', es: 'Último' }, body: { en: 'Last body', es: 'Cuerpo final' } },
]

beforeEach(() => {
  Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true })
})

describe('OnboardingTour engine', () => {
  it('renders English engine labels', () => {
    render(<OnboardingTour steps={steps} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument()
  })

  it('shows Spanish copy + labels when locale is Spanish', () => {
    Object.defineProperty(navigator, 'language', { value: 'es-AR', configurable: true })
    render(<OnboardingTour steps={steps} onClose={() => {}} />)
    expect(screen.getByText('Cuerpo uno')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /siguiente/i })).toBeInTheDocument()
  })

  it('advances on a matching action signal only', () => {
    const { rerender } = render(
      <OnboardingTour steps={steps} onClose={() => {}} advanceSignal={null} />,
    )
    // Advance to the drop step (s2) via Next.
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText('Drop step body')).toBeInTheDocument()

    // A non-matching action is ignored.
    rerender(<OnboardingTour steps={steps} onClose={() => {}} advanceSignal={{ action: 'sync', nonce: 1 }} />)
    expect(screen.getByText('Drop step body')).toBeInTheDocument()

    // The matching action advances to s3.
    rerender(<OnboardingTour steps={steps} onClose={() => {}} advanceSignal={{ action: 'drop', nonce: 2 }} />)
    expect(screen.getByText('Last body')).toBeInTheDocument()
  })

  it('finishing the last step calls onClose', () => {
    const onClose = vi.fn()
    render(<OnboardingTour steps={steps} onClose={onClose} startIndex={2} />)
    fireEvent.click(screen.getByRole('button', { name: /done/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
    cleanup()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/tutorial/worktrees-tour.test.ts src/__tests__/components/onboarding-tour-advance.test.tsx --project jsdom`
Expected: FAIL — `title.en` is undefined (titles are still plain strings), `advanceSignal` prop unknown, engine labels still Spanish.

- [ ] **Step 3: Update the TourStep type**

Replace `src/tutorial/types.ts` with:

```ts
// src/tutorial/types.ts
import type { Localized } from './i18n'

/** All tours shipped in the app. */
export type TourId = 'activation' | 'my-repos' | 'teams' | 'worktrees'

/** One coachmark step: anchor + copy + how it advances. */
export interface TourStep {
  /** Stable id, unique within a tour. */
  id: string
  /** CSS selector for the element to spotlight (e.g. `[data-tour-id="new-terminal"]`). */
  anchor: string
  /** Tooltip heading (localized). */
  title: Localized
  /** Tooltip body copy (localized). */
  body: Localized
  /** Preferred tooltip side relative to the anchor. Defaults to 'bottom'. */
  placement?: 'top' | 'bottom' | 'left' | 'right'
  /** If true, clicking the spotlighted element advances to the next step. */
  advanceOnClick?: boolean
  /**
   * If set, an incoming `advanceSignal` whose `action` equals this value
   * advances the step. Used for interactions with no click on the anchor
   * itself (e.g. dropping a worktree, clicking a button rendered later).
   */
  advanceOnAction?: string
}

export interface TourDef {
  id: TourId
  steps: TourStep[]
}
```

- [ ] **Step 4: Update the OnboardingTour engine**

Replace `src/tutorial/OnboardingTour.tsx` with:

```tsx
// src/tutorial/OnboardingTour.tsx
import { useState, useEffect, useRef, useCallback, type CSSProperties, type RefObject } from 'react'
import type { TourStep } from './types'
import { t, resolveTutorialLocale, type Localized } from './i18n'

/** Action signal: bumping `nonce` advances the step whose `advanceOnAction` === `action`. */
export interface AdvanceSignal {
  action: string
  nonce: number
}

export interface OnboardingTourProps {
  steps: TourStep[]
  onClose: () => void
  startIndex?: number
  /**
   * Scope anchor lookups to this element's subtree instead of the whole
   * document. Required when the tour runs over a live app that renders the
   * SAME `data-tour-id` anchors (e.g. the tutorial sandbox): without it,
   * `document.querySelector` would resolve to the background app's duplicate
   * anchor (hidden under the overlay) instead of the sandbox's.
   */
  rootRef?: RefObject<HTMLElement | null>
  /**
   * Drives action-based advancing. When `nonce` changes and the current step's
   * `advanceOnAction` matches `action`, the tour advances. Optional: when
   * absent the tour advances only via the anchor click or the Next button.
   */
  advanceSignal?: AdvanceSignal | null
}

const LABELS: Record<'back' | 'skip' | 'next' | 'done' | 'hint', Localized> = {
  back: { en: 'Back', es: 'Atrás' },
  skip: { en: 'Skip', es: 'Saltar' },
  next: { en: 'Next →', es: 'Siguiente →' },
  done: { en: 'Done', es: 'Listo' },
  hint: { en: 'or click the highlighted element', es: 'o tocá el elemento resaltado' },
}

export function OnboardingTour({ steps, onClose, startIndex = 0, rootRef, advanceSignal }: OnboardingTourProps) {
  const locale = resolveTutorialLocale()
  const [index, setIndex] = useState(startIndex)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const step = steps[index]
  const isLast = index === steps.length - 1

  const next = useCallback(() => {
    if (isLast) onClose()
    else setIndex((i) => i + 1)
  }, [isLast, onClose])

  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])

  // Track the anchored element's box; recompute on resize/scroll.
  useEffect(() => {
    if (!step) return
    const update = () => {
      const scope: ParentNode = rootRef?.current ?? document
      const el = scope.querySelector(step.anchor)
      setRect(el ? el.getBoundingClientRect() : null)
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [step, rootRef])

  // Click-to-advance: clicking the anchored element advances the step.
  useEffect(() => {
    if (!step?.advanceOnClick) return
    const scope: ParentNode = rootRef?.current ?? document
    const el = scope.querySelector(step.anchor)
    if (!el) return
    const handler = () => next()
    el.addEventListener('click', handler)
    return () => el.removeEventListener('click', handler)
  }, [step, next, rootRef])

  // Action-to-advance: a fresh signal whose action matches the current step
  // advances it. We mark every nonce as seen (even non-matching) so a stale
  // signal can't fire later when we reach a step that would match it.
  const lastNonce = useRef<number | null>(null)
  useEffect(() => {
    if (!advanceSignal) return
    if (lastNonce.current === advanceSignal.nonce) return
    lastNonce.current = advanceSignal.nonce
    if (step?.advanceOnAction && step.advanceOnAction === advanceSignal.action) {
      next()
    }
  }, [advanceSignal, step, next])

  if (!step) return null

  const pad = 6
  const spotlight = rect
    ? {
        top: rect.top - pad,
        left: rect.left - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }
    : null

  // Tooltip sits just below the spotlight (fallback: centered).
  const tooltipStyle: CSSProperties = spotlight
    ? { position: 'fixed', top: spotlight.top + spotlight.height + 12, left: spotlight.left, zIndex: 2001 }
    : { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 2001 }

  return (
    <div className="tour-overlay" role="dialog" aria-modal="true" aria-label="Tutorial">
      {/* When a spotlight is shown its box-shadow already dims everything
          OUTSIDE the cutout, so the focused element stays bright. A separate
          full dim would re-darken the cutout too ("can't see the focus"), so
          only use it as the fallback when there's no anchor to spotlight. */}
      {spotlight ? (
        <div
          className="tour-spotlight"
          style={{ top: spotlight.top, left: spotlight.left, width: spotlight.width, height: spotlight.height }}
        />
      ) : (
        <div className="tour-dim" />
      )}
      <div className="tour-tooltip" style={tooltipStyle}>
        <span className="tour-badge">
          {index + 1} / {steps.length}
        </span>
        <h3 className="tour-title">{t(step.title, locale)}</h3>
        <p className="tour-body">{t(step.body, locale)}</p>
        {step.advanceOnClick && <div className="tour-hint">{t(LABELS.hint, locale)}</div>}
        <div className="tour-controls">
          <button className="tour-back" onClick={back} disabled={index === 0}>
            {t(LABELS.back, locale)}
          </button>
          <span className="tour-spacer" />
          <button className="tour-skip" onClick={onClose}>
            {t(LABELS.skip, locale)}
          </button>
          <button className="tour-next" onClick={next}>
            {isLast ? t(LABELS.done, locale) : t(LABELS.next, locale)}
          </button>
        </div>
        <div className="tour-progress">
          {steps.map((s, i) => (
            <i key={s.id} className={i === index ? 'on' : ''} />
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Rewrite the worktrees tour with 13 bilingual steps**

Replace `src/tutorial/tours/worktrees.ts` with:

```ts
// src/tutorial/tours/worktrees.ts
import type { TourDef } from '../types'

export const worktreesTour: TourDef = {
  id: 'worktrees',
  steps: [
    {
      id: 'header',
      anchor: '[data-tour-id="wt-header"]',
      title: { en: 'Worktrees', es: 'Worktrees' },
      body: {
        en: 'A worktree is a branch in its own folder: work in parallel without touching your main branch.',
        es: 'Un worktree es una rama en su propia carpeta: trabajás en paralelo sin tocar tu rama principal.',
      },
      placement: 'right',
    },
    {
      id: 'add',
      anchor: '[data-tour-id="wt-add"]',
      title: { en: 'Create a worktree', es: 'Creá un worktree' },
      body: {
        en: 'Click "+" to create one from a branch.',
        es: 'Tocá "+" para crear uno a partir de una rama.',
      },
      placement: 'right',
      advanceOnClick: true,
    },
    {
      id: 'branch',
      anchor: '[data-tour-id="wt-branch-input"]',
      title: { en: 'Branch name', es: 'Nombre de la rama' },
      body: {
        en: 'Type the new branch name, e.g. feat/billing.',
        es: 'Escribí el nombre de la rama nueva, ej. feat/billing.',
      },
      placement: 'bottom',
    },
    {
      id: 'presets',
      anchor: '[data-tour-id="wt-presets"]',
      title: { en: 'Preset (optional)', es: 'Preset (opcional)' },
      body: {
        en: 'Pick a preset to run setup automatically (install deps, start the dev server).',
        es: 'Elegí un preset para correr el setup automático (instalar deps, levantar el dev).',
      },
      placement: 'bottom',
    },
    {
      id: 'env',
      anchor: '[data-tour-id="wt-env-banner"]',
      title: { en: '.env files', es: 'Archivos .env' },
      body: {
        en: 'If there are untracked .env files, you can copy them into the new worktree.',
        es: 'Si hay archivos .env sin trackear, podés copiarlos al worktree nuevo.',
      },
      placement: 'top',
    },
    {
      id: 'create',
      anchor: '[data-tour-id="wt-create-btn"]',
      title: { en: 'Create', es: 'Crear' },
      body: {
        en: 'Confirm: the worktree appears and runs its setup.',
        es: 'Confirmá: el worktree aparece y corre su setup.',
      },
      placement: 'top',
      advanceOnClick: true,
    },
    {
      id: 'list',
      anchor: '[data-tour-id="wt-list"]',
      title: { en: 'Your worktrees', es: 'Tus worktrees' },
      body: {
        en: 'They all show up here with their status (yellow = setup, green = ready).',
        es: 'Acá aparecen todos con su estado (amarillo = setup, verde = listo).',
      },
      placement: 'right',
    },
    {
      id: 'diff',
      anchor: '[data-tour-id="wt-diff-chip"]',
      title: { en: 'Changes', es: 'Cambios' },
      body: {
        en: 'The chip shows +added/−removed lines. Click it to see the full diff.',
        es: 'El chip muestra +líneas/−líneas. Tocalo para ver el diff completo.',
      },
      placement: 'right',
      advanceOnClick: true,
    },
    {
      id: 'diff-panel',
      anchor: '[data-tour-id="diff-panel"]',
      title: { en: 'Diff', es: 'Diff' },
      body: {
        en: 'Review changes file by file without leaving Nest.',
        es: 'Revisás los cambios archivo por archivo sin salir de Nest.',
      },
      placement: 'left',
    },
    {
      id: 'drag-terminal',
      anchor: '[data-tour-id="wt-list"]',
      title: { en: 'Open a terminal in a worktree', es: 'Abrí una terminal en un worktree' },
      body: {
        en: "Drag a worktree from the list into the workspace to open a terminal that runs in that worktree's folder.",
        es: 'Arrastrá un worktree de la lista al workspace para abrir una terminal que corre en la carpeta de ese worktree.',
      },
      placement: 'right',
      advanceOnAction: 'drop',
    },
    {
      id: 'sync-cwd',
      anchor: '[data-tour-id="pane-sync-cwd-btn"]',
      title: { en: "Switch a terminal's folder", es: 'Cambiá la carpeta de una terminal' },
      body: {
        en: 'Click another worktree to point this terminal at it, then hit "Sync cwd" to restart it there.',
        es: 'Tocá otro worktree para apuntar esta terminal ahí, después dale "Sync cwd" para reiniciarla en esa carpeta.',
      },
      placement: 'left',
      advanceOnAction: 'sync',
    },
    {
      id: 'pr',
      anchor: '[data-tour-id="wt-pr-chip"]',
      title: { en: 'Pull request', es: 'Pull request' },
      body: {
        en: 'If the branch has a PR, the chip takes you there. From the menu you can also "Push to GitHub".',
        es: 'Si la rama tiene PR, el chip te lleva ahí. Desde el menú también podés "Push to GitHub".',
      },
      placement: 'right',
    },
    {
      id: 'menu',
      anchor: '[data-tour-id="wt-context-menu"]',
      title: { en: 'Actions', es: 'Acciones' },
      body: {
        en: "Right-click a worktree: push, open in IDE, spotlight, or remove it. That's Worktrees!",
        es: 'Click derecho en un worktree: push, abrir en IDE, spotlight, o eliminarlo. ¡Eso es Worktrees!',
      },
      placement: 'right',
    },
  ],
}
```

- [ ] **Step 6: Update the existing integration test for English copy + 13 steps**

In `src/__tests__/components/worktrees-tutorial.test.tsx`, pin the locale to English in `beforeEach` (so the test never depends on the jsdom default), and update the copy/labels/counts.

Add to the top of the existing `beforeEach` body (before the sentinel assignments):

```ts
    Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true })
```

Replace the first test's body assertions:

```ts
    await waitFor(() =>
      expect(screen.getByText(/A worktree is a branch/)).toBeInTheDocument(),
    )
    expect(screen.getByText('Worktrees')).toBeInTheDocument()
    // Progress badge: step 1 of 13.
    expect(screen.getByText(/1\s*\/\s*13/)).toBeInTheDocument()
```

Replace the second test (`walks the whole tour via Next and finishes`) body:

```ts
    const onClose = vi.fn()
    render(<TutorialSandbox tourId="worktrees" onClose={onClose} />)
    await waitFor(() =>
      expect(screen.getByText(/A worktree is a branch/)).toBeInTheDocument(),
    )
    // 13 steps: advance with "Next →" 12 times, then the last step's button
    // reads "Done" and finishing calls onClose.
    for (let i = 0; i < 12; i++) {
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
    }
    fireEvent.click(screen.getByRole('button', { name: /done/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
```

Leave the diff-chip / pr-chip `waitFor` regression guards in the first test unchanged.

- [ ] **Step 7: Run all affected tests**

Run: `npx vitest run src/__tests__/tutorial/worktrees-tour.test.ts src/__tests__/components/onboarding-tour-advance.test.tsx src/__tests__/components/worktrees-tutorial.test.tsx src/__tests__/components/tutorial-isolation.test.tsx --project jsdom`
Expected: PASS.

- [ ] **Step 8: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors. (All `TourStep` consumers updated; `advanceSignal` is optional.)

- [ ] **Step 9: Commit**

```bash
git add src/tutorial/types.ts src/tutorial/OnboardingTour.tsx src/tutorial/tours/worktrees.ts src/__tests__/tutorial/worktrees-tour.test.ts src/__tests__/components/onboarding-tour-advance.test.tsx src/__tests__/components/worktrees-tutorial.test.tsx
git commit -m "feat(tutorial): bilingual + action-driven tour engine (13 steps, English UI)"
```

---

## Task 4: Shrink the coachmark tooltip

**Files:**
- Modify: `src/styles/global.css:9177-9197`

Pure CSS. The tooltip is too large/generic; reduce width, padding, and font sizes ~20-30%.

- [ ] **Step 1: Replace the tooltip block**

In `src/styles/global.css`, replace the existing `.tour-tooltip` through `.tour-progress i.on` block (lines 9177-9197) with:

```css
.tour-tooltip {
  width: 260px; background: #16161a; border: 1px solid #2b2b32; border-radius: 12px;
  padding: 12px; box-shadow: 0 14px 40px rgba(0,0,0,.55); color: #ededed;
}
.tour-badge {
  display: inline-block; font-size: 10px; font-weight: 600; color: #9cc0ff;
  background: rgba(47,109,255,.14); border: 1px solid rgba(47,109,255,.3);
  padding: 2px 8px; border-radius: 999px;
}
.tour-title { margin: 8px 0 4px; font-size: 13px; font-weight: 650; }
.tour-body { margin: 0; font-size: 11.5px; line-height: 1.45; color: #bdbdc6; }
.tour-hint { margin-top: 8px; font-size: 10.5px; color: #7f8694; }
.tour-controls { display: flex; align-items: center; gap: 6px; margin-top: 11px; padding-top: 10px; border-top: 1px solid #232329; }
.tour-spacer { flex: 1; }
.tour-back { font-size: 11px; color: #5a5a63; background: #1a1a1f; border: 1px solid #26262c; border-radius: 7px; padding: 6px 10px; cursor: pointer; }
.tour-back:disabled { cursor: not-allowed; opacity: .6; }
.tour-skip { background: none; border: none; color: #7f8694; font-size: 11px; cursor: pointer; }
.tour-next { font-size: 11px; font-weight: 600; color: #fff; background: #2f6dff; border: none; border-radius: 7px; padding: 6px 12px; cursor: pointer; }
.tour-progress { display: flex; gap: 4px; margin-top: 11px; justify-content: center; }
.tour-progress i { width: 6px; height: 6px; border-radius: 50%; background: #2a2a30; display: block; }
.tour-progress i.on { background: #2f6dff; }
```

(Leave `.tour-overlay`, `.tour-dim`, `.tour-spotlight`, and `.tour-help-btn` unchanged.)

- [ ] **Step 2: Verify the suite still passes (CSS has no test; guard against accidental selector breakage)**

Run: `npx vitest run src/__tests__/components/worktrees-tutorial.test.tsx --project jsdom`
Expected: PASS (selectors/classnames unchanged; only values changed).

- [ ] **Step 3: Commit**

```bash
git add src/styles/global.css
git commit -m "style(tutorial): shrink coachmark tooltip ~25%"
```

---

## Task 5: Interactive, multi-pane workspace mock

**Files:**
- Modify: `src/tutorial/DemoWorkspaceMock.tsx`
- Test: `src/__tests__/components/demo-workspace-mock.test.tsx` (new)

Add a stateful `DemoWorkspace` (drop target + 2 seeded panes + Sync cwd). Keep `DemoTabBar` as-is and keep the old static `DemoWorkspacePane` export for now (TutorialSandbox still imports it until Task 6) — Task 6 removes it. No PTY: the drag uses the REAL `WORKTREE_DRAG_MIME`, but "opening a terminal" and "restarting" are local state only.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/components/demo-workspace-mock.test.tsx`:

```tsx
// src/__tests__/components/demo-workspace-mock.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { DemoWorkspace } from '../../tutorial/DemoWorkspaceMock'
import { WORKTREE_DRAG_MIME } from '../../lib/dragTypes'

const FEAT = 'C:/demo/.worktrees/nest-web/feat-dark-mode'
const BILLING = 'C:/demo/.worktrees/nest-web/feat-billing'
const ROOT = 'C:/demo/nest-web'

function resolveBranch(p: string): string | undefined {
  return { [FEAT]: 'feat/dark-mode', [BILLING]: 'feat/billing', [ROOT]: 'main' }[p]
}

function dataTransfer(path: string) {
  return { getData: (type: string) => (type === WORKTREE_DRAG_MIME ? path : ''), types: [WORKTREE_DRAG_MIME] }
}

describe('DemoWorkspace (interactive mock)', () => {
  it('seeds two panes', () => {
    render(<DemoWorkspace resolveBranch={resolveBranch} selectedRepoPath={null} />)
    expect(screen.getAllByText(/CLAUDE|CODEX/).length).toBeGreaterThanOrEqual(2)
  })

  it('opening a dropped worktree adds a pane and fires onPaneOpened', () => {
    const onPaneOpened = vi.fn()
    render(<DemoWorkspace resolveBranch={resolveBranch} selectedRepoPath={null} onPaneOpened={onPaneOpened} />)
    const ws = screen.getByTestId('demo-workspace')
    fireEvent.drop(ws, { dataTransfer: dataTransfer(BILLING) })
    expect(onPaneOpened).toHaveBeenCalledTimes(1)
    // The new pane shows the dropped worktree's branch as its note.
    expect(screen.getByText('feat/billing')).toBeInTheDocument()
  })

  it('shows Sync cwd when the focused pane diverges, then clears it on click', () => {
    const onSyncCwd = vi.fn()
    const { rerender } = render(
      <DemoWorkspace resolveBranch={resolveBranch} selectedRepoPath={null} onSyncCwd={onSyncCwd} />,
    )
    // No divergence yet → no Sync cwd button.
    expect(screen.queryByRole('button', { name: /sync cwd/i })).toBeNull()

    // Select a different worktree → focused pane diverges → button appears.
    rerender(<DemoWorkspace resolveBranch={resolveBranch} selectedRepoPath={ROOT} onSyncCwd={onSyncCwd} />)
    const syncBtn = screen.getByRole('button', { name: /sync cwd/i })
    expect(syncBtn).toHaveAttribute('data-tour-id', 'pane-sync-cwd-btn')

    // Click Sync cwd → fires callback, button disappears (folder synced).
    fireEvent.click(syncBtn)
    expect(onSyncCwd).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /sync cwd/i })).toBeNull()
  })

  it('toggles the drop-target class on drag over / leave', () => {
    render(<DemoWorkspace resolveBranch={resolveBranch} selectedRepoPath={null} />)
    const ws = screen.getByTestId('demo-workspace')
    expect(ws.className).not.toMatch(/grid-workspace--drop-target/)
    fireEvent.dragOver(ws, { dataTransfer: dataTransfer(BILLING) })
    expect(ws.className).toMatch(/grid-workspace--drop-target/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/components/demo-workspace-mock.test.tsx --project jsdom`
Expected: FAIL — `DemoWorkspace` is not exported from `DemoWorkspaceMock`.

- [ ] **Step 3: Add the interactive component**

Edit `src/tutorial/DemoWorkspaceMock.tsx`. Change the top import line and add the new component + helpers. Replace the file's import line:

```ts
import type { CSSProperties } from 'react'
```

with:

```ts
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { WORKTREE_DRAG_MIME } from '../lib/dragTypes'
```

Add `const PANE_GREEN = '#3fb950'` right after the existing `const PANE_BLUE = '#0066FF'`.

Then append the following exports/helpers to the end of the file (keep `DemoTabBar`, `DemoWorkspacePane`, and `DemoTerminalBody` for now):

```tsx
interface FakePane {
  id: string
  label: string
  color: string
  branch: string
  /** Folder the pane is pointed at (changes when the user selects another worktree). */
  repoPath: string
  /** Folder the (fake) process is actually running in. Diverges from repoPath → Sync cwd. */
  runningRepoPath: string
  kind: 'claude' | 'tests'
}

let dropPaneCounter = 0

const SEED_FEAT = 'C:/demo/.worktrees/nest-web/feat-dark-mode'
const SEED_ROOT = 'C:/demo/nest-web'

interface DemoWorkspaceProps {
  /** Resolve a dropped worktree path to its branch (reads the live demo store). */
  resolveBranch: (repoPath: string) => string | undefined
  /** The worktree the user last selected in the sidebar — diverges the focused pane. */
  selectedRepoPath: string | null
  /** Fired when a dropped worktree opens a fake terminal pane. */
  onPaneOpened?: () => void
  /** Fired when the user clicks Sync cwd. */
  onSyncCwd?: () => void
}

/**
 * Stateful, interactive replica of the workspace. Accepts real worktree drags
 * (same MIME as the live app) to "open" fake terminals, and shows a Sync cwd
 * button when the focused pane points at a different folder than it's running
 * in. No PTYs — everything is local React state.
 */
export function DemoWorkspace({ resolveBranch, selectedRepoPath, onPaneOpened, onSyncCwd }: DemoWorkspaceProps) {
  const [panes, setPanes] = useState<FakePane[]>(() => [
    { id: 'pane-claude', label: 'CLAUDE', color: PANE_BLUE, branch: 'feat/dark-mode', repoPath: SEED_FEAT, runningRepoPath: SEED_FEAT, kind: 'claude' },
    { id: 'pane-tests', label: 'CODEX', color: PANE_GREEN, branch: 'main', repoPath: SEED_ROOT, runningRepoPath: SEED_ROOT, kind: 'tests' },
  ])
  const [focusedId, setFocusedId] = useState('pane-claude')
  const [dropActive, setDropActive] = useState(false)
  const [restartingId, setRestartingId] = useState<string | null>(null)
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Selecting a different worktree points the focused pane at it; its
  // runningRepoPath stays stale → the Sync cwd button appears.
  useEffect(() => {
    if (!selectedRepoPath) return
    setPanes((prev) => prev.map((p) => (p.id === focusedId ? { ...p, repoPath: selectedRepoPath } : p)))
  }, [selectedRepoPath, focusedId])

  useEffect(() => () => { if (restartTimer.current) clearTimeout(restartTimer.current) }, [])

  const onDragOver = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes(WORKTREE_DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (!dropActive) setDropActive(true)
  }
  const onDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setDropActive(false)
  }
  const onDrop = (e: React.DragEvent) => {
    const path = e.dataTransfer.getData(WORKTREE_DRAG_MIME)
    setDropActive(false)
    if (!path) return
    e.preventDefault()
    const branch = resolveBranch(path) ?? path
    const id = `pane-drop-${++dropPaneCounter}`
    setPanes((prev) => [...prev, { id, label: 'CLAUDE', color: PANE_BLUE, branch, repoPath: path, runningRepoPath: path, kind: 'claude' }])
    setFocusedId(id)
    onPaneOpened?.()
  }

  const syncCwd = (paneId: string) => {
    setRestartingId(paneId)
    setPanes((prev) => prev.map((p) => (p.id === paneId ? { ...p, runningRepoPath: p.repoPath } : p)))
    onSyncCwd?.()
    if (restartTimer.current) clearTimeout(restartTimer.current)
    restartTimer.current = setTimeout(() => setRestartingId(null), 600)
  }

  // Only the first diverged pane carries the tour anchor (avoid duplicate ids).
  const firstDivergedId = panes.find((p) => p.repoPath !== p.runningRepoPath)?.id ?? null

  return (
    <div
      className={`workspace${dropActive ? ' grid-workspace--drop-target' : ''}`}
      data-testid="demo-workspace"
      style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="grid-workspace" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, padding: 4, minHeight: 0 }}>
        {panes.map((p) => (
          <DemoPane
            key={p.id}
            pane={p}
            focused={p.id === focusedId}
            restarting={restartingId === p.id}
            tourAnchor={p.id === firstDivergedId}
            onFocus={() => setFocusedId(p.id)}
            onSync={() => syncCwd(p.id)}
          />
        ))}
      </div>
    </div>
  )
}

function DemoPane({
  pane,
  focused,
  restarting,
  tourAnchor,
  onFocus,
  onSync,
}: {
  pane: FakePane
  focused: boolean
  restarting: boolean
  tourAnchor: boolean
  onFocus: () => void
  onSync: () => void
}) {
  const diverged = pane.repoPath !== pane.runningRepoPath
  return (
    <div
      className="terminal-pane"
      style={{ flex: 1, minHeight: 0, outline: focused ? `1px solid ${pane.color}55` : 'none', ['--pane-color' as string]: pane.color } as CSSProperties}
      onClick={onFocus}
    >
      <div className="pane-header">
        <div className="pane-header-left">
          <span className="pane-color-btn" style={{ background: pane.color }} />
          <span className="pane-ai-label" style={{ color: pane.color, fontWeight: 600, fontSize: 11, letterSpacing: '.04em' }}>
            {pane.label}
          </span>
          <span
            style={{
              fontSize: 10,
              color: pane.color,
              background: `${pane.color}1f`,
              border: `1px solid ${pane.color}4d`,
              padding: '1px 6px',
              borderRadius: 3,
            }}
          >
            {pane.kind === 'claude' ? '5173' : 'test'}
          </span>
          <span className="pane-note" style={{ color: '#7f8694', fontSize: 12 }}>{pane.branch}</span>
          {diverged && (
            <button
              className="pane-sync-cwd-btn"
              {...(tourAnchor ? { 'data-tour-id': 'pane-sync-cwd-btn' } : {})}
              onClick={(e) => { e.stopPropagation(); onSync() }}
              title="Restart this terminal in the selected worktree's folder"
              style={{
                fontSize: 10,
                color: '#ffb454',
                background: 'rgba(255,180,84,.12)',
                border: '1px solid rgba(255,180,84,.35)',
                padding: '1px 7px',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              Sync cwd
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, color: '#5a5a63' }}>
          <span className="pane-zoom-btn">⛶</span>
          <span className="pane-close-btn">×</span>
        </div>
      </div>
      <div className="terminal-container">
        <DemoPaneBody pane={pane} restarting={restarting} />
      </div>
    </div>
  )
}

function basenameOf(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed
}

function DemoPaneBody({ pane, restarting }: { pane: FakePane; restarting: boolean }) {
  const mono = '"SF Mono", "JetBrains Mono", Menlo, Consolas, monospace'
  const folder = basenameOf(pane.runningRepoPath)
  const base: CSSProperties = {
    height: '100%',
    background: '#000',
    color: '#d6d6dc',
    fontFamily: mono,
    fontSize: 12.5,
    lineHeight: 1.55,
    padding: '8px 10px',
    overflow: 'hidden',
    whiteSpace: 'pre-wrap',
  }
  if (restarting) {
    return (
      <div style={base}>
        <div style={{ color: '#ffb454' }}>↻ Restarting in {folder}…</div>
      </div>
    )
  }
  if (pane.kind === 'tests') {
    return (
      <div style={base}>
        <div style={{ color: '#6b6b74' }}>~/{folder} · <span style={{ color: PANE_GREEN }}>{pane.branch}</span></div>
        <div style={{ height: 8 }} />
        <div><span style={{ color: PANE_GREEN }}>$</span> npm test --watch</div>
        <div style={{ height: 6 }} />
        <div style={{ color: '#3fb950' }}>  ✓ theme toggles to dark (12 ms)</div>
        <div style={{ color: '#3fb950' }}>  ✓ persists preference (4 ms)</div>
        <div style={{ color: '#8a8a93' }}>  Tests: <span style={{ color: '#3fb950' }}>2 passed</span>, 2 total</div>
        <div style={{ height: 10 }} />
        <div><span style={{ color: PANE_GREEN }}>$</span> <span style={{ background: '#d6d6dc', color: '#000' }}>&nbsp;</span></div>
      </div>
    )
  }
  return (
    <div style={base}>
      <div style={{ color: '#6b6b74' }}>~/{folder} · <span style={{ color: PANE_BLUE }}>{pane.branch}</span></div>
      <div style={{ height: 8 }} />
      <div><span style={{ color: '#5a8cff' }}>{'>'}</span> add a dark theme toggle to the settings panel</div>
      <div style={{ height: 8 }} />
      <div><span style={{ color: '#9cc0ff' }}>●</span> I'll add a ThemeToggle and wire it to the settings store.</div>
      <div style={{ height: 6 }} />
      <div style={{ color: '#8a8a93' }}>  Updated <span style={{ color: '#d6d6dc' }}>src/theme.ts</span>  <span style={{ color: '#3fb950' }}>+8</span> <span style={{ color: '#f85149' }}>-1</span></div>
      <div style={{ color: '#8a8a93' }}>  Added   <span style={{ color: '#d6d6dc' }}>src/components/ThemeToggle.tsx</span>  <span style={{ color: '#3fb950' }}>+24</span></div>
      <div style={{ height: 6 }} />
      <div style={{ color: '#3fb950' }}>  ✓ dev server ready on http://localhost:5173</div>
      <div style={{ height: 10 }} />
      <div><span style={{ color: '#5a8cff' }}>{'>'}</span> <span style={{ background: '#d6d6dc', color: '#000' }}>&nbsp;</span></div>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/components/demo-workspace-mock.test.tsx --project jsdom`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/tutorial/DemoWorkspaceMock.tsx src/__tests__/components/demo-workspace-mock.test.tsx
git commit -m "feat(tutorial): interactive multi-pane workspace mock (drop + Sync cwd)"
```

---

## Task 6: Wire the interactive mock + action signals into the sandbox

**Files:**
- Modify: `src/tutorial/TutorialSandbox.tsx`
- Modify: `src/tutorial/DemoWorkspaceMock.tsx` (remove the now-unused static `DemoWorkspacePane` + `DemoTerminalBody`)
- Test: `src/__tests__/components/worktrees-tutorial.test.tsx` (extend), `src/__tests__/components/tutorial-isolation.test.tsx` (verify still green)

Swap the static pane for `DemoWorkspace`, lift the `selectedRepoPath` + `advanceSignal` state, and route the mock's `onPaneOpened`/`onSyncCwd` into the tour's action channel.

- [ ] **Step 1: Write the failing test (drop advances the drag-terminal step)**

Append this test to `src/__tests__/components/worktrees-tutorial.test.tsx` (inside the existing `describe`):

```ts
  it('dropping a worktree advances the drag-terminal step', async () => {
    render(<TutorialSandbox tourId="worktrees" onClose={() => {}} />)
    await waitFor(() =>
      expect(screen.getByText(/A worktree is a branch/)).toBeInTheDocument(),
    )
    // Walk to the "Open a terminal in a worktree" step (index 9, the 10th).
    for (let i = 0; i < 9; i++) {
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
    }
    expect(screen.getByText('Open a terminal in a worktree')).toBeInTheDocument()

    // Drop a worktree onto the workspace → the tour advances to "Switch a
    // terminal's folder" without clicking Next.
    const ws = screen.getByTestId('demo-workspace')
    fireEvent.drop(ws, {
      dataTransfer: {
        getData: () => 'C:/demo/.worktrees/nest-web/feat-dark-mode',
        types: ['application/x-raven-worktree-path'],
      },
    })
    await waitFor(() =>
      expect(screen.getByText("Switch a terminal's folder")).toBeInTheDocument(),
    )
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/components/worktrees-tutorial.test.tsx --project jsdom`
Expected: FAIL — `demo-workspace` testid not found (sandbox still renders the static `DemoWorkspacePane`); the tour never auto-advances on drop.

- [ ] **Step 3: Wire DemoWorkspace + signals into TutorialSandbox**

Replace `src/tutorial/TutorialSandbox.tsx` with:

```tsx
// src/tutorial/TutorialSandbox.tsx
import { useRef, useState, useEffect, useCallback } from 'react'
import { createDemoHarness, type DemoHarness } from './demo/harness'
import { createDemoState, type DemoState } from './demo/fixtures'
import { OnboardingTour, type AdvanceSignal } from './OnboardingTour'
import { BridgeProvider } from '../lib/bridge'
import { DemoTabBar, DemoWorkspace } from './DemoWorkspaceMock'
import { getTour } from './registry'
import { WorktreesSection } from '../components/WorktreesSection'
import { NewWorktreeModal } from '../components/NewWorktreeModal'
import { DiffViewerPanel } from '../components/DiffViewerPanel'
import type { TourId } from './types'

interface Props {
  tourId: TourId
  onClose: () => void
}

/**
 * Full-screen overlay that runs a tutorial section in demo mode: activates a
 * (selective) demo harness so the mounted REAL components read mocks via bridge,
 * then renders those components + the coachmark tour. The background app is
 * untouched (it uses window.* directly). Worktrees does NOT swap supabase.
 */
export function TutorialSandbox({ tourId, onClose }: Props) {
  const harnessRef = useRef<DemoHarness | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [ready, setReady] = useState(false)
  const stateRef = useRef<DemoState | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [diffPath, setDiffPath] = useState<string | null>(null)
  // Drives the workspace mock's cwd divergence (which worktree the user picked).
  const [selectedRepoPath, setSelectedRepoPath] = useState<string | null>(null)
  // Action channel: bumping the nonce advances the step whose advanceOnAction matches.
  const [advanceSignal, setAdvanceSignal] = useState<AdvanceSignal | null>(null)
  const nonceRef = useRef(0)
  const fire = useCallback((action: string) => {
    setAdvanceSignal({ action, nonce: ++nonceRef.current })
  }, [])

  if (!harnessRef.current) {
    stateRef.current = createDemoState()
    // Worktrees needs no supabase/fetch — keep them off for isolation.
    harnessRef.current = createDemoHarness(stateRef.current, { supabase: false, fetch: false })
  }

  useEffect(() => {
    const h = harnessRef.current!
    h.activate()
    setReady(true)
    return () => {
      h.deactivate()
      setReady(false)
    }
  }, [])

  // Resolve a dropped worktree path → branch by reading the LIVE demo store
  // (so a worktree the user just created in the real modal resolves too).
  const resolveBranch = useCallback(
    (repoPath: string) => stateRef.current?.worktree.worktrees.find((w) => w.repoPath === repoPath)?.branch,
    [],
  )

  if (!ready) return null
  const tour = getTour(tourId)
  if (!tour) return null
  const repoPath = stateRef.current!.worktree.rootRepoPath

  return (
    <div ref={containerRef} className="tutorial-sandbox" style={{ position: 'fixed', inset: 0, zIndex: 1900, background: '#000', display: 'flex', flexDirection: 'column' }}>
      {/*
        Only the components INSIDE this provider read the demo mocks (via
        useBridge). The live app, mounted outside this subtree, keeps reading
        window.* and is untouched even though it renders these same components.
      */}
      <BridgeProvider value={harnessRef.current!.bridge}>
        {/* Window-wide tab bar (static mock) so the sandbox reads like the real app. */}
        <DemoTabBar />

        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* Left panel mimics the real sidebar wrapper using the real CSS classes */}
          <div className="sidebar expanded" style={{ width: 280, borderRight: '1px solid #1b1b20', overflow: 'auto' }}>
            <div className="sidebar-worktrees-wrap">
              <WorktreesSection
                repoPath={repoPath}
                activeRepoPath={repoPath}
                onSelect={(p) => { setDiffPath(p); setSelectedRepoPath(p) }}
                onNewClick={() => setModalOpen(true)}
              />
            </div>
          </div>

          {/* Right panel: an interactive workspace replica (drop target + fake panes). */}
          <DemoWorkspace
            resolveBranch={resolveBranch}
            selectedRepoPath={selectedRepoPath}
            onPaneOpened={() => fire('drop')}
            onSyncCwd={() => fire('sync')}
          />
        </div>

        <NewWorktreeModal
          open={modalOpen}
          repoPath={repoPath}
          onClose={() => setModalOpen(false)}
          onCreated={() => setModalOpen(false)}
        />
        <DiffViewerPanel open={diffPath !== null} worktreePath={diffPath} onClose={() => setDiffPath(null)} />
      </BridgeProvider>

      {/* The tour scopes anchor lookups to this sandbox container so it never
          targets the live app's duplicate data-tour-id anchors behind the overlay. */}
      <OnboardingTour steps={tour.steps} onClose={onClose} rootRef={containerRef} advanceSignal={advanceSignal} />
    </div>
  )
}
```

- [ ] **Step 4: Remove the now-unused static workspace exports**

In `src/tutorial/DemoWorkspaceMock.tsx`, delete the `DemoWorkspacePane` function (the old static `.workspace` replica) and the `DemoTerminalBody` function it used. Keep `DemoTabBar`, `DemoWorkspace`, `DemoPane`, `DemoPaneBody`, `basenameOf`, and the color constants. (The new `DemoPaneBody` fully replaces the old `DemoTerminalBody`.)

- [ ] **Step 5: Run the affected tests**

Run: `npx vitest run src/__tests__/components/worktrees-tutorial.test.tsx src/__tests__/components/tutorial-isolation.test.tsx --project jsdom`
Expected: PASS — including the new drop-advances-step test. The isolation test still shows the demo branch in the sandbox and the real branch in the live section.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (no dangling references to `DemoWorkspacePane`/`DemoTerminalBody`).

- [ ] **Step 7: Commit**

```bash
git add src/tutorial/TutorialSandbox.tsx src/tutorial/DemoWorkspaceMock.tsx src/__tests__/components/worktrees-tutorial.test.tsx
git commit -m "feat(tutorial): wire interactive workspace + action-driven advance into sandbox"
```

---

## Task 7: Full suite + manual Electron verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all projects green (no Spanish-copy or 11-step assertions remain).

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual Electron check (English locale)**

Run: `npm run dev`. Link a repo / expand the sidebar so the tutorial auto-launches (or open Settings → Tutorial → "Tutorial: Worktrees"). Verify:
- Tooltip is visibly smaller; engine buttons read **Back / Skip / Next → / Done** (English).
- The workspace shows **two** panes (CLAUDE + CODEX) — not an empty void.
- On the "Open a terminal in a worktree" step, dragging a worktree row into the workspace highlights the drop target and opens a third pane; the tour advances on its own.
- Clicking another worktree in the sidebar makes a **Sync cwd** button appear on the focused pane; clicking it shows "Restarting…" then the pane re-renders for the new folder, and the tour advances.
- No `bridge`/harness errors in the console, and **no real worktree is created or removed** (the demo store mutates, not disk).

- [ ] **Step 4: Manual Electron check (Spanish locale)**

Temporarily launch with a Spanish UI locale to confirm bilingual copy renders, e.g. PowerShell:

```powershell
$env:LANG = 'es_AR.UTF-8'; npm run dev
```

Confirm the tour copy and engine buttons render in Spanish (**Atrás / Saltar / Siguiente → / Listo**). Then unset and relaunch for normal use.

> Note: this is manual verification (no commit). If the locale env var does not switch Electron's `navigator.language`, fall back to verifying Spanish via the `i18n` unit tests (Task 2) and confirm English manually.

---

## Notes for the implementer

- **Isolation is sacred.** Never reintroduce a global bridge override or `document`-wide anchor queries. The sandbox renders inside `BridgeProvider`; the tour scopes anchors via `rootRef`.
- **No PTY in the mock.** `DemoWorkspace` is pure local state. The drag MUST use `WORKTREE_DRAG_MIME` so it genuinely originates from the real `WorktreesSection` drag source in Electron.
- **App UI is English-only.** All app-facing copy ships English; only the tutorial is localized, and English is the default.
- **Do NOT stage unrelated pre-existing changes.** The working tree has uncommitted edits in `electron/*`, `src/types.ts`, `src/hooks/useXterm.ts`, `src/lib/terminal*.ts`, `src/vite-env.d.ts`, `.gitignore`, etc. Each commit must `git add` only the explicit files listed in that task.
