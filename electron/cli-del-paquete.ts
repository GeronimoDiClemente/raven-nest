// El punto de entrada de `npx nest-memory`.
//
// Hasta acá todo el paquete portátil eran librerías sin puerta: el parser sabía qué se pidió,
// el plan sabía qué escribir, el store sabía abrir la base — y nadie los unía. Esto los une.
//
// Deliberadamente flaco: cada comando arma sus dependencias y llama a una función que ya está
// probada. Lo único propio de este archivo es imprimir, y por eso es lo único que no tiene
// tests unitarios — lo que se puede romper acá se ve corriéndolo.
//
// **Qué anda hoy sin nube**: `setup`, `status`, `search` y la ayuda. Son los que el §5.2
// promete para una máquina sola, y los que hacen al paquete útil sin cuenta.
// **Qué no está cableado todavía**: `login`, `recover` y `mcp`. Cada uno lo DICE en vez de
// fallar raro o de fingir: un comando que no hace nada y no avisa es peor que uno que no está.
import { homedir } from 'os'
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

function noCableado(comando: string, falta: string): never {
  // Decirlo con precisión y salir distinto de 0. Un comando que imprime algo lindo y no hace
  // nada es la peor de las tres opciones.
  console.error(`\`${comando}\` is not wired up yet: ${falta}`)
  salir(2)
}

export function correr(argv: string[]): void {
  const cmd = parsearArgumentos(argv)
  switch (cmd.comando) {
    case 'ayuda': console.log(AYUDA); return
    case 'setup': comandoSetup(cmd); return
    case 'status': comandoStatus(); return
    case 'search': comandoSearch(cmd.consulta); return
    case 'doctor': comandoDoctor(); return
    case 'login': noCableado('login', 'it needs the sync service URL and the polling loop hooked to it')
    case 'recover': noCableado('recover', 'it needs the recovery-code path hooked to the key store')
    case 'mcp': noCableado('mcp', 'the MCP server still runs inside Nest')
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
