import { GitFork, GitBranch, Github, X, Check, Plus, PanelLeftClose } from 'lucide-react'
import { PanelId, Workspace } from '../types'
import { useGitInfo } from '../hooks/useGitInfo'
import { basename } from '../lib/path'
import { WorktreesSection } from './WorktreesSection'
import SnippetPanel from './SnippetPanel'
import MCPPanel from './MCPPanel'
import WorkspacePanel from './WorkspacePanel'
import CommandHistoryPanel from './CommandHistoryPanel'

interface Props {
  panel: PanelId
  onClose: () => void
  // worktrees
  repoPath?: string
  activeCellRepoPath?: string
  onWorktreeSelect: (worktreePath: string) => void
  onNewWorktree: () => void
  worktreeRefreshKey?: number
  onRepoLink: () => void
  onRepoUnlink: () => void
  // snippets
  onSnippetSend: (content: string) => void
  onSnippetBroadcast: (content: string) => void
  // shared
  onUpgrade: () => void
  // workspaces
  onWorkspaceSave: (name: string) => void
  onWorkspaceLoad: (ws: Workspace) => void
  // cmdhist
  onCommandRun: (cmd: string) => void
}

const PANEL_TITLES: Record<PanelId, string> = {
  worktrees: 'Worktrees',
  snippets: 'Snippets',
  mcp: 'MCP',
  workspaces: 'Workspaces',
  cmdhist: 'Command History',
}

function WorktreesBody({
  repoPath,
  activeCellRepoPath,
  onWorktreeSelect,
  onNewWorktree,
  worktreeRefreshKey,
  onRepoLink,
  onRepoUnlink,
}: {
  repoPath?: string
  activeCellRepoPath?: string
  onWorktreeSelect: (p: string) => void
  onNewWorktree: () => void
  worktreeRefreshKey?: number
  onRepoLink: () => void
  onRepoUnlink: () => void
}) {
  const { branch, githubUrl, isDirty } = useGitInfo(repoPath)

  if (!repoPath) {
    return (
      <button className="side-panel-link" onClick={onRepoLink}>
        <Plus size={14} />
        Link a repository…
      </button>
    )
  }

  return (
    <>
      <div className="repo-card">
        <div className="repo-card-top">
          <GitFork className="gi" />
          <span className="repo-card-name">{basename(repoPath)}</span>
          {githubUrl && (
            <button
              className="repo-card-ext"
              title="Open on GitHub"
              onClick={() => window.electronShell.openExternal(githubUrl)}
            >
              <Github />
            </button>
          )}
          <button
            className="repo-card-ext"
            title="Unlink repository"
            onClick={onRepoUnlink}
          >
            <X />
          </button>
        </div>
        <div className="repo-card-meta">
          <span className={`branch-pill${isDirty ? ' dirty' : ''}`}>
            <GitBranch />
            {branch ?? '—'}
            {isDirty && ' ●'}
          </span>
          <span className="repo-sync">
            <Check />
            up to date
          </span>
        </div>
      </div>
      <WorktreesSection
        repoPath={repoPath}
        activeRepoPath={activeCellRepoPath}
        onSelect={onWorktreeSelect}
        onNewClick={onNewWorktree}
        refreshKey={worktreeRefreshKey}
      />
    </>
  )
}

export function SidePanel({
  panel,
  onClose,
  repoPath,
  activeCellRepoPath,
  onWorktreeSelect,
  onNewWorktree,
  worktreeRefreshKey,
  onRepoLink,
  onRepoUnlink,
  onSnippetSend,
  onSnippetBroadcast,
  onUpgrade,
  onWorkspaceSave,
  onWorkspaceLoad,
  onCommandRun,
}: Props) {
  return (
    <div className="side-panel">
      <div className="side-panel-head">
        <span className="ttl">{PANEL_TITLES[panel]}</span>
        <div className="acts">
          <button className="side-panel-act" title="Close panel" onClick={onClose}>
            <PanelLeftClose />
          </button>
        </div>
      </div>

      <div className="side-panel-body">
        {panel === 'worktrees' && (
          <WorktreesBody
            repoPath={repoPath}
            activeCellRepoPath={activeCellRepoPath}
            onWorktreeSelect={onWorktreeSelect}
            onNewWorktree={onNewWorktree}
            worktreeRefreshKey={worktreeRefreshKey}
            onRepoLink={onRepoLink}
            onRepoUnlink={onRepoUnlink}
          />
        )}

        {panel === 'snippets' && (
          <SnippetPanel
            onSend={onSnippetSend}
            onBroadcast={onSnippetBroadcast}
            onRequireUpgrade={onUpgrade}
          />
        )}

        {panel === 'mcp' && (
          <MCPPanel
            repoPath={repoPath}
            onRequireUpgrade={onUpgrade}
          />
        )}

        {panel === 'workspaces' && (
          <WorkspacePanel
            onSave={onWorkspaceSave}
            onLoad={onWorkspaceLoad}
            onRequireUpgrade={onUpgrade}
          />
        )}

        {panel === 'cmdhist' && (
          <CommandHistoryPanel
            onRun={onCommandRun}
          />
        )}
      </div>
    </div>
  )
}
