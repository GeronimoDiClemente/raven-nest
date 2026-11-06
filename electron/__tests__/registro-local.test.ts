// El main.log: que escriba, que rote, y que un disco que falla no tumbe nada.
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync, chmodSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { crearRegistro, duplicarConsola } from '../registro-local'

const dirs: string[] = []
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'registro-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

const FECHA = () => new Date('2026-11-06T12:00:00.000Z')

describe('crearRegistro', () => {
  it('escribe una línea con hora, nivel y los argumentos formateados', () => {
    const d = tmp()
    const r = crearRegistro(d, 1024, FECHA)
    r.escribir('error', ['[pty] spawn failed', { paneId: 'p1' }])
    expect(readFileSync(join(d, 'main.log'), 'utf8')).toBe("2026-11-06T12:00:00.000Z error [pty] spawn failed { paneId: 'p1' }\n")
  })

  it('al pasar el tope rota a main.old.log y sigue en uno nuevo', () => {
    const d = tmp()
    const r = crearRegistro(d, 200, FECHA)
    for (let i = 0; i < 10; i++) r.escribir('info', [`linea ${i} ${'x'.repeat(20)}`])
    expect(existsSync(join(d, 'main.old.log'))).toBe(true)
    expect(readFileSync(join(d, 'main.log'), 'utf8').length).toBeLessThanOrEqual(200)
    expect(readFileSync(join(d, 'main.log'), 'utf8')).toContain('linea 9')
  })

  it('un archivo que ya pasó el tope se rota al abrir', () => {
    const d = tmp()
    writeFileSync(join(d, 'main.log'), 'x'.repeat(500))
    crearRegistro(d, 200, FECHA).escribir('info', ['nueva'])
    expect(readFileSync(join(d, 'main.old.log'), 'utf8')).toHaveLength(500)
    expect(readFileSync(join(d, 'main.log'), 'utf8')).toContain('nueva')
  })

  it.skipIf(process.platform === 'win32')('si no puede escribir, no tira', () => {
    const d = tmp()
    const r = crearRegistro(d, 1024, FECHA)
    chmodSync(d, 0o500)
    try {
      expect(() => r.escribir('error', ['algo'])).not.toThrow()
    } finally {
      chmodSync(d, 0o700)
    }
  })
})

describe('duplicarConsola', () => {
  it('cada console.* va al archivo y también a la consola de siempre', () => {
    const d = tmp()
    const r = crearRegistro(d, 4096, FECHA)
    const vistas: string[] = []
    const consola = {
      log: (...a: unknown[]) => vistas.push(`log ${a.join(' ')}`),
      info: (...a: unknown[]) => vistas.push(`info ${a.join(' ')}`),
      warn: (...a: unknown[]) => vistas.push(`warn ${a.join(' ')}`),
      error: (...a: unknown[]) => vistas.push(`error ${a.join(' ')}`),
    }
    const deshacer = duplicarConsola(r, consola as unknown as Console)
    consola.log('hola')
    consola.error('falló', 42)
    deshacer()
    consola.warn('ya no')
    expect(vistas).toEqual(['log hola', 'error falló 42', 'warn ya no'])
    const archivo = readFileSync(join(d, 'main.log'), 'utf8')
    expect(archivo).toContain('info  hola')
    expect(archivo).toContain('error falló 42')
    expect(archivo).not.toContain('ya no')
  })
})
