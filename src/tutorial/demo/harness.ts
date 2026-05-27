// src/tutorial/demo/harness.ts
import { __setSupabaseClient, __resetSupabaseClient } from '../../lib/supabase'
import { __setBridgeOverrides, __clearBridgeOverrides } from '../../lib/bridge'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DemoState } from './fixtures'
import { makeWindowMocks, makePtyMock, makeSupabaseMock, makeWorktreeMocks } from './mocks'


export interface DemoHarness {
  /** The mutable demo world the UI reads/writes. */
  readonly state: DemoState
  /** Swap real APIs for mocks. Idempotent. */
  activate(): void
  /** Restore everything swapped by activate(). Idempotent. */
  deactivate(): void
}

export interface DemoHarnessOptions {
  /** Swap the supabase client for a mock (only sections that use Teams need this). Default false. */
  supabase?: boolean
  /** Patch window.fetch to serve GitHub/GitLab fixtures. Default false. */
  fetch?: boolean
}

export function createDemoHarness(state: DemoState, opts: DemoHarnessOptions = {}): DemoHarness {
  let active = false
  let pty: ReturnType<typeof makePtyMock> | null = null
  let originalFetch: typeof fetch | null = null
  let fetchPatched = false
  let supabaseSwapped = false

  function activate(): void {
    if (active) return
    active = true

    const mocks = makeWindowMocks(state)
    const wt = makeWorktreeMocks(state)
    pty = makePtyMock(state)
    __setBridgeOverrides({
      ...mocks,
      // Worktree-domain mocks take precedence for these keys (worktree, git,
      // preset, spotlight, diff, port, electronShell) so the real Worktrees
      // components read store-driven demo data.
      ...wt,
      // pty keeps the replay (onData/create from makePtyMock) AND adds getPid
      // from the worktree mocks (PortsBanner reads it).
      pty: { ...pty.api, getPid: wt.pty.getPid },
    })

    // fetch is NOT a contextBridge prop; it's the native fetch and is reassignable.
    // (PRList/PRReview call the global fetch directly; intercept it here.)
    if (opts.fetch) {
      originalFetch = window.fetch
      try {
        window.fetch = makeFetchMock(state, originalFetch.bind(window))
        fetchPatched = true
      } catch {
        fetchPatched = false
      }
    }

    if (opts.supabase) {
      __setSupabaseClient(makeSupabaseMock(state) as unknown as SupabaseClient)
      supabaseSwapped = true
    }
  }

  function deactivate(): void {
    if (!active) return
    active = false

    pty?.dispose()
    pty = null

    __clearBridgeOverrides()

    if (fetchPatched && originalFetch) {
      window.fetch = originalFetch
      fetchPatched = false
    }
    originalFetch = null

    if (supabaseSwapped) {
      __resetSupabaseClient()
      supabaseSwapped = false
    }
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
