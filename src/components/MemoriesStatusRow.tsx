// Spec §5.2 — "el sync y el vault se corren a una fila de estado chiquita arriba, porque son
// cosas que se tocan una vez". Y §4.5: los conflictos y lo bloqueado van ACA, no escondidos
// en una carpeta.
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { MemoriesState } from '../hooks/useMemories'

interface Props {
  state: MemoriesState
}

function ago(at: number | null): string {
  if (!at) return 'never'
  const mins = Math.round((Date.now() - at) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  return `${Math.round(mins / 60)}h ago`
}

export default function MemoriesStatusRow({ state }: Props) {
  const { status, vault, blocked, blockedTotal, silentSessions } = state

  return (
    <div className={cn('memories-status-row', 'border-b border-border text-fs-sm')}>
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

      <div className="memories-status-cell">
        <span className="font-mono tabular-nums">{vault.noteCount}</span>
        <span className="microlabel text-muted-foreground">notes</span>
        {/* Riesgo #2 de §11: el vault puede estar horas atras de la base y hoy nadie lo dice. */}
        {vault.enabled && (
          <span className="microlabel text-muted-foreground">vault {ago(vault.lastGeneratedAt)}</span>
        )}
      </div>

      {vault.conflictCount > 0 && (
        <Badge variant="outline" className="gap-1.5 text-warn">
          <span className="font-mono tabular-nums">{vault.conflictCount}</span>
          conflict{vault.conflictCount === 1 ? '' : 's'} kept in _conflicts/
        </Badge>
      )}

      {/* Spec §7.1 — "if sync is blocked, fail loudly and visibly. No silent drops."
          El total ya lo dice el semaforo de la izquierda, asi que aca va SOLO el desglose:
          repetir "816 blocked" al lado de "816 blocked" no agrega nada y se lee mal. */}
      {blockedTotal > 0 && (
        <div className="memories-status-cell">
          {blocked.map((g) => (
            <Badge key={g.reason} variant="outline" className="gap-1.5 text-warn">
              <span className="font-mono tabular-nums">{g.count}</span>
              {g.reason} · {g.reversible ? 'waiting, will retry' : 'terminal'}
            </Badge>
          ))}
        </div>
      )}

      {/* Spec §2.2 — el unico fallo hoy invisible. Se nombra el pane y la CLI: un contador
          suelto no le dice al usuario cual de sus terminales cerrar y volver a abrir. */}
      {silentSessions.length > 0 && (
        <Badge variant="outline" className="flex-wrap gap-1.5 text-destructive">
          <span className="font-mono tabular-nums">{silentSessions.length}</span>
          terminal{silentSessions.length === 1 ? '' : 's'} not writing to memory
          {silentSessions.map((s) => (
            <span key={s.paneId} className="microlabel opacity-70">{s.aiType} · {s.paneId}</span>
          ))}
        </Badge>
      )}
    </div>
  )
}
