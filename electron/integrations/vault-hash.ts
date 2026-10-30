// Helpers puros de hoja, compartidos por vault-plan.ts (vault personal) y
// team-thread-plan.ts (hilo de equipo). No conocen scope ni clasificacion: solo hashean
// texto y calculan el path de un conflicto. Por eso vivir en su propio modulo no rompe
// la separacion entre vault-plan.ts y team-thread-plan.ts — esa separacion protege la
// logica de clasificacion de scope, no estos dos helpers de hoja.
import { createHash } from 'crypto'

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export function conflictPathFor(filePath: string): string {
  const slash = filePath.lastIndexOf('/')
  const dir = slash === -1 ? '' : filePath.slice(0, slash + 1)
  const name = slash === -1 ? filePath : filePath.slice(slash + 1)
  return `${dir}_conflicts/${name}`
}
