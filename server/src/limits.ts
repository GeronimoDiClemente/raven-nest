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

/**
 * Aplica el override de `MAX_BYTES_PER_USER` sobre el techo de un plan.
 *
 * Un valor no numérico, vacío o ≤ 0 cae AL LÍMITE DEL PLAN — no a una constante propia. Antes
 * caía a 1 GiB fijo, y eso tenía dos consecuencias: `MAX_BYTES_PER_USER=abc` le reportaba
 * 1 GiB a TODO plan, Free (100 MiB) incluido, o sea que un typo en el env AFLOJABA el techo
 * en vez de ignorarse; y el README ya documentaba "se ignora y cae al plan", que es lo que
 * ahora hace de verdad. `Number('')` y `Number('   ')` son 0, así que un valor vacío entra
 * por la misma puerta que uno inválido.
 */
export function resolveMaxBytes(raw: string | undefined, planMaxBytes: number): number {
  if (raw === undefined) return planMaxBytes
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : planMaxBytes
}

/**
 * El techo de bytes que EFECTIVAMENTE rige para un plan, override incluido.
 *
 * Override de INSTANCIA DEDICADA (§10 de la spec de pricing): cuando un deploy sirve a un
 * solo cliente, el techo por usuario de la tabla de planes no significa nada y el disco de la
 * máquina es el límite real. Sin setear — el caso del servicio compartido — manda el plan.
 *
 * Los DOS caminos que dependen de este número tienen que pasar por acá y por ningún otro
 * lado: lo que `GET /v1/sync/status` informa en `quota.max_bytes`, y el rechazo
 * `quota_exceeded` de `push.ts`. Antes `status` leía el override y `push` comparaba contra
 * `limitsFor(plan).maxBytes` directo, así que una instancia dedicada que subiera la variable
 * mostraba una cuota grande y seguía frenando al tope del plan — un límite que se muestra
 * pero no se aplica, o al revés, es peor que no tenerlo.
 *
 * Lee `process.env` en cada llamada en vez de una sola vez al cargar el módulo: el costo es
 * un acceso a un objeto por request y a cambio el override es testeable sin remockear el
 * módulo entero.
 */
export function maxBytesFor(plan: string): number {
  return resolveMaxBytes(process.env.MAX_BYTES_PER_USER, limitsFor(plan).maxBytes)
}
