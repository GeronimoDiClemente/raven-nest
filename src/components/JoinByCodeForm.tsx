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

  return (
    <div className="join-code-form">
      <div>
        <label className="join-code-form-label">Invite code</label>
        <div className="join-code-input-row">
          <input
            className="snippet-input join-code-input"
            placeholder="XXXXXXXX"
            value={code}
            maxLength={8}
            onChange={e => setCode(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === 'Enter' && code.trim()) handleSubmit() }}
            disabled={submitting}
            spellCheck={false}
            autoComplete="off"
          />
          <button
            className="snippet-save-btn"
            onClick={handleSubmit}
            disabled={submitting || code.trim().length === 0}
          >
            {submitting ? '…' : 'Request to join'}
          </button>
        </div>
        {error && <p className="join-code-message error">{error}</p>}
        {success && <p className="join-code-message success">{success}</p>}
      </div>

      {myPendingRequests.length > 0 && (
        <div>
          <p className="join-code-form-label">Your pending requests</p>
          <div className="join-code-pending-list">
            {myPendingRequests.map(req => (
              <div key={req.memberId} className="team-pending-banner">
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{req.team.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    Waiting for approval · sent {new Date(req.requestedAt).toLocaleDateString()}
                  </div>
                </div>
                <button
                  className="snippet-cancel-btn"
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
