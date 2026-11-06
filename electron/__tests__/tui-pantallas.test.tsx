// Las pantallas Ink de la TUI contra una fuente falsa: lo que se dibuja y lo que piden las teclas.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'
import ts from 'typescript'
import { cargarInk } from '../tui-del-paquete/ink'
import { App } from '../tui-del-paquete/app'
import type { FuenteDeLaTui } from '../tui-del-paquete/fuente'
import type { ObservationSummary } from '../memory-protocol'
import type { DatosDeStatus } from '../status-del-paquete'
import type { DatosDeDoctor } from '../doctor-del-paquete'
import type { DetalleDeMemoria } from '../tui-del-paquete/estado'
import { leerDetalle } from '../tui-del-paquete/fuente-comun'
import { statusDeNest } from '../tui-del-paquete/status-de-nest'

const ahora = Date.now()
const mem = (syncId: string, title: string, type: ObservationSummary['type'], content: string, horas: number): ObservationSummary => ({
  syncId, title, type, content, topicKey: null, tags: ['sync'], updatedAt: ahora - horas * 3_600_000,
  originAi: null, gitBranch: null,
})

const MEMORIAS = [
  mem('a', 'Encryption is mandatory on connect', 'decision', 'Short…', 2),
  mem('b', 'Stale guard orders like resolveLWW', 'bugfix', 'Short…', 3),
  mem('c', 'Link codes survive OAuth via link_code', 'pattern', 'Short…', 30),
]

const STATUS: DatosDeStatus = {
  modo: 'propia', vacia: false, total: 1284, porGrupo: { decisions: 3 }, porTipo: { decision: 3 }, personal: 1280, deEquipo: 4,
  guardadaEn: '~/.nest/memory.db', servicio: 'https://sync.example',
  filas: [
    { marca: 'ok', etiqueta: 'Sync', detalle: 'up to date' },
    { marca: 'aviso', etiqueta: 'Encrypted', detalle: 'Encrypting… 3 left' },
  ],
  ilegiblesDeEquipo: 0, recientes: [], resumen: 'synced',
}

const DOCTOR: DatosDeDoctor = {
  filas: [{ marca: 'ok', etiqueta: 'Node', detalle: 'v22.12.0' }],
  homeDeNest: false,
  bloqueadas: [{ syncId: 'a', titulo: 'Encryption is mandatory on connect', motivo: 'team_key_missing' }],
  problemas: 0, avisos: 1,
}

function fuenteFalsa(opts: { memorias?: ObservationSummary[]; contenido?: string } = {}) {
  const memorias = opts.memorias ?? MEMORIAS
  const llamadas: string[] = []
  const fuente: FuenteDeLaTui = {
    proyecto: () => 'raven-nest',
    recientes: async () => { llamadas.push('recientes'); return memorias },
    buscar: async (q) => {
      llamadas.push(`buscar:${q}`)
      return memorias.filter((m) => m.title.toLowerCase().includes(q.toLowerCase()))
    },
    obtener: async (id): Promise<DetalleDeMemoria | null> => {
      llamadas.push(`obtener:${id}`)
      const m = memorias.find((x) => x.syncId === id)
      return m ? { item: { ...m, content: opts.contenido ?? `The full body of ${m.title}.` }, resolvedLinks: [], pendingLinks: [] } : null
    },
    guardar: async () => {},
    actualizar: async () => {},
    borrar: async () => {},
    status: async () => STATUS,
    doctor: async () => DOCTOR,
    cerrar: () => {},
  }
  return { fuente, llamadas }
}

const suspender = async () => ({ tipo: 'limpiar-aviso' as const })
/** Deja correr las promesas resueltas y el re-render. */
const tic = () => new Promise<void>((r) => setImmediate(r))
async function hasta(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !cond(); i++) await tic()
}

const ESC = '\u001B'

