// El punto de entrada de `npx nest-memory`.
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
// **Con cuenta**: `login` y `recover`, contra el servicio que diga `NEST_MEMORY_SYNC_URL`.
//
// El servidor MCP corre el MISMO bucle que adentro de Nest (`memory-mcp/servidor.ts`), con
// otro cliente atrás: lectura directa del disco en vez del daemon por socket.
import { homedir, hostname } from 'os'
import { existsSync } from 'fs'
import { parsearArgumentos, AYUDA } from './argumentos-del-paquete'
import { destinosDeSetup, planDeSetup, planDeDeshacer } from './setup-del-paquete'
import { aplicarPlan, sondasDeDisco } from './aplicar-setup'
import { decidirBase, pathDeBasePropia } from './base-para-el-paquete'
import { usarAbridorPorDefecto } from './sqlite-motor'
import { abrirBase, abrirBaseSoloLectura } from './sqlite-sin-compilar'
import { searchObservations, contextObservations } from './memory-reads'
import { GLOBAL_PROJECT_KEY } from './memory-project-key'
import { readActivePointer } from './memory-active-store'
import { llaveroPorPlataforma, correrComando } from './llavero-del-sistema'
import { usarAbridorDeLecturaPorDefecto } from './sqlite-motor'
import { MemoryReadonlyClient } from './memory-mcp/readonly'
import { runMcpServer } from './memory-mcp/servidor'
import { cifradoDeLlavero } from './llavero-del-sistema'
import { guardarCredencial, leerCredencial } from './credencial-del-paquete'
import { siguientePaso, interpretarRespuestaDePoll, type EstadoDeLogin } from './login-del-paquete'
import { ensureKeyMaterial, saveKeyMaterial } from './memory-key-store'
import { recoverWithCode } from './memory-keys-client'
import { normalizeRecoveryCode } from './memory-key-wrap'

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

/**
 * Lo que se escribe en la configuración de los editores.
 *
 * Una invocación estable y NO la ruta resuelta de este proceso: si `setup` corrió por `npx`
 * sin instalar nada, el binario vive en una caché temporal que npm puede limpiar, y esa ruta
 * dejaría configuraciones que se pudren solas.
 */
const COMO_LANZARME = { command: 'npx', args: ['-y', 'nest-memory', 'mcp'] }

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

  if (opts.simulado) {
    console.log(opts.deshacer ? 'Would remove nest-memory from:' : 'Would configure:')
    for (const p of pasos) {
      const que = p.accion === 'ausente' ? 'not installed'
        : p.accion === 'ya-esta' ? 'already done'
        : p.accion === 'crear' ? 'create' : 'update'
      console.log(`  ${p.destino.nombre.padEnd(12)} ${que.padEnd(14)} ${p.destino.path}`)
    }
    console.log('\nNothing was written (--dry-run).')
    return
  }

  const r = aplicarPlan(pasos)
  for (const path of r.escritos) console.log(`  ${opts.deshacer ? 'cleaned' : 'configured'}  ${path}`)
  for (const path of r.yaEstaban) console.log(`  unchanged   ${path}`)
  for (const f of r.fallados) console.error(`  FAILED      ${f.path}: ${f.error}`)

  const tocados = r.escritos.length + r.yaEstaban.length
  if (tocados === 0 && r.fallados.length === 0) {
    console.log('No editors found on this machine. Install one and run this again.')
  }
  // Un fallo parcial no puede salir con 0: quien lo corra desde un script tiene que poder
  // enterarse de que un editor quedó sin configurar.
  if (r.fallados.length > 0) salir(1)
}

/** Dónde está la base y qué se puede hacer con ella, sin tocar la red. */
function dondeEstaLaBase() {
  return decidirBase({
    env: process.env,
    home: homedir(),
    existe: (p) => existsSync(p),
    // Todavía no se sondea el socket de Nest: sin el cliente del daemon cableado, decir que
    // está vivo prometería un camino que este binario no puede tomar. Se lo trata como
    // ausente, que es la respuesta conservadora — se abre la base directo, para leer.
    socketVivo: () => false,
    // El mismo puntero que Nest escribe, y no una heurística nuestra: adivinar cuál base es
    // la buena cuando hay varias cuentas es exactamente la clase de cosa que un día devuelve
    // las memorias de otra persona.
    punteroDeNest: () => readActivePointer(homedir())?.storePath ?? null,
  })
}

function comandoStatus(): void {
  const base = dondeEstaLaBase()
  if (base.modo === 'daemon') {
    console.log('Nest is running here and owns the memory.')
    return
  }
  if (base.modo === 'propia' && base.nueva) {
    console.log(`No memory on this machine yet. It would live at ${pathDeBasePropia(homedir())}.`)
    return
  }
  const db = abrirBaseSoloLectura(base.path)
  try {
    const total = contextObservations(db, null, GLOBAL_PROJECT_KEY, 1000).length
    console.log(`${total} ${total === 1 ? 'memory' : 'memories'}`)
    console.log(`from ${base.path}${base.modo === 'nest' ? " (this machine's Nest)" : ''}`)
    console.log('Cloud sync is not connected from this command yet — run it inside Nest.')
  } finally {
    db.close()
  }
}

function comandoSearch(consulta: string): void {
  const base = dondeEstaLaBase()
  if (base.modo === 'daemon') {
    console.log('Nest is running here — search from Nest, it owns the memory.')
    return
  }
  if (base.modo === 'propia' && base.nueva) {
    console.log('No memory on this machine yet.')
    return
  }
  const db = abrirBaseSoloLectura(base.path)
  try {
    const hits = searchObservations(db, null, GLOBAL_PROJECT_KEY, consulta, 20)
    if (hits.length === 0) {
      console.log(`Nothing for "${consulta}".`)
      return
    }
    for (const h of hits) console.log(`  ${h.title}`)
  } finally {
    db.close()
  }
}

