#!/usr/bin/env node
// El punto de entrada de `npx @nestmux/memory`.
//
// Une las piezas del paquete portátil: el parser sabe qué se pidió, el plan sabe qué escribir y
// el store sabe abrir la base.
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
import { readFileSync } from 'fs'
import { join } from 'path'
import { parsearArgumentos, textoDeAyuda } from './argumentos-del-paquete'
import {
  crearEstilo, decidirColor, marca, marcas, fila, acortarHome, recortar, hace,
  grupoDeTipo, etiquetaDeTipo, barraDeGrupos,
} from './estilo-del-paquete'
import { destinosDeSetup, planDeSetup, planDeDeshacer, comoLanzarElServidor } from './setup-del-paquete'
import { aplicarPlan, sondasDeDisco } from './aplicar-setup'
import { dondeEstaLaBase } from './donde-esta-la-base'
import { leerStatusDelPaquete, type FilaDeEstado } from './status-del-paquete'
import { leerDoctorDelPaquete } from './doctor-del-paquete'
import { usarAbridorPorDefecto } from './sqlite-motor'
import { abrirBase, abrirBaseSoloLectura } from './sqlite-sin-compilar'
import { searchObservations } from './memory-reads'
import { GLOBAL_PROJECT_KEY } from './memory-project-key'
import { usarAbridorDeLecturaPorDefecto } from './sqlite-motor'
import { MemoryLocalClient } from './memory-mcp/local'
import { MemoryDaemonClient } from './memory-mcp/client'
import { dependenciasDeStatus, dependenciasDeDoctor } from './dependencias-de-lectura-del-paquete'
import { alAbrirConSync, cifradoDelSistema, urlDelServicio, urlDeUpgradeDelPaquete, avisarSiElServicioNoCoincide } from './sync-del-paquete-tras-escribir'
import { resolveGitInfoForCwd } from './git-info'
import { runMcpServer } from './memory-mcp/servidor'
import { guardarCredencial, leerCredencial } from './credencial-del-paquete'
import { siguientePaso, interpretarRespuestaDePoll, type EstadoDeLogin } from './login-del-paquete'
import { ensureKeyMaterial, saveKeyMaterial } from './memory-key-store'
import { recoverWithCode } from './memory-keys-client'
import { normalizeRecoveryCode } from './memory-key-wrap'
import { enrolarDesdeLogin } from './enrolamiento-desde-login'
import { mensajeDeEnrolamiento, type ResultadoDeEnrolamiento } from './enrolamiento-del-paquete'
import { comando, NOMBRE_DEL_PAQUETE } from './nombre-del-paquete'
import { webDelPaquete, abrirNavegador, iniciarVinculacion } from './vinculacion-web-del-paquete'

