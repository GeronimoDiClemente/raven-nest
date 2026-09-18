/**
 * Los dos conjuntos que `App` mantiene sobre los panes: cuáles están trabajando, y cuáles
 * sacaron texto hace poco.
 *
 * Están acá y no adentro de `App` por una razón de rendimiento, no de orden. React decide si
 * re-renderiza comparando **la identidad** del estado nuevo contra el viejo. Un `new Set(prev)`
 * que termina con exactamente los mismos elementos es un objeto distinto, así que React
 * re-renderiza igual — y `App` son 2300 líneas con la grilla de panes colgando, ninguno
 * memoizado.
 *
 * Importa porque el que llama no llama una vez: `TerminalPane` avisa que está ocupado en CADA
 * chunk que le llega del PTY, o sea ~20 veces por segundo por pane con un agente escribiendo.
 * De esos 20, **uno** es un cambio real (el paso de quieto a ocupado); los otros 19 repetían
 * el mismo conjunto con identidad nueva y re-renderizaban la app entera para nada.
 *
 * La regla, entonces: **si el conjunto no cambia, se devuelve el MISMO objeto.** El mismo
 * criterio que ya tenía el auto-clear de actividad de `App` — que llegó a esta conclusión
 * antes, para su propio timer, y es de donde salió la idea.
 */

/** El pane arrancó o dejó de sacar texto. Devuelve `prev` si eso ya se sabía. */
export function conPaneOcupado(
  prev: ReadonlySet<string>,
  paneId: string,
  ocupado: boolean,
): Set<string> {
  if (prev.has(paneId) === ocupado) return prev as Set<string>
  const next = new Set(prev)
  if (ocupado) next.add(paneId)
  else next.delete(paneId)
  return next
}

/**
 * Marca (o desmarca) actividad reciente de un pane dentro de su pestaña.
 *
 * El mapa es por pestaña porque el indicador vive en la solapa: lo que importa no es que el
 * pane haya hablado, sino en qué pestaña —posiblemente una que no estás mirando— pasó.
 */
export function conActividadDePane(
  prev: ReadonlyMap<string, Set<string>>,
  tabId: string,
  paneId: string,
  activo: boolean,
): Map<string, Set<string>> {
  const actuales = prev.get(tabId)
  if ((actuales?.has(paneId) ?? false) === activo) return prev as Map<string, Set<string>>
  const enLaPestaña = new Set(actuales ?? [])
  if (activo) enLaPestaña.add(paneId)
  else enLaPestaña.delete(paneId)
  const next = new Map(prev)
  next.set(tabId, enLaPestaña)
  return next
}
