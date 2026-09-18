// `nest-memory setup`: escribir la configuración MCP en los editores que hay en la máquina.
//
// Es el corazón del paquete portátil (spec `2026-09-13-nest-memory-portable-design.md` §3.1):
// hace a mano lo que hoy el usuario tiene que hacer a mano. Todo lo de acá es puro — decide
// qué escribiría y devuelve el texto resultante— para que `setup`, `setup --undo`, un
// `--dry-run` y el `doctor` lean la misma verdad, y para que nada de esto necesite tocar el
// disco para probarse.
//
// **La diferencia con `memory-provisioner*.ts` es el peligro, no el formato.** Esos escriben
// adentro de los directorios de cuenta que Nest se aísla para sí; acá el destino es el
// archivo de configuración REAL y global del usuario, el mismo que tiene sus otros servidores
// MCP y, en el caso de opencode, sus comentarios. De ahí las tres reglas de este módulo:
//
// 1. **Nunca se reescribe el documento entero.** Las ediciones son puntuales (`jsonc-parser`
//    para JSON y JSONC, un recorte por bloques para TOML), así que lo que no es nuestro no
//    se reordena, ni se reindenta, ni pierde los comentarios.
// 2. **Quitar es exactamente el inverso de poner.** Hay un test que compara el texto original
//    contra el que queda después de poner y sacar: tienen que ser idénticos, byte a byte.
// 3. **Correrlo dos veces no cambia nada.** No por cuidado al escribir sino por construcción:
//    poner es "sacar y volver a poner", así que una entrada vieja se pisa en vez de duplicarse.
//
// > **Sobre el comando que se escribe.** Quien llama decide, y hay una trampa: si `setup`
// > corre por `npx` sin instalar nada, el binario vive en una caché temporal que npm puede
// > limpiar. Escribir ESE path dejaría configuraciones que se pudren solas, así que lo que
// > corresponde escribir es una invocación estable (`npx -y nest-memory mcp`) y no la ruta
// > resuelta del proceso actual.
import { modify, applyEdits, parse as parseJsonc } from 'jsonc-parser'
import { join } from 'path'

/** El nombre bajo el que se registra el servidor, igual que del lado de Nest. */
export const NOMBRE_DEL_SERVIDOR = 'nest_memory'

const FORMATO_JSON = { insertSpaces: true, tabSize: 2 } as const

export type FormatoDeConfig = 'json' | 'jsonc' | 'toml'