/**
 * El motor: `node:sqlite`, que viene adentro de Node y no compila nada.
 *
 * Se registra ACÁ, en el arranque, porque es el arranque el que sabe en qué entorno corre.
 * `main.ts` hace lo mismo con `better-sqlite3`. `memory-store.ts` no nombra a ninguno de los
 * dos, y hay un test que camina el grafo de imports para que siga siendo así.
 *
 * Queda registrado aunque el comando sólo LEA: cualquier escritura tiene que encontrar su
 * motor sin que nadie se acuerde de esto.
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

async function comandoStatus(): Promise<void> {
  const base = await dondeEstaLaBase()
  const deps = dependenciasDeStatus(base)
  const credencial = deps.credencial
  const datos = await leerStatusDelPaquete(deps)
  console.log('')
  console.log(`  ${marca(e, 'status')}`)
  console.log('')
  if (datos.modo === 'daemon') {
    pintarFilas(datos.filas)
    console.log('')
    return
  }
  if (datos.vacia) {
    console.log(`  No memory on this machine yet. It will live at ${e.tenue(datos.guardadaEn ?? '')}`)
    console.log(`  ${e.tenue('Start with:')} ${comando('setup')}`)
    console.log('')
    return
  }
  const { total, deEquipo } = datos
  console.log(`  ${e.negrita(String(total))} ${total === 1 ? 'memory' : 'memories'} ready for your next session`)
  for (const linea of barraDeGrupos(e, datos.porGrupo)) console.log(linea)
  console.log('')
  console.log(`  ${e.tenue('SCOPE'.padEnd(9))}personal ${datos.personal}${deEquipo > 0 ? `  ${e.tenue('·')}  team ${deEquipo}` : ''}`)
  console.log(`  ${e.tenue('STORED'.padEnd(9))}${datos.guardadaEn}${datos.modo === 'nest' ? e.tenue("  (this machine's Nest)") : ''}`)
  if (datos.servicio !== null) {
    console.log(`  ${e.tenue('SERVICE'.padEnd(9))}${datos.servicio}`)
    avisarSiElServicioNoCoincide(credencial())
  }
  console.log('')
  pintarFilas(datos.filas)

  if (datos.recientes.length > 0) {
    console.log('')
    console.log(`  ${e.tenue('LATELY')}`)
    const ahora = Date.now()
    for (const m of datos.recientes) {
      const origen = [hace(m.updatedAt, ahora), m.originAi].filter(Boolean).join(' · ')
      console.log(`  ${etiquetaDeTipo(e, m.type)}  ${recortar(m.title, 50).padEnd(50)}  ${e.tenue(origen)}`)
    }
  }
  console.log('')
}

/** El mapa de `Marca` (dato) a la marca pintada del CLI. */
function pintarFilas(filas: FilaDeEstado[]): void {
  for (const f of filas) console.log(fila(marcas[f.marca](e), f.etiqueta, f.detalle))
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
  const datos = await leerDoctorDelPaquete(dependenciasDeDoctor(base))
  console.log('')
  console.log(`  ${marca(e, 'doctor')}`)
  console.log('')

  for (const f of datos.filas) {
    // Lo que es información y no estado va atenuado; el resto de los detalles, tal cual.
    const detalle = f.marca !== 'nada' ? f.detalle
      : f.etiqueta === 'Memory' ? f.detalle.replace('(created on first use)', e.tenue('(created on first use)'))
      : e.tenue(f.detalle)
    console.log(fila(marcas[f.marca](e), f.etiqueta, detalle))
  }

  if (datos.homeDeNest) {
    console.log('')
    console.log(`  ${e.aviso('This HOME looks like a Nest account folder.')} Nest redirects HOME inside its`)
    console.log('  panes, so the memory you are looking for probably lives under your real home.')
  }

  // Lo que el push retiene y por qué: sin esto «changes waiting» no dice qué ni cuánto.
  if (datos.bloqueadas.length > 0) {
    console.log('')
    console.log(`  ${e.tenue('BLOCKED')}`)
    for (const b of datos.bloqueadas) console.log(fila(marcas.aviso(e), recortar(b.titulo, 40), b.motivo))
  }

  console.log('')
  const { problemas, avisos } = datos
  const resumen = [problemas && `${problemas} ${problemas === 1 ? 'problem' : 'problems'}`, avisos && `${avisos} ${avisos === 1 ? 'warning' : 'warnings'}`].filter(Boolean).join(', ')
  console.log(`  ${resumen ? e.negrita(`${resumen}.`) : e.acento('All good.')}`)
  console.log('')
  if (problemas > 0) salir(1)
}

/**
 * `mcp`: el servidor que lanzan los editores, no una persona.
 *
 * Es el MISMO bucle que corre adentro de Nest —`memory-mcp/servidor.ts`— con otro cliente
 * atrás: el despacho del daemon corriendo en este proceso (`memory-mcp/local.ts`). Un agente
 * en una máquina sin Nest tiene las mismas herramientas Y puede escribir.
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
    // y sus escrituras aparecen al instante en la pantalla de Memories. Un editor lanzado
    // por su cuenta —Cursor, VS Code— no puede quedarse sin memoria justo con Nest abierto.
    await runMcpServer(new MemoryDaemonClient(base.socket, base.token), process.cwd())
    return
  }
  const cliente = new MemoryLocalClient(base.path, resolveGitInfoForCwd, alAbrirConSync(base))
  await runMcpServer(cliente, process.cwd())
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

/** Spec 2026-11-02 §5: con el código en pantalla, no se termina hasta que el usuario escriba
 * `saved`. Ctrl+C sale igual: con `activada` la maestra ya quedó en el llavero y el código se
 * puede regenerar desde Nest (Memory settings → Encryption → New recovery code). Con
 * `activada-sin-guardar` NO: la maestra no se pudo guardar en esta máquina y el código de la
 * pantalla es lo único que la recupera (`mensajeDeEnrolamiento` ya lo avisa). El código sólo va
 * a la terminal: nunca a un archivo ni a un log. */
