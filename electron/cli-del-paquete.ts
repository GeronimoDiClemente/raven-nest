#!/usr/bin/env node
// El punto de entrada de `npx @nestmux/memory`.
//
// Hasta acá todo el paquete portátil eran librerías sin puerta: el parser sabía qué se pidió,
// el plan sabía qué escribir, el store sabía abrir la base — y nadie los unía. Esto los une.
//
// Deliberadamente flaco: cada comando arma sus dependencias y llama a una función que ya está
// probada. Lo único propio de este archivo es imprimir, y por eso es lo único que no tiene
// tests unitarios — lo que se puede romper acá se ve corriéndolo.
//
// **Sin cuenta ni red**: `setup`, `status`, `search`, `doctor` y `mcp`. Son los que el §5.2
// promete para una máquina sola, y `mcp` es el que hace que el `setup` signifique algo — es
// lo que los editores lanzan.
// **Con cuenta**: `login` y `recover`, contra el servicio de `servicio-del-paquete.ts`.
//
// El servidor MCP corre el MISMO bucle que adentro de Nest (`memory-mcp/servidor.ts`), con
// otro cliente atrás: el despacho del daemon en proceso, sobre la base de esta máquina, en
// vez del daemon por socket.
// Primero que todo: el aviso de `node:sqlite` se emite al cargarlo — ver el archivo.
import './silenciar-aviso-sqlite'
import { homedir, hostname, userInfo } from 'os'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { parsearArgumentos, textoDeAyuda } from './argumentos-del-paquete'
import {
  crearEstilo, decidirColor, marca, marcas, fila, acortarHome, recortar, hace,
  grupoDeTipo, etiquetaDeTipo, barraDeGrupos, type GrupoDeTipo,
} from './estilo-del-paquete'
import { destinosDeSetup, planDeSetup, planDeDeshacer, comoLanzarElServidor } from './setup-del-paquete'
import { aplicarPlan, sondasDeDisco } from './aplicar-setup'
import { decidirBase, pathDeBasePropia } from './base-para-el-paquete'
import { usarAbridorPorDefecto } from './sqlite-motor'
import { abrirBase, abrirBaseSoloLectura } from './sqlite-sin-compilar'
import { searchObservations, contextObservations } from './memory-reads'
import { GLOBAL_PROJECT_KEY } from './memory-project-key'
import { readActivePointer } from './memory-active-store'
import { llaveroPorPlataforma, correrComando } from './llavero-del-sistema'
import { usarAbridorDeLecturaPorDefecto } from './sqlite-motor'
import { MemoryLocalClient } from './memory-mcp/local'
import { MemoryDaemonClient } from './memory-mcp/client'
import { buscarNestVivo } from './nest-vivo-del-paquete'
import { ravenHome } from './raven-home'
import { lineaDeSync, lineaDeEquipoRetenido } from './estado-de-sync-del-paquete'
import { armarDaemonDelPaquete } from './daemon-del-paquete'
import { TEAM_KEY_HOLD_REASONS } from './memory-daemon'
import { SyncDelMcp } from './sync-del-mcp'
import { resolveGitInfoForCwd } from './git-info'
import { runMcpServer } from './memory-mcp/servidor'
import { cifradoDeLlavero } from './llavero-del-sistema'
import { guardarCredencial, leerCredencial } from './credencial-del-paquete'
import { siguientePaso, interpretarRespuestaDePoll, type EstadoDeLogin } from './login-del-paquete'
import { ensureKeyMaterial, saveKeyMaterial, loadKeyMaterial } from './memory-key-store'
import { recoverWithCode } from './memory-keys-client'
import { normalizeRecoveryCode } from './memory-key-wrap'
import { enrolarDesdeLogin } from './enrolamiento-desde-login'
import { mensajeDeEnrolamiento } from './enrolamiento-del-paquete'
import { servicioDelPaquete, avisoDeServicioDistinto } from './servicio-del-paquete'
import { comando, NOMBRE_DEL_PAQUETE } from './nombre-del-paquete'

