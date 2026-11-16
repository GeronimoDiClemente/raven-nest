// Lo que muestra el explorer mientras la pestaña Settings está activa (spec §3): las
// secciones, con el mismo ancho y la misma fila que las carpetas.
import { cn } from 'cn'

export interface SettingsSectionListProps<T extends string> {
  secciones: ReadonlyArray<{ id: T; titulo: string }>
  activa: T
  onElegir: (id: T) => void
}

export default function SettingsSectionList<T extends string>({ secciones, activa, onElegir }: SettingsSectionListProps<T>) {
  return (
    <nav aria-label="Settings sections" className="flex h-full min-h-0 flex-col gap-0.5 overflow-y-auto p-2">
      {secciones.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-current={s.id === activa ? 'page' : undefined}
          onClick={() => onElegir(s.id)}
          className={cn(
            // `border-0 bg-transparent`: sin preflight un <button> trae borde y fondo del navegador.
            'flex w-full cursor-pointer items-center rounded-md border-0 bg-transparent px-1.5 py-1 text-left text-fs-sm font-medium text-foreground hover:bg-accent/50',
            s.id === activa && 'bg-accent',
          )}
        >
          {s.titulo}
        </button>
      ))}
    </nav>
  )
}
