import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, lstatSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import {
  elegirEditor,
  partirComando,
  editarEnEditor,
  reabrirEnEditor,
  descartar,
  conservarEnTemporal,
  escribirTemporalNuevo,
  nombreDeTemporal,
  crearLanzar,
  citarParaCmd,
  type Spawn,
} from '../tui-del-paquete/editor-externo'
import { serializarMemoria, plantillaDeNueva } from '../tui-del-paquete/frontmatter'

const FALSO = fileURLToPath(new URL('./fixtures/editor-falso.mjs', import.meta.url))
const editorFalso = [process.execPath, FALSO]

const original = serializarMemoria({ title: 'Uno', type: 'decision', tags: ['a'], content: 'cuerpo' })
const editada = serializarMemoria({ title: 'Dos', type: 'bugfix', tags: ['b', 'c'], content: 'nuevo' })

// El fixture lee el modo del entorno; spawnSync hereda process.env.
function conModo(modo: string, texto?: string): void {
  process.env.EDITOR_FALSO_MODO = modo
  if (texto !== undefined) process.env.EDITOR_FALSO_TEXTO = texto
}

const aBorrar: string[] = []
afterEach(() => {
  delete process.env.EDITOR_FALSO_MODO
  delete process.env.EDITOR_FALSO_TEXTO
  while (aBorrar.length) descartar(aBorrar.pop()!)
})

