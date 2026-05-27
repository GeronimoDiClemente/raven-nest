// src/tutorial/demo/fixtures.ts

import { createWorktreeDemoState, type WorktreeDemoState } from './worktree-fixtures'

/** A demo repo as the UI expects to see it. */
export interface DemoRepo {
  id: string
  fullName: string
  provider: 'github' | 'gitlab'
  cloneUrl: string
  /** null = not yet on disk (offers Clone / Link). */
  localPath: string | null
  defaultBranch: string
}

/** A GitHub-shaped PR for PRList/PRReview fixtures. */
export interface DemoPR {
  number: number
  title: string
  user: { login: string; avatar_url: string }
  state: 'open' | 'closed'
  merged: boolean
  created_at: string
  head: { ref: string }
  base: { ref: string }
  body: string | null
}

/** Mutable demo world. Mocks mutate this; the UI re-reads it. */
export interface DemoState {
  repos: DemoRepo[]
  prs: Record<string /* repoFullName */, DemoPR[]>
  /** Pre-recorded terminal output replayed into the demo pane. */
  ptyScript: string
  githubLogin: string
  githubToken: string
  worktree: WorktreeDemoState
}

const AVATAR =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="10" fill="%234F9EFF"/></svg>'

/** Returns a fresh, isolated copy of the demo world (no shared references). */
export function createDemoState(): DemoState {
  return {
    githubLogin: 'demo-user',
    githubToken: 'demo-token',
    repos: [
      {
        id: 'repo-web',
        fullName: 'demo-user/nest-web',
        provider: 'github',
        cloneUrl: 'https://github.com/demo-user/nest-web.git',
        localPath: null,
        defaultBranch: 'main',
      },
      {
        id: 'repo-api',
        fullName: 'demo-user/nest-api',
        provider: 'gitlab',
        cloneUrl: 'https://gitlab.com/demo-user/nest-api.git',
        localPath: 'C:/demo/nest-api',
        defaultBranch: 'main',
      },
    ],
    prs: {
      'demo-user/nest-web': [
        {
          number: 42,
          title: 'Add dark mode toggle',
          user: { login: 'teammate', avatar_url: AVATAR },
          state: 'open',
          merged: false,
          created_at: new Date(Date.now() - 3600_000).toISOString(),
          head: { ref: 'feat/dark-mode' },
          base: { ref: 'main' },
          body: 'Adds a dark mode toggle to settings.',
        },
      ],
    },
    ptyScript:
      '\x1b[32m$\x1b[0m claude\r\n' +
      'Welcome to Claude Code (demo)\r\n' +
      '> How do I add a route?\r\n' +
      '\x1b[36mAdd a new entry to src/router.tsx ...\x1b[0m\r\n',
    worktree: createWorktreeDemoState(),
  }
}
