// La línea de `npx @nestmux/memory status` sobre la nube. Aparte de la CLI para poder probarla:
// `cli-del-paquete.ts` corre el comando apenas se importa.
import { comando } from './nombre-del-paquete'

/**
 * Qué decir sobre la nube en `status`. Las cuatro situaciones piden cosas distintas, y por eso
 * no se colapsan en «sincronizado / no sincronizado».
 */
export function lineaDeSync(e: {
  modo: 'nest' | 'propia'
  enCola: number
  hayCredencial: boolean
  /** La cuenta cifra y esta máquina todavía no tiene la maestra: el push está frenado (el
   *  gate fail-closed del daemon) hasta que la autoricen. */
  esperandoAutorizacion?: boolean
  /** La cuenta todavía no cifra y esta máquina no tiene maestra: el push está frenado
   *  (`needs_encryption_setup`) hasta que `login` active el cifrado. */
  necesitaActivarCifrado?: boolean
}): string {
  const cambios = `${e.enCola} ${e.enCola === 1 ? 'change' : 'changes'}`
  // La base de Nest la sincroniza Nest: el paquete no la sube con su credencial porque
  // podría ser de otra cuenta (ver `comandoMcp`).
  if (e.modo === 'nest') {
    return e.enCola > 0 ? `${cambios} waiting for Nest to sync them.` : 'Nest syncs this memory when it runs.'
  }
  if (!e.hayCredencial) {
    return e.enCola > 0
      ? `Local only — ${cambios} queued. Run \`${comando('login')}\` to sync them.`
      : `Local only. Run \`${comando('login')}\` to sync across machines.`
  }
  // `servicioDelPaquete` siempre resuelve a algo — env, lo guardado, o el default de Nest —
  // así que "sin servicio configurado" no es un estado alcanzable acá.
  // Va ANTES de la cola normal: con la cuenta cifrada y sin la maestra no sube nada, así que
  // prometer que sube «la próxima vez» deja al usuario esperando algo que no va a pasar.
  if (e.necesitaActivarCifrado) {
    return `Cloud sync is paused until encryption is on. Run \`${comando('login')}\` to turn it on.`
  }
  if (e.esperandoAutorizacion) {
    return `Connected — ${cambios} held until this machine is authorized to encrypt. ` +
      `Run \`${comando('login')}\` to see its fingerprint.`
  }
  return e.enCola > 0
    ? `Connected — ${cambios} waiting to sync. They go up the next time an agent saves a memory.`
    : 'Connected — everything is synced.'
}

/**
 * El paquete no tiene claves de equipo: una memoria de un equipo que cifra la retiene el gate
 * del daemon (`team_key_missing`). Con la base de Nest no importa —la sube Nest, que sí tiene
 * la clave—, pero con la base propia no la sube nadie: ni el paquete, ni Nest si después se
 * instala, porque `decidirBase` pasa a la base de Nest y la propia queda sin leer. Por eso la
 * línea dice que se quedan acá y no promete que "abrir Nest" las mande.
 */
export function lineaDeEquipoRetenido(e: { modo: 'nest' | 'propia'; retenidas: number }): string | null {
  if (e.modo !== 'propia' || e.retenidas <= 0) return null
  const cuantas = e.retenidas === 1 ? '1 team memory stays' : `${e.retenidas} team memories stay`
  return `${cuantas} on this machine only: this team encrypts, and team keys live in the Nest app, not in this package.`
}

// ── Upgrade (spec 2026-11-02-login-y-compra-sin-nest §2) ─────────────────────────────

export type MotivoDeUpgrade = 'plan_required' | 'project_limit_reached' | 'device_limit_reached'

/**
 * Espejo, sólo para el copy, del tope de máquinas de `server/src/limits.ts`. Un test lee ese
 * archivo como texto y falla si se separan. El cliente no sabe el plan cuando choca con el
 * tope (el status también contesta 403), por eso el texto nombra los dos.
 */
export const MAQUINAS_POR_PLAN = { free: 3, cloud: 10 } as const

/** Espejo de `CLOUD_MONTHLY_PRICE` (`src/lib/stripe.ts`); mismo test. */
export const PRECIO_CLOUD_MENSUAL = 15

/**
 * `MOTIVO_TOPE_DE_PROYECTOS` del daemon. No se importa: este archivo no carga el daemon
 * entero. Un test los compara.
 */
const MOTIVO_TOPE = 'project_limit_reached'

/** Lo que del estado del daemon vale guardar para que `status` lo cuente sin red. */
export function errorDeCuentaDelDaemon(status: string, detalle?: string): 'plan_required' | 'device_limit_reached' | null {
  if (status === 'plan_required') return 'plan_required'
  if (status === 'error' && detalle === 'device_limit') return 'device_limit_reached'
  return null
}

