interface StatusBarProps {
  paneCount: number
  workspaceName: string
  repoName?: string
}

export default function StatusBar({ paneCount, workspaceName, repoName }: StatusBarProps) {
  return (
    <div className="status-bar">
      <span className="status-item">{workspaceName}</span>
      {repoName && <span className="status-item">⎇ {repoName}</span>}
      <span className="status-item status-item-end">
        {paneCount} {paneCount === 1 ? 'pane' : 'panes'}
      </span>
    </div>
  )
}
