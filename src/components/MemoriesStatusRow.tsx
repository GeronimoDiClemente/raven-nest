// Spec §5.2 — "el sync y el vault se corren a una fila de estado chiquita arriba, porque son
// cosas que se tocan una vez". Y §4.5: los conflictos y lo bloqueado van ACA, no escondidos
// en una carpeta.
//
// 2026-10-19 (Task 6): el icono de ajustes del vault y su popover se van — `MemoryVaultCard`
// ya vive en la seccion "Notes on disk" de Memory settings (spec §7), asi que esta fila
// queda SOLO de estado: nada que configurar, nada detras de un icono.
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { MemoriesState } from '../hooks/useMemories'
import { MOTIVO_TOPE_DE_PLAN, paneDisplayLabel, relativeTime, textoDeTopeDePlan } from '../lib/memories-status'
import PlanesModal from './PlanesModal'

interface Props {
  state: MemoriesState
}

export default function MemoriesStatusRow({ state }: Props) {
  const { status, vault, blocked, maxProjects, silentSessions } = state
  const [planes, setPlanes] = useState(false)

  return (
    <div
      className={cn('memories-status-row', 'border-b border-border text-fs-sm')}
      data-tour-id="memories-status"
    >
      <Badge
        variant="outline"
        className={cn(
          'gap-1.5',
          status.dot === 'green' && 'text-ok',
          status.dot === 'amber' && 'text-warn',
          status.dot === 'red' && 'text-destructive',
        )}
      >
        <span className="memories-dot" data-dot={status.dot} data-testid="memories-dot" />
        {status.text}
      </Badge>

      {/* El contador es de los .md que genera el VAULT, no de memorias — y sólo se muestra
          cuando el vault está prendido. Con el vault apagado siempre decía "0 notes", que
          justo al lado de una lista con ocho memorias se lee como "no tenés nada guardado":
          un número correcto que afirma lo contrario de lo que la pantalla muestra debajo. */}
      {vault.enabled && (
        <div className="memories-status-cell">
          <span className="font-mono tabular-nums">{vault.noteCount}</span>
          <span className="microlabel text-muted-foreground">notes</span>
          {/* Riesgo #2 de §11: el vault puede estar horas atras de la base y hoy nadie lo dice. */}
          <span className="microlabel text-muted-foreground">vault {relativeTime(vault.lastGeneratedAt)}</span>
        </div>
      )}

      {vault.conflictCount > 0 && (
        <Badge variant="outline" className="gap-1.5 text-warn">
          <span className="font-mono tabular-nums">{vault.conflictCount}</span>
          conflict{vault.conflictCount === 1 ? '' : 's'} kept in _conflicts/
        </Badge>
      )}

      {/* Spec §7.1 — "if sync is blocked, fail loudly and visibly. No silent drops."
          El total ya lo dice el semaforo de la izquierda, asi que aca va SOLO el desglose.
          Spec 2b-1 §4.5: lo retenido por el tope del plan NO es una falla — va en gris, dicho
          en palabras y con el camino a Cloud; los demas motivos, como siempre. */}
      {blocked.length > 0 && (
        <div className="memories-status-cell">
          {blocked.map((g) => g.reason === MOTIVO_TOPE_DE_PLAN ? (
            <span key={g.reason} className="flex items-center gap-1.5">
              <Badge variant="outline" className="gap-1.5 text-muted-foreground">
                {textoDeTopeDePlan(g.count, maxProjects)}
              </Badge>
              <Button size="xs" variant="outline" onClick={() => setPlanes(true)}>Upgrade</Button>
            </span>
          ) : (
            <Badge key={g.reason} variant="outline" className="gap-1.5 text-warn">
              <span className="font-mono tabular-nums">{g.count}</span>
              {g.reason} · {g.reversible ? 'waiting, will retry' : 'terminal'}
            </Badge>
          ))}
        </div>
      )}

      {/* Spec §2.2 — el unico fallo hoy invisible. Se nombra el pane y la CLI: un contador
          suelto no le dice al usuario cual de sus terminales cerrar y volver a abrir.
          Review C1/I3: la lista de panes NO va adentro del Badge — el Badge stock es
          `h-5 overflow-hidden`, asi que un `flex-wrap` ahi adentro recorta en vez de
          envolver (medido: 12 sesiones mudas perdian pane-10..12 sin ningun aviso, el
          fallo exacto que este bloque existe para evitar). El Badge queda para el
          resumen (una linea, nunca envuelve); los pane-ids van en un contenedor
          hermano sin alto fijo, como en el div.memories-status-cell original.
          Spec 2026-09-11 §2 — se muestra `paneDisplayLabel(s.paneId)` (el numero de
          pane), no el paneId crudo: ese trae un timestamp en ms que no dice cual
          terminal cerrar. */}
      {silentSessions.length > 0 && (
        <div className="memories-status-cell flex-wrap">
          <Badge variant="outline" className="gap-1.5 text-destructive">
            <span className="font-mono tabular-nums">{silentSessions.length}</span>
            terminal{silentSessions.length === 1 ? '' : 's'} not writing to memory
          </Badge>
          {silentSessions.map((s) => (
            <span key={s.paneId} className="microlabel text-destructive opacity-70">{s.aiType} · {paneDisplayLabel(s.paneId)}</span>
          ))}
        </div>
      )}

      {planes && <PlanesModal onClose={() => setPlanes(false)} />}
    </div>
  )
}
