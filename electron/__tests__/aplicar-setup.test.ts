// La capa que sí toca el disco. Va contra un directorio temporal REAL y no contra un mock de
// `fs`: lo que puede fallar acá —permisos, directorios que no existen, un renombre que pisa
// mal— no se ve mockeando las llamadas que uno cree que hace.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync, chmodSync, symlinkSync, lstatSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { aplicarPlan, sondasDeDisco } from '../aplicar-setup'
import { destinosDeSetup, planDeSetup, planDeDeshacer, NOMBRE_DEL_SERVIDOR } from '../setup-del-paquete'

const ENTRADA = { command: 'npx', args: ['-y', 'nest-memory', 'mcp'] }
let home: string

beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'nest-setup-')) })
afterEach(() => { rmSync(home, { recursive: true, force: true }) })

const destino = (id: string) => destinosDeSetup(home, 'darwin').find((d) => d.id === id)!

describe('aplicarPlan', () => {
  it('no toca los editores que no están', () => {
    const r = aplicarPlan(planDeSetup(destinosDeSetup(home, 'darwin'), sondasDeDisco(), ENTRADA))
    expect(r.escritos).toEqual([])
    expect(r.saltados.length).toBeGreaterThan(0)
  })

  it('crea el archivo de un editor instalado que todavía no lo tiene', () => {
    const d = destino('gemini')
    mkdirSync(d.dirDeDeteccion!, { recursive: true })

    aplicarPlan(planDeSetup([d], sondasDeDisco(), ENTRADA))

    const escrito = JSON.parse(readFileSync(d.path, 'utf8'))
    expect(escrito.mcpServers[NOMBRE_DEL_SERVIDOR]).toEqual(ENTRADA)
  })

  it('conserva lo que el usuario ya tenía en el archivo', () => {
    const d = destino('claude')
    writeFileSync(d.path, JSON.stringify({ projects: { a: 1 } }, null, 2))

    aplicarPlan(planDeSetup([d], sondasDeDisco(), ENTRADA))

    const escrito = JSON.parse(readFileSync(d.path, 'utf8'))
    expect(escrito.projects).toEqual({ a: 1 })
    expect(escrito.mcpServers[NOMBRE_DEL_SERVIDOR]).toEqual(ENTRADA)
  })

  it('correrlo dos veces no escribe la segunda', () => {
    const d = destino('claude')
    writeFileSync(d.path, '{}')
    aplicarPlan(planDeSetup([d], sondasDeDisco(), ENTRADA))
    const r = aplicarPlan(planDeSetup([d], sondasDeDisco(), ENTRADA))
    expect(r.escritos).toEqual([])
    expect(r.yaEstaban).toEqual([d.path])
  })

  it('deshacer devuelve el archivo a como estaba, byte a byte', () => {
    const d = destino('claude')
    const original = '{\n  "projects": {\n    "a": 1\n  }\n}'
    writeFileSync(d.path, original)

    aplicarPlan(planDeSetup([d], sondasDeDisco(), ENTRADA))
    aplicarPlan(planDeDeshacer([d], sondasDeDisco()))

    expect(readFileSync(d.path, 'utf8')).toBe(original)
  })

  it('deshacer NO borra el archivo', () => {
    // Es el config del usuario, no nuestro. Sacamos nuestra entrada y nada más.
    const d = destino('claude')
    writeFileSync(d.path, '{}')
    aplicarPlan(planDeSetup([d], sondasDeDisco(), ENTRADA))
    aplicarPlan(planDeDeshacer([d], sondasDeDisco()))
    expect(existsSync(d.path)).toBe(true)
  })

  // Windows no tiene bits de modo: `chmod` sólo toca el de sólo lectura y `stat` devuelve
  // siempre 0o666. Ahí lo que aísla el archivo es la ACL del perfil del usuario, que el
  // directorio home ya hereda.
  it.skipIf(process.platform === 'win32')('el archivo nuevo no queda legible por todo el mundo', () => {
    // Un config MCP dice qué corre y con qué argumentos. En una máquina compartida, que
    // cualquiera pueda leerlo no hace falta.
    const d = destino('gemini')
    mkdirSync(d.dirDeDeteccion!, { recursive: true })
    aplicarPlan(planDeSetup([d], sondasDeDisco(), ENTRADA))
    const modo = statSync(d.path).mode & 0o777
    expect(modo & 0o077).toBe(0)
  })

  it('crea el directorio que falte antes de escribir', () => {
    // Cursor guarda en `~/.cursor/mcp.json`: si el usuario tiene el directorio pero nunca
    // guardó nada, no hay problema; pero un destino cuyo padre no existe no puede fallar en
    // silencio a mitad del plan.
    const d = destino('cursor')
    mkdirSync(d.dirDeDeteccion!, { recursive: true })
    rmSync(join(d.path), { force: true })
    aplicarPlan(planDeSetup([d], sondasDeDisco(), ENTRADA))
    expect(existsSync(d.path)).toBe(true)
  })

  it('un destino que falla no aborta los demás, y se informa', () => {
    const bueno = destino('claude')
    writeFileSync(bueno.path, '{}')
    // Un destino cuyo path es un DIRECTORIO: escribirlo tira, y el plan tiene que seguir.
    const roto = { ...destino('cursor'), path: join(home, 'soy-un-directorio') }
    mkdirSync(roto.path, { recursive: true })

    const r = aplicarPlan(planDeSetup([roto, bueno], sondasDeDisco(), ENTRADA))

    expect(r.escritos).toEqual([bueno.path])
    expect(r.fallados).toHaveLength(1)
    expect(r.fallados[0]!.path).toBe(roto.path)
  })

  it('no deja archivos temporales tirados', () => {
    const d = destino('claude')
    writeFileSync(d.path, '{}')
    aplicarPlan(planDeSetup([d], sondasDeDisco(), ENTRADA))
    const sueltos = require('fs').readdirSync(home).filter((f: string) => f.includes('.tmp'))
    expect(sueltos).toEqual([])
  })
})