async function mostrarEnrolamiento(resultado: ResultadoDeEnrolamiento): Promise<void> {
  for (const linea of mensajeDeEnrolamiento(resultado)) console.log(linea)
  if (resultado.estado !== 'activada' && resultado.estado !== 'activada-sin-guardar') return
  for (;;) {
    console.log('')
    console.log('  Type "saved" once you have stored it, then press enter.')
    if ((await leerUnaLinea()).trim().toLowerCase() === 'saved') return
    // Sin terminal (stdin cerrado) no hay quien escriba `saved`: repetir el aviso sería un
    // bucle infinito. Se sale (con `activada-sin-guardar` el código ya se imprimió, y es lo
    // único que queda: ver el comentario de arriba).
    if (process.stdin.readableEnded) return
  }
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
    // Una credencial vieja sin `baseUrl` resuelve el servicio DE NUEVO cada corrida — env
    // actual, si no el default — sin dejar nada escrito. Si el env que la creó ya no está
    // seteado, el próximo `login` calla y habla con un servicio distinto del que emitió el
    // token. Se persiste ACÁ,
    // una sola vez, el valor que se está por usar — no hace falta que el usuario lo pida.
    if (!existente.baseUrl) guardarCredencial(homedir(), safe, { ...existente, baseUrl: base })
    await mostrarEnrolamiento(await enrolarDesdeLogin(homedir(), safe, {
      ...existente, baseUrl: base,
    }))
    return
  }

  const arranque = await iniciarVinculacion({
    base,
    baseWeb: webDelPaquete(process.env.NEST_MEMORY_WEB_URL),
    nombre: hostname(),
    plataforma: process.platform,
    env: process.env,
    fetch,
    abrir: (url) => abrirNavegador(url, process.platform),
    imprimir: (linea) => console.log(linea),
    tenue: e.tenue,
  })
  if (!arranque.ok) {
    if (arranque.motivo === 'http') console.error(`The sync service refused to start a link: HTTP ${arranque.status}`)
    else console.error('The sync service answered something this version does not understand.')
    salir(1)
  }
  process.stdout.write('  Waiting…')

  let estado: EstadoDeLogin = {
    intervaloMs: Math.max(1000, (arranque.intervaloSeg ?? 2) * 1000),
    esperaAcumuladaMs: 0,
    venceEnMs: (arranque.venceEnSeg ?? 600) * 1000,
  }

  for (;;) {
    // Una caída de red NO corta: el código sigue vivo del otro lado, y `siguientePaso` ya
    // sabe que eso se reintenta. Por eso el catch devuelve `sin-respuesta` en vez de tirar.
    const respuesta = await fetch(`${base}/v1/link/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: arranque.deviceCode, name: hostname(), platform: process.platform }),
    })
      .then(async (r) => interpretarRespuestaDePoll(r.status, await r.json().catch(() => null)))
      .catch(() => ({ status: 'sin-respuesta' as const }))

    const paso = siguientePaso(respuesta, estado)

    if (paso.accion === 'listo') {
      guardarCredencial(homedir(), safe, { token: paso.token, deviceId: paso.deviceId, baseUrl: base })
      console.log(`\n\n${fila(marcas.ok(e), 'Connected', 'your credential is saved in the system keyring')}`)
      await mostrarEnrolamiento(await enrolarDesdeLogin(homedir(), safe, {
        baseUrl: base, token: paso.token, deviceId: paso.deviceId,
      }))
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
    const terminar = (linea: string) => {
      process.stdin.off('data', alLeer)
      process.stdin.off('end', alCerrar)
      process.stdin.pause()
      resolve(linea)
    }
    const alLeer = (chunk: string) => {
      datos += chunk
      const corte = datos.indexOf('\n')
      if (corte !== -1) terminar(datos.slice(0, corte))
    }
    const alCerrar = () => terminar(datos)
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', alLeer)
    process.stdin.on('end', alCerrar)
    // Una segunda lectura (el bucle de `saved`) llega con el stream pausado por la primera.
    process.stdin.resume()
  })
}

/**
 * Un comando asincrónico que falla tiene que DECIRLO, no volcar un stack de Node.
 *
 * Sin esto, `void comandoLogin()` descarta la promesa: un servicio inalcanzable termina en
 * un rechazo sin atrapar, con el stack impreso y —lo peor— saliendo con código 0, o sea
 * anunciando éxito.
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
      // El compilador tiene que gritar si se agrega un comando al parser y nadie lo cablea
      // acá: sin esto, el binario lo aceptaría, no haría nada y saldría con 0.
      const nuncaLlega: never = cmd
      throw new Error(`Unhandled command: ${JSON.stringify(nuncaLlega)}`)
    }
  }
}

// `process.argv[0]` es node y `[1]` este archivo: los comandos empiezan en el 2.
correr(process.argv.slice(2))
