import type { ReactNode } from 'react'
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels'

interface Props {
  worktrees: ReactNode
  explorer: ReactNode
}

// Reparto vertical AJUSTABLE entre Worktrees y Explorer — misma mecánica y
// misma lib que los splits entre panes. El tamaño persiste solo (autoSaveId
// → localStorage). Con una sección sola no hay nada que repartir.
export default function SidebarSplit({ worktrees, explorer }: Props) {
  if (!worktrees || !explorer) return <>{worktrees}{explorer}</>
  return (
    <PanelGroup direction="vertical" autoSaveId="nest-sidebar-split" className="sidebar-split">
      <Panel defaultSize={45} minSize={15}>{worktrees}</Panel>
      <PanelResizeHandle className="resize-handle resize-handle--row sidebar-split-handle" />
      <Panel minSize={20}>{explorer}</Panel>
    </PanelGroup>
  )
}
