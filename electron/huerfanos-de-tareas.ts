// Los procesos que dejó vivos una tarea de fondo de un agente que ya terminó.
//
// Claude Code corre cada tarea de fondo en un `zsh -c` con setsid (sesión propia, sin tty, PGID =
// su pid) y escribe la salida en `/private/tmp/claude-<uid>/<proyecto>/<sesión>/tasks/<id>.output`.
// Al terminar la tarea le manda la señal al shell, no al grupo: lo que el shell lanzó queda vivo,
// adoptado por launchd (PPID 1). El caso que lo trajo: un python 3 días al 99% de CPU.
// Nest no lo evita matando mejor el pane: una sesión setsid no recibe el SIGHUP del tty.
//
// Un proceso es huérfano de una tarea si:
//   1. su padre es launchd (PPID 1) y es de este usuario;
//   2. su stdout o stderr apunta al `.output` de una tarea;
//   3. la tarea terminó: el líder de su grupo (el `zsh -c`) ya no existe, o el que quedó con
//      PPID 1 ES el líder — el agente que lo lanzó murió, si no, sería su padre.
//
// Nunca se matan solos: esto lee rutas internas de Claude Code, que pueden cambiar. Se
// muestran, y el usuario decide. Puro a propósito: la salida de `ps` y `lsof` entra como texto.

export interface FilaDeProceso {
  pid: number
  ppid: number
  pgid: number
  uid: number
  cpu: number
  /** Cuánto lleva vivo, en segundos. */
  segundos: number
  comando: string
}

export interface Huerfano {
  pid: number
  pgid: number
  cpu: number
  segundos: number
  comando: string
  /** El agente cuya tarea lo dejó. Hoy sólo `claude`: es el único cuyas rutas conocemos. */
  agente: 'claude'
  /** La carpeta del proyecto como la nombra Claude Code (`-Users-x-repo`), sin el home. */
  proyecto: string
  tarea: string
}

/** `ps -A -o pid=,ppid=,pgid=,uid=,%cpu=,etime=,command=`. */
export const ARGUMENTOS_DE_PS = ['-A', '-o', 'pid=,ppid=,pgid=,uid=,%cpu=,etime=,command=']

/** `[[dd-]hh:]mm:ss` → segundos. */
export function segundosDeEtime(etime: string): number {
  const [dias, resto] = etime.includes('-') ? etime.split('-') as [string, string] : ['0', etime]
  const partes = resto.split(':').map(Number)
  while (partes.length < 3) partes.unshift(0)
  const [h, m, s] = partes as [number, number, number]
  const total = Number(dias) * 86_400 + h * 3_600 + m * 60 + s
  return Number.isFinite(total) ? total : 0
}

export function parsearPs(stdout: string): FilaDeProceso[] {
  const filas: FilaDeProceso[] = []
  for (const linea of stdout.split('\n')) {
    const m = linea.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d.,]+)\s+(\S+)\s+(.*)$/)
    if (!m) continue
    filas.push({
      pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), uid: Number(m[4]),
      cpu: Number(m[5]!.replace(',', '.')), segundos: segundosDeEtime(m[6]!), comando: m[7]!,
    })
  }
  return filas
}

/** Los candidatos a mirar con `lsof`: de este usuario y adoptados por launchd. */
export function candidatos(filas: FilaDeProceso[], uid: number): FilaDeProceso[] {
  return filas.filter((f) => f.ppid === 1 && f.uid === uid)
}

/** `lsof -nP -a -d 1,2 -p <pids> -Fpn` → pid → rutas de su stdout/stderr. */
export function parsearLsof(stdout: string): Map<number, string[]> {
  const rutas = new Map<number, string[]>()
  let actual: number | null = null
  for (const linea of stdout.split('\n')) {
    if (linea.startsWith('p')) {
      actual = Number(linea.slice(1))
      if (!rutas.has(actual)) rutas.set(actual, [])
    } else if (linea.startsWith('n') && actual !== null) {
      rutas.get(actual)!.push(linea.slice(1))
    }
  }
  return rutas
}

const RUTA_DE_TAREA = /\/claude-\d+\/([^/]+)\/[^/]+\/tasks\/([^/]+)\.output$/

/** `-Users-x-RavenProjects-repo` → `RavenProjects-repo`: lo que sobra cuando se le saca el home. */
function sinHome(carpeta: string, home: string): string {
  const prefijo = `${home.replace(/[/.]/g, '-')}-`
  return carpeta.startsWith(prefijo) ? carpeta.slice(prefijo.length) : carpeta
}

export function detectarHuerfanos(
  filas: FilaDeProceso[], rutas: Map<number, string[]>, o: { uid: number; home: string },
): Huerfano[] {
  const vivos = new Set(filas.map((f) => f.pid))
  const huerfanos: Huerfano[] = []
  for (const f of candidatos(filas, o.uid)) {
    const tarea = (rutas.get(f.pid) ?? []).map((r) => r.match(RUTA_DE_TAREA)).find(Boolean)
    if (!tarea) continue
    const terminada = f.pid === f.pgid || !vivos.has(f.pgid)
    if (!terminada) continue
    huerfanos.push({
      pid: f.pid, pgid: f.pgid, cpu: f.cpu, segundos: f.segundos, comando: f.comando,
      agente: 'claude', proyecto: sinHome(tarea[1]!, o.home), tarea: tarea[2]!,
    })
  }
  // Los que más queman, primero: son los que el usuario vino a buscar.
  return huerfanos.sort((a, b) => b.cpu - a.cpu || b.segundos - a.segundos)
}

/** Los pids del grupo del huérfano: es lo que se mata, porque la tarea entera quedó suelta. */
export function grupoDe(filas: FilaDeProceso[], pgid: number): number[] {
  return filas.filter((f) => f.pgid === pgid).map((f) => f.pid)
}
