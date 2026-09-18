// El cableado de la extensión: de dónde saca los datos que muestra.
//
// Está separado de `extension-vscode.ts` porque aquél no toca nada —recibe la API del editor
// y unas dependencias— y esto sí: lee el disco, abre la base, mira el llavero. La frontera es
// la misma que en el resto del paquete, y es la que hace que la decisión se pueda probar sin
// levantar un editor.
//
// **Nada de esto toca la red.** La extensión corre en cada arranque del editor, y bloquear
// ese arranque contra un servicio que puede no contestar es peor que mostrar menos.
import { homedir } from 'os'
import { existsSync } from 'fs'
import { destinosDeSetup, planDeSetup } from './setup-del-paquete'
import { aplicarPlan, sondasDeDisco } from './aplicar-setup'
import { decidirBase } from './base-para-el-paquete'
import { readActivePointer } from './memory-active-store'
import { abrirBaseSoloLectura } from './sqlite-sin-compilar'
import { contextObservations } from './memory-reads'
import { GLOBAL_PROJECT_KEY } from './memory-project-key'
import { llaveroPorPlataforma, correrComando, cifradoDeLlavero } from './llavero-del-sistema'
import { leerCredencial } from './credencial-del-paquete'
import { loadKeyMaterial } from './memory-key-store'
import { huellaDeClave } from './memory-key-wrap'
import type { EntradaDelPanel } from './panel-de-la-extension'
import type { DepsDeExtension } from './extension-vscode'
import type { ResultadoDeAplicar } from './aplicar-setup'

/** Cómo se lanza el servidor MCP desde la configuración que escribimos. */
const COMO_LANZARME = { command: 'npx', args: ['-y', 'nest-memory', 'mcp'] }

/** Configura SÓLO el editor que hospeda la extensión, no los siete. */
function configurarEsteEditor(editorId: string): ResultadoDeAplicar {
  const destinos = destinosDeSetup(homedir(), process.platform).filter((d) => d.id === editorId)
  return aplicarPlan(planDeSetup(destinos, sondasDeDisco(), COMO_LANZARME))
}

function contarMemorias(path: string): number {
  const db = abrirBaseSoloLectura(path)
  try {
    return contextObservations(db, null, GLOBAL_PROJECT_KEY, 5000).length
  } finally {
    db.close()
  }
}

function leerEstado(): EntradaDelPanel {
  const base = decidirBase({
    env: process.env,
    home: homedir(),
    existe: (p) => existsSync(p),
    // Sin el cliente del daemon cableado, decir que el socket está vivo prometería un camino
    // que esta extensión no puede tomar.
    socketVivo: () => false,
    punteroDeNest: () => readActivePointer(homedir())?.storePath ?? null,
  })

  // El `&&` de arriba ya estrecha `base` a no-daemon, así que acá `base.path` existe. Una
  // segunda comparación contra 'daemon' sería código muerto — lo dijo el compilador.
  const hayBase = base.modo !== 'daemon' && !(base.modo === 'propia' && base.nueva)
  const memorias = hayBase ? contarMemorias(base.path) : 0

  const llavero = llaveroPorPlataforma(process.platform, correrComando)
  const safe = cifradoDeLlavero(llavero)
  const credencial = llavero.disponible() ? leerCredencial(homedir(), safe) : null
  const material = llavero.disponible() ? loadKeyMaterial(homedir(), null, safe) : null

  return {
    base,
    cuentaConectada: credencial !== null,
    enrolamiento: enrolamientoOffline(llavero.disponible(), material),
    memorias,
    ilegibles: 0,
  }
}

/**
 * Lo que se puede saber del cifrado SIN preguntarle al servicio.
 *
 * Hay un caso que offline no se distingue: una máquina conectada, con llavero y sin clave
 * maestra puede ser una que espera autorización, o una cuya cuenta simplemente no cifra. Se
 * elige `esperando-autorizacion` porque es lo correcto cuando la cuenta SÍ cifra —que es el
 * caso que importa, el que necesita una acción— y cuando no cifra, lo peor que pasa es que se
 * muestre una huella que no hacía falta. La alternativa era bloquear el arranque del editor
 * contra la red, y eso es peor que mostrar de más.
 */
function enrolamientoOffline(
  hayLlavero: boolean,
  material: ReturnType<typeof loadKeyMaterial>,
): EntradaDelPanel['enrolamiento'] {
  if (!hayLlavero) return { estado: 'sin-llavero' }
  if (material?.master) return { estado: 'lista', keyEpoch: material.keyEpoch }
  if (material?.device) return { estado: 'esperando-autorizacion', huella: huellaDeClave(material.device.publicKey) }
  // Sin material de claves todavía no hay nada que autorizar: se genera cuando se necesita.
  return { estado: 'cuenta-sin-cifrado' }
}

/** Lo que el `.vsix` le pasa a `activar`. `editorId` distingue VS Code de Cursor. */
export function depsDeExtension(editorId: string): DepsDeExtension {
  return {
    configurar: () => configurarEsteEditor(editorId),
    leerEstado,
  }
}
