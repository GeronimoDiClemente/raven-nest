// El arranque de la TUI: cuándo abrir, la pantalla alternativa, y el ida y vuelta con el
// editor (desmontar Ink, editar, volver a montar con el mismo estado, escribir por la fuente).
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cargarInk } from '../tui-del-paquete/ink'
import { arrancarTui, decidirArranque, restaurarTerminal } from '../tui-del-paquete/arrancar'
import { ErrorDeEscritura, type FuenteDeLaTui } from '../tui-del-paquete/fuente'
import { serializarMemoria, type MemoriaEscrita } from '../tui-del-paquete/frontmatter'
import type { ObservationSummary } from '../memory-protocol'
import type { DatosDeStatus } from '../status-del-paquete'

const FALSO = fileURLToPath(new URL('./fixtures/editor-falso.mjs', import.meta.url))
const EDITOR = `"${process.execPath}" "${FALSO}"`

const ENTRAR = '\x1b[?1049h'
const SALIR = '\x1b[?1049l'

describe('decidirArranque', () => {
  it('con las dos puntas en una terminal y modo crudo, abre', () => {
    expect(decidirArranque({ stdinTTY: true, stdoutTTY: true, tieneSetRawMode: true })).toBe('abrir')
  })
  it('sin terminal (un pipe de cualquier lado) imprime la ayuda', () => {
    expect(decidirArranque({ stdinTTY: false, stdoutTTY: true, tieneSetRawMode: false })).toBe('ayuda')
    expect(decidirArranque({ stdinTTY: true, stdoutTTY: false, tieneSetRawMode: true })).toBe('ayuda')
  })
  it('una terminal sin modo crudo no puede con la vista interactiva', () => {
    expect(decidirArranque({ stdinTTY: true, stdoutTTY: true, tieneSetRawMode: false })).toBe('sin-modo-crudo')
  })
})

describe('restaurarTerminal', () => {
  it('sale de la pantalla alternativa, muestra el cursor y apaga el modo crudo', () => {
    const escrito: string[] = []
    const crudo: boolean[] = []
    const stdout = { write: (s: string) => { escrito.push(s); return true } } as unknown as NodeJS.WriteStream
    const stdin = { isTTY: true, setRawMode: (b: boolean) => { crudo.push(b) } } as unknown as NodeJS.ReadStream
    restaurarTerminal(stdout, stdin)
    expect(escrito.join('')).toBe(`${SALIR}\x1b[?25h`)
    expect(crudo).toEqual([false])
  })
})

// --- El ida y vuelta, con stdin/stdout falsos como los de ink-testing-library ---

