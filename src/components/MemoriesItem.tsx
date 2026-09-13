// Spec §4.1/§4.2/§5.1 — la fila hermana de Personal. La "mini vista" pedida es la fila
// misma: el estado se lee sin abrir nada.
//
// A diferencia de PersonalItem, esta fila NO manda a onUpgrade en plan Free: la memoria
// local es de todos los planes (§8.1: runLocalMemoryImport se saco del handler de connect
// justo para que un usuario Free tambien importe), y esconderla detras del paywall
// contradice el local-first que es la mitad de por que esto le gana a lo hosteado.
//
// Se escribe con el MISMO <Button ghost> que PersonalItem, y no con un `<div class="sidebar-item">`.
// Medido el 2026-09-13: era la unica fila de la barra con un glifo dibujado a mano (viewBox
// 16 contra el 24 de los ocho Lucide) y con el color base de `.sidebar-item`
// (`--text-secondary`) en vez del `text-muted-foreground` de sus vecinas — o sea, dos
// sistemas de front conviviendo en la misma columna. Se notaba: el icono se veia mas pesado
// y la fila mas apagada que Personal y Settings, que estan pegadas.
import { Button } from '@/components/ui/button'
import { Waypoints } from 'lucide-react'
import { useMemories } from '../hooks/useMemories'
import { ICON_SIZE } from '../lib/icons'

interface Props {
  expanded: boolean
  onOpen: () => void
}

export default function MemoriesItem({ expanded, onOpen }: Props) {
  const { status } = useMemories()

  return (
    <Button
      variant="ghost"
      size="default"
      className="h-8 w-full justify-start gap-2.5 px-2.5 font-normal text-muted-foreground hover:text-foreground"
      onClick={onOpen}
      title={`Memories · ${status.text}`}
    >
      <span className="sidebar-icon" style={{ position: 'relative' }}>
        {/* `Waypoints`: nodos unidos por aristas, que es exactamente lo que hay del otro lado.
            Antes era un glifo propio con la misma idea pero dibujado a mano y con otra
            geometria, y en una columna de ocho Lucide el unico distinto se lee como de otra
            app. La marca no valia romper la linea. */}
        <Waypoints size={ICON_SIZE.lg} aria-hidden />
        <span
          data-testid="memories-dot"
          data-dot={status.dot}
          className="memories-dot"
          aria-label={status.text}
        />
      </span>
      <span className="sidebar-label">Memories</span>
      {expanded && <span className="memories-status-text">{status.text}</span>}
    </Button>
  )
}
