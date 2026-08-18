import type { AIType, PaneNode } from '../types'

// El broadcast escribe al PTY de cada target: solo tiene sentido en panes
// corriendo un agente de IA. Editor y browser no tienen PTY, y una terminal
// plana es la shell del usuario, no un agente — mandarle el mismo prompt que
// a los agentes la ejecutaría como comando.
const AGENT_AI_TYPES: ReadonlySet<AIType> = new Set(['claude', 'gemini', 'codex', 'copilot', 'opencode', 'custom'])

export function isAgentPane(aiType: AIType): boolean {
  return AGENT_AI_TYPES.has(aiType)
}

// Targets de una escritura en broadcast originada en `sourceId`: la propia
// pane primero (el usuario está tipeando AHÍ, agente o no) y después cada
// pane de agente, sin duplicar el origen.
export function broadcastTargets(panes: readonly PaneNode[], sourceId: string): string[] {
  const agents = panes.filter((p) => p.id !== sourceId && isAgentPane(p.aiType)).map((p) => p.id)
  return [sourceId, ...agents]
}
