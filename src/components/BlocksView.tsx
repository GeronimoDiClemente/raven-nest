import { useState, useCallback } from 'react'
import { ResponseBlock, PaneNode, AI_CONFIG } from '../types'
import { safeWriteText } from '../lib/clipboard'

interface Props {
  blocks: ResponseBlock[]
  pane: PaneNode
}

const PREVIEW_LINES = 5

export default function BlocksView({ blocks, pane }: Props) {
  const accentColor = pane.customColor ?? AI_CONFIG[pane.aiType].color

  if (blocks.length === 0) {
    return (
      <div className="blocks-view blocks-view-empty">
        <span className="blocks-empty-msg">No responses captured yet</span>
      </div>
    )
  }

  return (
    <div className="blocks-view">
      {[...blocks].reverse().map(block => (
        <BlockCard key={block.id} block={block} accentColor={accentColor} />
      ))}
    </div>
  )
}

function BlockCard({ block, accentColor }: { block: ResponseBlock; accentColor: string }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const lines = block.content.split('\n')
  const isLong = lines.length > PREVIEW_LINES
  const displayText = expanded || !isLong ? block.content : lines.slice(0, PREVIEW_LINES).join('\n')

  const handleCopy = useCallback(() => {
    void safeWriteText(block.content).then(ok => {
      if (ok) {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    })
  }, [block.content])

  const time = new Date(block.timestamp).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })

  return (
    <div className="block-card">
      <div className="block-card-header">
        <span className="block-card-label" style={{ color: accentColor }}>{block.label}</span>
        <span className="block-card-time">{time}</span>
        <button className={`block-copy-btn${copied ? ' copied' : ''}`} onClick={handleCopy} title="Copy response">
          {copied ? (
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M2 6l3 3 5-5" stroke="#22C55E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <rect x="4" y="1" width="7" height="8" rx="1" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M1 4v7h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="block-card-content">{displayText}</pre>
      {isLong && (
        <button className="block-expand-btn" onClick={() => setExpanded(v => !v)}>
          {expanded ? 'Show less' : `Show ${lines.length - PREVIEW_LINES} more lines`}
        </button>
      )}
    </div>
  )
}
