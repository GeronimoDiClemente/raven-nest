import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import {
  elegirEditor,
  partirComando,
  editarEnEditor,
  reabrirEnEditor,
  descartar,
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
      id: 'sc1',
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
      id: 'sc2',
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
    const r = editarEnEditor({ inicial: plantillaDeNueva(), id: 'new-x', editor: editorFalso })
    expect(r).toEqual({ tipo: 'sin-cambios' })
  })

  it('cambios válidos devuelven la memoria y borran el temporal', () => {
    conModo('valido', editada)
    let archivo = ''
    const r = editarEnEditor({
      inicial: original,
      id: 'ok1',
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
    const r = editarEnEditor({ inicial: original, id: 'inv1', editor: editorFalso })
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
    const r = editarEnEditor({ inicial: original, id: 'inv2', editor: editorFalso })
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
      id: 'f3',
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
      id: 'enoent',
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
      id: 'throw',
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
      id: 'args',
      editor: ['code', '--wait'],
      lanzar: (bin, args) => {
        visto = [bin, ...args]
        return { status: 0 }
      },
    })
    expect(visto.slice(0, 2)).toEqual(['code', '--wait'])
    expect(visto[2]).toMatch(/memory-args\.md$/)
  })

  it.skipIf(process.platform === 'win32')('el temporal se crea con modo 0600', () => {
    let modo = 0
    editarEnEditor({
      inicial: original,
      id: 'modo1',
      editor: ['x'],
      lanzar: (_b, args) => {
        modo = statSync(args[args.length - 1]).mode & 0o777
        return { status: 0 }
      },
    })
    expect(modo).toBe(0o600)
  })

  it.skipIf(process.platform === 'win32')('un temporal preexistente con otro modo queda en 0600', () => {
    let modo = 0
    const previo = join(tmpdir(), 'memory-modo2.md')
    writeFileSync(previo, 'viejo', { mode: 0o644 })
    editarEnEditor({
      inicial: original,
      id: 'modo2',
      editor: ['x'],
      lanzar: (_b, args) => {
        modo = statSync(args[args.length - 1]).mode & 0o777
        return { status: 0 }
      },
    })
    expect(modo).toBe(0o600)
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
