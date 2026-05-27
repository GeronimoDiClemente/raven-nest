// src/tutorial/demo/harness.ts
import { __setSupabaseClient, __resetSupabaseClient } from '../../lib/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DemoState } from './fixtures'
import { makeWindowMocks, makePtyMock, makeSupabaseMock } from './mocks'


export interface DemoHarness {
  /** The mutable demo world the UI reads/writes. */
  readonly state: DemoState
  /** Swap real APIs for mocks. Idempotent. */
  activate(): void
  /** Restore everything swapped by activate(). Idempotent. */
  deactivate(): void
}

export function createDemoHarness(state: DemoState): DemoHarness {
  let active = false
  const savedDescriptors = new Map<string, PropertyDescriptor | undefined>()
  let pty: ReturnType<typeof makePtyMock> | null = null

  function install(key: string, value: unknown): void {
    if (!savedDescriptors.has(key)) {
      savedDescriptors.set(key, Object.getOwnPropertyDescriptor(window, key))
    }
    Object.defineProperty(window, key, { value, writable: true, configurable: true, enumerable: true })
  }

  function activate(): void {
    if (active) return
    active = true

    const mocks = makeWindowMocks(state)
    install('git', mocks.git)
    install('worktree', makeWorktreeMock(state))
    install('metrics', mocks.metrics)
    install('accounts', mocks.accounts)
    install('session', mocks.session)
    install('dialog', mocks.dialog)
    install('localPaths', mocks.localPaths)
    install('port', mocks.port)
    install('electronShell', mocks.electronShell)

    const originalFetch = window.fetch.bind(window)
    install('fetch', makeFetchMock(state, originalFetch))

    pty = makePtyMock(state)
    install('pty', pty.api)

    __setSupabaseClient(makeSupabaseMock(state) as unknown as SupabaseClient)
  }

  function deactivate(): void {
    if (!active) return
    active = false

    pty?.dispose()
    pty = null

    for (const [key, desc] of savedDescriptors) {
      if (desc) Object.defineProperty(window, key, desc)
      else delete (window as unknown as Record<string, unknown>)[key]
    }
    savedDescriptors.clear()

    __resetSupabaseClient()
  }

  return { state, activate, deactivate }
}

/** Builds a fetch replacement that answers GitHub/GitLab calls from fixtures. */
function makeFetchMock(state: DemoState, realFetch: typeof fetch): typeof fetch {
  const json = (data: unknown, status = 200): Response =>
    ({ ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) } as unknown as Response)

  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const isGit = url.includes('api.github.com') || url.includes('gitlab.com/api')
    if (!isGit) return realFetch(input, init)

    // PUT .../pulls/:n/merge → mark merged in state.
    const mergeMatch = url.match(/repos\/([^/]+\/[^/]+)\/pulls\/(\d+)\/merge/)
    if (mergeMatch && (init?.method ?? 'GET').toUpperCase() === 'PUT') {
      const [, repo, num] = mergeMatch
      const pr = state.prs[repo]?.find((p) => p.number === Number(num))
      if (pr) {
        pr.merged = true
        pr.state = 'closed'
      }
      return json({ merged: true, message: 'Pull Request successfully merged' })
    }

    // GET .../pulls → list.
    const listMatch = url.match(/repos\/([^/]+\/[^/]+)\/pulls/)
    if (listMatch) {
      const repo = listMatch[1]
      const wantClosed = /state=closed/.test(url)
      const all = state.prs[repo] ?? []
      return json(all.filter((p) => (wantClosed ? p.state === 'closed' : p.state === 'open')))
    }

    // GET .../repos/:owner/:repo → repo metadata.
    const repoMatch = url.match(/repos\/([^/]+\/[^/]+)(?:\?|$)/)
    if (repoMatch) {
      const r = state.repos.find((x) => x.fullName === repoMatch[1])
      return json({ default_branch: r?.defaultBranch ?? 'main' })
    }

    // Fallback: empty array (branches, reviews, files, etc.).
    return json([])
  }) as typeof fetch
}

/** worktree mock that appends created worktrees to an in-memory list. */
function makeWorktreeMock(_state: DemoState) {
  const worktrees: unknown[] = []
  return {
    list: async () => ({ ok: true, worktrees }),
    create: async (opts: { repoPath: string; branch: string }) => {
      const meta = { path: `C:/demo/wt/${opts.branch}`, branch: opts.branch, setupState: 'done' as const }
      worktrees.push(meta)
      return meta
    },
    remove: async () => ({ ok: true }),
    get: async (p: string) => ({ path: p, branch: 'demo', setupState: 'done' as const }),
    setPreset: async () => ({ ok: true }),
    copyFiles: async () => ({ ok: true }),
  }
}
