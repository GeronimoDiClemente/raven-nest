// Escribir una memoria a mano.
//
// Hasta ahora Memories era de SÓLO LECTURA: únicamente los agentes escribían, y algo que vos
// querías dejar asentado no tenía puerta. Eso convertía la pantalla en un visor de lo que
// hacen otros en vez de en un lugar donde trabajás.
//
// El formulario es corto a propósito. Lo único obligatorio es el título, porque una memoria
// sin título no se puede encontrar después; todo lo demás son las dos cosas que de verdad la
// conectan con las otras —el tipo y los tags— y el cuerpo.
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MEMORY_TYPES_IN_LEGEND_ORDER, memoryTypeSwatch } from '../lib/memory-type-legend'

interface Props {
  /** El worktree abierto, si hay. Sin él la memoria va al proyecto global — que es lo que
   *  significa: algo que vale más allá de un repo. */
  activeRepoPath: string | null
  onClose: () => void
  /** Se llama cuando el guardado salió bien, para que la lista y el grafo se refresquen. */
  onSaved: () => void
}

export default function NewMemoryForm({ activeRepoPath, onClose, onSaved }: Props) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [type, setType] = useState<string>('decision')
  const [tagsRaw, setTagsRaw] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const puedeGuardar = title.trim().length > 0 && !guardando

  async function guardar() {
    if (!puedeGuardar) return
    const api = window.memory?.saveFromUi
    if (!api) {
      setError('This build cannot save memories yet.')
      return
    }
    setGuardando(true)
    setError(null)
    try {
      const res = await api({
        title: title.trim(),
        content: content.trim(),
        type,
        // Separadas por coma o espacio, y sin el `#` si alguien lo escribe — es cómo la gente
        // los tipea, no cómo se guardan.
        tags: tagsRaw
          .split(/[,\s]+/)
          .map((t) => t.replace(/^#/, '').trim())
          .filter(Boolean),
        worktreePath: activeRepoPath,
      })
      if (!res.ok) {
        setError(res.error === 'memory_unavailable'
          ? 'Memory is disabled in this session.'
          : res.error ?? 'Could not save')
        return
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="flex shrink-0 flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex items-baseline gap-2">
        <p className="text-fs font-medium text-foreground">New memory</p>
        <p className="min-w-0 flex-1 truncate text-fs-sm text-muted-foreground">
          {activeRepoPath
            ? 'Saved to the repo open in this tab, with its branch.'
            : 'No repo open, so this is saved as something that holds everywhere.'}
        </p>
      </div>

      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What should be remembered?"
        aria-label="Memory title"
        autoFocus
        onKeyDown={(e) => {
          // ⌘/Ctrl+Enter guarda desde cualquier campo: escribir una memoria es un gesto
          // corto y mandar a buscar el botón con el mouse lo corta.
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void guardar()
        }}
      />

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="The detail — what you tried, why it is this way, what bit you."
        aria-label="Memory content"
        rows={3}
        className="w-full resize-y rounded-md border border-input bg-transparent px-2.5 py-2 font-mono text-fs-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void guardar()
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        {/* El tipo, con su color — el mismo punto que se ve en la lista y en el grafo, así
            que elegirlo acá muestra de entrada cómo va a quedar pintado. */}
        <div className="flex flex-wrap gap-1">
          {MEMORY_TYPES_IN_LEGEND_ORDER.map((t) => {
            const swatch = memoryTypeSwatch(t)!
            return (
              <Button
                key={t}
                variant={type === t ? 'secondary' : 'outline'}
                size="sm"
                aria-pressed={type === t}
                onClick={() => setType(t)}
              >
                <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: swatch.color }} />
                {swatch.label}
              </Button>
            )
          })}
        </div>
      </div>

      <Input
        value={tagsRaw}
        onChange={(e) => setTagsRaw(e.target.value)}
        placeholder="Tags — auth, api (a tag reaches across repos)"
        aria-label="Memory tags"
        className="font-mono"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void guardar()
        }}
      />

      {error && <p className="text-fs-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-2">
        <Button onClick={() => void guardar()} disabled={!puedeGuardar}>
          {guardando ? 'Saving…' : 'Save memory'}
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={guardando}>Cancel</Button>
        <span className="ml-auto font-mono text-fs-xs text-muted-foreground">⌘↵</span>
      </div>
    </div>
  )
}