describe('editarEnEditor', () => {
  it('sin cambios no escribe y borra el temporal', () => {
    conModo('igual')
    let archivo = ''
    const r = editarEnEditor({
      inicial: original,
      editor: editorFalso,
      lanzar: (bin, args) => {
        archivo = args[args.length - 1]
        return spawnSync(bin, args, { stdio: 'inherit', shell: false })
      },
    })
    expect(r).toEqual({ tipo: 'sin-cambios' })
    expect(archivo).not.toBe('')
    expect(existsSync(archivo)).toBe(false)
  })

  it('un editor que guarda sin cambiar el contenido cuenta como sin cambios', () => {
    const r = editarEnEditor({
      inicial: original,
      editor: ['x'],
      lanzar: (_b, args) => {
        writeFileSync(args[args.length - 1], original)
        return { status: 0 }
      },
    })
    expect(r).toEqual({ tipo: 'sin-cambios' })
  })

  it('la plantilla de nueva sin tocar es sin cambios', () => {
    conModo('igual')
    const r = editarEnEditor({ inicial: plantillaDeNueva(), editor: editorFalso })
    expect(r).toEqual({ tipo: 'sin-cambios' })
  })

  it('cambios válidos devuelven la memoria y borran el temporal', () => {
    conModo('valido', editada)
    let archivo = ''
    const r = editarEnEditor({
      inicial: original,
      editor: editorFalso,
      lanzar: (bin, args) => {
        archivo = args[args.length - 1]
        return spawnSync(bin, args, { stdio: 'inherit', shell: false })
      },
    })
    expect(r).toEqual({
      tipo: 'lista',
      memoria: { title: 'Dos', type: 'bugfix', tags: ['b', 'c'], content: 'nuevo' },
    })
    expect(existsSync(archivo)).toBe(false)
  })

  it('frontmatter inválido conserva el archivo; reabrir con el editor válido lo resuelve y lo borra', () => {
    conModo('invalido')
    const r = editarEnEditor({ inicial: original, editor: editorFalso })
    expect(r.tipo).toBe('invalida')
    if (r.tipo !== 'invalida') return
    aBorrar.push(r.archivo)
    expect(r.error).toMatch(/frontmatter/i)
    expect(existsSync(r.archivo)).toBe(true)
    expect(readFileSync(r.archivo, 'utf8')).toContain('esto no tiene frontmatter')

    conModo('valido', editada)
    const r2 = reabrirEnEditor(r.archivo, editorFalso)
    expect(r2.tipo).toBe('lista')
    expect(existsSync(r.archivo)).toBe(false)
  })

  it('reabrir sin arreglar sigue inválido y conserva el archivo', () => {
    conModo('invalido')
    const r = editarEnEditor({ inicial: original, editor: editorFalso })
    if (r.tipo !== 'invalida') throw new Error('esperaba invalida')
    aBorrar.push(r.archivo)
    const r2 = reabrirEnEditor(r.archivo, editorFalso)
    expect(r2).toMatchObject({ tipo: 'invalida', archivo: r.archivo })
    expect(existsSync(r.archivo)).toBe(true)
  })

  it('el editor que sale con 3 borra el temporal', () => {
    conModo('falla')
    let archivo = ''
    const r = editarEnEditor({
      inicial: original,
      editor: editorFalso,
      lanzar: (bin, args) => {
        archivo = args[args.length - 1]
        return spawnSync(bin, args, { stdio: 'inherit', shell: false })
      },
    })
    expect(r.tipo).toBe('fallo-el-editor')
    expect(existsSync(archivo)).toBe(false)
  })

  it('un editor que tira ENOENT borra el temporal', () => {
    let archivo = ''
    const r = editarEnEditor({
      inicial: original,
      editor: ['no-existe-este-editor-jamas'],
      lanzar: (bin, args) => {
        archivo = args[args.length - 1]
        return spawnSync(bin, args, { stdio: 'inherit', shell: false })
      },
    })
    expect(r.tipo).toBe('fallo-el-editor')
    expect(existsSync(archivo)).toBe(false)
  })

  it('un editor que lanza una excepción borra el temporal', () => {
    let archivo = ''
    const r = editarEnEditor({
      inicial: original,
      editor: ['x'],
      lanzar: (_b, args) => {
        archivo = args[args.length - 1]
        throw new Error('boom')
      },
    })
    expect(r.tipo).toBe('fallo-el-editor')
    expect(existsSync(archivo)).toBe(false)
  })

  it('el archivo se agrega como último argumento, con los args del editor antes', () => {
    let visto: string[] = []
    editarEnEditor({
      inicial: original,
      editor: ['code', '--wait'],
      lanzar: (bin, args) => {
        visto = [bin, ...args]
        return { status: 0 }
      },
    })
    expect(visto.slice(0, 2)).toEqual(['code', '--wait'])
    expect(basename(visto[2]!)).toMatch(NOMBRE_AL_AZAR)
  })

  it.skipIf(process.platform === 'win32')('el temporal se crea con modo 0600', () => {
    let modo = 0
    editarEnEditor({
      inicial: original,
      editor: ['x'],
      lanzar: (_b, args) => {
        modo = statSync(args[args.length - 1]).mode & 0o777
        return { status: 0 }
      },
    })
    expect(modo).toBe(0o600)
  })

  it('el editor que escribe el archivo y sale con 3 conserva el texto y ofrece Reopen', () => {
    conModo('valido-y-falla', editada)
    const r = editarEnEditor({ inicial: original, editor: editorFalso })
    expect(r).toMatchObject({ tipo: 'invalida', error: 'The editor exited with code 3 — your text is kept' })
    if (r.tipo !== 'invalida') return
    aBorrar.push(r.archivo)
    expect(readFileSync(r.archivo, 'utf8')).toBe(editada)
    // Reopen con un editor que sale bien: lo conservado se escribe.
    conModo('igual')
    expect(reabrirEnEditor(r.archivo, editorFalso)).toMatchObject({ tipo: 'lista', memoria: { title: 'Dos' } })
  })

  it('en Reopen, un editor que cambia el archivo y sale con 3 también lo conserva', () => {
    conModo('invalido')
    const r = editarEnEditor({ inicial: original, editor: editorFalso })
    if (r.tipo !== 'invalida') throw new Error('esperaba invalida')
    aBorrar.push(r.archivo)
    conModo('valido-y-falla', editada)
    const r2 = reabrirEnEditor(r.archivo, editorFalso)
    expect(r2).toEqual({ tipo: 'invalida', error: 'The editor exited with code 3 — your text is kept', archivo: r.archivo })
    expect(readFileSync(r.archivo, 'utf8')).toBe(editada)
  })
})

/** `memory-<uuid>.md`: nada del syncId. */
const NOMBRE_AL_AZAR = /^memory-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.md$/