// En vitest el `import()` de `new Function` no tiene callback: se le pasa uno de vitest. El
// camino nativo lo prueba `cargarInk carga Ink de verdad desde CommonJS`, en un node aparte.
beforeAll(() => cargarInk((m) => import(m)))
afterEach(() => { vi.useRealTimers() })

describe('pantallas de la TUI', () => {
  it('Recent dibuja las 3 filas con su tipo y la barra de teclas', async () => {
    const { fuente } = fuenteFalsa()
    const r = render(<App fuente={fuente} ancho={100} suspenderYEditar={suspender} />)
    await hasta(() => !!r.lastFrame()?.includes('Link codes'))
    const f = r.lastFrame()!
    expect(f).toContain('> nest memory_ · raven-nest')
    expect(f).toContain('Decision')
    expect(f).toContain('Bugfix')
    expect(f).toContain('Encryption is mandatory on connect')
    expect(f).toContain('Stale guard orders like resolveLWW')
    expect(f).toContain('n new')
    expect(f).toContain('2h ago')
    await hasta(() => !!r.lastFrame()?.includes('1,284 items'))
    expect(r.lastFrame()).toContain('● synced · 1,284 items')
    r.unmount()
  })

  it('con 50 columnas no hay fecha; con 39 dice Window too narrow', async () => {
    const { fuente } = fuenteFalsa()
    const r = render(<App fuente={fuente} ancho={50} suspenderYEditar={suspender} />)
    await hasta(() => !!r.lastFrame()?.includes('bugfix'))
    expect(r.lastFrame()).not.toContain('2h ago')
    r.unmount()

    const r2 = render(<App fuente={fuente} ancho={39} suspenderYEditar={suspender} />)
    await tic()
    expect(r2.lastFrame()).toContain('Window too narrow')
    r2.unmount()
  })

  it('escribir "enc" en Search filtra a los 150 ms', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { fuente, llamadas } = fuenteFalsa()
    const r = render(<App fuente={fuente} ancho={100} suspenderYEditar={suspender} />)
    await hasta(() => !!r.lastFrame()?.includes('Link codes'))
    r.stdin.write('/')
    await tic()
    for (const c of 'enc') { r.stdin.write(c); await tic() }
    await vi.advanceTimersByTimeAsync(149)
    expect(llamadas.filter((l) => l.startsWith('buscar'))).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(llamadas.filter((l) => l.startsWith('buscar'))).toEqual(['buscar:enc'])
    await hasta(() => !r.lastFrame()?.includes('Searching'))
    const f = r.lastFrame()!
    expect(f).toContain('enc')
    expect(f).toContain('Encryption is mandatory on connect')
    expect(f).not.toContain('Stale guard')
    r.unmount()
  })

  it('borrar toda la consulta cancela la búsqueda pendiente y no busca ""', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { fuente, llamadas } = fuenteFalsa()
    const r = render(<App fuente={fuente} ancho={100} suspenderYEditar={suspender} />)
    await hasta(() => !!r.lastFrame()?.includes('Link codes'))
    r.stdin.write('/')
    await tic()
    r.stdin.write('e')
    await tic()
    r.stdin.write('\u007F') // backspace
    await tic()
    await vi.advanceTimersByTimeAsync(500)
    expect(llamadas.filter((l) => l.startsWith('buscar'))).toEqual([])
    r.unmount()
  })

  it('⏎ abre el detalle con el contenido completo de memory.get', async () => {
    const { fuente, llamadas } = fuenteFalsa()
    const r = render(<App fuente={fuente} ancho={100} suspenderYEditar={suspender} />)
    await hasta(() => !!r.lastFrame()?.includes('Link codes'))
    r.stdin.write('\r')
    await hasta(() => !!r.lastFrame()?.includes('The full body'))
    const f = r.lastFrame()!
    expect(llamadas).toContain('obtener:a')
    expect(f).toContain('The full body of Encryption is mandatory on connect.')
    expect(f).not.toContain('Short…')
    expect(f).toContain('2h ago')
    r.stdin.write(ESC)
    await hasta(() => !!r.lastFrame()?.includes('Stale guard'))
    expect(r.lastFrame()).not.toContain('The full body')
    r.unmount()
  })

  it('un daemon viejo sin resolvedLinks/pendingLinks: el detalle con [[…]] se dibuja sin reventar', async () => {
    const { fuente } = fuenteFalsa()
    // `memory.get` de un Nest anterior a los wikilinks: sólo `item`.
    const viejo = { call: async () => ({ item: { ...MEMORIAS[0]!, content: 'Body that points to [[Stale guard]] here.' } }) }
    fuente.obtener = (id) => leerDetalle(viejo, '/tmp/r', id)
    const r = render(<App fuente={fuente} ancho={100} suspenderYEditar={suspender} />)
    await hasta(() => !!r.lastFrame()?.includes('Link codes'))
    r.stdin.write('\r')
    await hasta(() => !!r.lastFrame()?.includes('Body that points'))
    expect(r.lastFrame()).toContain('Body that points to [[Stale guard]] here.')
    r.stdin.write('\t') // pasar por los links no puede romper con la lista vacía
    await tic()
    expect(r.lastFrame()).toContain('Body that points')
    r.unmount()
  })

  it('Status pinta las filas de DatosDeStatus y Doctor pinta lo bloqueado', async () => {
    const { fuente } = fuenteFalsa()
    const r = render(<App fuente={fuente} ancho={100} suspenderYEditar={suspender} />)
    await hasta(() => !!r.lastFrame()?.includes('Link codes'))
    r.stdin.write('3')
    await hasta(() => !!r.lastFrame()?.includes('Encrypting'))
    let f = r.lastFrame()!
    expect(f).toContain('Sync')
    expect(f).toContain('up to date')
    expect(f).toContain('Encrypting… 3 left')
    r.stdin.write('4')
    await hasta(() => !!r.lastFrame()?.includes('BLOCKED'))
    f = r.lastFrame()!
    expect(f).toContain('v22.12.0')
    expect(f).toContain('team_key_missing')
    expect(f).toContain('1 warning')
    r.unmount()
  })

  it('Status con Nest abierto pinta los conteos, los conflictos y las sesiones', async () => {
    const { fuente } = fuenteFalsa()
    fuente.status = async () => statusDeNest({
      total: 40, byType: { decision: 30, bugfix: 10 }, team: 5, pending: 0,
      sync: { status: 'idle', detail: null, plaintextPending: 0 },
      conflicts: 2, sessions: { writing: 1, silent: 1, disabled: 0 },
    })
    const r = render(<App fuente={fuente} ancho={100} suspenderYEditar={suspender} />)
    await hasta(() => !!r.lastFrame()?.includes('40 items'))
    r.stdin.write('3')
    await hasta(() => !!r.lastFrame()?.includes('Conflicts'))
    const f = r.lastFrame()!
    expect(f).toContain('40 memories')
    expect(f).toContain('personal 35 · team 5')
    expect(f).toContain("2 in the vault's _conflicts")
    expect(f).toContain('1 silent · 1 writing')
    expect(f).not.toContain('STORED')
    r.unmount()
  })

  it('Recent vacía muestra el mensaje de bienvenida', async () => {
    const { fuente } = fuenteFalsa({ memorias: [] })
    const r = render(<App fuente={fuente} ancho={100} suspenderYEditar={suspender} />)
    await hasta(() => !!r.lastFrame()?.includes('No memories yet'))
    expect(r.lastFrame()).toContain('No memories yet. Agents save them through the MCP, or press n.')
    r.unmount()
  })

  it('n llama a suspenderYEditar y despacha lo que devuelve', async () => {
    const { fuente } = fuenteFalsa()
    const pedidos: unknown[] = []
    const editar = async (e: unknown) => { pedidos.push(e); return { tipo: 'escrito' as const, syncId: null } }
    const r = render(<App fuente={fuente} ancho={100} suspenderYEditar={editar} />)
    await hasta(() => !!r.lastFrame()?.includes('Link codes'))
    r.stdin.write('n')
    await hasta(() => !!r.lastFrame()?.includes('Saved'))
    expect(pedidos).toEqual([{ tipo: 'editar', syncId: null }])
    r.unmount()
  })
})

