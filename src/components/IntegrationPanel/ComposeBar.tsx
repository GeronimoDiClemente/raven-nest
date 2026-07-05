import { useState } from 'react'
import type { ComposeBody } from '../../integrations/types'

interface Props {
  placeholder: string
  onSubmit: (body: ComposeBody) => void
  getTerminalOutput?: () => string
}

export function ComposeBar({ placeholder, onSubmit, getTerminalOutput }: Props) {
  const [text, setText] = useState('')
  const [attached, setAttached] = useState<string | undefined>(undefined)
  return (
    <footer className="ip-compose">
      {attached && <pre className="ip-compose-attachment">{attached}</pre>}
      <textarea className="ip-compose-input" placeholder={placeholder} value={text}
        onChange={(e) => setText(e.target.value)} rows={2} />
      <div className="ip-compose-actions">
        {getTerminalOutput && (
          <button className="ip-attach" onClick={() => setAttached(getTerminalOutput())}>
            ⌨ Adjuntar output del terminal
          </button>
        )}
        <button
          className="ip-send"
          disabled={!text.trim() && !attached}
          onClick={() => {
            onSubmit({ text: text.trim(), terminalOutput: attached })
            setText(''); setAttached(undefined)
          }}
        >Enviar</button>
      </div>
    </footer>
  )
}
