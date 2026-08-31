import { Component, Fragment, type ReactNode } from 'react'

// Un throw sincrónico en el render/commit de un pane (ej.: una lib de
// terceros patcheando globals, como el setTheme de shiki pre-fix) desmonta
// el árbol de React ENTERO en React 18 si nadie lo captura — la app entera
// muerta por un solo pane. Los error boundaries solo existen como class
// component: no hay hook equivalente.
interface PaneErrorBoundaryProps {
  children: ReactNode
  onClose: () => void
}

interface PaneErrorBoundaryState {
  error: Error | null
  // Remontar los children tras Reload exige una identidad nueva del subtree
  // (mismo elemento re-renderizado conserva el estado que causó el throw).
  retrySeq: number
}

export class PaneErrorBoundary extends Component<PaneErrorBoundaryProps, PaneErrorBoundaryState> {
  state: PaneErrorBoundaryState = { error: null, retrySeq: 0 }

  static getDerivedStateFromError(error: Error): Partial<PaneErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error): void {
    console.error('[PaneErrorBoundary] pane crashed:', error)
  }

  private handleReload = (): void => {
    this.setState((s) => ({ error: null, retrySeq: s.retrySeq + 1 }))
  }

  render(): ReactNode {
    const { error, retrySeq } = this.state
    if (error) {
      return (
        <div className="editor-file-unavailable pane-crashed" data-testid="pane-crashed">
          <span className="editor-unavailable-text">
            This pane crashed: {error.message}
          </span>
          <div className="pane-crashed-actions">
            <button className="editor-banner-btn primary" onClick={this.handleReload}>Reload pane</button>
            <button className="editor-banner-btn" onClick={this.props.onClose}>Close pane</button>
          </div>
        </div>
      )
    }
    return <Fragment key={retrySeq}>{this.props.children}</Fragment>
  }
}