describe('pantallas de la TUI — bordes', () => {
  it('un párrafo largo se parte en filas: el cuadro no pasa la terminal y el scroll llega al final', async () => {
    const contenido = `${'lorem ipsum dolor '.repeat(70)}THE-END`
    expect(contenido.length).toBeGreaterThan(200)
    const { fuente } = fuenteFalsa({ contenido })
    const r = render(<App fuente={fuente} ancho={60} suspenderYEditar={suspender} />)
    await hasta(() => !!r.lastFrame()?.includes('Link codes'))
    r.stdin.write('\r')
    await hasta(() => !!r.lastFrame()?.includes('lorem'))
    // 24 filas: el alto por defecto cuando stdout no dice `rows`.
    expect(r.lastFrame()!.split('\n').length).toBeLessThanOrEqual(24)
    expect(r.lastFrame()).not.toContain('THE-END')
    for (let i = 0; i < 40; i++) { r.stdin.write('j'); await tic() }
    const f = r.lastFrame()!
    expect(f).toContain('THE-END')
    expect(f.split('\n').length).toBeLessThanOrEqual(24)
    // La barra sigue siendo la última fila, sin texto del contenido mezclado.
    expect(f.split('\n').at(-1)).toContain('esc back')
    r.unmount()
  })

  for (const [nombre, tecla] of [['Esc', ESC], ['Tab', '\t']] as const) {
    it(`${nombre} en Search cancela la búsqueda pendiente`, async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const { fuente, llamadas } = fuenteFalsa()
      fuente.buscar = async (q) => { llamadas.push(`buscar:${q}`); throw new Error('search exploded') }
      const r = render(<App fuente={fuente} ancho={100} suspenderYEditar={suspender} />)
      await hasta(() => !!r.lastFrame()?.includes('Link codes'))
      r.stdin.write('/')
      await tic()
      r.stdin.write('e')
      await tic()
      r.stdin.write(tecla)
      await tic()
      await vi.advanceTimersByTimeAsync(500)
      await tic()
      expect(llamadas.filter((l) => l.startsWith('buscar'))).toEqual([])
      expect(r.lastFrame()).not.toContain('search exploded')
      r.unmount()
    })
  }

  it('con 45 columnas el encabezado y las pestañas ocupan una fila cada uno', async () => {
    const { fuente } = fuenteFalsa()
    const r = render(<App fuente={fuente} ancho={45} suspenderYEditar={suspender} />)
    await hasta(() => !!r.lastFrame()?.includes('synced'))
    const filas = r.lastFrame()!.split('\n')
    expect(filas[0]).toContain('> nest memory_ · raven-nest')
    expect(filas[1]).toContain('4 Doctor')
    expect(filas[2]!.trim().startsWith('─')).toBe(true)
    expect(filas.length).toBeLessThanOrEqual(24)
    r.unmount()
  })

  it('un throw sincrónico de la fuente termina en un aviso, no en un rechazo suelto', async () => {
    const { fuente } = fuenteFalsa()
    fuente.recientes = () => { throw new Error('database is locked') }
    const r = render(<App fuente={fuente} ancho={100} suspenderYEditar={suspender} />)
    await hasta(() => !!r.lastFrame()?.includes('database is locked'))
    // En la barra, con la TUI viva: no en la pantalla de error de Ink.
    const filas = r.lastFrame()!.split('\n')
    expect(filas[0]).toContain('> nest memory_ · raven-nest')
    expect(filas.at(-1)).toContain('database is locked')
    r.unmount()
  })

  it('la lista nombra al agente que escribió cada memoria, y el detalle suma rama y agente', async () => {
    const conAgente = [
      { ...MEMORIAS[0]!, originAi: 'claude', gitBranch: 'feat/x' },
      { ...MEMORIAS[1]!, originAi: 'codex' },
      MEMORIAS[2]!,
    ]
    const { fuente } = fuenteFalsa({ memorias: conAgente })
    const r = render(<App fuente={fuente} ancho={100} suspenderYEditar={suspender} />)
    await hasta(() => !!r.lastFrame()?.includes('Link codes'))
    const f = r.lastFrame()!.split('\n')
    expect(f.find((l) => l.includes('Encryption is'))).toContain('◆ Claude')
    expect(f.find((l) => l.includes('Stale guard'))).toContain('◆ Codex')
    expect(f.find((l) => l.includes('Link codes'))).not.toContain('◆')
    // La fecha sigue alineada con o sin agente.
    const fecha = (l: string) => l.indexOf('ago')
    expect(fecha(f.find((l) => l.includes('Encryption is'))!)).toBe(fecha(f.find((l) => l.includes('Link codes'))!))
    r.stdin.write('\r')
    await hasta(() => !!r.lastFrame()?.includes('The full body'))
    expect(r.lastFrame()).toMatch(/feat\/x · 2h ago · ◆ Claude/)
    r.unmount()
  })

  it('a 70 columnas el agente se cae antes que el título', async () => {
    const { fuente } = fuenteFalsa({ memorias: [{ ...MEMORIAS[0]!, originAi: 'claude' }] })
    const r = render(<App fuente={fuente} ancho={70} suspenderYEditar={suspender} />)
    await hasta(() => !!r.lastFrame()?.includes('Encryption'))
    expect(r.lastFrame()).not.toContain('◆')
    r.unmount()
  })

  it('el tipo architecture entra entero y la columna de títulos queda alineada', async () => {
    const { fuente } = fuenteFalsa({ memorias: [mem('z', 'Layers of the daemon', 'architecture', 'x', 1), MEMORIAS[0]!] })
    const r = render(<App fuente={fuente} ancho={100} suspenderYEditar={suspender} />)
    await hasta(() => !!r.lastFrame()?.includes('Layers'))
    const f = r.lastFrame()!.split('\n')
    const a = f.find((l) => l.includes('Layers'))!
    const d = f.find((l) => l.includes('Encryption is'))!
    expect(a).toContain('Architecture')
    expect(a.indexOf('Layers')).toBe(d.indexOf('Encryption is'))
    r.unmount()
  })
})