export function motivoDeUpgrade(e: { ultimoError: string | null; bloqueadasPorTope: number }): MotivoDeUpgrade | null {
  if (e.ultimoError === 'plan_required' || e.ultimoError === 'device_limit_reached') return e.ultimoError
  if (e.bloqueadasPorTope > 0) return 'project_limit_reached'
  return null
}

export function lineaDeUpgrade(motivo: MotivoDeUpgrade, urlUpgrade: string): string {
  if (motivo === 'device_limit_reached') {
    // Sin el plan no se le puede decir «pasate a Cloud» a una cuenta que ya es Cloud: a esa
    // le toca sacar una máquina. Por eso el texto les habla a los dos planes por separado.
    return `This account syncs the most machines its plan allows ` +
      `(Free: ${MAQUINAS_POR_PLAN.free}, Cloud: ${MAQUINAS_POR_PLAN.cloud}). ` +
      `On Cloud, remove a machine in Nest › Settings › Account. ` +
      `On Free, upgrade to Cloud ($${PRECIO_CLOUD_MENSUAL}/mo) for up to ${MAQUINAS_POR_PLAN.cloud}: ${urlUpgrade}`
  }
  return `Upgrade to Cloud ($${PRECIO_CLOUD_MENSUAL}/mo) to sync every project: ${urlUpgrade}`
}

/** Una fila del `mutation_log`, con lo justo para saber si la retiene el tope de proyectos. */
export interface FilaRetenida {
  blocked_reason: string | null
  pushed_at: number | null
}

/**
 * Cuántas escrituras retiene el tope de proyectos. La ÚNICA definición: `status` le pasa las
 * filas que lee de la base y el MCP las de `MemoryStore.blockedMutations()`.
 */
export function bloqueadasPorTope(filas: readonly FilaRetenida[]): number {
  return filas.filter((f) => f.pushed_at === null && f.blocked_reason === MOTIVO_TOPE).length
}

/** Lo mínimo de una base que hace falta para leer: lo cumplen `node:sqlite` y better-sqlite3. */
export interface LectorSql {
  prepare(sql: string): { get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] }
}

/**
 * De la base: el error de cuenta que guardó el daemon y cuántas escrituras retiene el tope de
 * proyectos. Una base vieja sin alguna de las tablas no tiene nada que avisar — nunca lanza.
 */
export function leerDatosDeUpgrade(db: LectorSql): { ultimoError: string | null; bloqueadasPorTope: number } {
  let ultimoError: string | null = null
  try {
    const fila = db.prepare("SELECT last_error FROM sync_state WHERE partition_key = '__account__'").get() as
      | { last_error?: string | null } | undefined
    ultimoError = fila?.last_error ?? null
  } catch { /* sin `sync_state` todavía */ }
  let retenidas = 0
  try {
    retenidas = bloqueadasPorTope(db.prepare(
      'SELECT blocked_reason, pushed_at FROM mutation_log WHERE blocked_reason IS NOT NULL'
    ).all() as FilaRetenida[])
  } catch { /* sin `mutation_log` todavía */ }
  return { ultimoError, bloqueadasPorTope: retenidas }
}

/**
 * La fila «Upgrade» de `status`, o null. Sólo con la base propia y credencial: la base de Nest
 * la sube Nest con SU cuenta, y sin credencial no hay cuenta que mejorar.
 */
export function lineaDeUpgradeDeStatus(e: {
  modo: 'nest' | 'propia'
  hayCredencial: boolean
  db: LectorSql
  urlUpgrade: string
}): string | null {
  if (e.modo !== 'propia' || !e.hayCredencial) return null
  const motivo = motivoDeUpgrade(leerDatosDeUpgrade(e.db))
  return motivo ? lineaDeUpgrade(motivo, e.urlUpgrade) : null
}

/**
 * El aviso del MCP: lo que corre `SyncDelMcp` al terminar cada operación. El motivo sale del
 * estado en memoria del daemon (el de esta misma sesión) y de lo que el store retiene por el
 * tope. Un aviso por motivo y por sesión: repetirlo en cada escritura llenaría el log del
 * editor. Quien llama decide dónde imprime — stderr, porque stdout es el protocolo.
 */
export function avisadorDeUpgradeDelMcp(d: {
  daemon: { getStatus(): string; getStatusDetail(): string | undefined }
  store: { blockedMutations(): readonly FilaRetenida[] }
  urlUpgrade: string
  imprimir: (linea: string) => void
}): () => void {
  const avisados = new Set<MotivoDeUpgrade>()
  return () => {
    const motivo = motivoDeUpgrade({
      ultimoError: errorDeCuentaDelDaemon(d.daemon.getStatus(), d.daemon.getStatusDetail()),
      bloqueadasPorTope: bloqueadasPorTope(d.store.blockedMutations()),
    })
    if (!motivo || avisados.has(motivo)) return
    avisados.add(motivo)
    d.imprimir(`[nest-memory] ${lineaDeUpgrade(motivo, d.urlUpgrade)}`)
  }
}
