// src/tutorial/registry.ts
import type { TourDef, TourId } from './types'
import { activationTour } from './tours/activation'

/** All registered tours. Follow-up plans add my-repos / teams / worktrees here. */
const tours: Record<string, TourDef> = {
  [activationTour.id]: activationTour,
}

export function getTour(id: TourId): TourDef | undefined {
  return tours[id]
}

export function listTourIds(): TourId[] {
  return Object.keys(tours) as TourId[]
}