/**
 * El motor: `node:sqlite`, que viene adentro de Node y no compila nada.
 *
 * Se registra ACÁ, en el arranque, porque es el arranque el que sabe en qué entorno corre.
 * `main.ts` hace lo mismo con `better-sqlite3`. `memory-store.ts` no nombra a ninguno de los
 * dos, y hay un test que camina el grafo de imports para que siga siendo así.
 *
 * Queda registrado aunque los comandos de hoy sólo LEAN: el día que se cablee una escritura,
 * el store tiene que encontrar su motor sin que nadie se acuerde de esto.
 */
usarAbridorPorDefecto(abrirBase)
usarAbridorDeLecturaPorDefecto(abrirBaseSoloLectura)

/** Lo que se escribe en la configuración de los editores — ver `comoLanzarElServidor`. */
const COMO_LANZARME = comoLanzarElServidor(process.platform)

const e = crearEstilo(decidirColor(process.env, process.stdout.isTTY === true))

/** HOME dentro de un panel de Nest apunta a la carpeta de la cuenta: se acortan los dos. */
const corto = (path: string) => acortarHome(path, [homedir(), userInfo().homedir])

/** La versión del paquete publicado; `undefined` corriendo desde el repo. */
function versionDelPaquete(): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { name?: string; version?: string }
    return pkg.name === NOMBRE_DEL_PAQUETE ? pkg.version : undefined
  } catch {
    return undefined
  }
}

function salir(codigo: number): never {
  process.exit(codigo)
}

function comandoSetup(opts: { soloEditores: string[] | null; deshacer: boolean; simulado: boolean }): void {
  const todos = destinosDeSetup(homedir(), process.platform)
  const destinos = opts.soloEditores
    ? todos.filter((d) => opts.soloEditores!.includes(d.id))
    : todos

  const sondas = sondasDeDisco()
  const pasos = opts.deshacer
    ? planDeDeshacer(destinos, sondas)
    : planDeSetup(destinos, sondas, COMO_LANZARME)

  const nombreDe = new Map(pasos.map((p) => [p.destino.path, p.destino.nombre]))
  console.log('')
  console.log(`  ${marca(e, opts.deshacer ? 'setup --undo' : 'setup')}`)

  if (opts.simulado) {
    console.log(`  ${e.tenue('Dry run — nothing is written.')}`)
    console.log('')
    for (const p of pasos) {
      const [m, que] = p.accion === 'ausente' ? [marcas.nada(e), 'not installed']
        : p.accion === 'ya-esta' ? [marcas.ok(e), opts.deshacer ? 'nothing to remove' : 'already set up']
        : [marcas.pendiente(e), opts.deshacer ? 'would remove' : p.accion === 'crear' ? 'would create' : 'would update']
      console.log(fila(m, p.destino.nombre, `${que.padEnd(18)} ${e.tenue(corto(p.destino.path))}`))
    }
    console.log('')
    return
  }

  if (!opts.deshacer) console.log(`  ${e.tenue('One memory for every agent on this machine.')}`)
  console.log('')
  const r = aplicarPlan(pasos)
  for (const path of r.escritos) {
    console.log(fila(marcas.ok(e), nombreDe.get(path) ?? path, `${e.ok((opts.deshacer ? 'removed' : 'configured').padEnd(14))} ${e.tenue(corto(path))}`))
  }
  for (const path of r.yaEstaban) {
    console.log(fila(marcas.ok(e), nombreDe.get(path) ?? path, `${(opts.deshacer ? 'not set up' : 'already set up').padEnd(14)} ${e.tenue(corto(path))}`))
  }
  for (const path of r.saltados) {
    console.log(e.tenue(fila('·', nombreDe.get(path) ?? path, 'not installed')))
  }
  for (const f of r.fallados) {
    console.error(fila(marcas.falla(e), nombreDe.get(f.path) ?? f.path, e.falla(`failed — ${f.error}`)))
  }
  console.log('')

  const conectados = r.escritos.length + r.yaEstaban.length
  if (opts.deshacer) {
    console.log(`  ${r.escritos.length === 0 ? 'Nothing to remove.' : `Removed from ${r.escritos.length} ${r.escritos.length === 1 ? 'editor' : 'editors'}.`}`)
  } else if (conectados === 0 && r.fallados.length === 0) {
    console.log('  No editors found on this machine. Install one and run this again.')
  } else if (conectados > 0) {
    console.log(`  ${e.acento(`${conectados} ${conectados === 1 ? 'editor now uses' : 'editors now share'} one memory.`)}`)
    if (r.escritos.length > 0) console.log(`  ${e.tenue('Restart them so they pick up the new tools.')}`)
    console.log('')
    console.log(`  ${e.tenue('Undo anytime:')} ${comando('setup --undo')}`)
    console.log(`  ${e.tenue('Next:')}         ${comando('login')}  ${e.tenue('to use it on your other machines')}`)
  }
  console.log('')
  // Un fallo parcial no puede salir con 0: quien lo corra desde un script tiene que poder
  // enterarse de que un editor quedó sin configurar.
  if (r.fallados.length > 0) salir(1)
}

