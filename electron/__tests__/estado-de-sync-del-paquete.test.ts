import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'
import { MemoryStore } from '../memory-store'
import { abrirSoloLecturaConBetterSqlite3 } from '../sqlite-better'
import { MOTIVO_TOPE_DE_PROYECTOS } from '../memory-daemon'
import {
  lineaDeSync, lineaDeEquipoRetenido,
  lineaDeUpgrade, motivoDeUpgrade, errorDeCuentaDelDaemon, leerDatosDeUpgrade, bloqueadasPorTope,
  lineaDeUpgradeDeStatus, avisadorDeUpgradeDelMcp,
  MAQUINAS_POR_PLAN, PRECIO_CLOUD_MENSUAL,
} from '../estado-de-sync-del-paquete'

const base = { modo: 'propia' as const, enCola: 0, hayCredencial: true }

// Review final de rama, A: "conectado pero sin servicio configurado" se borró de acá — era
// un caso MUERTO. `servicioDelPaquete` (desde 5dc84c5) siempre resuelve a algo (env, lo
// guardado, o el default de Nest), y el único caller de `lineaDeSync` (`comandoStatus` en
// cli-del-paquete.ts) ya pasaba `hayServicio: true` fijo — el `false` no lo producía nada.
describe('lineaDeSync', () => {
  it('con la base de Nest, sincroniza Nest — nunca el paquete', () => {
    expect(lineaDeSync({ ...base, modo: 'nest', enCola: 3 })).toBe('3 changes waiting for Nest to sync them.')
    expect(lineaDeSync({ ...base, modo: 'nest' })).toMatch(/Nest syncs/)
  })

  it('sin cuenta dice cuántos esperan y cómo conectarse', () => {
    expect(lineaDeSync({ ...base, hayCredencial: false, enCola: 1 })).toBe('Local only — 1 change queued. Run `npx @nestmux/memory login` to sync them.')
    expect(lineaDeSync({ ...base, hayCredencial: false })).toMatch(/^Local only\. Run `npx @nestmux\/memory login`/)
  })

  it('cuenta cifrada y máquina sin autorizar: NO promete que va a subir — falta autorizarla', () => {
    // Visto contra el servicio real el 2026-10-02: el gate fail-closed frena el push (bien) y
    // `status` decía «They go up the next time an agent saves a memory», que es falso. Quien
    // lo leía se quedaba esperando un sync que no iba a pasar nunca.
    const linea = lineaDeSync({ ...base, enCola: 1, esperandoAutorizacion: true })
    expect(linea).toMatch(/^Connected — 1 change held until this machine is authorized/)
    expect(linea).toMatch(/npx @nestmux\/memory login/)
    expect(linea).not.toMatch(/next time an agent saves/)
  })

  it('cuenta sin cifrado activado: dice que la nube está en pausa y cómo activarlo', () => {
    const linea = lineaDeSync({ ...base, enCola: 2, necesitaActivarCifrado: true })
    expect(linea).toBe('Cloud sync is paused until encryption is on. Run `npx @nestmux/memory login` to turn it on.')
  })

  it('conectado: la cola, o que está todo arriba', () => {
    expect(lineaDeSync({ ...base, enCola: 5 })).toMatch(/^Connected — 5 changes waiting to sync/)
    expect(lineaDeSync(base)).toBe('Connected — everything is synced.')
  })
})

// Follow-up del handoff 2026-10-15: el paquete no tiene claves de equipo, así que lo de un
// equipo que cifra queda retenido. Con la base propia nadie más lo va a subir: hay que decirlo.
describe('lineaDeEquipoRetenido', () => {
  // No promete que "abrir Nest" las suba: al instalar Nest, `decidirBase` pasa a la base de
  // Nest y la propia no la lee nadie más.
  it('con la base propia y memorias de equipo retenidas, dice cuántas y que se quedan acá', () => {
    expect(lineaDeEquipoRetenido({ modo: 'propia', retenidas: 2 }))
      .toBe('2 team memories stay on this machine only: this team encrypts, and team keys live in the Nest app, not in this package.')
    expect(lineaDeEquipoRetenido({ modo: 'propia', retenidas: 1 })).toMatch(/^1 team memory stays on this machine only/)
    expect(lineaDeEquipoRetenido({ modo: 'propia', retenidas: 2 })).not.toMatch(/open nest/i)
  })

  it('sin retenidas no dice nada', () => {
    expect(lineaDeEquipoRetenido({ modo: 'propia', retenidas: 0 })).toBeNull()
  })

  // La base de Nest la sube Nest, que sí tiene la clave de equipo (y su tarjeta ya lo cuenta).
  it('con la base de Nest no dice nada', () => {
    expect(lineaDeEquipoRetenido({ modo: 'nest', retenidas: 3 })).toBeNull()
  })
})

const URL_UP = 'https://nestmux.com/upgrade'

