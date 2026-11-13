/**
 * Spec 2b-2 §4.7: con más proyectos propios que el tope del plan (alguien que bajó de Cloud a
 * Free), cuáles siguen aceptando mutaciones. El resto recibe `project_limit_reached`, el mismo
 * rechazo reversible de 2b-1: nada se borra y pull no cambia.
 *
 * "Más viejo" es el menor `projects.id` (D1 del plan: `projects` no tiene `created_at`, y
 * `id` es un bigserial asignado al dar de alta, bajo el lock `project-limit:<user>`).
 *
 * `propios` va SIN `__global__`: no ocupa lugar (ver GLOBAL_PROJECT_KEY en push.ts).
 */
export function proyectosPermitidos(
  propios: ReadonlyArray<{ projectKey: string; id: number }>,
  keptProjectKey: string | null,
  maxProjects: number
): Set<string> {
  const porAntiguedad = [...propios].sort((x, y) => x.id - y.id).map((x) => x.projectKey)
  if (porAntiguedad.length <= maxProjects) return new Set(porAntiguedad)
  const elegido = keptProjectKey !== null && porAntiguedad.includes(keptProjectKey) ? keptProjectKey : null
  if (elegido === null) return new Set(porAntiguedad.slice(0, maxProjects))
  const resto = porAntiguedad.filter((k) => k !== elegido).slice(0, Math.max(0, maxProjects - 1))
  return new Set([elegido, ...resto])
}
