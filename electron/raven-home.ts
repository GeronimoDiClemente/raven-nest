import { homedir } from 'os'

// Honors RAVEN_HOME env var so e2e tests can isolate persistent state in a tmpdir.
// On Windows, `os.homedir()` ignores spawn-injected USERPROFILE in some paths,
// so a dedicated env var is the only reliable isolation hook.
export function ravenHome(): string {
  return process.env.RAVEN_HOME || homedir()
}