describe('lineaDeUpgrade (spec login sin Nest §2)', () => {
  it('plan_required y project_limit_reached: el texto del spec con el link', () => {
    const esperado = 'Upgrade to Cloud ($15/mo) to sync every project: https://nestmux.com/upgrade'
    expect(lineaDeUpgrade('plan_required', URL_UP)).toBe(esperado)
    expect(lineaDeUpgrade('project_limit_reached', URL_UP)).toBe(esperado)
  })

  it('device_limit_reached dice cuántas máquinas permite cada plan y apunta al mismo link', () => {
    const linea = lineaDeUpgrade('device_limit_reached', URL_UP)
    expect(linea).toMatch(/Free: 3, Cloud: 10/)
    expect(linea).toMatch(/https:\/\/nestmux\.com\/upgrade$/)
  })

  // Ruling P3: el cliente no sabe el plan cuando choca con el tope de máquinas, y a una cuenta
  // Cloud ya llena no se le puede decir «pasate a Cloud»: lo suyo es sacar una máquina.
  it('device_limit_reached no le ofrece Cloud a quien ya lo tiene: a Cloud le dice que saque una máquina', () => {
    const linea = lineaDeUpgrade('device_limit_reached', URL_UP)
    expect(linea).not.toMatch(/^Upgrade to Cloud/)
    expect(linea).toMatch(/On Cloud, remove a machine/)
    expect(linea).toMatch(/On Free, upgrade to Cloud \(\$15\/mo\)/)
  })

  it('los números espejan al servidor y al precio de la app', () => {
    const limites = readFileSync(join(__dirname, '../../server/src/limits.ts'), 'utf8')
    expect(Number(/const FREE[\s\S]*?maxDevices:\s*(\d+)/.exec(limites)![1])).toBe(MAQUINAS_POR_PLAN.free)
    expect(Number(/const CLOUD[\s\S]*?maxDevices:\s*(\d+)/.exec(limites)![1])).toBe(MAQUINAS_POR_PLAN.cloud)
    const stripe = readFileSync(join(__dirname, '../../src/lib/stripe.ts'), 'utf8')
    expect(Number(/CLOUD_MONTHLY_PRICE\s*=\s*(\d+)/.exec(stripe)![1])).toBe(PRECIO_CLOUD_MENSUAL)
  })
})

describe('motivoDeUpgrade', () => {
  it('lo que guardó el daemon gana; si no, lo retenido por el tope de proyectos', () => {
    expect(motivoDeUpgrade({ ultimoError: 'plan_required', bloqueadasPorTope: 0 })).toBe('plan_required')
    expect(motivoDeUpgrade({ ultimoError: 'device_limit_reached', bloqueadasPorTope: 2 })).toBe('device_limit_reached')
    expect(motivoDeUpgrade({ ultimoError: null, bloqueadasPorTope: 2 })).toBe('project_limit_reached')
    expect(motivoDeUpgrade({ ultimoError: 'fetch failed', bloqueadasPorTope: 0 })).toBeNull()
  })

  it('el estado del daemon que se persiste', () => {
    expect(errorDeCuentaDelDaemon('plan_required')).toBe('plan_required')
    expect(errorDeCuentaDelDaemon('error', 'device_limit')).toBe('device_limit_reached')
    expect(errorDeCuentaDelDaemon('error', 'not_in_beta')).toBeNull()
    expect(errorDeCuentaDelDaemon('idle')).toBeNull()
  })
})

describe('bloqueadasPorTope', () => {
  it('cuenta sólo lo retenido por el tope de proyectos que no subió', () => {
    expect(bloqueadasPorTope([
      { blocked_reason: 'project_limit_reached', pushed_at: null },
      { blocked_reason: 'project_limit_reached', pushed_at: null },
      { blocked_reason: 'project_limit_reached', pushed_at: 123 },
      { blocked_reason: 'team_key_missing', pushed_at: null },
      { blocked_reason: null, pushed_at: null },
    ])).toBe(2)
  })
})

/** Una base real con el esquema del store: lo que `status` abre en sólo lectura. */
function conBase(fn: (store: MemoryStore, dbPath: string) => void): void {
  const dir = makeTmpDir('nest-upgrade-')
  const dbPath = join(dir, 'memory.db')
  const store = new MemoryStore(dbPath)
  try { fn(store, dbPath) } finally { store.close(); cleanupTmp(dir) }
}

/** Una escritura retenida por el tope, como la deja el daemon tras el rechazo del servidor. */
function retenerPorTope(store: MemoryStore): void {
  store.ensureProject({ projectKey: 'k-api', displayName: 'api' })
  store.save({ projectKey: 'k-api', scope: 'personal', type: 'decision', title: 't', content: 'c', source: 'mcp' })
  const [m] = store.pendingMutations()
  store.blockMutations([{ seq: m!.seq, reason: MOTIVO_TOPE_DE_PROYECTOS }])
}

