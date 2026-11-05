// El sync de una pasada del paquete portátil, extraído de `comandoMcp` para compartirlo con la
// TUI: al abrir la base baja, y después de cada escritura sube (`sync-del-mcp.ts`). Sin daemon
// de fondo y soltando el candado entre operaciones.
//
// **Sólo sobre la base PROPIA del paquete.** Con la base de Nest (Nest instalado y cerrado)
// no se sincroniza: esa base es de la cuenta de Nest, que puede no ser la del `login` del
// paquete, y subirla con esta credencial mezclaría las memorias de dos cuentas. Ahí lo
// escrito queda en la cola y lo sube Nest cuando se abre.
//
// Acá viven también los helpers de servicio/llavero que antes eran locales de
// `cli-del-paquete.ts`: los usan el CLI y la TUI.
import { homedir } from 'os'
import type { MemoryStore } from './memory-store'
import { llaveroPorPlataforma, correrComando, cifradoDeLlavero } from './llavero-del-sistema'
import { leerCredencial } from './credencial-del-paquete'
import { armarDaemonDelPaquete } from './daemon-del-paquete'
import { SyncDelMcp } from './sync-del-mcp'
import { avisadorDeUpgradeDelMcp } from './estado-de-sync-del-paquete'
import { servicioDelPaquete, avisoDeServicioDistinto } from './servicio-del-paquete'
import { webDelPaquete, urlDeUpgrade } from './vinculacion-web-del-paquete'

/** El cifrado en reposo de esta máquina: el llavero del sistema. */
export function cifradoDelSistema() {
  return cifradoDeLlavero(llaveroPorPlataforma(process.platform, correrComando))
}

/** `nestmux.com/upgrade`, o la del `NEST_MEMORY_WEB_URL` si está seteado. */
export function urlDeUpgradeDelPaquete(): string {
  return urlDeUpgrade(webDelPaquete(process.env.NEST_MEMORY_WEB_URL))
}

/**
 * A qué servicio hablarle: la variable de entorno, si no el del `login`, si no el default de
 * Nest. Ver `servicio-del-paquete.ts`.
 */
export function urlDelServicio(credencial: { baseUrl?: string } | null): string {
  return servicioDelPaquete({ env: process.env.NEST_MEMORY_SYNC_URL, guardada: credencial?.baseUrl })
}

/**
 * Si el env difiere de contra qué se hizo `login`, lo avisa — SIEMPRE por stderr: en modo
 * `mcp` stdout es el protocolo y un aviso ahí rompe la sesión del editor con un error de
 * parseo; en los demás comandos no hay razón para mezclarlo con la salida normal tampoco.
 */
export function avisarSiElServicioNoCoincide(credencial: { baseUrl?: string } | null): void {
  const aviso = avisoDeServicioDistinto({ env: process.env.NEST_MEMORY_SYNC_URL, guardada: credencial?.baseUrl })
  if (aviso) console.error(`Warning: ${aviso}`)
}

export interface DependenciasDeSync {
  home: string
  cifrado: () => ReturnType<typeof cifradoDelSistema>
  /** Por stderr: stdout es el protocolo del MCP y la pantalla de la TUI. */
  imprimir: (linea: string) => void
}

const REALES: DependenciasDeSync = {
  home: '', // se resuelve al usar: `homedir()` puede cambiar con el entorno de un test
  cifrado: cifradoDelSistema,
  imprimir: (linea) => console.error(linea),
}

/** El `alAbrir` de `MemoryLocalClient`, con una forma de esperar al sync que haya en vuelo. */
export type AlAbrirConSync = ((store: MemoryStore) => (() => void) | void) & {
  /**
   * Resuelve cuando la fila de sync (pull del arranque, pushes de después de escribir) se
   * vació; enseguida si no hay sync. La TUI lo espera antes de cerrar la base: cerrarla con
   * un push encolado lo hace fallar. El MCP no lo usa.
   */
  enCurso: () => Promise<void>
}

/**
 * El `alAbrir` de `MemoryLocalClient`. Recibe la base decidida: si no es la propia, no
 * engancha nada (devuelve `undefined` en vez de la función de después-de-escribir).
 */
export function alAbrirConSync(
  base: { modo: 'daemon' | 'nest' | 'propia'; path?: string },
  deps: Partial<DependenciasDeSync> = {},
): AlAbrirConSync {
  const d = { ...REALES, ...deps }
  /** El de la última apertura: si la base se cierra y se reabre, ése es el que importa. */
  let actual: SyncDelMcp | null = null
  const alAbrir = (store: MemoryStore): (() => void) | void => {
    if (base.modo !== 'propia' || !base.path) return
    const home = d.home || homedir()
    const safe = d.cifrado()
    const credencial = leerCredencial(home, safe)
    avisarSiElServicioNoCoincide(credencial)
    const { daemon, hayCuenta } = armarDaemonDelPaquete({
      store, dbPath: base.path, home,
      baseUrl: urlDelServicio(credencial), safe,
    })
    const sync = new SyncDelMcp(daemon, hayCuenta, avisadorDeUpgradeDelMcp({
      daemon, store, urlUpgrade: urlDeUpgradeDelPaquete(), imprimir: d.imprimir,
    }))
    actual = sync
    sync.alArrancar()
    return () => sync.trasEscribir()
  }
  return Object.assign(alAbrir, { enCurso: () => actual?.enCurso() ?? Promise.resolve() })
}
