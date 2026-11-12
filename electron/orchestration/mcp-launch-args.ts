// Args de arranque que registran el shim MCP de orquestación en el CLI del agente. Es un
// registro APARTE del de Memories: no toca `.claude.json` de la cuenta ni el provisioner.
import { mkdirSync } from 'fs'
import { join } from 'path'
import { writeFileAtomic } from '../memory-provisioner' // utilidad pura (escritura atómica)

const toml = (v: string): string => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

export interface OrchestrationLaunchPaths {
  /** El binario de Electron de Nest (corre el shim con ELECTRON_RUN_AS_NODE=1). */
  execPath: string
  /** `dist-electron/orchestration-mcp.js`. */
  shimPath: string
  /** Dónde Nest guarda archivos generados; ahí cae el json que lee claude. */
  configDir: string
}

/**
 * Verificado a mano (spike, claude 2.1.311 y codex): `--mcp-config` SUMA el server a los de
 * `.claude.json` (el `init` lista `nest_memory` y `nest_orchestration`; sólo
 * `--strict-mcp-config` descarta el resto) y los `-c mcp_servers.*` de codex suman a los de
 * `config.toml` (`codex mcp list`).
 *
 * Un bin que no sea claude ni codex (Gemini/Qwen/OpenCode) queda fuera de esta entrega: `[]`.
 */
export function orchestrationLaunchArgs(bin: string, paths: OrchestrationLaunchPaths): string[] {
  if (bin === 'claude') {
    const file = join(paths.configDir, 'orchestration-mcp.json')
    const config = {
      mcpServers: {
        nest_orchestration: {
          command: paths.execPath,
          args: [paths.shimPath],
          env: { ELECTRON_RUN_AS_NODE: '1' },
        },
      },
    }
    // writeFileAtomic no crea el directorio: sin esto el pane arrancaría sin el shim, en silencio.
    mkdirSync(paths.configDir, { recursive: true })
    writeFileAtomic(file, JSON.stringify(config, null, 2))
    return ['--mcp-config', file]
  }
  if (bin === 'codex') {
    // Strings básicos de TOML ("..."): un path con `'` (p.ej. /Users/O'Brien) rompería un
    // literal '...'. Se escapan `\` y `"`.
    return [
      '-c', `mcp_servers.nest_orchestration.command=${toml(paths.execPath)}`,
      '-c', `mcp_servers.nest_orchestration.args=[${toml(paths.shimPath)}]`,
      '-c', `mcp_servers.nest_orchestration.env.ELECTRON_RUN_AS_NODE=${toml('1')}`,
    ]
  }
  return []
}
