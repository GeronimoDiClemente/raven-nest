// Cómo se nombra y se pinta el estado de un worker. El estado va SIEMPRE con los tokens de
// estado (`--ok` / `--warn` / `--destructive`) y en palabras; el color del worker (workerSwatch)
// es leyenda de identidad y nunca dice el estado (spec §5).
import type { OrchestrationWorkerStatus } from '../types'

export const ETIQUETA_DE_WORKER: Record<OrchestrationWorkerStatus, string> = {
  starting: 'Starting',
  working: 'Working',
  needs_input: 'Needs input',
  done: 'Done',
  exited: 'Exited',
  stopped: 'Stopped',
}

/** Clase de texto del estado. `working` queda neutro, como el gris de MemoriesStatusRow:
 *  trabajar no es una noticia. */
export const CLASE_DE_WORKER: Record<OrchestrationWorkerStatus, string> = {
  starting: 'text-muted-foreground',
  working: 'text-foreground',
  needs_input: 'text-warn',
  done: 'text-ok',
  exited: 'text-destructive',
  stopped: 'text-muted-foreground',
}
