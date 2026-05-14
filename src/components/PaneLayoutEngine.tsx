import { Fragment, type ReactNode } from 'react'
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels'
import type { PaneNode, LayoutId } from '../types'
import { getPreset, type Split } from '../layout/presets'

function equalSizes(count: number): number[] {
  if (count <= 0) return []
  const base = Math.floor(100 / count)
  const sizes = Array(count).fill(base)
  sizes[sizes.length - 1] += 100 - base * count
  return sizes
}

export interface PaneLayoutEngineProps {
  layoutId: LayoutId
  panes: PaneNode[]
  splitRatios?: Record<string, number[]>
  onResize: (path: string, sizes: number[]) => void
  renderPane: (pane: PaneNode) => ReactNode
  renderEmpty: (slot: number) => ReactNode
}

export function PaneLayoutEngine({
  layoutId, panes, splitRatios = {}, onResize, renderPane, renderEmpty,
}: PaneLayoutEngineProps) {
  const preset = getPreset(layoutId)
  return (
    <div className="grid-workspace">
      {renderSplit(preset.root, 'r', panes, splitRatios, onResize, renderPane, renderEmpty)}
    </div>
  )
}

function renderSplit(
  split: Split,
  path: string,
  panes: PaneNode[],
  splitRatios: Record<string, number[]>,
  onResize: (path: string, sizes: number[]) => void,
  renderPane: (pane: PaneNode) => ReactNode,
  renderEmpty: (slot: number) => ReactNode,
): ReactNode {
  if (split.kind === 'pane') {
    const pane = panes[split.slot]
    return pane ? renderPane(pane) : renderEmpty(split.slot)
  }

  // Defensive: a persisted ratio array whose length doesn't match the current
  // children count would feed `defaultSize={undefined}` to the trailing Panels
  // and render them as degenerate slivers. When the count mismatches, fall
  // back to equal weights.
  const persisted = splitRatios[path]
  const ratios = persisted && persisted.length === split.children.length
    ? persisted
    : equalSizes(split.children.length)
  const direction = split.kind === 'h' ? 'horizontal' : 'vertical'
  const handleClass = split.kind === 'h' ? 'resize-handle resize-handle--col' : 'resize-handle resize-handle--row'

  // Re-mount the group when the children count changes — react-resizable-panels
  // only reads `defaultSize` on mount, so adding/removing a Panel in-place
  // leaves the existing siblings stuck at their old sizes. Keying on the count
  // forces a fresh layout when the shape changes, without re-mounting on every
  // user resize (which would discard their drag).
  return (
    <PanelGroup
      key={`${path}-${split.children.length}`}
      direction={direction}
      onLayout={(sizes) => onResize(path, sizes)}
    >
      {split.children.map((child, i) => (
        <Fragment key={i}>
          {i > 0 && <PanelResizeHandle className={handleClass} />}
          <Panel defaultSize={ratios[i]} minSize={8}>
            {renderSplit(child, `${path}/${i}`, panes, splitRatios, onResize, renderPane, renderEmpty)}
          </Panel>
        </Fragment>
      ))}
    </PanelGroup>
  )
}