// Permisos y symlinks (auditoría 2026-11-05): el renombre ponía el inodo del temporal, nacido
// con el umask, en lugar del config del usuario.
describe.skipIf(process.platform === 'win32')('aplicarPlan — permisos del archivo del usuario', () => {
  const modo = (p: string) => statSync(p).mode & 0o777

  it('un ~/.claude.json en 0600 sigue en 0600 después del setup y del deshacer', () => {
    const d = destino('claude')
    writeFileSync(d.path, '{}')
    chmodSync(d.path, 0o600)
    aplicarPlan(planDeSetup([d], sondasDeDisco(), ENTRADA))
    expect(modo(d.path)).toBe(0o600)
    aplicarPlan(planDeDeshacer([d], sondasDeDisco()))
    expect(modo(d.path)).toBe(0o600)
  })

  it('tampoco le restringe los permisos a uno que el usuario dejó abierto', () => {
    const d = destino('claude')
    writeFileSync(d.path, '{}')
    chmodSync(d.path, 0o664)
    aplicarPlan(planDeSetup([d], sondasDeDisco(), ENTRADA))
    expect(modo(d.path)).toBe(0o664)
  })

  it('el que crea nace en 0600, sin importar el umask', () => {
    const d = destino('gemini')
    mkdirSync(d.dirDeDeteccion!, { recursive: true })
    aplicarPlan(planDeSetup([d], sondasDeDisco(), ENTRADA))
    expect(modo(d.path)).toBe(0o600)
  })

  it('un config que es un symlink (dotfiles) sigue siendo symlink, y se escribe su destino', () => {
    const d = destino('claude')
    const real = join(home, 'dotfiles-claude.json')
    writeFileSync(real, '{}')
    chmodSync(real, 0o600)
    symlinkSync(real, d.path)
    aplicarPlan(planDeSetup([d], sondasDeDisco(), ENTRADA))
    expect(lstatSync(d.path).isSymbolicLink()).toBe(true)
    expect(JSON.parse(readFileSync(real, 'utf8')).mcpServers[NOMBRE_DEL_SERVIDOR]).toEqual(ENTRADA)
    expect(modo(real)).toBe(0o600)
  })
})