/**
 * Dónde está la base y qué se puede hacer con ella, sin tocar la red.
 *
 * Lo de Nest se busca bajo `ravenHome()` y no bajo `homedir()`: adentro de una terminal de
 * Nest el HOME está redirigido a la carpeta de la cuenta (`~/.raven-nest/accounts/...`), y
 * con `homedir()` el paquete no encontraba ni el puntero ni el pipe — parecía no haber Nest
 * justo en la máquina donde estaba abierto.
 */
async function dondeEstaLaBase() {
  const raven = ravenHome()
  return decidirBase({
    home: homedir(),
    existe: (p) => existsSync(p),
    nestVivo: await buscarNestVivo(process.env, raven, process.platform === 'win32'),
    // El mismo puntero que Nest escribe, y no una heurística nuestra: adivinar cuál base es
    // la buena cuando hay varias cuentas es exactamente la clase de cosa que un día devuelve
    // las memorias de otra persona.
    punteroDeNest: () => readActivePointer(raven)?.storePath ?? null,
  })
}

async function comandoStatus(): Promise<void> {
  const base = await dondeEstaLaBase()
  console.log('')
  console.log(`  ${marca(e, 'status')}`)
  console.log('')
  if (base.modo === 'daemon') {
    console.log(fila(marcas.ok(e), 'Nest', 'open here — it owns this memory and syncs it live'))
    console.log('')
    return
  }
  if (base.modo === 'propia' && base.nueva) {
    console.log(`  No memory on this machine yet. It will live at ${e.tenue(corto(pathDeBasePropia(homedir())))}`)
    console.log(`  ${e.tenue('Start with:')} ${comando('setup')}`)
    console.log('')
    return
  }
  const db = abrirBaseSoloLectura(base.path)
  try {
    const filas = db.prepare(
      'SELECT type, scope, COUNT(*) AS c FROM observations WHERE deleted = 0 AND superseded_by IS NULL GROUP BY type, scope'
    ).all() as Array<{ type: string; scope: string; c: number }>
    const total = filas.reduce((n, f) => n + f.c, 0)
    const porGrupo: Partial<Record<GrupoDeTipo, number>> = {}
    let deEquipo = 0
    for (const f of filas) {
      const g = grupoDeTipo(f.type)
      porGrupo[g] = (porGrupo[g] ?? 0) + f.c
      if (f.scope === 'team') deEquipo += f.c
    }

    console.log(`  ${e.negrita(String(total))} ${total === 1 ? 'memory' : 'memories'} ready for your next session`)
    for (const linea of barraDeGrupos(e, porGrupo)) console.log(linea)
    console.log('')
    console.log(`  ${e.tenue('SCOPE'.padEnd(9))}personal ${total - deEquipo}${deEquipo > 0 ? `  ${e.tenue('·')}  team ${deEquipo}` : ''}`)
    console.log(`  ${e.tenue('STORED'.padEnd(9))}${corto(base.path)}${base.modo === 'nest' ? e.tenue("  (this machine's Nest)") : ''}`)

    // La cola, con número y no con un ícono (P-R5 del spec): lo que el usuario necesita saber
    // es si lo que escribió en esta máquina ya está en la nube o todavía no.
    const enCola = (db.prepare(
      'SELECT COUNT(*) AS c FROM mutation_log WHERE pushed_at IS NULL AND blocked_reason IS NULL'
    ).get() as { c: number }).c
    const safe = cifradoDelSistema()
    const credencial = base.modo === 'propia' && safe.isEncryptionAvailable() ? leerCredencial(homedir(), safe) : null
    const hayCredencial = credencial !== null
    // Con la base de Nest la sube Nest, con su credencial: el servicio sólo importa con la propia.
    if (base.modo === 'propia' && hayCredencial) {
      console.log(`  ${e.tenue('SERVICE'.padEnd(9))}${urlDelServicio(credencial)}`)
      avisarSiElServicioNoCoincide(credencial)
    }
    console.log('')

    // La época que el daemon vio en el último status: el mismo dato que arma el gate
    // fail-closed del push.
    let epocaConocida = 0
    try {
      epocaConocida = Number((db.prepare("SELECT value FROM meta WHERE key = 'known_key_epoch'").get() as { value?: string } | undefined)?.value ?? 0)
    } catch { /* una base sin `meta` todavía no vio ningún status */ }
    const tieneMaestra = Boolean(loadKeyMaterial(homedir(), null, safe)?.master)
    const esperandoAutorizacion = hayCredencial && epocaConocida > 0 && !tieneMaestra
    const marcaDeSync = !hayCredencial && base.modo === 'propia' ? marcas.nada(e)
      : esperandoAutorizacion ? marcas.aviso(e)
      : enCola > 0 ? marcas.pendiente(e)
      : marcas.ok(e)
    console.log(fila(marcaDeSync, 'Sync', lineaDeSync({ modo: base.modo, enCola, hayCredencial, esperandoAutorizacion })))
    if (base.modo === 'propia' && hayCredencial && epocaConocida > 0) {
      console.log(fila(tieneMaestra ? marcas.ok(e) : marcas.aviso(e), 'Encrypted',
        tieneMaestra ? 'end to end — this machine holds the key' : 'end to end — this machine is not authorized yet'))
    }
    // Lo que el gate retuvo por falta de clave de equipo: `enCola` no lo cuenta.
    const retenidas = (db.prepare(
      `SELECT payload FROM mutation_log WHERE pushed_at IS NULL
         AND blocked_reason IN (${TEAM_KEY_HOLD_REASONS.map(() => '?').join(',')})`
    ).all(...TEAM_KEY_HOLD_REASONS) as Array<{ payload: string }>).filter(({ payload }) => {
      try { return (JSON.parse(payload) as { scope?: unknown }).scope === 'team' } catch { return false }
    }).length
    const retenidoDeEquipo = lineaDeEquipoRetenido({ modo: base.modo, retenidas })
    if (retenidoDeEquipo) console.log(fila(marcas.aviso(e), 'Team', retenidoDeEquipo))

    const recientes = contextObservations(db, null, GLOBAL_PROJECT_KEY, 3)
    if (recientes.length > 0) {
      console.log('')
      console.log(`  ${e.tenue('LATELY')}`)
      const ahora = Date.now()
      for (const m of recientes) {
        const origen = [hace(m.updatedAt, ahora), m.originAi].filter(Boolean).join(' · ')
        console.log(`  ${etiquetaDeTipo(e, m.type)}  ${recortar(m.title, 50).padEnd(50)}  ${e.tenue(origen)}`)
      }
    }
    console.log('')
  } finally {
    db.close()
  }
}

