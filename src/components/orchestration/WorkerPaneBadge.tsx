// El estado de un worker en el header de su pane (spec §6.7/§6.9): el mismo vocabulario que la
// fila de estado de Memories — `Badge variant="outline"` con punto + texto y el texto con el
// token de estado. El punto es el color del worker (quién es), el texto es cómo está.
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { OrchestrationWorkerStatus } from '../../types'
import { CLASE_DE_WORKER, ETIQUETA_DE_WORKER } from '../../orchestration/worker-status'
import WorkerDot from './WorkerDot'

interface Props {
  status: OrchestrationWorkerStatus
  colorIndex: number
  ansi?: readonly string[]
  label?: string
}

export default function WorkerPaneBadge({ status, colorIndex, ansi, label }: Props) {
  return (
    <Badge
      variant="outline"
      data-testid="worker-badge"
      data-status={status}
      className={cn('gap-1.5', CLASE_DE_WORKER[status])}
      title={label ? `Worker "${label}" · ${ETIQUETA_DE_WORKER[status]}` : ETIQUETA_DE_WORKER[status]}
    >
      <WorkerDot colorIndex={colorIndex} ansi={ansi} />
      {ETIQUETA_DE_WORKER[status]}
    </Badge>
  )
}