describe('leerDatosDeUpgrade', () => {
  it('lee el error de cuenta y cuenta lo retenido por el tope', () => {
    conBase((store, dbPath) => {
      store.setSyncState('__account__', { lastError: 'plan_required' })
      const db = abrirSoloLecturaConBetterSqlite3(dbPath)
      try {
        expect(leerDatosDeUpgrade(db)).toEqual({ ultimoError: 'plan_required', bloqueadasPorTope: 0 })
      } finally { db.close() }
      retenerPorTope(store)
      const db2 = abrirSoloLecturaConBetterSqlite3(dbPath)
      try {
        expect(leerDatosDeUpgrade(db2).bloqueadasPorTope).toBe(1)
      } finally { db2.close() }
    })
  })

  it('una base sin las tablas devuelve nada que avisar, no lanza', () => {
    const roto = { prepare: () => { throw new Error('no such table') } }
    expect(leerDatosDeUpgrade(roto)).toEqual({ ultimoError: null, bloqueadasPorTope: 0 })
  })

  it('el motivo del tope es el mismo literal que usa el daemon', () => {
    expect(MOTIVO_TOPE_DE_PROYECTOS).toBe('project_limit_reached')
  })
})

// Ruling P4: el cableado de `status` (qué base, con qué credencial, qué fila) se prueba acá,
// no sólo las piezas sueltas.
describe('lineaDeUpgradeDeStatus', () => {
  it('con la base propia y credencial: la línea del error que guardó el daemon', () => {
    conBase((store, dbPath) => {
      store.setSyncState('__account__', { lastError: 'device_limit_reached' })
      const db = abrirSoloLecturaConBetterSqlite3(dbPath)
      try {
        expect(lineaDeUpgradeDeStatus({ modo: 'propia', hayCredencial: true, db, urlUpgrade: URL_UP }))
          .toBe(lineaDeUpgrade('device_limit_reached', URL_UP))
      } finally { db.close() }
    })
  })

  it('lo retenido por el tope de proyectos también avisa', () => {
    conBase((store, dbPath) => {
      retenerPorTope(store)
      const db = abrirSoloLecturaConBetterSqlite3(dbPath)
      try {
        expect(lineaDeUpgradeDeStatus({ modo: 'propia', hayCredencial: true, db, urlUpgrade: URL_UP }))
          .toBe(lineaDeUpgrade('project_limit_reached', URL_UP))
      } finally { db.close() }
    })
  })

  it('sin nada que avisar, con la base de Nest o sin credencial: nada', () => {
    conBase((store, dbPath) => {
      const db = abrirSoloLecturaConBetterSqlite3(dbPath)
      try {
        expect(lineaDeUpgradeDeStatus({ modo: 'propia', hayCredencial: true, db, urlUpgrade: URL_UP })).toBeNull()
        store.setSyncState('__account__', { lastError: 'plan_required' })
        // La base de Nest la sube Nest con SU cuenta; sin credencial no hay cuenta que mejorar.
        expect(lineaDeUpgradeDeStatus({ modo: 'nest', hayCredencial: true, db, urlUpgrade: URL_UP })).toBeNull()
        expect(lineaDeUpgradeDeStatus({ modo: 'propia', hayCredencial: false, db, urlUpgrade: URL_UP })).toBeNull()
      } finally { db.close() }
    })
  })
})

// Ruling P4: el cableado del MCP — de dónde saca el motivo y cuántas veces lo dice.
describe('avisadorDeUpgradeDelMcp', () => {
  function armar() {
    const estado: {
      status: string
      detalle?: string
      filas: Array<{ blocked_reason: string | null; pushed_at: number | null }>
    } = { status: 'idle', filas: [] }
    const impreso: string[] = []
    const avisar = avisadorDeUpgradeDelMcp({
      daemon: { getStatus: () => estado.status, getStatusDetail: () => estado.detalle },
      store: { blockedMutations: () => estado.filas },
      urlUpgrade: URL_UP,
      imprimir: (l) => { impreso.push(l) },
    })
    return { estado, impreso, avisar }
  }

  it('sin límite no dice nada', () => {
    const { impreso, avisar } = armar()
    avisar()
    expect(impreso).toEqual([])
  })

  it('una vez por motivo y por sesión, con el prefijo del MCP', () => {
    const { estado, impreso, avisar } = armar()
    estado.status = 'plan_required'
    avisar()
    avisar()
    expect(impreso).toEqual([`[nest-memory] ${lineaDeUpgrade('plan_required', URL_UP)}`])
    estado.status = 'error'
    estado.detalle = 'device_limit'
    avisar()
    avisar()
    expect(impreso).toEqual([
      `[nest-memory] ${lineaDeUpgrade('plan_required', URL_UP)}`,
      `[nest-memory] ${lineaDeUpgrade('device_limit_reached', URL_UP)}`,
    ])
  })

  it('lo retenido por el tope, leído del store, avisa con el motivo del tope', () => {
    const { estado, impreso, avisar } = armar()
    estado.filas = [{ blocked_reason: MOTIVO_TOPE_DE_PROYECTOS, pushed_at: null }]
    avisar()
    expect(impreso).toEqual([`[nest-memory] ${lineaDeUpgrade('project_limit_reached', URL_UP)}`])
  })
})
