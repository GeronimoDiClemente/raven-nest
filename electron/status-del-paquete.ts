// `status` como DATOS: lo que antes `comandoStatus` calculaba e imprimía a la vez. El CLI lo
// pinta y la TUI lo reusa. Nada acá imprime ni lee el proceso: todo entra por
// `DependenciasDeStatus`, así los tests no tocan el disco real.
import type { DecisionDeBase } from './base-para-el-paquete'
import { pathDeBasePropia } from './base-para-el-paquete'
import type { BaseSqlite } from './sqlite-forma'
import type { ObservationSummary } from './memory-protocol'
import { acortarHome, grupoDeTipo, type GrupoDeTipo } from './estilo-del-paquete'
import { lineaDeSync, lineaDeEquipoRetenido, lineaDeUpgradeDeStatus } from './estado-de-sync-del-paquete'
import { contextObservations } from './memory-reads'
import { GLOBAL_PROJECT_KEY } from './memory-project-key'
import { TEAM_KEY_HOLD_REASONS } from './memory-daemon'

export type Marca = 'ok' | 'aviso' | 'pendiente' | 'nada' | 'falla'
export interface FilaDeEstado { marca: Marca; etiqueta: string; detalle: string }

export interface DatosDeStatus {
  modo: 'daemon' | 'nest' | 'propia'
  /** Base propia nueva: «No memory on this machine yet». */
  vacia: boolean
  /** Sin conteos que mostrar (Nest abierto y no se le preguntó, o no supo contestar): sólo las filas. */
  sinConteos?: boolean
  total: number
  porGrupo: Partial<Record<GrupoDeTipo, number>>
  personal: number
  deEquipo: number
  /** El path, ya acortado con `acortarHome`. */
  guardadaEn: string | null
  servicio: string | null
  /** Sync, Upgrade, Encrypted, Team — en ese orden. */
  filas: FilaDeEstado[]
  /** Filas de equipo que esta máquina no puede abrir; 0 si no hay tabla. */
  ilegiblesDeEquipo: number
  /** Las 3 de LATELY. */
  recientes: ObservationSummary[]
  /** Una línea para el encabezado de la TUI. */
  resumen: string
}

export interface DependenciasDeStatus {
  /** El HOME de esta máquina (donde vive la base propia). */
  home: string
  /** Los HOME contra los que se acorta un path (el redirigido y el real). */
  homes: string[]
  base: DecisionDeBase
  abrirSoloLectura: (path: string) => BaseSqlite
  /** ¿Hay dónde guardar claves? Sin eso no se lee credencial. */
  llaveroDisponible: boolean
  /** La credencial del `login`, o null. Sólo se llama con la base propia y llavero. */
  credencial: () => { baseUrl?: string } | null
  tieneMaestra: () => boolean
  urlDelServicio: (credencial: { baseUrl?: string } | null) => string
  urlUpgrade: string
}

const VACIO: DatosDeStatus = {
  modo: 'propia', vacia: false, total: 0, porGrupo: {}, personal: 0, deEquipo: 0,
  guardadaEn: null, servicio: null, filas: [], ilegiblesDeEquipo: 0, recientes: [], resumen: '',
}

/**
 * Cuántas memorias ilegibles hay de equipos: `undecryptable` guarda sólo el `sync_id` y de qué
 * equipo son está en `meta` (`undecryptable_team_ids`). Sin ese conjunto no hay ilegible de
 * equipo; con él, son las de la tabla (la misma lectura de `hayIlegiblesDeEquipos`).
 */
function contarIlegiblesDeEquipo(db: BaseSqlite): number {
  try {
    const meta = db.prepare("SELECT value FROM meta WHERE key = 'undecryptable_team_ids'").get() as { value?: string } | undefined
    const equipos = JSON.parse(meta?.value ?? '[]') as unknown
    if (!Array.isArray(equipos) || equipos.length === 0) return 0
    return Number((db.prepare('SELECT count(*) AS n FROM undecryptable').get() as { n: number }).n)
  } catch {
    return 0 // sin tabla o sin `meta`
  }
}

