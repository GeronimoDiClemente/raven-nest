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