interface Resultado {
  title: string
  content?: string
  type?: string
  updatedAt?: number
  originAi?: string | null
  gitBranch?: string | null
}

function imprimirResultados(consulta: string, hits: Resultado[]): void {
  console.log('')
  console.log(`  ${marca(e, 'search', hits.length === 1 ? '1 result' : `${hits.length} results`)}`)
  console.log('')
  if (hits.length === 0) {
    console.log(`  Nothing for "${consulta}".`)
    console.log('')
    return
  }
  const ahora = Date.now()
  const sangria = ' '.repeat(16)
  for (const h of hits) {
    console.log(`  ${e.deGrupo(grupoDeTipo(h.type ?? ''), '●')} ${etiquetaDeTipo(e, h.type ?? '', 11)} ${e.negrita(recortar(h.title, 60))}`)
    if (h.content) console.log(`${sangria}${recortar(h.content, 62)}`)
    const origen = [h.updatedAt ? `${hace(h.updatedAt, ahora)} ago` : null, h.originAi, h.gitBranch].filter(Boolean).join(' · ')
    if (origen) console.log(`${sangria}${e.tenue(origen)}`)
    console.log('')
  }
  console.log(`  ${e.tenue('Your agents see the same results through')} memory_search${e.tenue('.')}`)
  console.log('')
}

