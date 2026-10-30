// Spec 2b-1 §4.4: la fila «Projects in the cloud» de Settings › Sync. Presentación pura: el
// roster, el tope y lo que quedó afuera entran por props (no le habla al bridge de memoria).
// Spec 2b-2 §4.8: por encima del tope (bajó de plan), `Keep syncing` elige qué proyecto sigue.
import { useState } from 'react'
import SettingRow from './SettingRow'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  descripcionDeProyectosEnLaNube, descripcionSobreElTope, lineaSoloLocales, proyectoQueSigue, soloLocales, tieneTope,
  type ProyectoEnLaNube,
} from '@/lib/proyectos-en-la-nube'

/** Ruling P8 (plan 2b-2): el spec no da copy para cuando el daemon no pudo elegir. */
const COPY_NO_SE_PUDO_ELEGIR = "Couldn't change the synced project. Try again."

export interface CloudProjectsRowProps {
  /** El roster de la nube, sin `__global__`, con nombres locales, del más viejo al más nuevo. */
  enLaNube: readonly ProyectoEnLaNube[]
  /** `limits.max_projects` del servidor; null = todavía no lo informó. */
  maxProyectos: number | null
  /** Los repos retenidos por el tope (`memory:doctor`). */
  fuera: readonly ProyectoEnLaNube[]
  onUpgrade: () => void
  /** Spec 2b-2: hay más proyectos en la nube que los que el plan sincroniza. */
  overLimit?: boolean
  /** Spec 2b-2: el proyecto elegido; null = no eligió (sigue el más viejo). */
  keptProjectKey?: string | null
  /** Spec 2b-2: elegir el proyecto que sigue. Si devuelve `{ ok: false }`, la fila lo muestra. */
  onKeep?: (projectKey: string) => void | Promise<{ ok: boolean; error?: string }>
}

export default function CloudProjectsRow({
  enLaNube, maxProyectos, fuera, onUpgrade, overLimit = false, keptProjectKey = null, onKeep,
}: CloudProjectsRowProps) {
  // Lo recién elegido, mientras ningún status nuevo lo confirme o lo contradiga: el status que
  // vuelve con keepProject puede traer todavía el elegido VIEJO (un poll que estaba en vuelo).
  const [elegido, setElegido] = useState<string | null>(null)
  const [fallo, setFallo] = useState(false)
  const [eligiendo, setEligiendo] = useState(false)
  // Un `keptProjectKey` distinto es un status nuevo: manda él (estado derivado de las props).
  const [keptVisto, setKeptVisto] = useState(keptProjectKey)
  if (keptVisto !== keptProjectKey) {
    setKeptVisto(keptProjectKey)
    setElegido(null)
    setFallo(false)
  }

  // D4 (2b-1): sólo con tope. A un Cloud con retenidas viejas no se le ofrece pasar a Cloud.
  const afuera = tieneTope(maxProyectos) ? soloLocales(fuera, enLaNube) : []
  const sobreElTope = overLimit && tieneTope(maxProyectos) && enLaNube.length > 0
  const sigue = !sobreElTope ? null
    : elegido !== null && enLaNube.some((p) => p.projectKey === elegido) ? elegido
    : proyectoQueSigue(enLaNube, keptProjectKey)

  const elegir = async (projectKey: string) => {
    if (projectKey === sigue || !onKeep) return
    setElegido(projectKey)
    setFallo(false)
    setEligiendo(true)
    let r: void | { ok: boolean; error?: string }
    try {
      r = await onKeep(projectKey)
    } catch {
      r = { ok: false }
    }
    setEligiendo(false)
    // Ruling P8: si no se pudo, el select vuelve a lo guardado y la fila lo dice.
    if (r && !r.ok) {
      setElegido(null)
      setFallo(true)
    }
  }

  const upgrade = <Button size="sm" onClick={onUpgrade}>Upgrade</Button>
  const control = sobreElTope ? (
    <>
      <span className="text-fs-sm text-muted-foreground">Keep syncing</span>
      <Select value={sigue ?? undefined} disabled={eligiendo} onValueChange={(v) => { void elegir(v) }}>
        <SelectTrigger size="sm" aria-label="Keep syncing"><SelectValue /></SelectTrigger>
        <SelectContent>
          {enLaNube.map((p) => <SelectItem key={p.projectKey} value={p.projectKey}>{p.name}</SelectItem>)}
        </SelectContent>
      </Select>
      {upgrade}
    </>
  ) : afuera.length > 0 ? upgrade : null

  return (
    <SettingRow
      nombre="Projects in the cloud"
      descripcion={sobreElTope
        ? descripcionSobreElTope(maxProyectos as number, enLaNube.length)
        : descripcionDeProyectosEnLaNube(enLaNube, maxProyectos)}
      control={control}
    >
      {sobreElTope && fallo && <p className="m-0 text-fs-sm text-destructive">{COPY_NO_SE_PUDO_ELEGIR}</p>}
      {afuera.length > 0 && <p className="m-0 text-fs-sm text-muted-foreground">{lineaSoloLocales(afuera)}</p>}
    </SettingRow>
  )
}
