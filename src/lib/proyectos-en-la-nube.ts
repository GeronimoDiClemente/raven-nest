// Spec 2b-1 §4.4/§4.7: el copy y las reglas de la fila «Projects in the cloud» de Settings ›
// Sync. Puro: lo usa CloudProjectsRow, que recibe todo por props.

/** Desde este tope el plan se lee como "sin tope": el de Cloud (server/src/limits.ts). */
export const TOPE_SIN_LIMITE = 100

export interface ProyectoEnLaNube {
  projectKey: string
  name: string
}

/** Un `max_projects` chico y conocido: un plan con tope (hoy sólo Free = 1). D3. */
export function tieneTope(max: number | null): max is number {
  return max !== null && Number.isFinite(max) && max < TOPE_SIN_LIMITE
}

export function descripcionDeProyectosEnLaNube(enLaNube: readonly ProyectoEnLaNube[], max: number | null): string {
  const n = enLaNube.length
  if (!tieneTope(max)) return `${n} ${n === 1 ? 'project' : 'projects'}`
  const nombres = enLaNube.map((p) => p.name).join(', ')
  // D5: sin nada arriba todavía no queda un " · " colgando.
  return nombres ? `${n} of ${max} · ${nombres}` : `${n} of ${max}`
}

/** Los repos que quedaron afuera, sin los que el roster ya tiene (D4). */
export function soloLocales(fuera: readonly ProyectoEnLaNube[], enLaNube: readonly ProyectoEnLaNube[]): string[] {
  const enNube = new Set(enLaNube.map((p) => p.projectKey))
  return fuera.filter((p) => !enNube.has(p.projectKey)).map((p) => p.name)
}

export function lineaSoloLocales(nombres: readonly string[]): string {
  return `Local only: ${nombres.join(', ')} — Cloud syncs all your projects.`
}
