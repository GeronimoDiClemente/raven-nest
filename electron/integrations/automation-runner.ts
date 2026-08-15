// Headless execution of a scheduled automation (Epic C / H11). The scheduler
// (scheduler.ts) owns the "when"; this module owns the "how" of a single run:
// spin up an ephemeral worktree, invoke the agent CLI non-interactively inside
// it, summarize the output, then tear the worktree down. Every side effect
// (git, child_process, fs) is injected via `AutomationRunnerPorts`, so this
// file stays 100% pure/testable — main.ts wires the real ports.
import type { Automation, AutomationRunResult, RunAutomationFn } from './scheduler'

/** Model tokens we allow onto the CLI argv. Deliberately conservative: letters,
 *  digits, and the punctuation real model ids use (`.`, `_`, `:`, `/`, `-`).
 *  Anything else (spaces, shell metachars, quotes) is dropped rather than
 *  passed through — the automation still runs, just without a model override. */
const SAFE_MODEL = /^[A-Za-z0-9._:/-]+$/

/**
 * Builds the argv for a headless agent run, or `null` if the provider has no
 * confirmed non-interactive mode. The prompt is always a single argv element
 * (never concatenated into another arg), so a prompt containing spaces, quotes,
 * `;`, or `$(...)` is passed verbatim to the CLI — there is no shell here.
 *
 * Only `'claude'` is supported today (`claude -p <prompt>`, with an optional
 * `--model`). The other providers (codex, gemini, copilot, opencode, …) are
 * intentionally left out: their non-interactive/headless flags aren't confirmed
 * yet, and guessing a wrong flag would launch an interactive session that hangs
 * the cron run. Add a provider here only once its headless invocation is known.
 */
export function buildAgentArgv(
  provider: string | undefined,
  prompt: string,
  model?: string,
): string[] | null {
  if (provider !== 'claude') return null
  const modelArgs = model && SAFE_MODEL.test(model) ? ['--model', model] : []
  return ['claude', ...modelArgs, '-p', prompt]
}

/**
 * Condenses raw agent output into a short summary for the automation's
 * `lastSummary`: the last `maxLines` non-empty lines, joined by newlines, then
 * capped to `maxChars` (truncating with an ellipsis when it overflows). Empty
 * or whitespace-only output yields `''`.
 */
export function summarize(output: string, maxLines = 8, maxChars = 600): string {
  const lines = output.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim().length > 0)
  const joined = lines.slice(-maxLines).join('\n')
  if (joined.length <= maxChars) return joined
  return joined.slice(0, maxChars - 1) + '…'
}

/** Injected side-effect seam for {@link makeRunAutomation}. Every git / process
 *  interaction goes through here so the orchestration logic stays pure. */
export interface AutomationRunnerPorts {
  createWorktree: (
    repoPath: string,
    branch: string,
  ) => Promise<{ ok: true; wtPath: string } | { ok: false; error: string }>
  runAgent: (argv: string[], cwd: string) => Promise<{ ok: boolean; output: string }>
  removeWorktree: (repoPath: string, wtPath: string) => Promise<void>
  resolveModel: (automation: Automation) => string | undefined
  makeId: () => string
}

/**
 * Builds the `RunAutomationFn` the scheduler invokes for a due automation.
 * Orchestrates: resolve model → build argv → create an ephemeral worktree →
 * run the agent inside it → summarize → always remove the worktree (finally).
 *
 * Never throws: unsupported provider, missing repo, worktree-create failure,
 * a non-ok agent result, and a thrown agent error all resolve to
 * `{ ok: false, summary }`. Cleanup runs only when a worktree was actually
 * created (a failed/absent create leaves nothing to remove).
 */
export function makeRunAutomation(ports: AutomationRunnerPorts): RunAutomationFn {
  return async (automation: Automation): Promise<AutomationRunResult> => {
    const model = ports.resolveModel(automation)
    const argv = buildAgentArgv(automation.provider, automation.prompt, model)
    if (!argv) {
      return { ok: false, summary: `Unsupported provider "${automation.provider ?? 'none'}" — no headless mode` }
    }
    if (!automation.repo) {
      return { ok: false, summary: 'No repo configured for this automation' }
    }

    const branch = `nest-auto/${automation.id}-${ports.makeId()}`
    const created = await ports.createWorktree(automation.repo, branch)
    if (!created.ok) {
      // Nothing was created, so there's nothing to clean up.
      return { ok: false, summary: `Worktree create failed: ${created.error}` }
    }

    const { wtPath } = created
    try {
      const { ok, output } = await ports.runAgent(argv, wtPath)
      return { ok, summary: summarize(output) }
    } catch (err) {
      return { ok: false, summary: err instanceof Error ? err.message : String(err) }
    } finally {
      await ports.removeWorktree(automation.repo, wtPath)
    }
  }
}
