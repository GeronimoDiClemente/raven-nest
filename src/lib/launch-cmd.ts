/** Model ids in practice are alphanumerics plus `. _ - / :`
 *  (e.g. `opus`, `gemini-2.5-pro`, `anthropic/claude-opus`). Anything with a
 *  space or shell metacharacter is treated as unsafe and dropped. */
const SAFE_MODEL = /^[A-Za-z0-9._:/-]+$/

/** Compose a launch command with an optional per-agent model flag.
 *  Pure + total: an empty base (plain terminal/browser) is never modified,
 *  and a missing flag or model degrades to the base command (no-op) rather
 *  than emitting a broken command.
 *
 *  Defense-in-depth: the composed string is ultimately written to a PTY shell,
 *  and `model` may originate from a persisted (and, in future, shared/imported)
 *  worker-spec. A `model` containing anything outside the safe model-id charset
 *  is treated as absent and degrades to the base command — never emit a broken
 *  or injectable command. */
export function appendModelFlag(
  baseCmd: string,
  modelFlag: string | undefined,
  model: string | undefined,
): string {
  if (!baseCmd) return baseCmd
  if (!modelFlag || !model) return baseCmd
  if (!SAFE_MODEL.test(model)) return baseCmd // reject shell metacharacters/spaces → no-op, never inject
  return `${baseCmd} ${modelFlag} ${model}`
}
