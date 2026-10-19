// src/lib/memoriesWelcome.ts
// Task 7 (2026-10-19): cuándo mostrar el diálogo de bienvenida de Memories.
//
// Extraída de App.tsx a una función pura para poder testear el predicado sin
// montar el árbol entero: la condición crítica es que NUNCA se dispare sola
// bajo `e2eBypass` — si lo hiciera, taparía cualquier e2e que abra Memories,
// que es exactamente lo mismo que ya le pasó a `showMemoryHub` (ver el check
// de `window.appFlags?.e2eBypass` junto a esa bandera en App.tsx). `forced`
// es la única vía para saltarse ese freno: es el botón "How Memories works",
// un pedido explícito del usuario, no el disparo automático de la primera vez.
export function shouldShowMemoriesWelcome(opts: {
  memoriesOpen: boolean
  vista: 'memorias' | 'settings'
  forced: boolean
  hasSeenMemoriesWelcome: boolean
  e2eBypass: boolean
}): boolean {
  const { memoriesOpen, vista, forced, hasSeenMemoriesWelcome, e2eBypass } = opts
  if (!memoriesOpen || vista !== 'memorias') return false
  return forced || (!hasSeenMemoriesWelcome && !e2eBypass)
}
