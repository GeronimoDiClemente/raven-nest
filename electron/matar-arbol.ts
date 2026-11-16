// Matar un proceso con todo su árbol en macOS/Linux.
//
// `process.kill(pid)` le manda SIGTERM sólo a ese pid: el dev server o el python que el shell
// de un pane lanzó quedan vivos, adoptados por launchd (PPID 1), y nadie los vuelve a ver. Acá
// se le manda SIGTERM al árbol entero y SIGKILL a lo que siga vivo después de la gracia: un
// proceso que ignora SIGTERM (o que está trabado) no puede sobrevivir al botón de matar.
//
// Puro a propósito: el árbol, las señales y el reloj entran por `DepsDeMatar`.

export interface DepsDeMatar {
  /** El pid y todos sus descendientes (lo que da `pidtree(pid, { root: true })`). */
  arbolDe: (pid: number) => Promise<number[]>
  /** `process.kill`: tira ESRCH si el proceso ya no existe. */
  senal: (pid: number, senal: NodeJS.Signals) => void
  /** ¿Sigue vivo? (`process.kill(pid, 0)` sin tirar). */
  vivo: (pid: number) => boolean
  esperar: (ms: number) => Promise<void>
}

export type ResultadoDeMatar = { ok: true } | { ok: false; error: string }

const GRACIA_MS = 3_000
const PASO_MS = 100

const mensajeDe = (err: unknown) => (err instanceof Error ? err.message : String(err))

/**
 * El árbol se lee ANTES de la primera señal: muerto el padre, los hijos pasan a PPID 1 y ya no
 * se los encuentra desde él.
 */
export async function matarArbol(pid: number, deps: DepsDeMatar, o: { graciaMs?: number; pasoMs?: number } = {}): Promise<ResultadoDeMatar> {
  let arbol: number[]
  try {
    arbol = await deps.arbolDe(pid)
  } catch {
    arbol = [pid] // sin tabla de procesos, al menos el pid pedido
  }
  if (!arbol.includes(pid)) arbol = [pid, ...arbol]

  let errorDeLaRaiz: string | null = null
  for (const p of arbol) {
    try {
      deps.senal(p, 'SIGTERM')
    } catch (err) {
      // Un hijo que murió entre la lectura y la señal no es un error; la raíz sí lo es, salvo que
      // haya hijos a los que todavía se pueda matar.
      if (p === pid) errorDeLaRaiz = mensajeDe(err)
    }
  }

  const gracia = o.graciaMs ?? GRACIA_MS
  const paso = o.pasoMs ?? PASO_MS
  let vivos = arbol.filter((p) => deps.vivo(p))
  for (let t = 0; vivos.length > 0 && t < gracia; t += paso) {
    await deps.esperar(paso)
    vivos = vivos.filter((p) => deps.vivo(p))
  }
  for (const p of vivos) {
    try { deps.senal(p, 'SIGKILL') } catch { /* murió justo ahora */ }
  }

  if (errorDeLaRaiz && arbol.length === 1) return { ok: false, error: errorDeLaRaiz }
  return { ok: true }
}
