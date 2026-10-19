// src/tutorial/registry.ts
import type { TourDef, TourId } from './types'
import { worktreesTour } from './tours/worktrees'
import { myReposTour } from './tours/my-repos'
import { teamsTour } from './tours/teams'
import { memoriesTour } from './tours/memories'
import { memorySettingsTour } from './tours/memory-settings'

/** All registered tours. */
const tours: Record<string, TourDef> = {
  [worktreesTour.id]: worktreesTour,
  [myReposTour.id]: myReposTour,
  [teamsTour.id]: teamsTour,
  [memoriesTour.id]: memoriesTour,
  [memorySettingsTour.id]: memorySettingsTour,
}

export function getTour(id: TourId): TourDef | undefined {
  return tours[id]
}

export function listTourIds(): TourId[] {
  return Object.keys(tours) as TourId[]
}
