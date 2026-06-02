import { useState, useEffect, useRef } from 'react'

export interface StagedFile {
  path: string
  name: string
  thumbnail?: string
}

interface Props {
  files: StagedFile[]
  onRemove: (path: string) => void
  onSend: (message: string) => void
  onCancel: () => void
}

export default function FileStagingBar({ files, onRemove, onSend, onCancel }: Props) {
  const [message, setMessage] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { onSend(message); setMessage('') }
    if (e.key === 'Escape') onCancel()
  }

  return (
    <div className="file-staging-bar">
      <div className="file-staging-files">
        {files.map((f, i) => (
          <div key={f.path ?? i} className="file-staging-item">
            {f.thumbnail
              ? <img src={f.thumbnail} className="file-staging-thumb" alt={f.name} />
              : <span className="file-staging-icon">📄</span>
            }
            <span className="file-staging-name">{f.name}</span>
            <button className="file-staging-remove" onClick={() => onRemove(f.path)}>×</button>
          </div>
        ))}
      </div>
      <div className="file-staging-input-row">
        <input
          ref={inputRef}
          className="file-staging-input"
          placeholder="Message (optional)…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button className="file-staging-send" onClick={() => { onSend(message); setMessage('') }}>
          Send ↵
        </button>
      </div>
    </div>
  )
}
