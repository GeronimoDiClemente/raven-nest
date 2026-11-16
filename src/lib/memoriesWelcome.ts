// Cuándo mostrar el diálogo de bienvenida de Memories.
//
// Función pura para poder testear el predicado sin montar el árbol entero: la
// condición crítica es que NUNCA se dispare sola bajo `e2eBypass` — si lo hiciera,
// taparía cualquier e2e que abra Memories (mismo freno que `showMemoryHub`: ver el
// check de `window.appFlags?.e2eBypass` junto a esa bandera en App.tsx). `forced`
// es la única vía para saltarse ese freno: es el botón «How it works» del header,
// un pedido explícito del usuario, no el disparo automático de la primera vez.
export function shouldShowMemoriesWelcome(opts: {
  memoriesOpen: boolean
  /** Memories se abrió desde Account → "Memory settings": no se tapa Settings con la
   *  bienvenida de la primera vez. */
  abiertaEnSettings: boolean
  forced: boolean
  hasSeenMemoriesWelcome: boolean
  e2eBypass: boolean
}): boolean {
  const { memoriesOpen, abiertaEnSettings, forced, hasSeenMemoriesWelcome, e2eBypass } = opts
  if (!memoriesOpen) return false
  // "How it works" vive siempre en el header: un pedido explícito se muestra siempre.
  if (forced) return true
  return !abiertaEnSettings && !hasSeenMemoriesWelcome && !e2eBypass
}
