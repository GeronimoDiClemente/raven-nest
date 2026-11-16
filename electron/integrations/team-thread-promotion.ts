// El unico cambio en la ruta de captura (spec §6.2) y el gate de redaccion (spec §6.3).
//
// Por que el gate va ACA y no en el planner: en el vault personal un secreto que se filtra
// te lo filtras a vos mismo; una vez que la fila nace `team` sale de la maquina en el
// proximo push y ya no hay como volver atras. El gate tiene que estar antes del push, no
// antes del render.
import type { ObservationType } from '../memory-protocol'
import { redact } from '../memory-redaction'
import type { TeamThreadSettings } from './team-thread-config'

export interface CaptureScope {
  scope: 'personal' | 'team'
  /** true = daba para team pero se retuvo por sospecha de secreto. */
  heldBack: boolean
}

export function scopeForCapture(
  settings: TeamThreadSettings,
  type: ObservationType,
  title: string,
  content: string,
): CaptureScope {
  if (!settings.enabled) return { scope: 'personal', heldBack: false }
  if (!settings.includedTypes.includes(type)) return { scope: 'personal', heldBack: false }

  const { redacted } = redact(`${title}\n${content}`)
  if (redacted) return { scope: 'personal', heldBack: true }

  return { scope: 'team', heldBack: false }
}
