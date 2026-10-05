// El cableado de la extensión: de dónde saca los datos que muestra.
//
// Está separado de `extension-vscode.ts` porque aquél no toca nada —recibe la API del editor
// y unas dependencias— y esto sí: lee el disco, abre la base, mira el llavero. La frontera es
// la misma que en el resto del paquete, y es la que hace que la decisión se pueda probar sin
// levantar un editor.
//
// **Nada de esto toca la red.** La extensión corre en cada arranque del editor, y bloquear
// ese arranque contra un servicio que puede no contestar es peor que mostrar menos. Lo único
// que sale del proceso es el `ping` a un Nest local, y sólo cuando se abre el panel.
import { homedir } from 'os'
import { ravenHome } from './raven-home'
import { existsSync } from 'fs'
import { destinosDeSetup, planDeSetup, comoLanzarElServidor } from './setup-del-paquete'
import { aplicarPlan, sondasDeDisco } from './aplicar-setup'
import { decidirBase } from './base-para-el-paquete'
import { buscarNestVivo } from './nest-vivo-del-paquete'
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
const COMO_LANZARME = comoLanzarElServidor(process.platform)

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

async function leerEstado(): Promise<EntradaDelPanel> {
  const raven = ravenHome()
  const punteroDeNest = () => readActivePointer(raven)?.storePath ?? null
  const base = decidirBase({
    home: homedir(),
    existe: (p) => existsSync(p),
    // Hace falta el `ping` y no alcanza con el puntero: con Nest abierto el panel no puede
    // ofrecer «conectar», porque eso arma un segundo daemon sobre la misma cuenta. Corre al
    // abrir el panel, no al arrancar el editor, y tiene tope corto.
    nestVivo: await buscarNestVivo(process.env, raven, process.platform === 'win32'),
    punteroDeNest,
  })

  // Con Nest vivo se cuenta sobre su base, en sólo lectura: es la misma memoria que él sirve,
  // y preguntársela por el socket sería sumar un formato de respuesta sólo para un número.
  const pathAContar = base.modo === 'daemon'
    ? punteroDeNest()
    : base.modo === 'propia' && base.nueva ? null : base.path
  const memorias = pathAContar && existsSync(pathAContar) ? contarMemorias(pathAContar) : 0

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
