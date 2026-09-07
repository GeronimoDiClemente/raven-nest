interface Props {
  count: number
  projects: string[]
  onAdopt: () => void
  onDecline: () => void
}

/**
 * Task 2 (adopción con aviso, docs/superpowers/plans/2026-09-03-memoria-por-cuenta-multi-dispositivo.md):
 * se muestra al primer login de una cuenta cuando `_local` tiene memorias sin dueño — antes
 * de que Task 1's swapMemoryStore() las adopte en silencio. "Not mine" no borra nada: los
 * datos quedan intactos en `_local`, invisibles para esta cuenta, y siguen ahí para que
 * cualquier cuenta que entre después pueda reclamarlos (ver swapMemoryStore's `adopt` param).
 * Reusa la cáscara visual de MemoryHub (Task 7) para que se sienta parte del mismo sistema.
 */
export default function MemoryAdoptionDialog({ count, projects, onAdopt, onDecline }: Props) {
  const memories = count === 1 ? 'memory' : 'memories'

  return (
    <div className="modal-backdrop">
      <div className="memory-hub">
        <div className="memory-hub-body">
          <h2>We found {count} {memories} captured before you signed in</h2>
          {projects.length > 0 && <p>From {projects.join(', ')}. Are these yours?</p>}
          <p>If not, they'll stay right where they are — nothing gets deleted, and whoever they belong to can still claim them later.</p>
        </div>

        <div className="memory-hub-footer">
          <button className="memory-hub-skip" onClick={onDecline}>Not mine</button>
          <button className="memory-hub-next" onClick={onAdopt}>Yes, these are mine</button>
        </div>
      </div>
    </div>
  )
}
