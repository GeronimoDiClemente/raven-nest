/** Compose a launch command with an optional per-agent model flag.
 *  Pure + total: an empty base (plain terminal/browser) is never modified,
 *  and a missing flag or model degrades to the base command (no-op) rather
 *  than emitting a broken command. */
export function appendModelFlag(
  baseCmd: string,
  modelFlag: string | undefined,
  model: string | undefined,
): string {
  if (!baseCmd) return baseCmd
  if (!modelFlag || !model) return baseCmd
  return `${baseCmd} ${modelFlag} ${model}`
}