/** Lo que se escribe como valor de la entrada: cómo se lanza el servidor MCP. */
export interface EntradaDelServidor {
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface DestinoDeSetup {
  id: string
  /** Como se le dice al usuario. */
  nombre: string
  path: string
  formato: FormatoDeConfig
  /** Dónde vive la entrada adentro del documento. */
  clave: string[]
  /**
   * Directorio cuya existencia alcanza para decir que el editor está instalado, aunque
   * todavía no haya escrito su archivo de configuración.
   *
   * Sin esto, un editor recién instalado —que todavía no guardó ningún ajuste— se vería como
   * ausente y `setup` lo saltearía justo cuando más sirve. `null` cuando el archivo cuelga
   * suelto del home y su directorio padre no dice nada.
   */
  dirDeDeteccion: string | null
}

/**
 * Dónde guarda VS Code la configuración de usuario. Es el único destino cuyo path cambia con
 * el sistema operativo; los demás cuelgan del home igual en todos lados.
 */
function dirDeUsuarioDeVSCode(home: string, plataforma: NodeJS.Platform): string {
  if (plataforma === 'darwin') return join(home, 'Library', 'Application Support', 'Code', 'User')
  if (plataforma === 'win32') return join(home, 'AppData', 'Roaming', 'Code', 'User')
  return join(home, '.config', 'Code', 'User')
}

/**
 * Los siete editores que `setup` sabe configurar, con la forma exacta que espera cada uno.
 *
 * Las cinco primeras salen de los `memory-provisioner*.ts`, que ya las tenían verificadas
 * contra los CLIs reales. Cursor y VS Code se agregaron el 2026-09-18 leyendo su
 * documentación, y ahí apareció la trampa que hacía falta verificar y no adivinar: **VS Code
 * anida bajo `servers` y no bajo `mcpServers`** como todos los demás. Una entrada con la clave
 * equivocada no da error: el editor la ignora y el usuario se queda esperando una memoria que
 * nunca llega.
 */
export function destinosDeSetup(home: string, plataforma: NodeJS.Platform): DestinoDeSetup[] {
  const mcpServers = ['mcpServers', NOMBRE_DEL_SERVIDOR]
  return [
    {
      id: 'claude', nombre: 'Claude Code', formato: 'json', clave: mcpServers,
      path: join(home, '.claude.json'), dirDeDeteccion: null,
    },
    {
      id: 'codex', nombre: 'Codex', formato: 'toml', clave: ['mcp_servers', NOMBRE_DEL_SERVIDOR],
      path: join(home, '.codex', 'config.toml'), dirDeDeteccion: join(home, '.codex'),
    },
    {
      id: 'gemini', nombre: 'Gemini CLI', formato: 'json', clave: mcpServers,
      path: join(home, '.gemini', 'settings.json'), dirDeDeteccion: join(home, '.gemini'),
    },
    {
      id: 'qwen', nombre: 'Qwen', formato: 'json', clave: mcpServers,
      path: join(home, '.qwen', 'settings.json'), dirDeDeteccion: join(home, '.qwen'),
    },
    {
      // JSONC de verdad: opencode admite comentarios en su config, y anida bajo `mcp`.
      id: 'opencode', nombre: 'opencode', formato: 'jsonc', clave: ['mcp', NOMBRE_DEL_SERVIDOR],
      path: join(home, '.config', 'opencode', 'opencode.jsonc'),
      dirDeDeteccion: join(home, '.config', 'opencode'),
    },
    {
      id: 'cursor', nombre: 'Cursor', formato: 'json', clave: mcpServers,
      path: join(home, '.cursor', 'mcp.json'), dirDeDeteccion: join(home, '.cursor'),
    },
    {
      id: 'vscode', nombre: 'VS Code', formato: 'json', clave: ['servers', NOMBRE_DEL_SERVIDOR],
      path: join(dirDeUsuarioDeVSCode(home, plataforma), 'mcp.json'),
      dirDeDeteccion: dirDeUsuarioDeVSCode(home, plataforma),
    },
  ]
}

// ---------------------------------------------------------------------------
// Poner y sacar la entrada
// ---------------------------------------------------------------------------

function conEntradaJson(texto: string, clave: string[], entrada: EntradaDelServidor): string {
  const base = texto.trim() === '' ? '{}' : texto
  return applyEdits(base, modify(base, clave, entrada, { formattingOptions: FORMATO_JSON }))
}

function sinEntradaJson(texto: string, clave: string[]): string {
  if (texto.trim() === '') return texto
  // `modify()` tira "Can not delete in empty document" cuando el padre no existe, así que se
  // comprueba antes en vez de atrapar: un archivo que nunca tuvo la entrada no es un error.
  const doc = parseJsonc(texto) as unknown
  let nodo: unknown = doc
  for (const tramo of clave) {
    if (typeof nodo !== 'object' || nodo === null || !(tramo in (nodo as object))) return texto
    nodo = (nodo as Record<string, unknown>)[tramo]
  }
  let resultado = applyEdits(texto, modify(texto, clave, undefined, { formattingOptions: FORMATO_JSON }))

  // El contenedor que quedó vacío se saca también. Si no, `--undo` deja un `"mcpServers": {}`
  // de recuerdo: residuo visible de algo que dice haberse ido del todo. Sólo se saca si
  // quedó SIN NADA adentro — un contenedor con otros servidores del usuario no se toca, y hay
  // test. El único caso en que esto cambia algo es un contenedor que el usuario ya tenía
  // vacío, que no significa nada en ningún editor.
  for (let corte = clave.length - 1; corte >= 1; corte--) {
    const padre = clave.slice(0, corte)
    const valor = valorEn(resultado, padre)
    if (typeof valor !== 'object' || valor === null || Object.keys(valor).length > 0) break
    resultado = applyEdits(resultado, modify(resultado, padre, undefined, { formattingOptions: FORMATO_JSON }))
  }
  return resultado
}

/** El valor en una ruta del documento, o `undefined` si la ruta no existe. */
function valorEn(texto: string, ruta: string[]): unknown {
  let nodo: unknown = parseJsonc(texto) as unknown
  for (const tramo of ruta) {
    if (typeof nodo !== 'object' || nodo === null || !(tramo in (nodo as object))) return undefined
    nodo = (nodo as Record<string, unknown>)[tramo]
  }
  return nodo
}

/** El literal TOML de un string. Sólo para lo que este módulo escribe: comandos y paths. */
function literalToml(valor: string): string {
  return JSON.stringify(valor)
}

function bloqueToml(entrada: EntradaDelServidor): string {
  const lineas = [
    `[${TABLA}]`,
    `command = ${literalToml(entrada.command)}`,
    `args = [${entrada.args.map(literalToml).join(', ')}]`,
  ]
  if (entrada.env && Object.keys(entrada.env).length > 0) {
    lineas.push('', `[${TABLA}.env]`)
    for (const [k, v] of Object.entries(entrada.env)) lineas.push(`${k} = ${literalToml(v)}`)
  }
  return lineas.join('\n') + '\n'
}

/**
 * Saca el bloque y sus sub-tablas del TOML.
 *
 * Se recorta por líneas y no con un parser porque no hay ninguno en el repo y porque acá
 * alcanza: sólo hay que reconocer dónde empieza nuestra tabla y dónde empieza la siguiente.
 * Lo delicado es que `[mcp_servers.nest_memory_otro]` NO es nuestra —un prefijo compartido no
 * es lo mismo que la misma tabla— y hay un test que lo fija.
 */
const TABLA = `mcp_servers.${NOMBRE_DEL_SERVIDOR}`

/** El nombre de la tabla que abre una línea, o `null` si la línea no abre ninguna. */
function nombreDeTabla(linea: string): string | null {
  // El nombre se EXTRAE en vez de comparar la línea entera, porque TOML admite
  // `[tabla] # comentario` y comparar por igualdad dejaba pasar ese caso — con lo cual
  // `--undo` no deshacía nada. Hay un test.
  const m = /^\[([^\]]+)\]/.exec(linea.trim())
  return m ? m[1]!.trim() : null
}

