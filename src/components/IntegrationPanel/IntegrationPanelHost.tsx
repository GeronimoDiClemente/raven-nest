// Overlay que monta el shell con el adapter del plugin (misma mecánica que IntegrationsMarketplace).
import { useMemo } from 'react'
import { getAdapter } from '../../integrations/registry'
import { IntegrationPanelShell } from './IntegrationPanelShell'
import { useGitInfo } from '../../hooks/useGitInfo'

interface Props {
  pluginId: string
  repoPath: string | null
  onClose: () => void
}

export function IntegrationPanelHost({ pluginId, repoPath, onClose }: Props) {
  const adapter = useMemo(() => getAdapter(pluginId), [pluginId])
  const { branch } = useGitInfo(repoPath ?? undefined)
  if (!adapter) return null
  return (
    <div className="ip-overlay" onClick={onClose}>
      <div className="ip-window" role="dialog" aria-label={adapter.displayName} onClick={(e) => e.stopPropagation()}>
        <div className="ip-window-bar">
          {adapter.displayName}
          <button className="ip-window-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <IntegrationPanelShell
          adapter={adapter}
          worktreeContext={{ repoPath, branch: branch ?? null }}
          getTerminalOutput={() => '$ (milestone 2: real output from the active pane)'}
        />
      </div>
    </div>
  )
}
