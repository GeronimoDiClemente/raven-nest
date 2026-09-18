// La puerta de entrada de `npx nest-memory`, sin proceso ni salida por pantalla adentro.
//
// Es un parser y nada más: recibe `argv` y devuelve qué se pidió. Lo que hace con eso —correr
// el setup, esperar el login, imprimir— vive afuera, así que todos los bordes de esta capa se
// prueban sin levantar nada.
//
// **Una opción que no se reconoce es un ERROR, no algo que se ignora.** Es la decisión menos
// obvia del archivo y la que más importa: un `setup --dry-runn` que se traga la opción
// desconocida escribe los configs de verdad mientras el usuario cree que está simulando. Lo
// mismo con un comando mal tipeado — «no pasó nada» es una respuesta peor que «eso no existe».

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

export const AYUDA = `nest-memory — your memory, on any machine

Usage:
  npx nest-memory setup            Detect your editors and configure them all
  npx nest-memory setup --cursor   Only one (${EDITORES.join(', ')})
  npx nest-memory setup --dry-run  Show what it would write, write nothing
  npx nest-memory setup --undo     Remove what setup added
  npx nest-memory login            Connect this machine to your account
  npx nest-memory status           What it sees, where from, and whether it can decrypt
  npx nest-memory search <words>   Read your memory without going through an agent
  npx nest-memory doctor           Why it is not working
  npx nest-memory recover          Use your recovery code to read encrypted memory
  npx nest-memory mcp              Run the MCP server (editors launch this, not you)
`

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
  // Sin argumentos no es un error: alguien que corre `npx nest-memory` a ver qué hace no se
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
