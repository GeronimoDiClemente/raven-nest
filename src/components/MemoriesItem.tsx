// Spec §4.1/§4.2/§5.1 — la fila hermana de Personal. La "mini vista" pedida es la fila
// misma: el estado se lee sin abrir nada.
//
// A diferencia de PersonalItem, esta fila NO manda a onUpgrade en plan Free: la memoria
// local es de todos los planes (§8.1: runLocalMemoryImport se saco del handler de connect
// justo para que un usuario Free tambien importe), y esconderla detras del paywall
// contradice el local-first que es la mitad de por que esto le gana a lo hosteado.
import { useMemories } from '../hooks/useMemories'

interface Props {
  expanded: boolean
  onOpen: () => void
}

export default function MemoriesItem({ expanded, onOpen }: Props) {
  const { status } = useMemories()

  return (
    <div
      className="sidebar-item sidebar-item-panel sidebar-item-team"
      style={{ cursor: 'pointer', position: 'relative' }}
      onClick={onOpen}
      title={`Memories · ${status.text}`}
    >
      <span className="sidebar-icon" style={{ position: 'relative' }}>
        {/* Un nodo con dos aristas: el grafo, que es lo que hay del otro lado. */}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="4" r="2" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="3.5" cy="12" r="2" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="12.5" cy="12" r="2" stroke="currentColor" strokeWidth="1.3" />
          <path d="M6.7 5.7 4.8 10.2M9.3 5.7l1.9 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <span
          data-testid="memories-dot"
          data-dot={status.dot}
          className="memories-dot"
          aria-label={status.text}
        />
      </span>
      <span className="sidebar-label">Memories</span>
      {expanded && <span className="memories-status-text">{status.text}</span>}
    </div>
  )
}