export async function leerStatusDelPaquete(d: DependenciasDeStatus): Promise<DatosDeStatus> {
  const base = d.base
  const corto = (p: string) => acortarHome(p, d.homes)
  if (base.modo === 'daemon') {
    return {
      ...VACIO, modo: 'daemon', sinConteos: true, resumen: 'Nest owns this memory',
      filas: [{ marca: 'ok', etiqueta: 'Nest', detalle: 'open here — it owns this memory and syncs it live' }],
    }
  }
  if (base.modo === 'propia' && base.nueva) {
    return { ...VACIO, vacia: true, guardadaEn: corto(pathDeBasePropia(d.home)), resumen: 'no memory yet' }
  }

  const db = d.abrirSoloLectura(base.path)
  try {
    const grupos = db.prepare(
      'SELECT type, scope, COUNT(*) AS c FROM observations WHERE deleted = 0 AND superseded_by IS NULL GROUP BY type, scope'
    ).all() as Array<{ type: string; scope: string; c: number }>
    const total = grupos.reduce((n, f) => n + f.c, 0)
    const porGrupo: Partial<Record<GrupoDeTipo, number>> = {}
    let deEquipo = 0
    for (const f of grupos) {
      const g = grupoDeTipo(f.type)
      porGrupo[g] = (porGrupo[g] ?? 0) + f.c
      if (f.scope === 'team') deEquipo += f.c
    }

    // La cola, con número y no con un ícono (P-R5 del spec).
    const enCola = (db.prepare(
      'SELECT COUNT(*) AS c FROM mutation_log WHERE pushed_at IS NULL AND blocked_reason IS NULL'
    ).get() as { c: number }).c
    const credencial = base.modo === 'propia' && d.llaveroDisponible ? d.credencial() : null
    const hayCredencial = credencial !== null
    // Con la base de Nest la sube Nest, con su credencial: el servicio sólo importa con la propia.
    const servicio = base.modo === 'propia' && hayCredencial ? d.urlDelServicio(credencial) : null

    // La época que el daemon vio en el último status: el mismo dato que arma el gate
    // fail-closed del push.
    let epocaConocida = 0
    try {
      epocaConocida = Number((db.prepare("SELECT value FROM meta WHERE key = 'known_key_epoch'").get() as { value?: string } | undefined)?.value ?? 0)
    } catch { /* una base sin `meta` todavía no vio ningún status */ }
    const tieneMaestra = d.llaveroDisponible ? d.tieneMaestra() : false
    const esperandoAutorizacion = hayCredencial && epocaConocida > 0 && !tieneMaestra
    // Época 0 y sin maestra: el daemon no sube (`needs_encryption_setup`) hasta que `login` active.
    const necesitaActivarCifrado = hayCredencial && epocaConocida === 0 && !tieneMaestra
    const marcaDeSync: Marca = !hayCredencial && base.modo === 'propia' ? 'nada'
      : esperandoAutorizacion || necesitaActivarCifrado ? 'aviso'
      : enCola > 0 ? 'pendiente'
      : 'ok'
    const filas: FilaDeEstado[] = [{
      marca: marcaDeSync, etiqueta: 'Sync',
      detalle: lineaDeSync({ modo: base.modo, enCola, hayCredencial, esperandoAutorizacion, necesitaActivarCifrado }),
    }]
    const upgrade = lineaDeUpgradeDeStatus({ modo: base.modo, hayCredencial, db, urlUpgrade: d.urlUpgrade })
    if (upgrade) filas.push({ marca: 'aviso', etiqueta: 'Upgrade', detalle: upgrade })
    if (base.modo === 'propia' && hayCredencial && epocaConocida > 0) {
      filas.push({
        marca: tieneMaestra ? 'ok' : 'aviso', etiqueta: 'Encrypted',
        detalle: tieneMaestra ? 'end to end — this machine holds the key' : 'end to end — this machine is not authorized yet',
      })
    }
    // Lo que el gate retuvo por falta de clave de equipo: `enCola` no lo cuenta.
    const retenidas = (db.prepare(
      `SELECT payload FROM mutation_log WHERE pushed_at IS NULL
         AND blocked_reason IN (${TEAM_KEY_HOLD_REASONS.map(() => '?').join(',')})`
    ).all(...TEAM_KEY_HOLD_REASONS) as Array<{ payload: string }>).filter(({ payload }) => {
      try { return (JSON.parse(payload) as { scope?: unknown }).scope === 'team' } catch { return false }
    }).length
    const retenidoDeEquipo = lineaDeEquipoRetenido({ modo: base.modo, retenidas })
    if (retenidoDeEquipo) filas.push({ marca: 'aviso', etiqueta: 'Team', detalle: retenidoDeEquipo })

    const ilegiblesDeEquipo = contarIlegiblesDeEquipo(db)
    if (ilegiblesDeEquipo > 0) {
      filas.push({
        marca: 'aviso', etiqueta: 'Team',
        detalle: `${ilegiblesDeEquipo} encrypted for your team — this machine doesn't have the team key yet`,
      })
    }

    const resumen = necesitaActivarCifrado ? 'needs encryption setup'
      : esperandoAutorizacion ? 'this machine is not authorized yet'
      : marcaDeSync === 'nada' ? 'local only'
      : enCola > 0 ? `${enCola} waiting to sync`
      : 'synced'

    return {
      modo: base.modo, vacia: false, total, porGrupo,
      personal: total - deEquipo, deEquipo,
      guardadaEn: corto(base.path), servicio, filas, ilegiblesDeEquipo,
      recientes: contextObservations(db, null, GLOBAL_PROJECT_KEY, 3),
      resumen,
    }
  } finally {
    db.close()
  }
}