function sinEntradaToml(texto: string): string {
  const lineas = texto.split('\n')
  const quedan: string[] = []
  let adentro = false

  for (const linea of lineas) {
    const tabla = nombreDeTabla(linea)
    // Sólo se re-evalúa al abrir una tabla: las líneas de adentro del bloque no dicen nada
    // sobre a quién pertenecen. `startsWith(TABLA + '.')` toma las sub-tablas (`.env`) y deja
    // afuera una tabla que apenas comparta el prefijo (`nest_memory_otro`).
    if (tabla !== null) adentro = tabla === TABLA || tabla.startsWith(`${TABLA}.`)
    if (!adentro) quedan.push(linea)
  }

  // Se devuelve tal cual, sin normalizar saltos: este módulo promete no reescribir lo que no
  // es suyo, y el espaciado del usuario tampoco lo es. Colapsar líneas en blanco de más
  // rompía esa promesa en silencio — lo destapó una mutación que ningún test atrapaba.
  return quedan.join('\n')
}

function conEntradaToml(texto: string, entrada: EntradaDelServidor): string {
  // Poner es "sacar y volver a poner": así una entrada vieja se pisa en vez de duplicarse, y
  // correrlo dos veces da exactamente el mismo texto sin tener que comprobar nada.
  const limpio = sinEntradaToml(texto)
  // Un solo salto, siempre, y de ahí sale que poner y sacar sea EXACTAMENTE reversible:
  // sobre un archivo que ya termina en salto queda una línea en blanco de separación, y
  // sobre uno que no termina en salto sólo se cierra su última línea —que no es opcional,
  // porque nuestro encabezado de tabla no puede quedar pegado al final de la línea del
  // usuario—. En los dos casos, sacar el bloque devuelve el texto original byte a byte.
  const base = limpio === '' ? '' : `${limpio}\n`
  return base + bloqueToml(entrada)
}

