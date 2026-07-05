export function WorktreeContextCard({ branch, entityLabel }: { branch: string | null; entityLabel: string | null }) {
  if (!branch) return null
  return (
    <div className="ip-worktree-card">
      <span className="ip-worktree-label">Worktree actual</span>
      <span className="ip-worktree-value">
        <code>{branch}</code>{entityLabel ? <> → {entityLabel}</> : null}
      </span>
    </div>
  )
}
