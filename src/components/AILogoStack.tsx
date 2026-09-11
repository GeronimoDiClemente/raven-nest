import type { AIType } from '../types'
import { AILogo } from './AILogos'
import { sliceAILogos } from '../lib/repo-ai-logos'

interface Props {
  /** El conjunto de aiType que groupAITypesByRepoPath encontro para este path. */
  aiTypes: readonly AIType[]
  size?: number
}

/**
 * workspace-shell-design §3: los logos de las IAs con un pane abierto en
 * esta fila de repo/worktree. Maximo MAX_VISIBLE_AI_LOGOS, el resto se
 * pliega en un "+N".
 *
 * Devuelve null si `aiTypes` esta vacio — el caller solo pasa los tipos de
 * una fila cuando groupAITypesByRepoPath encontro panes ahi; un path sin
 * panes no se rellena con un slot vacio ni un icono gris (§3, "manejo de
 * errores").
 *
 * `AILogo` ya devuelve null para un aiType sin logo conocido (terminal,
 * custom, editor) — sin fallback generico, a proposito. Eso puede dejar un
 * slot silenciosamente vacio dentro del maximo de 3; es la misma decision
 * tomada a nivel de agente individual, no un bug de este componente.
 *
 * El color de marca de cada logo se respeta — excepcion explicita a la
 * constraint acromatica, la misma que ya aplica el picker de New Pane.
 */
export function AILogoStack({ aiTypes, size = 13 }: Props) {
  if (aiTypes.length === 0) return null
  const { visible, overflow } = sliceAILogos(aiTypes)
  return (
    <span className="inline-flex items-center gap-1 shrink-0" aria-hidden="true">
      {visible.map((t) => (
        <AILogo key={t} aiType={t} size={size} />
      ))}
      {overflow > 0 && (
        <span className="font-mono text-fs-2xs tabular-nums text-muted-foreground">+{overflow}</span>
      )}
    </span>
  )
}
