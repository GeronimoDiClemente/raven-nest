// La puerta de entrada de `npx @nestmux/memory`, sin proceso ni salida por pantalla adentro.
//
// Es un parser y nada más: recibe `argv` y devuelve qué se pidió. Lo que hace con eso —correr
// el setup, esperar el login, imprimir— vive afuera, así que todos los bordes de esta capa se
// prueban sin levantar nada.
//
// **Una opción que no se reconoce es un ERROR, no algo que se ignora.** Es la decisión menos
// obvia del archivo y la que más importa: un `setup --dry-runn` que se traga la opción
// desconocida escribe los configs de verdad mientras el usuario cree que está simulando. Lo
// mismo con un comando mal tipeado — «no pasó nada» es una respuesta peor que «eso no existe».
import { comando } from './nombre-del-paquete'
import { crearEstilo, marca, type Estilo } from './estilo-del-paquete'

export type ComandoDelPaquete =
  | { comando: 'ayuda' }
  | { comando: 'setup'; soloEditores: string[] | null; deshacer: boolean; simulado: boolean }
  | { comando: 'login' }
  | { comando: 'status' }
  | { comando: 'search'; consulta: string }
  | { comando: 'doctor' }
  | { comando: 'recover' }
  /** El servidor MCP: lo que los editores lanzan, no lo que una persona escribe. */
  | { comando: 'mcp' }
  | { comando: 'error'; detalle: string }

/** Los editores que `setup` sabe configurar. Tiene que coincidir con `destinosDeSetup`. */
const EDITORES = ['claude', 'codex', 'gemini', 'qwen', 'opencode', 'cursor', 'vscode'] as const

const SIN_ARGUMENTOS = ['login', 'status', 'doctor', 'recover', 'mcp'] as const

const COMANDOS_DIARIOS: Array<[string, string]> = [
  ['status', 'what it sees, and whether it can decrypt'],
  ['search <words>', 'read your memory without an agent'],
  ['doctor', "why something isn't working"],
  ['recover', 'unlock encrypted memory with your recovery code'],
  ['mcp', 'the server your editors launch, not you'],
]

/** La bienvenida de `npx @nestmux/memory` sin argumentos: qué es, para qué sirve y cómo empezar. */
export function textoDeAyuda(e: Estilo, version?: string): string {
  const titulo = marca(e)
  const conVersion = version ? `${titulo}${' '.repeat(Math.max(2, 60 - '> nest memory_'.length))}${e.tenue(`v${version}`)}` : titulo
  const flecha = (s: string) => e.tenue(s)
  const ancho = Math.max(...COMANDOS_DIARIOS.map(([c]) => c.length)) + 2
  return [
    '',
    `  ${conVersion}`,
    `  Your next session starts with what you already learned.`,
    '',
    `  ${e.tenue('SESSION 01 · Claude Code')}          ${e.tenue('SESSION 02 · Cursor')}`,
    `  decision saved  ${flecha('─────────────────▶')}  decision remembered`,
    '',
    `  ${flecha('Claude Code ─┐')}`,
    `  ${flecha('Cursor ──────┤')}`,
    `  ${flecha('Codex ───────┼──▶')}  ${e.acento('● one memory')}   ${e.tenue('local first · end-to-end encrypted sync')}`,
    `  ${flecha('Gemini CLI ──┤')}`,
    `  ${flecha('OpenCode ────┘')}`,
    '',
    `  ${e.tenue('GET STARTED')}`,
    `   ${e.acento('1')}  ${e.negrita('setup'.padEnd(14))}  connect every editor on this machine`,
    `   ${e.acento('2')}  ${e.negrita('login'.padEnd(14))}  sync across your machines ${e.tenue('(optional)')}`,
    `   ${e.acento('3')}  ${e.negrita('just work'.padEnd(14))}  your agents save and recall on their own`,
    '',
    `  ${e.tenue('EVERYDAY')}`,
    ...COMANDOS_DIARIOS.map(([c, d]) => `      ${c.padEnd(ancho)}${d}`),
    '',
    `  ${e.tenue('SETUP OPTIONS')}`,
    `      --dry-run       show what it would write, write nothing`,
    `      --undo          remove what setup added`,
    `      --<editor>      only one: ${EDITORES.join(', ')}`,
    '',
    `  ${e.tenue('Next:')} ${comando('setup')}`,
    '',
  ].join('\n')
}

/** La bienvenida sin color, para los tests y para una salida que no es una terminal. */
export const AYUDA = textoDeAyuda(crearEstilo(false))

function parsearSetup(resto: string[]): ComandoDelPaquete {
  const soloEditores: string[] = []
  let deshacer = false
  let simulado = false

  for (const a of resto) {
    if (a === '--undo') { deshacer = true; continue }
    if (a === '--dry-run') { simulado = true; continue }
    const editor = a.startsWith('--') ? a.slice(2) : null
    if (editor && (EDITORES as readonly string[]).includes(editor)) { soloEditores.push(editor); continue }
    return { comando: 'error', detalle: `Unknown option for setup: ${a}. Try --help.` }
  }

  return { comando: 'setup', soloEditores: soloEditores.length > 0 ? soloEditores : null, deshacer, simulado }
}

export function parsearArgumentos(argv: string[]): ComandoDelPaquete {
  const [primero, ...resto] = argv
  // Sin argumentos no es un error: alguien que corre `npx @nestmux/memory` a ver qué hace no se
  // equivocó en nada, y contestarle con un error lo manda a buscar qué hizo mal.
  if (!primero || primero === '--help' || primero === '-h') return { comando: 'ayuda' }

  if (primero === 'setup') return parsearSetup(resto)

  if (primero === 'search') {
    // Las palabras se juntan en vez de exigir comillas: `search auth token` es lo que la
    // gente escribe, y pedirle comillas a alguien que ya escribió su búsqueda es una
    // ceremonia que no compra nada.
    const consulta = resto.join(' ').trim()
    if (consulta === '') return { comando: 'error', detalle: 'search needs something to look for. Try --help.' }
    return { comando: 'search', consulta }
  }

  if ((SIN_ARGUMENTOS as readonly string[]).includes(primero)) {
    if (resto.length > 0) return { comando: 'error', detalle: `${primero} takes no options: ${resto[0]}. Try --help.` }
    return { comando: primero as 'login' | 'status' | 'doctor' | 'recover' | 'mcp' }
  }

  return { comando: 'error', detalle: `Unknown command: ${primero}. Try --help.` }
}
