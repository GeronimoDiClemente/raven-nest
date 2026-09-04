// src/components/IntegrationPanel/IntegrationPanelShell.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import type { IntegrationAdapter, Section, DetailModel, ItemRef, WorktreeContext, ComposeBody } from '../../integrations/types'
import { ContextColumn } from './ContextColumn'
import { ComposeBar } from './ComposeBar'

interface Props {
  adapter: IntegrationAdapter
  worktreeContext: WorktreeContext
  getTerminalOutput?: () => string
  /** H5: cuando se provee (paneles de docs, p.ej. Notion), muestra "Work on this"
   *  en el detalle — baja el doc como spec inicial de un worktree nuevo. */
  onWorkOnDoc?: (pageId: string, title: string) => void
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function IntegrationPanelShell({ adapter, worktreeContext, getTerminalOutput, onWorkOnDoc }: Props) {
  const [sections, setSections] = useState<Section[]>([])
  const [selected, setSelected] = useState<ItemRef | null>(null)
  const [detail, setDetail] = useState<DetailModel | null>(null)
  const [worktreeEntity, setWorktreeEntity] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Deps por primitivas: el host puede pasar un objeto literal nuevo en cada
  // render y no queremos refetchear/resetear el panel por identidad de objeto.
  const { repoPath, branch } = worktreeContext

  // Guard de carreras: token monotónico compartido por todas las operaciones
  // async del panel (carga inicial, select, runAction, compose). Antes de
  // aplicar el resultado de un await se compara contra el token vigente al
  // momento del disparo — si ya no coincide, la resolución pertenece a una
  // operación vieja (ej. un click anterior más lento) y se descarta sin
  // tocar el estado.
  const requestIdRef = useRef(0)
  // Evita setState tras unmount cuando una promesa controlada por el test
  // (o una llamada real lenta) resuelve después de que el componente se fue.
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])
  // Reintento: guarda la última operación que falló para que el botón
  // "Retry" del banner de error la vuelva a ejecutar tal cual.
  const retryRef = useRef<() => void>(() => {})

  const loadInitial = useCallback(async () => {
    const token = ++requestIdRef.current
    setLoading(true)
    setError(null)
    const ctx: WorktreeContext = { repoPath, branch }
    try {
      const [secs, entityRef] = await Promise.all([
        adapter.fetchSections(ctx),
        adapter.resolveWorktreeEntity(ctx),
      ])
      if (!mountedRef.current || requestIdRef.current !== token) return
      setSections(secs)
      if (entityRef) {
        setSelected(entityRef)
        const d = await adapter.fetchDetail(entityRef)
        if (!mountedRef.current || requestIdRef.current !== token) return
        setDetail(d)
        setWorktreeEntity(d.key ?? d.title)
      }
      setLoading(false)
    } catch (e) {
      if (!mountedRef.current || requestIdRef.current !== token) return
      setLoading(false)
      setError(errorMessage(e))
      retryRef.current = () => void loadInitial()
    }
  }, [adapter, repoPath, branch])

  useEffect(() => {
    void loadInitial()
  }, [loadInitial])

  const select = useCallback(async (ref: ItemRef) => {
    const token = ++requestIdRef.current
    setSelected(ref)
    setError(null)
    try {
      const d = await adapter.fetchDetail(ref)
      if (!mountedRef.current || requestIdRef.current !== token) return
      setDetail(d)
      setWorktreeEntity(d.key ?? d.title)
    } catch (e) {
      if (!mountedRef.current || requestIdRef.current !== token) return
      setError(errorMessage(e))
      retryRef.current = () => void select(ref)
    }
  }, [adapter])

  const runAction = useCallback(async (actionId: string) => {
    if (!selected) return
    const ref = selected
    const token = ++requestIdRef.current
    setError(null)
    try {
      await adapter.runAction(actionId, ref)
      const d = await adapter.fetchDetail(ref)
      if (!mountedRef.current || requestIdRef.current !== token) return
      setDetail(d)
    } catch (e) {
      if (!mountedRef.current || requestIdRef.current !== token) return
      setError(errorMessage(e))
      retryRef.current = () => void runAction(actionId)
    }
  }, [adapter, selected])

  const compose = useCallback(async (body: ComposeBody) => {
    if (!selected) return
    const ref = selected
    const token = ++requestIdRef.current
    setError(null)
    try {
      await adapter.compose(ref, body)
      const d = await adapter.fetchDetail(ref)
      if (!mountedRef.current || requestIdRef.current !== token) return
      setDetail(d)
    } catch (e) {
      if (!mountedRef.current || requestIdRef.current !== token) return
      setError(errorMessage(e))
      retryRef.current = () => void compose(body)
    }
  }, [adapter, selected])

  const retry = useCallback(() => retryRef.current(), [])

  return (
    <div className="ip-shell">
      <ContextColumn
        header={{ title: adapter.displayName }}
        sections={sections} selected={selected} onSelect={(r) => void select(r)}
        branch={branch} entityLabel={worktreeEntity}
      />
      <div className="ip-main">
        {error && (
          <div className="ip-error" role="alert">
            <span className="ip-error-text">Something went wrong: {error}</span>
            <button className="ip-error-retry" onClick={retry}>Retry</button>
          </div>
        )}
        {loading && <div className="ip-loading">Loading…</div>}
        {!loading && detail && (
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
                {onWorkOnDoc && (
                  <button className="ip-action ip-action-primary" onClick={() => onWorkOnDoc(detail.ref.itemId, detail.title)}>
                    Work on this
                  </button>
                )}
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
            <ComposeBar placeholder={`Comment on ${detail.key ?? detail.title}…`}
              onSubmit={(b) => void compose(b)} getTerminalOutput={getTerminalOutput} />
          </>
        )}
        {!loading && !detail && !error && (
          <div className="ip-empty">Pick an item on the left</div>
        )}
      </div>
    </div>
  )
}
