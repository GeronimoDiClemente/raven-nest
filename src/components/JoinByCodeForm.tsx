import { useState } from 'react'
import type { PendingRequest } from '../hooks/useTeam'

interface Props {
  myPendingRequests: PendingRequest[]
  onRequestJoin: (code: string) => Promise<{ ok: boolean; teamName?: string; error?: string }>
  onCancelRequest: (memberId: string) => Promise<{ ok: boolean; error?: string }>
}

export default function JoinByCodeForm({ myPendingRequests, onRequestJoin, onCancelRequest }: Props) {
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [cancelingId, setCancelingId] = useState<string | null>(null)

  const handleSubmit = async () => {
    setError(null)
    setSuccess(null)
    setSubmitting(true)
    const result = await onRequestJoin(code)
    setSubmitting(false)
    if (result.ok) {
      setSuccess(result.teamName ? `Request sent to ${result.teamName}` : 'Request sent')
      setCode('')
    } else {
      setError(result.error ?? 'Error')
    }
  }

  const handleCancel = async (memberId: string) => {
    setCancelingId(memberId)
    await onCancelRequest(memberId)
    setCancelingId(null)
  }

  const canSubmit = code.trim().length > 0 && !submitting

  return (
    <div className="jcf-root">
      <p className="jcf-subtitle">
        Enter the 8-character code your team shared with you.
      </p>

      <div className="jcf-input-wrap">
        <input
          className="jcf-input"
          placeholder="XXXXXXXX"
          value={code}
          maxLength={8}
          onChange={e => setCode(e.target.value.toUpperCase().replace(/\s/g, ''))}
          onKeyDown={e => { if (e.key === 'Enter' && canSubmit) handleSubmit() }}
          disabled={submitting}
          spellCheck={false}
          autoComplete="off"
          aria-label="Invite code"
        />
      </div>

      <button
        className="jcf-submit-btn"
        onClick={handleSubmit}
        disabled={!canSubmit}
      >
        {submitting ? (
          <span className="jcf-submit-spinner" aria-hidden="true" />
        ) : (
          <>
            <span>Request to join</span>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </>
        )}
      </button>

      {(error || success) && (
        <div className={`jcf-message ${error ? 'jcf-message-error' : 'jcf-message-success'}`}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            {error ? (
              <>
                <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </>
            ) : (
              <>
                <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M5 8.2l2.2 2.2L11 6.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </>
            )}
          </svg>
          <span>{error ?? success}</span>
        </div>
      )}

      {myPendingRequests.length > 0 && (
        <div className="jcf-pending">
          <div className="jcf-pending-label">Pending requests</div>
          <div className="jcf-pending-list">
            {myPendingRequests.map(req => (
              <div key={req.memberId} className="jcf-pending-item">
                <div className="jcf-pending-info">
                  <div className="jcf-pending-name">{req.team.name}</div>
                  <div className="jcf-pending-meta">
                    Waiting for approval · {new Date(req.requestedAt).toLocaleDateString()}
                  </div>
                </div>
                <button
                  className="jcf-pending-cancel"
                  onClick={() => handleCancel(req.memberId)}
                  disabled={cancelingId === req.memberId}
                >
                  {cancelingId === req.memberId ? '…' : 'Cancel'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
