/**
 * La única fuente de verdad de qué puede hacer cada plan.
 *
 * Vive del lado del servidor por la misma razón que el gate de nube (§9.3 de la spec del
 * backend): un límite verificado sólo en el renderer no es un límite, es una sugerencia.
 */
export interface PlanLimits {
  /** Proyectos que pueden existir en la nube para este usuario. */
  maxProjects: number
  /** Suma de bytes de contenido del usuario, en todos sus proyectos. */
  maxBytes: number
  /** Devices activos que pueden sincronizar. */
  maxDevices: number
  /** §11.4: el ritmo de polleo lo manda el servidor. Es la única palanca de costo real. */
  nextPollMs: number
  /** Si puede escribir observaciones con `scope: 'team'`, visibles para otras personas. */
  teamScope: boolean
}

const FREE: PlanLimits = {
  maxProjects: 1,
  maxBytes: 100 * 1024 * 1024,
  maxDevices: 3,
  nextPollMs: 900_000,
  teamScope: false,
}

const CLOUD: PlanLimits = {
  maxProjects: 100,
  maxBytes: 1024 ** 3,
  maxDevices: 10,
  nextPollMs: 300_000,
  teamScope: false,
}

// 5 GiB es el número por asiento de la spec, pero el servicio todavía no modela asientos:
// hasta que los modele, es el techo de la cuenta entera.
const TEAM: PlanLimits = {
  ...CLOUD,
  maxBytes: 5 * 1024 ** 3,
  teamScope: true,
}

const BY_PLAN: Record<string, PlanLimits> = {
  free: FREE,
  cloud: CLOUD,
  // El rename pro -> cloud es del corte comercial. Mientras tanto conviven.
  pro: CLOUD,
  team: TEAM,
  enterprise: TEAM,
}

/** Un plan desconocido cae a Free a propósito: fallar cerrado, nunca regalar la nube. */
export function limitsFor(plan: string): PlanLimits {
  return BY_PLAN[plan] ?? FREE
}
