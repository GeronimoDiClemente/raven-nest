import { Component, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  label?: string
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('[ErrorBoundary]', this.props.label ?? '', error)
  }

  render() {
    if (this.state.error) {
      return this.props.fallback ?? (
        <div style={{ padding: 24, color: '#ef4444', fontSize: 13 }}>
          <p style={{ fontWeight: 600, marginBottom: 8 }}>Something went wrong{this.props.label ? ` in ${this.props.label}` : ''}</p>
          <pre style={{ fontSize: 11, color: '#888', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {this.state.error.message}
          </pre>
          <button
            style={{ marginTop: 12, fontSize: 12, color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            onClick={() => this.setState({ error: null })}
          >
            ↺ Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
