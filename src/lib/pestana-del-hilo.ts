// ¿Va la pestaña «Team thread» de Memories? Sale del MISMO estado que usa el toggle de
// Branch notes (el workspace lo levanta y se lo pasa a la pestaña Settings): prender o apagar
// el hilo se ve en el acto, sin releer al volver.
//
// `null` = todavía no se sabe (leyendo): al reabrir el overlay la pestaña viene de la caché de
// sesión, y tratar "leyendo" como "apagado" la sacaría antes de que llegue la respuesta.
// Sólo una LECTURA fallida cuenta como apagado: un rechazo al cambiarlo no saca la
// pestaña, porque el hilo sigue prendido.
import type { UseTeamThreadSettings } from '../hooks/useTeamThreadSettings'

export function pestanaDelHilo(
  activeRepoPath: string | null,
  hilo: Pick<UseTeamThreadSettings, 'ready' | 'enabled' | 'cargaFallida'>,
): boolean | null {
  if (!activeRepoPath) return false
  if (!hilo.ready) return null
  return hilo.enabled && !hilo.cargaFallida
}
