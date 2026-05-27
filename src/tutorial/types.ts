// src/tutorial/types.ts

/** All tours shipped in the app. */
export type TourId = 'activation' | 'my-repos' | 'teams' | 'worktrees'

/** One coachmark step: anchor + copy + how it advances. */
export interface TourStep {
  /** Stable id, unique within a tour. */
  id: string
  /** CSS selector for the element to spotlight (e.g. `[data-tour-id="new-terminal"]`). */
  anchor: string
  /** Tooltip heading. */
  title: string
  /** Tooltip body copy. */
  body: string
  /** Preferred tooltip side relative to the anchor. Defaults to 'bottom'. */
  placement?: 'top' | 'bottom' | 'left' | 'right'
  /** If true, clicking the spotlighted element advances to the next step. */
  advanceOnClick?: boolean
}

export interface TourDef {
  id: TourId
  steps: TourStep[]
}
