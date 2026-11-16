// El copy y las reglas de la fila «Projects in the cloud» de Settings › Sync. Puro: lo usa
// CloudProjectsRow, que recibe todo por props.

/** Desde este tope el plan se lee como "sin tope": el de Cloud (server/src/limits.ts). */
const TOPE_SIN_LIMITE = 100

export interface ProyectoEnLaNube {
  projectKey: string
  name: string
}

/** Un `max_projects` chico y conocido: un plan con tope (hoy sólo Free = 1). */
export function tieneTope(max: number | null): max is number {
  return max !== null && Number.isFinite(max) && max < TOPE_SIN_LIMITE
}

export function descripcionDeProyectosEnLaNube(enLaNube: readonly ProyectoEnLaNube[], max: number | null): string {
  const n = enLaNube.length
  if (!tieneTope(max)) return `${n} ${n === 1 ? 'project' : 'projects'}`
  const nombres = enLaNube.map((p) => p.name).join(', ')
  // Sin nada arriba todavía no queda un " · " colgando.
  return nombres ? `${n} of ${max} · ${nombres}` : `${n} of ${max}`
}

/** Los repos que quedaron afuera, sin los que el roster ya tiene. */
export function soloLocales(fuera: readonly ProyectoEnLaNube[], enLaNube: readonly ProyectoEnLaNube[]): string[] {
  const enNube = new Set(enLaNube.map((p) => p.projectKey))
  return fuera.filter((p) => !enNube.has(p.projectKey)).map((p) => p.name)
}

export function lineaSoloLocales(nombres: readonly string[]): string {
  return `Local only: ${nombres.join(', ')} — Cloud syncs all your projects.`
}

/** La descripción de la fila cuando hay más proyectos en la nube que el tope. */
export function descripcionSobreElTope(max: number, n: number): string {
  return `Your plan syncs ${max} of ${n} projects.`
}

/**
 * El valor del select `Keep syncing`: el elegido si sigue en el roster; si no, el primero, que
 * es el más viejo porque `status` ordena el roster por antigüedad.
 */
export function proyectoQueSigue(enLaNube: readonly ProyectoEnLaNube[], kept: string | null): string | null {
  if (kept !== null && enLaNube.some((p) => p.projectKey === kept)) return kept
  return enLaNube[0]?.projectKey ?? null
}