/** Deja la entrada puesta en el texto del config, sin tocar nada más. */
export function conEntrada(texto: string, destino: DestinoDeSetup, entrada: EntradaDelServidor): string {
  if (destino.formato === 'toml') return conEntradaToml(texto, entrada)
  return conEntradaJson(texto, destino.clave, entrada)
}

/** Saca la entrada. Nunca borra el archivo ni toca ninguna otra clave. */
export function sinEntrada(texto: string, destino: DestinoDeSetup): string {
  if (destino.formato === 'toml') return sinEntradaToml(texto)
  return sinEntradaJson(texto, destino.clave)
}

// ---------------------------------------------------------------------------
// El plan
// ---------------------------------------------------------------------------

export type AccionDeSetup =
  /** El editor no está en esta máquina. No se toca nada. */
  | 'ausente'
  /** Está instalado pero todavía no tiene archivo de configuración. */
  | 'crear'
  /** Tiene configuración y hay que meter o corregir la entrada. */
  | 'actualizar'
  /** Ya quedó configurado antes y el texto no cambiaría. */
  | 'ya-esta'

export interface PasoDelPlan {
  destino: DestinoDeSetup
  accion: AccionDeSetup
  /** El contenido completo que se escribiría, o `null` si no hay nada que escribir. */
  textoNuevo: string | null
}

export interface SondasDeDisco {
  existe: (path: string) => boolean
  leer: (path: string) => string
}

/**
 * Qué haría `setup`, sin hacerlo.
 *
 * Que el plan traiga el texto final —y no sólo la decisión— es lo que permite mostrarlo antes
 * de tocar un archivo del usuario, y es de donde sale la idempotencia: la acción se decide
 * comparando el texto que quedaría contra el que hay, no llevando una marca aparte que se
 * puede desincronizar del archivo.
 */
export function planDeSetup(
  destinos: DestinoDeSetup[],
  sondas: SondasDeDisco,
  entrada: EntradaDelServidor,
): PasoDelPlan[] {
  return destinos.map((destino) => {
    const hayArchivo = sondas.existe(destino.path)
    const hayEditor = hayArchivo
      || (destino.dirDeDeteccion !== null && sondas.existe(destino.dirDeDeteccion))
    if (!hayEditor) return { destino, accion: 'ausente', textoNuevo: null }

    const actual = hayArchivo ? sondas.leer(destino.path) : ''
    const nuevo = conEntrada(actual, destino, entrada)
    if (!hayArchivo) return { destino, accion: 'crear', textoNuevo: nuevo }
    return { destino, accion: nuevo === actual ? 'ya-esta' : 'actualizar', textoNuevo: nuevo }
  })
}

/** Lo que `setup --undo` escribiría en cada destino que hoy tenga la entrada puesta. */
export function planDeDeshacer(destinos: DestinoDeSetup[], sondas: SondasDeDisco): PasoDelPlan[] {
  return destinos.map((destino) => {
    if (!sondas.existe(destino.path)) return { destino, accion: 'ausente', textoNuevo: null }
    const actual = sondas.leer(destino.path)
    const nuevo = sinEntrada(actual, destino)
    return { destino, accion: nuevo === actual ? 'ya-esta' : 'actualizar', textoNuevo: nuevo }
  })
}