describe('cargar Ink', () => {
  it('cargarInk carga Ink de verdad desde CommonJS', () => {
    // El paquete compila a CommonJS: se transpila ink.ts así y se corre en un node aparte, donde
    // el `import()` de `new Function` sí tiene el loader por defecto. Si tsc lo convirtiera en
    // `require`, esto reventaría con ERR_REQUIRE_ASYNC_MODULE (Ink tiene top-level await).
    const origen = join(__dirname, '..', 'tui-del-paquete', 'ink.ts')
    const js = ts.transpileModule(readFileSync(origen, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    expect(js).not.toMatch(/require\(['"]ink['"]\)/)
    const programa = `
      const Module = require('module'); const path = require('path')
      const archivo = ${JSON.stringify(origen.replace(/\.ts$/, '.js'))}
      const m = new Module(archivo); m.filename = archivo; m.paths = Module._nodeModulePaths(path.dirname(archivo))
      m._compile(${JSON.stringify(js)}, archivo)
      let antes = 'no tiró'; try { m.exports.ink() } catch (e) { antes = e.message }
      m.exports.cargarInk().then((i) => console.log(JSON.stringify({ antes, box: typeof m.exports.ink().Box, render: typeof i.render })))
    `
    const salida = execFileSync(process.execPath, ['-e', programa], { encoding: 'utf8' })
    expect(JSON.parse(salida.trim())).toEqual({ antes: 'Ink not loaded — call cargarInk() first', box: 'object', render: 'function' })
  })
})
