// Una fila de Memory settings (spec §4): a la izquierda qué es y para qué sirve, a la derecha
// el control, y abajo, a todo el ancho, el detalle (estado, barra, listas). Presentación pura.
import { Children, type ReactNode } from 'react'

export interface SettingRowProps {
  /** Va en el nombre, para que el control lo use de `aria-labelledby`. */
  id?: string
  nombre: ReactNode
  descripcion?: ReactNode
  control?: ReactNode
  children?: ReactNode
}

export default function SettingRow({ id, nombre, descripcion, control, children }: SettingRowProps) {
  // `toArray` descarta null/false: una fila sin detalle no deja un hueco con gap.
  const detalle = Children.toArray(children)
  return (
    <div data-slot="setting-row" className="flex flex-col gap-2 border-b border-border py-3 last:border-b-0">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p id={id} className="m-0 text-fs font-medium text-foreground">{nombre}</p>
          {descripcion && <p className="m-0 mt-0.5 text-fs-sm text-muted-foreground">{descripcion}</p>}
        </div>
        {control && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{control}</div>}
      </div>
      {detalle.length > 0 && <div className="flex min-w-0 flex-col gap-2">{detalle}</div>}
    </div>
  )
}
