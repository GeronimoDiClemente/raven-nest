// Spec §4.1/§4.2/§5.1 — la fila hermana de Personal. La "mini vista" pedida es la fila
// misma: el estado se lee sin abrir nada.
//
// A diferencia de PersonalItem, esta fila NO manda a onUpgrade en plan Free: la memoria
// local es de todos los planes (§8.1: runLocalMemoryImport se saco del handler de connect
// justo para que un usuario Free tambien importe), y esconderla detras del paywall
// contradice el local-first que es la mitad de por que esto le gana a lo hosteado.
import { useMemories } from '../hooks/useMemories'
import { ICON_SIZE, ICON_STROKE } from '../lib/icons'

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
        {/* Un nodo con dos aristas: el grafo, que es lo que hay del otro lado. Es la única
            marca dibujada a mano que queda en la sidebar, y se queda porque el grafo ES el
            producto — pero toma el tamaño y el trazo de `icons.ts`, que es de donde los saca
            el resto de la fila. Medido en la app: las 9 filas de la sidebar dan 16×16 con
            trazo 1.25 y `non-scaling-stroke`; ésta era la única con 1.3 y sin el efecto, que
            es lo que mantiene el trazo parejo cuando la cáscara se escala. */}
        <svg
          width={ICON_SIZE.lg}
          height={ICON_SIZE.lg}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={ICON_STROKE}
          strokeLinecap="round"
        >
          <circle cx="8" cy="4" r="2" vectorEffect="non-scaling-stroke" />
          <circle cx="3.5" cy="12" r="2" vectorEffect="non-scaling-stroke" />
          <circle cx="12.5" cy="12" r="2" vectorEffect="non-scaling-stroke" />
          <path d="M6.7 5.7 4.8 10.2M9.3 5.7l1.9 4.5" vectorEffect="non-scaling-stroke" />
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
