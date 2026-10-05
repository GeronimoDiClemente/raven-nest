// La beta cerrada de Memories (2026-10-05): el equipo y unos testers la usan de verdad antes
// de que salga para todos, y en la beta la nube no se cobra.
//
// Por eso, en un build `-beta.N` el PLAN no decide si se ofrece la nube: la mayoría de los
// testers tienen plan Free, y con el gate de plan verían «Upgrade» en lugar de «Connect»
// aunque estén habilitados. Quién entra lo decide el SERVIDOR, con su allowlist — una cuenta
// que no está recibe `not_in_beta`, y eso se le explica en vez de mostrarle el código crudo.
//
// En un build estable no cambia nada: el plan sigue mandando.

/** `1.6.0-beta.3` sí; `1.6.0`, `1.6.0-rc.1` o una versión vacía, no. */
export function esVersionBeta(version: string | undefined | null): boolean {
  return /^\d+\.\d+\.\d+-beta\.\d+$/.test(version ?? '')
}

/** La versión que se horneó en el build (`electron.vite.config.ts`). En los tests no hay. */
export const ES_BUILD_BETA = esVersionBeta(import.meta.env.VITE_NEST_VERSION)

/** Si se ofrece conectar la nube de memoria. */
export function nubeDeMemoriaDisponible(planIncluyeNube: boolean, esBeta: boolean = ES_BUILD_BETA): boolean {
  return planIncluyeNube || esBeta
}

/**
 * El error de sync tal como se le muestra a una persona. Sólo traduce lo que tiene una
 * explicación propia; el resto pasa tal cual, porque un "something went wrong" deja al
 * usuario sin nada que buscar ni que reportar.
 */
export function textoDeErrorDeMemoria(error: string): string {
  if (error === 'not_in_beta') {
    return "cloud memory is in a closed beta and this account isn't in it yet. Your memory keeps working on this machine."
  }
  return error
}
