import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
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

/**
 * Motor de layout con REPARENTING.
 *
 * El árbol de PanelGroups solo renderiza SLOTS vacíos, keyeados por posición
 * (su forma es estable). Cada pane se monta una única vez dentro de un div
 * "host" propio vía portal, y lo que se mueve entre slots es ese nodo del DOM.
 *
 * Por qué: keyear los Panel por id del pane evitaba el remount solo entre
 * hermanos del MISMO grupo. React no puede mover un elemento entre padres, así
 * que un swap que cruzaba de PanelGroup (p. ej. en '3M' = h(p0, v(p1, p2)))
 * desmontaba y remontaba ambos panes — Monaco arrancaba vacío/negro y el
 * WebContentsView del browser se destruía y recreaba. Cambiarle el container a
 * un portal remonta igual; lo único que preserva la instancia es mantener el
 * host fijo y reubicarlo con appendChild.
 */
export function PaneLayoutEngine({
  layoutId, panes, splitRatios = {}, onResize, renderPane, renderEmpty,
}: PaneLayoutEngineProps) {
  const preset = getPreset(layoutId)
  const [slotEls, setSlotEls] = useState<Record<number, HTMLDivElement | null>>({})
  const hostsRef = useRef<Map<string, HTMLDivElement>>(new Map())
  // Callbacks de ref memoizados por slot: si creáramos una función nueva en
  // cada render, React la llamaría con null y de nuevo con el nodo cada vez,
  // y el setState del ref dispararía un render en bucle.
  const slotRefCbs = useRef<Map<number, (el: HTMLDivElement | null) => void>>(new Map())

  const slotRef = (slot: number) => {
    let cb = slotRefCbs.current.get(slot)
    if (!cb) {
      cb = (el: HTMLDivElement | null) => {
        setSlotEls(prev => (prev[slot] === el ? prev : { ...prev, [slot]: el }))
      }
      slotRefCbs.current.set(slot, cb)
    }
    return cb
  }

  const hostFor = (paneId: string): HTMLDivElement => {
    let host = hostsRef.current.get(paneId)
    if (!host) {
      host = document.createElement('div')
      host.className = 'pane-host'
      hostsRef.current.set(paneId, host)
    }
    return host
  }

  useLayoutEffect(() => {
    const alive = new Set<string>()
    panes.forEach((pane, slot) => {
      if (!pane) return
      alive.add(pane.id)
      const host = hostsRef.current.get(pane.id)
      const target = slotEls[slot]
      if (!host || !target || host.parentElement === target) return
      // appendChild saca el nodo del DOM y lo vuelve a insertar: si el foco
      // estaba adentro (xterm, Monaco) se pierde y vuelve al body. Lo
      // restauramos para que arrastrar el pane activo no te deje tecleando en
      // la nada.
      const focused = document.activeElement as HTMLElement | null
      const hadFocus = !!focused && host.contains(focused)
      target.appendChild(host)
      if (hadFocus && focused) focused.focus()
    })
    // Panes que ya no existen: su portal lo desmonta React, pero el host queda
    // colgado en el DOM del slot.
    for (const [paneId, host] of hostsRef.current) {
      if (!alive.has(paneId)) {
        host.remove()
        hostsRef.current.delete(paneId)
      }
    }
  })

  return (
    <div className="grid-workspace">
      {renderSplit(preset.root, 'r', panes, splitRatios, onResize, renderEmpty, slotRef)}
      {panes.map(pane => (
        pane ? <Fragment key={pane.id}>{createPortal(renderPane(pane), hostFor(pane.id))}</Fragment> : null
      ))}
    </div>
  )
}

function renderSplit(
  split: Split,
  path: string,
  panes: PaneNode[],
  splitRatios: Record<string, number[]>,
  onResize: (path: string, sizes: number[]) => void,
  renderEmpty: (slot: number) => ReactNode,
  slotRef: (slot: number) => (el: HTMLDivElement | null) => void,
): ReactNode {
  if (split.kind === 'pane') {
    // Solo el hueco: el pane vive en su host y se muda acá por appendChild.
    return (
      <div className="pane-slot" ref={slotRef(split.slot)}>
        {panes[split.slot] ? null : renderEmpty(split.slot)}
      </div>
    )
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
      {split.children.map((child, i) => {
        // Key por POSICIÓN: los slots son huecos intercambiables y su forma no
        // depende de qué pane los ocupa, así que el árbol nunca se remonta al
        // reordenar. La identidad la conserva el host de cada pane.
        const key = child.kind === 'pane' ? `slot-${child.slot}` : `split-${i}`
        return (
          <Fragment key={key}>
            {i > 0 && <PanelResizeHandle className={handleClass} />}
            <Panel id={String(key)} order={i} defaultSize={ratios[i]} minSize={8}>
              {renderSplit(child, `${path}/${i}`, panes, splitRatios, onResize, renderEmpty, slotRef)}
            </Panel>
          </Fragment>
        )
      })}
    </PanelGroup>
  )
}
