// Dónde cae el pane de un worker: en el tab que contiene al coordinador (no en el activo), con
// el color de la paleta de workers. Puro: App.tsx lo aplica con setTabs y contesta el `reply`.
import { AI_CONFIG, MAX_PANES, type AIType, type LayoutId, type OrchestrationLaunchPaneReply, type OrchestrationLaunchPaneRequest, type PaneNode, type WorkspaceTab } from '../types'
import { workerSwatch } from '../lib/worker-palette'
import { defaultLayoutFor } from '../layout/select'
import { getPreset } from '../layout/presets'

export function placeWorkerPane(
  tabs: WorkspaceTab[],
  req: OrchestrationLaunchPaneRequest,
  ansi: readonly string[] | undefined,
): { tabs: WorkspaceTab[]; reply: OrchestrationLaunchPaneReply } {
  // Un tab Hub sólo referencia panes de otros: el pane vive en su tab de origen.
  const tab = tabs.find((t) => !t.isHub && t.panes.some((p) => p.id === req.coordinatorPaneId))
  if (!tab) return { tabs, reply: { requestId: req.requestId, ok: false, error: 'no_tab' } }
  if (tab.panes.length >= MAX_PANES) return { tabs, reply: { requestId: req.requestId, ok: false, error: 'tab_full' } }

  const aiType: AIType = Object.prototype.hasOwnProperty.call(AI_CONFIG, req.aiType) ? (req.aiType as AIType) : 'custom'
  const pane: PaneNode = {
    id: req.paneId,
    aiType,
    accountName: req.accountName,
    accountDir: req.accountDir,
    borderColor: workerSwatch(req.colorIndex, ansi),
    cmd: req.cmd,
    customLabel: req.label,
    repoPath: req.repoPath,
    initialInput: req.initialInput,
    orchestration: { role: 'worker', workerId: req.workerId, coordinatorPaneId: req.coordinatorPaneId, colorIndex: req.colorIndex },
  }
  const nextPanes = [...tab.panes, pane]
  // Mismo criterio que addPane: si el preset quedó chico se promueve y se limpian los ratios.
  const promoted = nextPanes.length > getPreset(tab.layoutId).slotCount
  const layoutId: LayoutId = promoted ? defaultLayoutFor(nextPanes.length) : tab.layoutId
  const nuevo: WorkspaceTab = promoted
    ? { ...tab, panes: nextPanes, layoutId, splitRatios: {} }
    : { ...tab, panes: nextPanes, layoutId }
  return {
    tabs: tabs.map((t) => (t.id === tab.id ? nuevo : t)),
    reply: { requestId: req.requestId, ok: true, tabPaneCount: nextPanes.length },
  }
}
