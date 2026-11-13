import type { WorkerSpec, WorkerStep } from '../types'

export interface WorkerRun { workerId: string; stepIndex: number }

/** Build the initial input for a step: prepend any handoff from the prior
 *  step, include the step's own instructions, and — for non-final steps —
 *  instruct the agent to write its handoff summary when done. */
export function composeStepInput(
  instructions: string | undefined,
  handoff: string | null,
  isFinal: boolean,
): string {
  const parts: string[] = []
  if (handoff) parts.push(`Handoff from the previous step:\n\n${handoff}`)
  if (instructions) parts.push(instructions)
  if (!isFinal) parts.push('When you finish, write a concise handoff summary (what you did, what remains, key files) to .nest/handoff.md.')
  return parts.join('\n\n')
}

/** The step after the current run position, or null if the pipeline is done. */
export function nextStep(spec: WorkerSpec, run: WorkerRun): { step: WorkerStep; index: number } | null {
  const i = run.stepIndex + 1
  if (i >= spec.steps.length) return null
  return { step: spec.steps[i], index: i }
}

/** Merge a worker spec into a list by id: replace the existing entry (e.g. an
 *  edited worker's fresh steps) or append a new one. Lets the app keep its
 *  resolvable-by-id spec list current when a spec created/edited after mount
 *  arrives through the board-open path, instead of missing it in a stale
 *  mount-loaded list. */
export function upsertWorkerSpec(list: WorkerSpec[], spec: WorkerSpec): WorkerSpec[] {
  return [...list.filter((s) => s.id !== spec.id), spec]
}