class Stdout extends EventEmitter {
  isTTY = true
  columns = 100
  rows = 30
  escrito: string[] = []
  write = (s: string) => { this.escrito.push(s); return true }
  /** El último frame que pintó Ink: se saltean las escrituras que son sólo secuencias de
   *  control (pantalla alternativa, el `?25l` con que Ink esconde el cursor al montar). */
  ultimo = () => [...this.escrito].reverse().find((s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim() !== '') ?? ''
  veces = (s: string) => this.escrito.filter((x) => x.includes(s)).length
}

class Stdin extends EventEmitter {
  isTTY = true
  data: string | null = null
  escribir = (d: string) => { this.data = d; this.emit('readable'); this.emit('data', d) }
  setEncoding() {}
  setRawMode() {}
  resume() {}
  pause() {}
  ref() {}
  unref() {}
  read = () => { const d = this.data; this.data = null; return d }
}

const ahora = Date.now()
const MEMORIA: ObservationSummary = {
  syncId: 'a', title: 'Encryption is mandatory on connect', type: 'decision',
  content: 'Short…', topicKey: null, tags: ['sync'], updatedAt: ahora, originAi: null, gitBranch: null,
}
const CUERPO_ENTERO = 'The whole body, much longer than the list shows.'

const STATUS: DatosDeStatus = {
  modo: 'propia', vacia: false, total: 1, porGrupo: {}, personal: 1, deEquipo: 0,
  guardadaEn: '~/.nest/memory.db', servicio: null, filas: [], ilegiblesDeEquipo: 0, recientes: [], resumen: 'synced',
}

type Retenida = { resolver: () => void; rechazar: (e: Error) => void }

/**
 * `retener`: guardar/actualizar quedan colgados hasta que el test los suelte (`retenidas`).
 * `idDeMemoria`: el syncId de la memoria de la lista (default `a`). `cerrar`: lo que hace
 * cerrar la fuente (para probar que la TUI lo espera).
 */
function fuenteFalsa(o: {
  fallaAlGuardar?: () => Error | null
  fallaAlActualizar?: () => Error | null
  retener?: boolean
  idDeMemoria?: string
  cerrar?: () => Promise<void>
} = {}) {
  const id0 = o.idDeMemoria ?? 'a'
  const memoria = { ...MEMORIA, syncId: id0 }
  const guardadas: MemoriaEscrita[] = []
  const actualizadas: Array<[string, MemoriaEscrita]> = []
  const retenidas: Retenida[] = []
  const quizasRetener = () => o.retener
    ? new Promise<void>((resolver, rechazar) => { retenidas.push({ resolver, rechazar }) })
    : Promise.resolve()
  let cerrada = false
  const fuente: FuenteDeLaTui = {
    proyecto: () => 'raven-nest',
    recientes: async () => [memoria],
    buscar: async () => [],
    obtener: async (id) => (id === id0 ? { item: { ...memoria, content: CUERPO_ENTERO }, resolvedLinks: [], pendingLinks: [] } : null),
    guardar: async (m) => {
      const err = o.fallaAlGuardar?.()
      if (err) throw err
      guardadas.push(m)
      await quizasRetener()
    },
    actualizar: async (id, m) => {
      const err = o.fallaAlActualizar?.()
      if (err) throw err
      actualizadas.push([id, m])
      await quizasRetener()
    },
    borrar: async () => {},
    status: async () => STATUS,
    doctor: async () => ({ filas: [], homeDeNest: false, bloqueadas: [], problemas: 0, avisos: 0 }),
    cerrar: async () => { await o.cerrar?.(); cerrada = true },
  }
  return { fuente, guardadas, actualizadas, retenidas, cerrada: () => cerrada }
}

const tics = async (n: number) => { for (let i = 0; i < n; i++) await tic() }
const tic = () => new Promise<void>((r) => setImmediate(r))
async function hasta(cond: () => boolean, que: string): Promise<void> {
  for (let i = 0; i < 200 && !cond(); i++) await tic()
  if (!cond()) throw new Error(`nunca pasó: ${que}`)
}

/**
 * Los temporales de la TUI van a un directorio propio de este archivo (`dirTemporal`):
 * `tui-editor-externo` corre en paralelo y deja los suyos en tmpdir con el mismo formato.
 */
let DIR = ''
const temporales = () => new Set(readdirSync(DIR).filter((f) => /^memory-[0-9a-f-]{36}\.md$/.test(f)))

/** `dir: null` deja el default de verdad (tmpdir). */
function arrancar(fuente: FuenteDeLaTui, dir: string | null = DIR) {
  const stdout = new Stdout()
  const stdin = new Stdin()
  const listo = arrancarTui(fuente, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    env: { EDITOR },
    plataforma: process.platform,
    ...(dir === null ? {} : { dirTemporal: dir }),
    // Frames enteros en cada render: el modo normal de Ink no escribe nada con CI=true.
    opcionesDeInk: { debug: true, patchConsole: false },
  })
  return { stdout, stdin, listo }
}

function modo(m: string, texto?: string): void {
  process.env.EDITOR_FALSO_MODO = m
  if (texto !== undefined) process.env.EDITOR_FALSO_TEXTO = texto
  else delete process.env.EDITOR_FALSO_TEXTO
}

beforeAll(async () => {
  DIR = mkdtempSync(join(tmpdir(), 'tui-arrancar-'))
  await cargarInk((m) => import(m))
})
afterAll(() => rmSync(DIR, { recursive: true, force: true }))
afterEach(() => {
  delete process.env.EDITOR_FALSO_MODO
  delete process.env.EDITOR_FALSO_TEXTO
  delete process.env.EDITOR_FALSO_REGISTRO
})