async function comandoSearch(consulta: string): Promise<void> {
  const base = await dondeEstaLaBase()
  if (base.modo === 'daemon') {
    // Con Nest abierto se le pregunta a él: es quien tiene la versión al día, recién bajada.
    const { items } = await new MemoryDaemonClient(base.socket, base.token)
      .call<{ items: Resultado[] }>('memory.search', { cwd: process.cwd(), query: consulta, limit: 20 })
    imprimirResultados(consulta, items)
    return
  }
  if (base.modo === 'propia' && base.nueva) {
    console.log(`  No memory on this machine yet. ${e.tenue('Start with:')} ${comando('setup')}`)
    return
  }
  const db = abrirBaseSoloLectura(base.path)
  try {
    imprimirResultados(consulta, searchObservations(db, null, GLOBAL_PROJECT_KEY, consulta, 20))
  } finally {
    db.close()
  }
}

/**
 * `doctor`: por qué no anda. Mira lo mismo que miran los demás comandos y lo dice en voz
 * alta — dónde buscó la base, si el Node alcanza, y si hay dónde guardar claves.
 */
async function comandoDoctor(): Promise<void> {
  const base = await dondeEstaLaBase()
  console.log('')
  console.log(`  ${marca(e, 'doctor')}`)
  console.log('')

  let problemas = 0
  let avisos = 0
  const ok = () => marcas.ok(e)
  const aviso = () => { avisos++; return marcas.aviso(e) }
  const falla = () => { problemas++; return marcas.falla(e) }

  console.log(NODE_MINIMO_OK
    ? fila(ok(), 'Node', process.version)
    : fila(falla(), 'Node', `${process.version} — needs ${NODE_MINIMO} or newer (node:sqlite)`))
  console.log(fila(marcas.nada(e), 'Home', e.tenue(acortarHome(homedir(), [userInfo().homedir]))))

  const puntero = readActivePointer(ravenHome())
  if (base.modo === 'daemon') console.log(fila(ok(), 'Nest', 'open — memory goes through it'))
  else if (puntero) console.log(fila(aviso(), 'Nest', 'closed — changes wait until it opens'))
  else console.log(fila(marcas.nada(e), 'Nest', e.tenue('not installed for this user')))

  if (base.modo === 'daemon') console.log(fila(ok(), 'Memory', "through Nest's socket"))
  else if (base.modo === 'propia' && base.nueva) console.log(fila(marcas.nada(e), 'Memory', `${corto(base.path)} ${e.tenue('(created on first use)')}`))
  else console.log(fila(ok(), 'Memory', corto(base.path)))

  const llavero = llaveroPorPlataforma(process.platform, correrComando)
  console.log(llavero.disponible()
    ? fila(ok(), 'Keyring', 'available')
    : fila(aviso(), 'Keyring', 'not available — encrypted cloud memory stays closed'))

  // Adentro de un panel de Nest el HOME está redirigido a la carpeta de la cuenta: el paquete
  // busca la base donde no está y parece que no hubiera memoria.
  if (!puntero && homedir().includes('.raven-nest')) {
    console.log('')
    console.log(`  ${e.aviso('This HOME looks like a Nest account folder.')} Nest redirects HOME inside its`)
    console.log('  panes, so the memory you are looking for probably lives under your real home.')
  }

  console.log('')
  const resumen = [problemas && `${problemas} ${problemas === 1 ? 'problem' : 'problems'}`, avisos && `${avisos} ${avisos === 1 ? 'warning' : 'warnings'}`].filter(Boolean).join(', ')
  console.log(`  ${resumen ? e.negrita(`${resumen}.`) : e.acento('All good.')}`)
  console.log('')
  if (problemas > 0) salir(1)
}