/**
 * `doctor`: por qué no anda. Mira lo mismo que miran los demás comandos y lo dice en voz
 * alta — dónde buscó la base, si el Node alcanza, y si hay dónde guardar claves.
 */
function comandoDoctor(): void {
  const base = dondeEstaLaBase()
  console.log(`node        ${process.version}${NODE_MINIMO_OK ? '' : `  (needs >= ${NODE_MINIMO}, node:sqlite is not in older ones)`}`)
  console.log(`home        ${homedir()}`)

  const puntero = readActivePointer(homedir())
  console.log(`nest        ${puntero ? puntero.storePath : 'no active-store pointer under this home'}`)

  const dondeMira =
    base.modo === 'daemon' ? 'talking to Nest over its socket'
    : base.modo === 'nest' ? base.path
    : `${base.path}${base.nueva ? '  (does not exist yet)' : ''}`
  console.log(`memory      ${dondeMira}`)

  const llavero = llaveroPorPlataforma(process.platform, correrComando)
  console.log(`keyring     ${llavero.disponible() ? 'available' : 'not available — encrypted cloud memory stays closed'}`)

  // El aviso que explica el caso más confuso, y el que este comando existe para desarmar:
  // adentro de un panel de Nest el HOME está redirigido a la carpeta de la cuenta, así que
  // el paquete busca la base en un lugar donde no está y parece que no hubiera memoria.
  if (!puntero && homedir().includes('.raven-nest')) {
    console.log('')
    console.log('This HOME looks like a Nest account folder. Nest redirects HOME inside its')
    console.log('panes, so the memory you are looking for probably lives under your real home.')
  }
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
 * atrás: en vez del daemon por socket, lectura directa del disco. Eso hace que un agente en
 * una máquina sin Nest tenga exactamente las mismas herramientas, y que lo que NO puede
 * hacer (escribir) lo diga con las mismas palabras.
 *
 * **Nada se imprime por stdout acá**: ese canal es el protocolo. Un `console.log` suelto
 * rompe la sesión del editor con un error de parseo que no dice nada.
 */
async function comandoMcp(): Promise<void> {
  const base = dondeEstaLaBase()
  if (base.modo === 'daemon') {
    // Con Nest vivo el shim de Electron es el que corresponde: él escribe, éste no.
    console.error('Nest is running here — its own memory server is the one to use.')
    salir(2)
  }
  const path = base.modo === 'nest' ? base.path : base.path
  await runMcpServer(new MemoryReadonlyClient(homedir(), path), process.cwd())
}

/**
 * A qué servicio hablarle. Sale del entorno y NO está clavado en el binario: un `npx` se
 * publica una vez y el servicio puede mudarse, y además hace falta poder apuntarlo a uno de
 * desarrollo sin republicar nada.
 */
function urlDelServicio(): string | null {
  const u = process.env.NEST_MEMORY_SYNC_URL?.trim()
  return u ? u.replace(/\/+$/, '') : null
}

/** El cifrado en reposo de esta máquina: el llavero del sistema. */
function cifradoDelSistema() {
  return cifradoDeLlavero(llaveroPorPlataforma(process.platform, correrComando))
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

function exigirServicio(): string {
  const base = urlDelServicio()
  if (!base) {
    console.error('No sync service configured. Set NEST_MEMORY_SYNC_URL to your service URL.')
    salir(2)
  }
  return base
}

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
  const base = exigirServicio()
  const safe = exigirLlavero()

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

  console.log('')
  console.log(`  Your code:  ${arranque.user_code}`)
  console.log('')
  console.log('  Open Nest on a machine where you are signed in, go to Memories, and type it')
  console.log('  into "Connect a machine without a browser".')
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
      body: JSON.stringify({ device_code: arranque.device_code, name: hostname() }),
    })
      .then(async (r) => interpretarRespuestaDePoll(r.status, await r.json().catch(() => null)))
      .catch(() => ({ status: 'sin-respuesta' as const }))

    const paso = siguientePaso(respuesta, estado)

    if (paso.accion === 'listo') {
      guardarCredencial(homedir(), safe, { token: paso.token, deviceId: paso.deviceId })
      console.log('\n\n  Connected. This machine can sync now.')
      return
    }
    if (paso.accion === 'cortar') {
      const porque = paso.motivo === 'vencido'
        ? 'the code expired — run login again to get a new one'
        : `the service refused this machine: ${paso.detalle ?? 'no reason given'}`
      console.error(`\n\n  Could not connect: ${porque}`)
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
  const base = exigirServicio()
  const safe = exigirLlavero()
  const credencial = leerCredencial(homedir(), safe)
  if (!credencial) {
    console.error('This machine is not connected to an account. Run `nest-memory login` first.')
    salir(2)
  }

  console.log('Paste your recovery code and press enter.')
  console.log('Using it spends your one emergency copy — if another machine is available,')
  console.log('authorizing from there is the better path.')
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
    console.log('Recovered. This machine can read your encrypted memory now.')
  } catch (err) {
    // El motivo va tal cual: «código equivocado» y «no hay copia de recuperación en esta
    // cuenta» piden cosas distintas, y colapsarlos en "no se pudo" deja al usuario probando
    // el mismo código otra vez.
    console.error(`Could not recover: ${err instanceof Error ? err.message : String(err)}`)
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
    case 'ayuda': console.log(AYUDA); return
    case 'setup': comandoSetup(cmd); return
    case 'status': comandoStatus(); return
    case 'search': comandoSearch(cmd.consulta); return
    case 'doctor': comandoDoctor(); return
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
