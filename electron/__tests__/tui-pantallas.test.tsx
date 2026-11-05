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
  modo: 'propia', vacia: false, total: 1284, porGrupo: { decisions: 3 }, personal: 1280, deEquipo: 4,
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

function fuenteFalsa(opts: { memorias?: ObservationSummary[] } = {}) {
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
      return m ? { item: { ...m, content: `The full body of ${m.title}.` }, resolvedLinks: [], pendingLinks: [] } : null
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
    expect(f).toContain('Nest Memory · raven-nest')
    expect(f).toContain('decision')
    expect(f).toContain('bugfix')
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