const NODE_MINIMO = '22.5.0'
const NODE_MINIMO_OK = (() => {
  const [may, men] = process.versions.node.split('.').map(Number)
  return (may ?? 0) > 22 || ((may ?? 0) === 22 && (men ?? 0) >= 5)
})()

/**
 * `mcp`: el servidor que lanzan los editores, no una persona.
 *
 * Es el MISMO bucle que corre adentro de Nest —`memory-mcp/servidor.ts`— con otro cliente
 * atrás: el despacho del daemon corriendo en este proceso (`memory-mcp/local.ts`). Un agente
 * en una máquina sin Nest tiene las mismas herramientas Y puede escribir: hasta el
 * 2026-10-02 esto era de sólo lectura, y en una máquina nueva no servía para nada.
 *
 * Con cuenta (§6.2 del spec) baja al abrir la base y sube después de cada escritura, sin
 * daemon de fondo y soltando el candado entre operaciones (`sync-del-mcp.ts`).
 *
 * **Sólo sobre la base PROPIA del paquete.** Con la base de Nest (Nest instalado y cerrado)
 * no se sincroniza: esa base es de la cuenta de Nest, que puede no ser la del `login` del
 * paquete, y subirla con esta credencial mezclaría las memorias de dos cuentas. Ahí lo
 * escrito queda en la cola y lo sube Nest cuando se abre.
 *
 * **Nada se imprime por stdout acá**: ese canal es el protocolo. Un `console.log` suelto
 * rompe la sesión del editor con un error de parseo que no dice nada.
 */
async function comandoMcp(): Promise<void> {
  const base = await dondeEstaLaBase()
  if (base.modo === 'daemon') {
    // Con Nest abierto se le delega TODO: es el escritor único y el que sincroniza en vivo,
    // y sus escrituras aparecen al instante en la pantalla de Memories. Antes acá se salía
    // con «use Nest's own server», que para un editor lanzado por su cuenta —Cursor, VS
    // Code— era quedarse sin memoria justo con Nest abierto.
    await runMcpServer(new MemoryDaemonClient(base.socket, base.token), process.cwd())
    return
  }
  const sincronizar = base.modo === 'propia'
  const cliente = new MemoryLocalClient(base.path, resolveGitInfoForCwd, (store) => {
    if (!sincronizar) return
    const credencial = leerCredencial(homedir(), cifradoDelSistema())
    avisarSiElServicioNoCoincide(credencial)
    const { daemon, hayCuenta } = armarDaemonDelPaquete({
      store, dbPath: base.path, home: homedir(),
      baseUrl: urlDelServicio(credencial), safe: cifradoDelSistema(),
    })
    const sync = new SyncDelMcp(daemon, hayCuenta)
    sync.alArrancar()
    return () => sync.trasEscribir()
  })
  await runMcpServer(cliente, process.cwd())
}

/**
 * A qué servicio hablarle: la variable de entorno, si no el del `login`, si no el default de
 * Nest. Ver `servicio-del-paquete.ts`.
 */
function urlDelServicio(credencial: { baseUrl?: string } | null): string {
  return servicioDelPaquete({ env: process.env.NEST_MEMORY_SYNC_URL, guardada: credencial?.baseUrl })
}

/**
 * Si el env difiere de contra qué se hizo `login`, lo avisa — SIEMPRE por stderr: en modo
 * `mcp` stdout es el protocolo (ver su doc comment más abajo) y un aviso ahí rompe la sesión
 * del editor con un error de parseo; en los demás comandos no hay razón para mezclarlo con
 * la salida normal tampoco.
 */
function avisarSiElServicioNoCoincide(credencial: { baseUrl?: string } | null): void {
  const aviso = avisoDeServicioDistinto({ env: process.env.NEST_MEMORY_SYNC_URL, guardada: credencial?.baseUrl })
  if (aviso) console.error(`Warning: ${aviso}`)
}

