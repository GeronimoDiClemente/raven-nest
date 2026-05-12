import { useState } from 'react'
import { useTeamJoinCode } from '../hooks/useTeamJoinCode'

interface Props {
  teamId: string
  isLeader: boolean
}

export default function TeamJoinCodePanel({ teamId, isLeader }: Props) {
  const { code, loading, regenerate } = useTeamJoinCode(teamId)
  const [working, setWorking] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmRotate, setConfirmRotate] = useState(false)

  const handleGenerate = async () => {
    setWorking(true)
    await regenerate()
    setWorking(false)
  }

  const handleRotate = async () => {
    setConfirmRotate(false)
    setWorking(true)
    await regenerate()
    setWorking(false)
  }

  const handleCopy = async () => {
    if (!code) return
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (loading) return null

  // No code yet, not a leader → nothing to show
  if (!code && !isLeader) return null

  // No code yet, leader → empty state
  if (!code) {
    return (
      <div className="tjcp-card tjcp-card--empty">
        <div className="tjcp-header">
          <div className="tjcp-header-left">
            <span className="tjcp-icon-wrap" aria-hidden="true">
              <KeyIcon />
            </span>
            <span className="tjcp-label">Team join code</span>
          </div>
        </div>
        <p className="tjcp-hint">
          Generate a code so others can request to join.
        </p>
        <div className="tjcp-empty-actions">
          <button
            className="tjcp-primary-btn"
            onClick={handleGenerate}
            disabled={working}
          >
            {working ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="tjcp-card">
        <div className="tjcp-header">
          <div className="tjcp-header-left">
            <span className="tjcp-icon-wrap" aria-hidden="true">
              <KeyIcon />
            </span>
            <span className="tjcp-label">Team join code</span>
          </div>
          <div className="tjcp-actions">
            <button
              className={`tjcp-icon-btn${copied ? ' tjcp-icon-btn--ok' : ''}`}
              onClick={handleCopy}
              title={copied ? 'Copied' : 'Copy code'}
              aria-label="Copy code"
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
            {isLeader && (
              <button
                className="tjcp-icon-btn"
                onClick={() => setConfirmRotate(true)}
                disabled={working}
                title="Rotate (invalidates the current code)"
                aria-label="Rotate code"
              >
                <RotateIcon />
              </button>
            )}
          </div>
        </div>

        <div className="tjcp-code-row">
          <span className="tjcp-code">{code}</span>
        </div>

        <p className="tjcp-hint">
          Share it with anyone who wants to join. Requests need a leader's approval.
        </p>
      </div>

      {confirmRotate && (
        <div
          className="confirm-overlay"
          onMouseDown={e => { if (e.target === e.currentTarget) setConfirmRotate(false) }}
        >
          <div className="team-modal" style={{ width: 380, height: 'auto' }}>
            <div className="team-modal-header">
              <span className="team-modal-title">Rotate join code?</span>
              <button className="team-modal-close" onClick={() => setConfirmRotate(false)}>×</button>
            </div>
            <div className="team-modal-body" style={{ padding: '18px 20px', display: 'block' }}>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
                The current code will be invalidated. Pending requests aren't affected.
              </p>
              <div className="snippet-form-actions">
                <button className="snippet-cancel-btn" onClick={() => setConfirmRotate(false)}>Cancel</button>
                <button className="snippet-save-btn" onClick={handleRotate}>Rotate</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function KeyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor">
      <circle cx="6" cy="10" r="3" strokeWidth="1.4" />
      <path d="M8.5 8L13 3.5M11 5.5L13 7.5" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor">
      <rect x="5" y="5" width="9" height="9" rx="1.5" strokeWidth="1.3" />
      <path d="M3 11V3a1 1 0 011-1h7" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor">
      <path d="M3 8.5l3 3 7-7" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function RotateIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor">
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M13.5 2.5v3h-3" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