describe('el ida y vuelta con el editor falso', () => {
  it('entra a la pantalla alternativa y q la deja como estaba, sin listeners colgados', async () => {
    const contar = () => ['exit', 'SIGINT', 'SIGTERM'].map((s) => process.listenerCount(s))
    const una = async () => {
      const f = fuenteFalsa()
      const { stdout, stdin, listo } = arrancar(f.fuente)
      await hasta(() => stdout.ultimo().includes('Encryption is mandatory'), 'Recent')
      expect(stdout.escrito[0]).toBe(ENTRAR)
      stdin.escribir('q')
      await listo
      expect(stdout.escrito.at(-1)).toBe(`${SALIR}\x1b[?25h`)
      expect(f.cerrada()).toBe(true)
    }
    // La primera corrida deja el `restore-cursor` de Ink (uno por proceso, a propósito); de
    // ahí en más, cada corrida tiene que sacar lo que puso.
    await una()
    const despuesDeUna = contar()
    await una()
    expect(contar()).toEqual(despuesDeUna)
  })

  it('Ctrl+C también sale por el reducer (exitOnCtrlC apagado)', async () => {
    const f = fuenteFalsa()
    const { stdout, stdin, listo } = arrancar(f.fuente)
    await hasta(() => stdout.ultimo().includes('Encryption is mandatory'), 'Recent')
    stdin.escribir('\x03')
    await listo
    expect(stdout.escrito.at(-1)).toBe(`${SALIR}\x1b[?25h`)
  })

  it('valido: n guarda lo que escribió el editor, y vuelve con el mismo estado', async () => {
    const texto = serializarMemoria({ title: 'Written in the editor', type: 'bugfix', tags: ['x'], content: 'body' })
    modo('valido', texto)
    const f = fuenteFalsa()
    const { stdout, stdin, listo } = arrancar(f.fuente)
    await hasta(() => stdout.ultimo().includes('Encryption is mandatory'), 'Recent')
    stdin.escribir('g') // estado que tiene que sobrevivir al re-montaje
    await hasta(() => stdout.ultimo().includes('· all'), 'all projects')
    stdin.escribir('n')
    await hasta(() => f.guardadas.length === 1, 'guardar')
    expect(f.guardadas[0]).toEqual({ title: 'Written in the editor', type: 'bugfix', tags: ['x'], content: 'body' })
    // Soltó la terminal para el editor y la volvió a tomar.
    expect(stdout.veces(ENTRAR)).toBe(2)
    expect(stdout.escrito.filter((s) => s.startsWith(SALIR)).length).toBe(1)
    await hasta(() => stdout.ultimo().includes('Saved'), 'Saved')
    expect(stdout.ultimo()).toContain('· all')
    stdin.escribir('q')
    await listo
  })

  it('igual: no escribe nada', async () => {
    modo('igual')
    const f = fuenteFalsa()
    const { stdout, stdin, listo } = arrancar(f.fuente)
    await hasta(() => stdout.ultimo().includes('Encryption is mandatory'), 'Recent')
    stdin.escribir('n')
    await hasta(() => stdout.veces(ENTRAR) === 2, 'volver del editor')
    for (let i = 0; i < 10; i++) await tic()
    expect(f.guardadas).toEqual([])
    expect(f.actualizadas).toEqual([])
    stdin.escribir('q')
    await listo
  })

  it('e en una memoria parte del texto ENTERO de obtener, no del recortado de la lista', async () => {
    modo('anexar')
    const f = fuenteFalsa()
    const { stdout, stdin, listo } = arrancar(f.fuente)
    await hasta(() => stdout.ultimo().includes('Encryption is mandatory'), 'Recent')
    stdin.escribir('e')
    await hasta(() => f.actualizadas.length === 1, 'actualizar')
    const [id, m] = f.actualizadas[0]!
    expect(id).toBe('a')
    expect(m).toEqual({
      title: MEMORIA.title, type: 'decision', tags: ['sync'],
      content: `${CUERPO_ENTERO}\nappended by the editor`,
    })
    stdin.escribir('q')
    await listo
  })

  it('invalido: muestra el error con Reopen; Discard borra el temporal', async () => {
    modo('invalido')
    const antes = temporales()
    const f = fuenteFalsa()
    const { stdout, stdin, listo } = arrancar(f.fuente)
    await hasta(() => stdout.ultimo().includes('Encryption is mandatory'), 'Recent')
    stdin.escribir('n')
    await hasta(() => stdout.ultimo().includes('Missing frontmatter'), 'el error')
    expect(stdout.ultimo()).toMatch(/r reopen/i)
    expect(stdout.ultimo()).toMatch(/d discard/i)
    const nuevos = [...temporales()].filter((t) => !antes.has(t))
    expect(nuevos).toHaveLength(1)
    stdin.escribir('d')
    await hasta(() => !stdout.ultimo().includes('Missing frontmatter'), 'descartado')
    expect(existsSync(join(DIR, nuevos[0]!))).toBe(false)
    expect(f.guardadas).toEqual([])
    stdin.escribir('q')
    await listo
  })

  it('si la fuente no puede escribir, el texto se conserva y Reopen lo vuelve a intentar', async () => {
    const texto = serializarMemoria({ title: 'Kept on failure', type: 'decision', tags: [], content: 'keep me' })
    modo('valido', texto)
    let falla = true
    const antes = temporales()
    const f = fuenteFalsa({ fallaAlGuardar: () => (falla ? new ErrorDeEscritura('Memory is locked by another process') : null) })
    const { stdout, stdin, listo } = arrancar(f.fuente)
    await hasta(() => stdout.ultimo().includes('Encryption is mandatory'), 'Recent')
    stdin.escribir('n')
    await hasta(() => stdout.ultimo().includes('Memory is locked'), 'el error de escritura')
    expect(stdout.ultimo()).toMatch(/r reopen/i)
    const nuevos = [...temporales()].filter((t) => !antes.has(t))
    expect(nuevos).toHaveLength(1)
    expect(readFileSync(join(DIR, nuevos[0]!), 'utf8')).toBe(texto)

    falla = false
    modo('igual') // Reopen sin tocar nada: el texto conservado ya es válido
    stdin.escribir('r')
    await hasta(() => f.guardadas.length === 1, 'guardar al reabrir')
    expect(f.guardadas[0]).toEqual({ title: 'Kept on failure', type: 'decision', tags: [], content: 'keep me' })
    expect(existsSync(join(DIR, nuevos[0]!))).toBe(false)
    stdin.escribir('q')
    await listo
  })

  it('salir con un error de editor pendiente no deja el temporal', async () => {
    modo('invalido')
    const antes = temporales()
    const f = fuenteFalsa()
    const { stdout, stdin, listo } = arrancar(f.fuente)
    await hasta(() => stdout.ultimo().includes('Encryption is mandatory'), 'Recent')
    stdin.escribir('n')
    await hasta(() => stdout.ultimo().includes('Missing frontmatter'), 'el error')
    stdin.escribir('\x03')
    await listo
    expect([...temporales()].filter((t) => !antes.has(t))).toEqual([])
  })

  it('un segundo n con la escritura en vuelo no abre otro editor ni escribe dos veces', async () => {
    modo('valido', serializarMemoria({ title: 'Once', type: 'decision', tags: [], content: 'only one' }))
    const f = fuenteFalsa({ retener: true })
    const { stdout, stdin, listo } = arrancar(f.fuente)
    await hasta(() => stdout.ultimo().includes('Encryption is mandatory'), 'Recent')
    stdin.escribir('n')
    await hasta(() => f.retenidas.length === 1, 'guardar en vuelo')
    await hasta(() => stdout.ultimo().includes('Saving…'), 'Saving…')
    stdin.escribir('n')
    await tics(20)
    expect(stdout.veces(ENTRAR)).toBe(2) // un solo editor: arranque + un re-montaje
    f.retenidas[0]!.resolver()
    await hasta(() => stdout.ultimo().includes('Saved'), 'Saved')
    expect(f.guardadas).toHaveLength(1)
    stdin.escribir('q')
    await listo
  })

  it('r dos veces durante un Reopen: un editor, y actualiza la MISMA memoria', async () => {
    modo('invalido')
    const f = fuenteFalsa({ retener: true })
    const { stdout, stdin, listo } = arrancar(f.fuente)
    await hasta(() => stdout.ultimo().includes('Encryption is mandatory'), 'Recent')
    stdin.escribir('e')
    await hasta(() => stdout.ultimo().includes('Missing frontmatter'), 'el error')
    modo('valido', serializarMemoria({ title: 'Fixed', type: 'decision', tags: [], content: 'ok now' }))
    stdin.escribir('r')
    await hasta(() => f.retenidas.length === 1, 'actualizar en vuelo')
    stdin.escribir('r')
    await tics(20)
    expect(stdout.veces(ENTRAR)).toBe(3) // arranque, vuelta del e, vuelta del primer r
    f.retenidas[0]!.resolver()
    await hasta(() => stdout.ultimo().includes('Saved'), 'Saved')
    expect(f.actualizadas.map(([id]) => id)).toEqual(['a'])
    expect(f.guardadas).toEqual([])
    stdin.escribir('q')
    await listo
  })

  it('q con la escritura en vuelo: espera, y si falla no deja un temporal huérfano', async () => {
    modo('valido', serializarMemoria({ title: 'In flight', type: 'decision', tags: [], content: 'x' }))
    const antes = temporales()
    const f = fuenteFalsa({ retener: true })
    const { stdout, stdin, listo } = arrancar(f.fuente)
    await hasta(() => stdout.ultimo().includes('Encryption is mandatory'), 'Recent')
    stdin.escribir('n')
    await hasta(() => f.retenidas.length === 1, 'guardar en vuelo')
    stdin.escribir('q')
    let termino = false
    void listo.then(() => { termino = true })
    await tics(20)
    expect(termino).toBe(false) // espera a la escritura antes de cerrar la fuente
    expect(f.cerrada()).toBe(false)
    f.retenidas[0]!.rechazar(new ErrorDeEscritura('Memory is locked by another process'))
    await listo
    expect(f.cerrada()).toBe(true)
    expect([...temporales()].filter((t) => !antes.has(t))).toEqual([])
  })

  it('Reopen sin el temporal y con el editor caído suelta el error: r ya no abre nada', async () => {
    modo('invalido')
    const antes = temporales()
    const f = fuenteFalsa()
    const { stdout, stdin, listo } = arrancar(f.fuente)
    await hasta(() => stdout.ultimo().includes('Encryption is mandatory'), 'Recent')
    stdin.escribir('n')
    await hasta(() => stdout.ultimo().includes('Missing frontmatter'), 'el error')
    const [nuevo] = [...temporales()].filter((t) => !antes.has(t))
    unlinkSync(join(DIR, nuevo!))
    modo('falla')
    stdin.escribir('r')
    await hasta(() => stdout.ultimo().includes('Editor exited with code 3'), 'el fallo del editor')
    expect(stdout.ultimo()).not.toMatch(/r reopen/i)
    const entradas = stdout.veces(ENTRAR)
    stdin.escribir('r')
    await tics(20)
    expect(stdout.veces(ENTRAR)).toBe(entradas)
    stdin.escribir('q')
    await listo
  })

  it('un syncId con ../ no saca el temporal de tmpdir: ni lo escribe ni lo borra afuera', async () => {
    // La víctima vive en un hermano de tmpdir: con `memory-${syncId}.md`, el syncId
    // `x/../<hermano>/CLAUDE` la habría pisado y después borrado.
    const hermano = mkdtempSync(join(tmpdir(), 'tui-victima-'))
    const victima = join(hermano, 'CLAUDE.md')
    writeFileSync(victima, 'original')
    const registro = join(hermano, 'registro.txt')
    try {
      const malo = `x/../${basename(hermano)}/CLAUDE`
      // 1) e y el editor sale: el editor recibe un archivo directo en tmpdir.
      process.env.EDITOR_FALSO_REGISTRO = registro
      modo('anexar')
      const f = fuenteFalsa({ idDeMemoria: malo, fallaAlActualizar: () => new ErrorDeEscritura('Memory is locked') })
      const { stdout, stdin, listo } = arrancar(f.fuente, null)
      await hasta(() => stdout.ultimo().includes('Encryption is mandatory'), 'Recent')
      stdin.escribir('e')
      // 2) la escritura falla: `conservarEnTemporal` tampoco usa el syncId.
      await hasta(() => stdout.ultimo().includes('Memory is locked'), 'el error de escritura')
      const recibidos = readFileSync(registro, 'utf8').trim().split('\n')
      expect(recibidos).toHaveLength(1)
      expect(dirname(recibidos[0]!)).toBe(tmpdir())
      expect(basename(recibidos[0]!)).toMatch(/^memory-[0-9a-f-]{36}\.md$/)
      // 3) Reopen con un editor que no toca nada, y la escritura vuelve a fallar; después Discard.
      modo('igual')
      stdin.escribir('r')
      await hasta(() => readFileSync(registro, 'utf8').trim().split('\n').length === 2, 'reabrir')
      const reabierto = readFileSync(registro, 'utf8').trim().split('\n')[1]!
      expect(dirname(reabierto)).toBe(tmpdir())
      await hasta(() => stdout.ultimo().includes('Memory is locked'), 'el error otra vez')
      stdin.escribir('d')
      await hasta(() => !stdout.ultimo().includes('Memory is locked'), 'descartado')
      stdin.escribir('q')
      await listo
      expect(readFileSync(victima, 'utf8')).toBe('original')
      expect(readdirSync(hermano).sort()).toEqual(['CLAUDE.md', 'registro.txt'])
      for (const r of [recibidos[0]!, reabierto]) expect(existsSync(r)).toBe(false)
    } finally {
      rmSync(hermano, { recursive: true, force: true })
    }
  })

  it('un editor que escribe y sale con 3 conserva el texto y ofrece Reopen', async () => {
    const texto = serializarMemoria({ title: 'Saved before the error', type: 'decision', tags: [], content: 'kept' })
    modo('valido-y-falla', texto)
    const antes = temporales()
    const f = fuenteFalsa()
    const { stdout, stdin, listo } = arrancar(f.fuente)
    await hasta(() => stdout.ultimo().includes('Encryption is mandatory'), 'Recent')
    stdin.escribir('n')
    await hasta(() => stdout.ultimo().includes('your text is kept'), 'el aviso')
    expect(stdout.ultimo()).toMatch(/r reopen/i)
    const nuevos = [...temporales()].filter((t) => !antes.has(t))
    expect(nuevos).toHaveLength(1)
    expect(readFileSync(join(DIR, nuevos[0]!), 'utf8')).toBe(texto)
    expect(f.guardadas).toEqual([])
    modo('igual')
    stdin.escribir('r')
    await hasta(() => f.guardadas.length === 1, 'guardar al reabrir')
    expect(f.guardadas[0]).toEqual({ title: 'Saved before the error', type: 'decision', tags: [], content: 'kept' })
    stdin.escribir('q')
    await listo
  })

  it('q espera a que la fuente termine de cerrar (el sync en vuelo) antes de volver', async () => {
    let soltar: () => void = () => {}
    const f = fuenteFalsa({ cerrar: () => new Promise<void>((r) => { soltar = r }) })
    const { stdout, stdin, listo } = arrancar(f.fuente)
    await hasta(() => stdout.ultimo().includes('Encryption is mandatory'), 'Recent')
    stdin.escribir('q')
    let termino = false
    void listo.then(() => { termino = true })
    await tics(20)
    expect(termino).toBe(false)
    soltar()
    await listo
    expect(f.cerrada()).toBe(true)
  })
})