/** El cifrado en reposo de esta máquina: el llavero del sistema. */
function cifradoDelSistema() {
  return cifradoDeLlavero(llaveroPorPlataforma(process.platform, correrComando))
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

function exigirLlavero(): ReturnType<typeof cifradoDelSistema> {
  const safe = cifradoDelSistema()
  if (!safe.isEncryptionAvailable()) {
    console.error('No system keyring available, so there is nowhere safe to keep the token.')
    console.error('Local memory keeps working — this only affects the cloud.')
    salir(2)
  }
  return safe
}

/** `login`: conectar esta máquina a tu cuenta, sin abrir un navegador acá. */
async function comandoLogin(): Promise<void> {
  const safe = exigirLlavero()
  console.log('')
  console.log(`  ${marca(e, 'login')}`)
  console.log('')

  // Reusar la credencial conserva el deviceId que otra máquina está autorizando: pedir
  // otro código crearía otro dispositivo y dejaría la autorización anterior sin destinatario.
  const existente = leerCredencial(homedir(), safe)
  const base = urlDelServicio(existente)
  if (existente) {
    console.log(fila(marcas.ok(e), 'Connected', 'checking encryption access'))
    avisarSiElServicioNoCoincide(existente)
    // Review final de rama, MINOR: una credencial sin `baseUrl` (de antes de 5dc84c5)
    // resolvía el servicio DE NUEVO cada corrida — env actual, si no el default — sin
    // dejar nada escrito. Si el env que la creó ya no está seteado, el próximo `login`
    // calla y habla con un servicio distinto del que emitió el token. Se persiste ACÁ,
    // una sola vez, el valor que se está por usar — no hace falta que el usuario lo pida.
    if (!existente.baseUrl) guardarCredencial(homedir(), safe, { ...existente, baseUrl: base })
    for (const linea of mensajeDeEnrolamiento(await enrolarDesdeLogin(homedir(), safe, {
      ...existente, baseUrl: base,
    }))) console.log(linea)
    return
  }

  const inicio = await fetch(`${base}/v1/link/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  if (!inicio.ok) {
    console.error(`The sync service refused to start a link: HTTP ${inicio.status}`)
    salir(1)
  }
  const arranque = (await inicio.json()) as {
    user_code?: string; device_code?: string; expires_in?: number; interval?: number
  }
  if (!arranque.user_code || !arranque.device_code) {
    console.error('The sync service answered something this version does not understand.')
    salir(1)
  }

  console.log(`  Your code:  ${e.acento(arranque.user_code)}`)
  console.log('')
  console.log('  Open Nest on a machine where you are signed in, go to Memories, and type it')
  console.log('  into Memory settings → "Add a machine that has no browser".')
  console.log('')
  process.stdout.write('  Waiting…')

  let estado: EstadoDeLogin = {
    intervaloMs: Math.max(1000, (arranque.interval ?? 2) * 1000),
    esperaAcumuladaMs: 0,
    venceEnMs: (arranque.expires_in ?? 600) * 1000,
  }

  for (;;) {
    // Una caída de red NO corta: el código sigue vivo del otro lado, y `siguientePaso` ya
    // sabe que eso se reintenta. Por eso el catch devuelve `sin-respuesta` en vez de tirar.
    const respuesta = await fetch(`${base}/v1/link/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: arranque.device_code, name: hostname(), platform: process.platform }),
    })
      .then(async (r) => interpretarRespuestaDePoll(r.status, await r.json().catch(() => null)))
      .catch(() => ({ status: 'sin-respuesta' as const }))

    const paso = siguientePaso(respuesta, estado)

    if (paso.accion === 'listo') {
      guardarCredencial(homedir(), safe, { token: paso.token, deviceId: paso.deviceId, baseUrl: base })
      console.log(`\n\n${fila(marcas.ok(e), 'Connected', 'your credential is saved in the system keyring')}`)
      for (const linea of mensajeDeEnrolamiento(await enrolarDesdeLogin(homedir(), safe, {
        baseUrl: base, token: paso.token, deviceId: paso.deviceId,
      }))) console.log(linea)
      return
    }
    if (paso.accion === 'cortar') {
      const porque = paso.motivo === 'vencido'
        ? 'the code expired — run login again to get a new one'
        : `the service refused this machine: ${paso.detalle ?? 'no reason given'}`
      console.error(`\n\n${fila(marcas.falla(e), 'Not connected', porque)}`)
      salir(1)
    }
    process.stdout.write('.')
    await dormir(paso.esperarMs)
    estado = {
      ...estado,
      intervaloMs: paso.intervaloMs,
      esperaAcumuladaMs: estado.esperaAcumuladaMs + paso.esperarMs,
    }
  }
}

