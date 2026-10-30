// Core decision + git invocation for `worktree:create`, factored out of the
// (untestable) inline IPC handler in main.ts so the idempotency behaviour can
// be tested with injected ports. The handler keeps the IPC-boundary
// validation, wtPath computation, and meta/preset side-effects.

export interface WorktreeAddPorts {
  /** true if a worktree is already checked out at wtPath */
  worktreeExists(wtPath: string): boolean
  /** true if refs/heads/<branch> already exists in the repo. May be async (main.ts runs git without blocking). */
  branchExists(repoPath: string, branch: string): boolean | Promise<boolean>
  /** run `git <args>`; must throw (or reject) on a non-zero exit */
  runGit(args: string[]): void | Promise<void>
}

export type WorktreeAddResult =
  | { ok: true; created: boolean } // created:false → an existing worktree was reused
  | { ok: false; error: string }

export async function performWorktreeAdd(
  ports: WorktreeAddPorts,
  opts: { repoPath: string; branch: string; wtPath: string; fromBranch: string },
): Promise<WorktreeAddResult> {
  // Idempotency: "Work on this" clicked twice (or an earlier run left the
  // worktree behind) must reuse it, not surface git's raw
  // "fatal: '<path>' already exists".
  if (ports.worktreeExists(opts.wtPath)) return { ok: true, created: false }

  const args = (await ports.branchExists(opts.repoPath, opts.branch))
    ? ['-C', opts.repoPath, 'worktree', 'add', opts.wtPath, opts.branch]
    : ['-C', opts.repoPath, 'worktree', 'add', '-b', opts.branch, opts.wtPath, opts.fromBranch]

  try {
    await ports.runGit(args)
    return { ok: true, created: true }
  } catch (err) {
    return { ok: false, error: `git worktree add failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}
