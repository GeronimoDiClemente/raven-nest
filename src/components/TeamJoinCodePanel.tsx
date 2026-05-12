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

  // No code yet
  if (!code) {
    if (!isLeader) return null
    return (
      <div className="team-join-code-panel empty">
        <div className="team-join-code-panel-info">
          <span className="team-join-code-label">
            <KeyIcon />
            Team join code
          </span>
          <span className="team-join-code-hint">
            Generate a code so others can request to join.
          </span>
        </div>
        <button
          className="snippet-save-btn"
          onClick={handleGenerate}
          disabled={working}
        >
          {working ? '…' : 'Generate'}
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="team-join-code-panel">
        <div className="team-join-code-panel-info">
          <span className="team-join-code-label">
            <KeyIcon />
            Team join code
          </span>
          <span className="team-join-code-value">{code}</span>
          <span className="team-join-code-hint">
            Share it with anyone who wants to join. Requests need a leader's approval.
          </span>
        </div>
        <div className="team-join-code-actions">
          <button
            className={`team-join-code-icon-btn${copied ? ' copied' : ''}`}
            onClick={handleCopy}
            title={copied ? 'Copied' : 'Copy code'}
            aria-label="Copy code"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
          {isLeader && (
            <button
              className="team-join-code-icon-btn"
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

      {confirmRotate && (
        <div className="confirm-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setConfirmRotate(false) }}>
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
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
      <circle cx="6" cy="10" r="3" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M8.5 8L13 3.5M11 5.5L13 7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M3 11V3a1 1 0 011-1h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function RotateIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <path d="M13.5 2.5v3h-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
