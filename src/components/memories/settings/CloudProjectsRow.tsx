// Spec 2b-1 §4.4: la fila «Projects in the cloud» de Settings › Sync. Presentación pura: el
// roster, el tope y lo que quedó afuera entran por props (no le habla al bridge de memoria).
import SettingRow from './SettingRow'
import { Button } from '@/components/ui/button'
import {
  descripcionDeProyectosEnLaNube, lineaSoloLocales, soloLocales, tieneTope, type ProyectoEnLaNube,
} from '@/lib/proyectos-en-la-nube'

export interface CloudProjectsRowProps {
  /** El roster de la nube, sin `__global__`, con nombres locales. */
  enLaNube: readonly ProyectoEnLaNube[]
  /** `limits.max_projects` del servidor; null = todavía no lo informó. */
  maxProyectos: number | null
  /** Los repos retenidos por el tope (`memory:doctor`). */
  fuera: readonly ProyectoEnLaNube[]
  onUpgrade: () => void
}

export default function CloudProjectsRow({ enLaNube, maxProyectos, fuera, onUpgrade }: CloudProjectsRowProps) {
  // D4: sólo con tope. A un Cloud con retenidas viejas (antes de que el daemon destrabe por el
  // cambio de plan) no se le ofrece pasar a Cloud.
  const afuera = tieneTope(maxProyectos) ? soloLocales(fuera, enLaNube) : []
  return (
    <SettingRow
      nombre="Projects in the cloud"
      descripcion={descripcionDeProyectosEnLaNube(enLaNube, maxProyectos)}
      control={afuera.length > 0 && <Button size="sm" onClick={onUpgrade}>Upgrade</Button>}
    >
      {afuera.length > 0 && <p className="m-0 text-fs-sm text-muted-foreground">{lineaSoloLocales(afuera)}</p>}
    </SettingRow>
  )
}