describe('los temporales', () => {
  it('editarEnEditor crea el temporal directo en tmpdir, con un nombre al azar', () => {
    let archivo = ''
    editarEnEditor({
      inicial: original,
      editor: ['x'],
      lanzar: (_b, args) => { archivo = args[args.length - 1]!; return { status: 0 } },
    })
    expect(dirname(archivo)).toBe(tmpdir())
    expect(basename(archivo)).toMatch(NOMBRE_AL_AZAR)
  })

  it('conservarEnTemporal también, y cada llamada da un nombre distinto', () => {
    const a = conservarEnTemporal('uno')
    const b = conservarEnTemporal('dos')
    aBorrar.push(a, b)
    expect(dirname(a)).toBe(tmpdir())
    expect(basename(a)).toMatch(NOMBRE_AL_AZAR)
    expect(a).not.toBe(b)
    expect(readFileSync(a, 'utf8')).toBe('uno')
  })

  it('nombreDeTemporal nunca sale del directorio', () => {
    for (let i = 0; i < 20; i++) expect(dirname(nombreDeTemporal('/d/x'))).toBe('/d/x')
  })

  describe.skipIf(process.platform === 'win32')('escribirTemporalNuevo', () => {
    let dir = ''
    afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = '' })

    it('un symlink plantado con ese nombre no lleva la escritura a su destino', () => {
      dir = mkdtempSync(join(tmpdir(), 'tui-symlink-'))
      const victima = join(dir, 'victima.md')
      writeFileSync(victima, 'original')
      const archivo = join(dir, 'memory-plantado.md')
      symlinkSync(victima, archivo)
      escribirTemporalNuevo(archivo, 'del usuario')
      expect(readFileSync(victima, 'utf8')).toBe('original')
      expect(lstatSync(archivo).isSymbolicLink()).toBe(false)
      expect(readFileSync(archivo, 'utf8')).toBe('del usuario')
      expect(statSync(archivo).mode & 0o777).toBe(0o600)
    })

    it('un archivo preexistente con otro modo se reemplaza y queda en 0600', () => {
      dir = mkdtempSync(join(tmpdir(), 'tui-modo-'))
      const archivo = join(dir, 'memory-previo.md')
      writeFileSync(archivo, 'viejo', { mode: 0o644 })
      escribirTemporalNuevo(archivo, 'nuevo')
      expect(statSync(archivo).mode & 0o777).toBe(0o600)
      expect(readFileSync(archivo, 'utf8')).toBe('nuevo')
    })
  })
})

describe('crearLanzar', () => {
  function espia() {
    const vistas: Array<{ bin: string; args: string[]; o: Parameters<Spawn>[2] }> = []
    const spawn: Spawn = (bin, args, o) => { vistas.push({ bin, args, o }); return { status: 0 } }
    return { vistas, spawn }
  }

  it('en posix lanza el editor directo, sin shell', () => {
    const { vistas, spawn } = espia()
    expect(crearLanzar('darwin', spawn)('code', ['--wait', '/tmp/memory-1.md'])).toEqual({ status: 0, error: undefined })
    expect(vistas).toEqual([{ bin: 'code', args: ['--wait', '/tmp/memory-1.md'], o: { stdio: 'inherit', shell: false } }])
  })

  it('en win32 pasa por cmd.exe /d /s /c con cada argumento entre comillas (los shims .cmd)', () => {
    const { vistas, spawn } = espia()
    crearLanzar('win32', spawn)('code', ['--wait', 'C:\\Users\\Ana (Work)\\Temp\\memory-1.md'])
    expect(vistas).toEqual([{
      bin: 'cmd.exe',
      args: ['/d', '/s', '/c', '""code" "--wait" "C:\\Users\\Ana (Work)\\Temp\\memory-1.md""'],
      o: { stdio: 'inherit', shell: false, windowsVerbatimArguments: true },
    }])
  })

  it('citarParaCmd dobla las comillas internas', () => {
    expect(citarParaCmd('a"b')).toBe('"a""b"')
    expect(citarParaCmd('')).toBe('""')
  })
})

describe('elegirEditor', () => {
  const si = () => true
  const no = () => false
  it('prefiere VISUAL', () => {
    expect(elegirEditor({ VISUAL: 'code --wait', EDITOR: 'vim' }, 'linux', si)).toEqual(['code', '--wait'])
  })
  it('usa EDITOR si no hay VISUAL', () => {
    expect(elegirEditor({ EDITOR: 'vim' }, 'darwin', si)).toEqual(['vim'])
  })
  it('sin variables: notepad en win32 sin consultar existe', () => {
    let consultas = 0
    expect(elegirEditor({}, 'win32', () => (consultas++, false))).toEqual(['notepad'])
    expect(consultas).toBe(0)
  })
  it('sin variables: nano, o vi si no hay nano', () => {
    expect(elegirEditor({}, 'linux', si)).toEqual(['nano'])
    expect(elegirEditor({}, 'darwin', no)).toEqual(['vi'])
  })
  it('una variable vacía o en blanco se ignora', () => {
    expect(elegirEditor({ VISUAL: '  ', EDITOR: 'vim' }, 'linux', si)).toEqual(['vim'])
  })
})

describe('partirComando', () => {
  it('separa por espacios', () => {
    expect(partirComando('code --wait')).toEqual(['code', '--wait'])
  })
  it('respeta comillas dobles y simples', () => {
    expect(partirComando('"/A B/subl" -w')).toEqual(['/A B/subl', '-w'])
    expect(partirComando("'/A B/subl' -w")).toEqual(['/A B/subl', '-w'])
  })
})
