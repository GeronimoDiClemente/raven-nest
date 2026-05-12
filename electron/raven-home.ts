import { homedir } from 'os'
import { sep } from 'path'
import { existsSync } from 'fs'

// Recover the real user home when homedir() returns a path that's already
// nested inside an accountDir. Happens when Raven Nest is launched from a
// process whose HOME was redirected by a parent Raven Nest (e.g. running
// `nest` inside a Claude pane that itself runs inside a Nest sandbox).
// Without this, each level creates `.raven-nest/accounts/...` inside the
// previous level's accountDir, producing recursively nested paths.
function unnest(p: string): string {
  const segments = p.split(/[\\/]/)
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i] === '.raven-nest' && segments[i + 1] === 'accounts') {
      const head = segments.slice(0, i).join(sep)
      if (!head) return p
      // Defensive: only un-nest when the trimmed prefix actually exists on
      // disk. An enterprise HOMEDIR policy that legitimately points at a
      // path containing `.raven-nest/accounts` (rare, but possible if IT
      // shipped a profile from one of our own machines) would otherwise be
      // silently rewritten to a non-existent directory.
      if (!existsSync(head)) return p
      return head
    }
  }
  return p
}

// Honors RAVEN_HOME env var so e2e tests can isolate persistent state in a tmpdir.
// On Windows, `os.homedir()` ignores spawn-injected USERPROFILE in some paths,
// so a dedicated env var is the only reliable isolation hook.
// Used for PERSISTENT STORAGE only (.raven-nest/accounts, workspaces, settings).
export function ravenHome(): string {
  if (process.env.RAVEN_HOME) return process.env.RAVEN_HOME
  return unnest(homedir())
}

// Real user home for terminal cwd / file ops. Always un-nests and IGNORES
// RAVEN_HOME — RAVEN_HOME is for redirecting Nest's storage, not for changing
// where new shells/panes start. Without this separation, setting RAVEN_HOME
// to a nested accountDir (to preserve existing data) would also force every
// new PTY to spawn inside that accountDir.
export function userHome(): string {
  return unnest(homedir())
}
