// src/components/IntegrationPanel/IntegrationPanelShell.tsx
import { useCallback, useEffect, useState } from 'react'
import type { IntegrationAdapter, Section, DetailModel, ItemRef, WorktreeContext, ComposeBody } from '../../integrations/types'
import { ContextColumn } from './ContextColumn'
import { ComposeBar } from './ComposeBar'

interface Props {
  adapter: IntegrationAdapter
  worktreeContext: WorktreeContext
  getTerminalOutput?: () => string
}

export function IntegrationPanelShell({ adapter, worktreeContext, getTerminalOutput }: Props) {
  const [sections, setSections] = useState<Section[]>([])
  const [selected, setSelected] = useState<ItemRef | null>(null)
  const [detail, setDetail] = useState<DetailModel | null>(null)
  const [worktreeEntity, setWorktreeEntity] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const [secs, entityRef] = await Promise.all([
        adapter.fetchSections(worktreeContext),
        adapter.resolveWorktreeEntity(worktreeContext),
      ])
      if (!alive) return
      setSections(secs)
      if (entityRef) {
        setSelected(entityRef)
        const d = await adapter.fetchDetail(entityRef)
        if (!alive) return
        setDetail(d)
        setWorktreeEntity(d.key ?? d.title)
      }
    })()
    return () => { alive = false }
  }, [adapter, worktreeContext])

  const select = useCallback(async (ref: ItemRef) => {
    setSelected(ref)
    setDetail(await adapter.fetchDetail(ref))
  }, [adapter])

  const runAction = useCallback(async (actionId: string) => {
    if (!selected) return
    await adapter.runAction(actionId, selected)
    setDetail(await adapter.fetchDetail(selected))
  }, [adapter, selected])

  const compose = useCallback(async (body: ComposeBody) => {
    if (!selected) return
    await adapter.compose(selected, body)
    setDetail(await adapter.fetchDetail(selected))
  }, [adapter, selected])

  return (
    <div className="ip-shell">
      <ContextColumn
        header={{ title: adapter.displayName }}
        sections={sections} selected={selected} onSelect={(r) => void select(r)}
        branch={worktreeContext.branch} entityLabel={worktreeEntity}
      />
      <div className="ip-main">
        {detail ? (
          <>
            <header className="ip-detail-header">
              {detail.key && <span className="ip-detail-key">{detail.key}</span>}
              <h2 className="ip-detail-title">{detail.title}</h2>
              <div className="ip-detail-row">
                {detail.status && <span className="ip-status">{detail.status}</span>}
                {adapter.actions(detail).map((a) => (
                  <button key={a.id} className={`ip-action ip-action-${a.kind}`} onClick={() => void runAction(a.id)}>
                    {a.label}
                  </button>
                ))}
              </div>
              <div className="ip-detail-meta">
                {detail.meta.map((m) => <span key={m.label}>{m.label} <b>{m.value}</b></span>)}
              </div>
            </header>
            <div className="ip-detail-blocks">
              {detail.blocks.map((b, i) => {
                if (b.kind === 'code') return <pre key={i} className="ip-block-code">{b.code}</pre>
                if (b.kind === 'comment') return (
                  <div key={i} className="ip-block-comment">
                    <span className="ip-comment-who">{b.author} <small>{b.when}</small></span>
                    <span className="ip-comment-text">{b.text}</span>
                  </div>
                )
                return <p key={i} className="ip-block-text">{b.text}</p>
              })}
            </div>
            <ComposeBar placeholder={`Comentar en ${detail.key ?? detail.title}…`}
              onSubmit={(b) => void compose(b)} getTerminalOutput={getTerminalOutput} />
          </>
        ) : (
          <div className="ip-empty">Elegí un ítem de la izquierda</div>
        )}
      </div>
    </div>
  )
}