/** `recover`: abrir la memoria cifrada con el código de recuperación. */
async function comandoRecover(): Promise<void> {
  const safe = exigirLlavero()
  const credencial = leerCredencial(homedir(), safe)
  if (!credencial) {
    console.error(`This machine is not connected to an account. Run \`${comando('login')}\` first.`)
    salir(2)
  }
  const base = urlDelServicio(credencial)

  console.log('')
  console.log(`  ${marca(e, 'recover')}`)
  console.log('')
  console.log('  Paste your recovery code and press enter.')
  console.log(`  ${e.tenue('Using it spends your one emergency copy — if another machine is available,')}`)
  console.log(`  ${e.tenue('authorizing from there is the better path.')}`)
  const tipeado = (await leerUnaLinea()).trim()
  if (!tipeado) {
    console.error('No code given.')
    salir(1)
  }

  const material = ensureKeyMaterial(homedir(), null, safe)
  try {
    const r = await recoverWithCode(
      { baseUrl: base, token: credencial.token, deviceId: credencial.deviceId },
      material.device,
      normalizeRecoveryCode(tipeado),
    )
    saveKeyMaterial(homedir(), null, safe, { ...material, master: r.master, keyEpoch: r.keyEpoch })
    console.log(fila(marcas.ok(e), 'Recovered', 'this machine can read your encrypted memory now'))
  } catch (err) {
    // El motivo va tal cual: «código equivocado» y «no hay copia de recuperación en esta
    // cuenta» piden cosas distintas, y colapsarlos en "no se pudo" deja al usuario probando
    // el mismo código otra vez.
    console.error(fila(marcas.falla(e), 'Not recovered', err instanceof Error ? err.message : String(err)))
    salir(1)
  }
}

function leerUnaLinea(): Promise<string> {
  return new Promise((resolve) => {
    let datos = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      datos += chunk
      const corte = datos.indexOf('\n')
      if (corte !== -1) { process.stdin.pause(); resolve(datos.slice(0, corte)) }
    })
    process.stdin.on('end', () => resolve(datos))
  })
}

/**
 * Un comando asincrónico que falla tiene que DECIRLO, no volcar un stack de Node.
 *
 * Sin esto, `void comandoLogin()` descarta la promesa: un servicio inalcanzable terminaba en
 * un rechazo sin atrapar, con el stack impreso y —lo peor— saliendo con código 0, o sea
 * anunciando éxito. Lo encontré corriéndolo contra un puerto cerrado.
 */
function correrAsync(p: Promise<void>): void {
  p.catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    salir(1)
  })
}

export function correr(argv: string[]): void {
  const cmd = parsearArgumentos(argv)
  switch (cmd.comando) {
    case 'ayuda': console.log(textoDeAyuda(e, versionDelPaquete())); return
    case 'setup': comandoSetup(cmd); return
    case 'status': correrAsync(comandoStatus()); return
    case 'search': correrAsync(comandoSearch(cmd.consulta)); return
    case 'doctor': correrAsync(comandoDoctor()); return
    case 'login': correrAsync(comandoLogin()); return
    case 'recover': correrAsync(comandoRecover()); return
    case 'mcp': correrAsync(comandoMcp()); return
    case 'error':
      console.error(cmd.detalle)
      salir(1)
    // eslint-disable-next-line no-fallthrough
    default: {
      // El compilador tiene que gritar si mañana se agrega un comando al parser y nadie lo
      // cablea acá. Sin esto, `doctor` estuvo en la ayuda y en el parser y NO en este
      // switch: el binario lo aceptaba, no hacía nada y salía con 0. Se descubrió
      // CORRIÉNDOLO, no compilándolo — que es justo lo que este guard evita la próxima vez.
      const nuncaLlega: never = cmd
      throw new Error(`Unhandled command: ${JSON.stringify(nuncaLlega)}`)
    }
  }
}

// `process.argv[0]` es node y `[1]` este archivo: los comandos empiezan en el 2.
correr(process.argv.slice(2))
