// src/tutorial/demo/worktree-fixtures.ts

/** Minimal worktree shape the components read (subset of the app's WorktreeMeta). */
export interface DemoWorktree {
  repoPath: string
  branch: string
  setupState: 'idle' | 'running' | 'done' | 'error'
  isRoot: boolean
}

export interface DiffHunk {
  header: string
  lines: string[]
}
export interface DiffFile {
  path: string
  additions: number
  deletions: number
  binary: boolean
  hunks: DiffHunk[]
}

/** Mutable worktree world the worktree mocks read/write. */
export interface WorktreeDemoState {
  rootRepoPath: string
  worktrees: DemoWorktree[]
  branches: string[]
  defaultBranch: string
  /** diff keyed by worktree repoPath */
  diffs: Record<string, DiffFile[]>
  /** declared ports keyed by worktree repoPath */
  ports: Record<string, number[]>
  /** PR keyed by branch */
  prs: Record<string, { number: number; url: string }>
}

export function createWorktreeDemoState(): WorktreeDemoState {
  const root = 'C:/demo/nest-web'
  const featPath = 'C:/demo/.worktrees/nest-web/feat-dark-mode'
  return {
    rootRepoPath: root,
    branches: ['main', 'feat/dark-mode'],
    defaultBranch: 'main',
    worktrees: [
      { repoPath: root, branch: 'main', setupState: 'done', isRoot: true },
      { repoPath: featPath, branch: 'feat/dark-mode', setupState: 'done', isRoot: false },
    ],
    diffs: {
      [featPath]: [
        {
          path: 'src/theme.ts',
          additions: 8,
          deletions: 1,
          binary: false,
          hunks: [
            { header: '@@ -1,3 +1,10 @@', lines: ['+export const dark = { bg: "#0b0b0c" }', '-export const theme = light', '+export const theme = dark'] },
          ],
        },
      ],
    },
    ports: { [featPath]: [5173] },
    prs: { 'feat/dark-mode': { number: 42, url: 'https://github.com/demo-user/nest-web/pull/42' } },
  }
}
