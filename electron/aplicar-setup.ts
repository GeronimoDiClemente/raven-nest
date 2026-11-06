// La mitad de `setup` que sí toca el disco.
//
// `setup-del-paquete.ts` decide y devuelve el texto; esto lo escribe. Están separados porque
// la decisión es donde viven las trampas —las claves por editor, la idempotencia, que quitar
// sea el inverso exacto de poner— y todo eso se prueba mejor sin un disco de por medio. Acá
// abajo queda lo que no se puede evitar: crear directorios, escribir, y no romper nada del
// usuario en el intento.
//
// Dos reglas, las dos por el mismo motivo —el destino es el archivo de configuración REAL de
// alguien, no uno nuestro—:
//
// 1. **Escritura atómica** (temporal + renombre), el patrón de la casa que ya usan
//    `memory-provisioner.ts` y `session-store.ts`. Sin eso, un corte a mitad de escritura
//    deja el config del editor truncado y el editor deja de arrancar — habríamos roto algo
//    que no era nuestro para agregar una línea.
// 2. **Un destino que falla no aborta a los demás.** Que Cursor tenga un permiso raro no es
//    motivo para dejar sin memoria a Claude Code. Se informa cuál falló y por qué.
import { mkdirSync, writeFileSync, renameSync, existsSync, readFileSync, unlinkSync, statSync, chmodSync, realpathSync } from 'fs'
import { dirname } from 'path'
import { randomBytes } from 'crypto'
import type { PasoDelPlan, SondasDeDisco } from './setup-del-paquete'

/** Las sondas de verdad, para pasarle a `planDeSetup` / `planDeDeshacer`. */
export function sondasDeDisco(): SondasDeDisco {
  return {
    existe: (path) => existsSync(path),
    // Un archivo ilegible se trata como vacío a propósito: el plan comparará contra '' y
    // propondrá escribirlo, y ahí sí fallará con un error que dice cuál es el archivo. Tirar
    // desde la sonda cortaría el plan entero antes de mirar los otros seis editores.
    leer: (path) => { try { return readFileSync(path, 'utf8') } catch { return '' } },
  }
}

export interface ResultadoDeAplicar {
  escritos: string[]
  yaEstaban: string[]
  saltados: string[]
  fallados: Array<{ path: string; error: string }>
}

/**
 * Los permisos del archivo que creamos nosotros.
 *
 * Un config MCP dice qué binario corre y con qué argumentos; en una máquina compartida, que
 * cualquiera pueda leerlo no hace falta. Sólo aplica a los que creamos: a un archivo que ya
 * existía no le cambiamos los permisos, porque no son nuestros.
 *
 * "No cambiarlos" exige copiarlos: el renombre deja en el lugar el INODO del temporal, que
 * nace con el umask (0644), así que un `~/.claude.json` en 0600 quedaba legible para otros
 * usuarios de la máquina (auditoría 2026-11-05). Por lo mismo, un config que es un symlink
 * (dotfiles en un repo) se escribe en su destino: renombrar sobre el link lo reemplazaba por
 * un archivo suelto.
 */
const MODO = 0o600

function escribirAtomico(pathPedido: string, contenido: string, esNuevo: boolean): void {
  const path = esNuevo ? pathPedido : realpathSync(pathPedido)
  const modo = esNuevo ? MODO : statSync(path).mode & 0o777
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  try {
    writeFileSync(tmp, contenido, { mode: modo })
    chmodSync(tmp, modo) // el `mode` de writeFileSync pasa por el umask; éste no
    renameSync(tmp, path)
  } catch (err) {
    // El temporal se limpia SIEMPRE que el renombre no haya llegado a pasar. Dejarlo tirado
    // al lado del config de alguien es basura con nuestro nombre, y encima con el contenido
    // adentro.
    try { if (existsSync(tmp)) unlinkSync(tmp) } catch { /* nada que hacer */ }
    throw err
  }
}

export function aplicarPlan(pasos: PasoDelPlan[]): ResultadoDeAplicar {
  const r: ResultadoDeAplicar = { escritos: [], yaEstaban: [], saltados: [], fallados: [] }

  for (const paso of pasos) {
    const path = paso.destino.path
    if (paso.accion === 'ausente') { r.saltados.push(path); continue }
    if (paso.accion === 'ya-esta') { r.yaEstaban.push(path); continue }
    if (paso.textoNuevo === null) { r.saltados.push(path); continue }

    try {
      escribirAtomico(path, paso.textoNuevo, paso.accion === 'crear')
      r.escritos.push(path)
    } catch (err) {
      r.fallados.push({ path, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return r
}
