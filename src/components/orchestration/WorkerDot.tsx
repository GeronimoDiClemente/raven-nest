// El punto de identidad de un worker: misma geometría que `.memories-dot` (7px, redondo), pero
// en línea y con el color del worker (leyenda categórica, allow-list del spec §5). No es estado.
import { workerSwatch } from '../../lib/worker-palette'

export default function WorkerDot({ colorIndex, ansi }: { colorIndex: number; ansi?: readonly string[] }) {
  return (
    <span
      aria-hidden
      data-testid="worker-dot"
      className="inline-block size-[7px] shrink-0 rounded-full"
      style={{ background: workerSwatch(colorIndex, ansi) }}
    />
  )
}
