import type { AIType } from '../types'

// workspace-shell-design §3: "los logos de las IAs entran en las filas" de
// repos y worktrees. No hace falta ningun dato nuevo — SessionPane/PaneNode
// ya tienen aiType y repoPath; agrupar los panes abiertos por repoPath da,
// para cada repo o worktree, el conjunto de IAs corriendo ahi. Puro y
// testeable aparte del componente, por pedido explicito de la spec.

export const MAX_VISIBLE_AI_LOGOS = 3

/**
 * Forma minima que hace falta para agrupar — la cumplen tanto el PaneNode
 * en memoria (App.tsx) como el SessionPane persistido (types.ts), asi que
 * esta funcion no ata el caller a uno de los dos.
 */
export interface PaneAIRef {
  aiType: AIType
  repoPath?: string
}

/**
 * Agrupa los panes abiertos por repoPath, deduplicando aiType dentro de
 * cada path. Un pane sin repoPath no se puede atribuir a ninguna fila y se
 * salta. Sin `filter` de "tiene logo o no" a proposito: el mapeo aiType →
 * logo es una decision de render (AILogo devuelve null para un tipo
 * desconocido, sin fallback), no del agrupamiento.
 *
 * Orden: primera aparicion entre los panes recibidos (no alfabetico), asi
 * refleja "que IA se abrio primero aca".
 */
export function groupAITypesByRepoPath(panes: readonly PaneAIRef[]): Map<string, AIType[]> {
  const byPath = new Map<string, AIType[]>()
  for (const pane of panes) {
    if (!pane.repoPath) continue
    const existing = byPath.get(pane.repoPath)
    if (existing) {
      if (!existing.includes(pane.aiType)) existing.push(pane.aiType)
    } else {
      byPath.set(pane.repoPath, [pane.aiType])
    }
  }
  return byPath
}

export interface AILogoSlice {
  visible: AIType[]
  overflow: number
}

/**
 * Recorta una lista de aiType a los MAX_VISIBLE_AI_LOGOS primeros, con el
 * resto plegado en un contador `overflow` (el "+N" de la fila).
 */
export function sliceAILogos(aiTypes: readonly AIType[]): AILogoSlice {
  return {
    visible: aiTypes.slice(0, MAX_VISIBLE_AI_LOGOS),
    overflow: Math.max(0, aiTypes.length - MAX_VISIBLE_AI_LOGOS),
  }
}
