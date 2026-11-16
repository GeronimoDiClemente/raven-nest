// ¿Nest está abierto en esta máquina? Lo que decide si el paquete portátil le delega todo.
//
// Hasta el 2026-10-02 la sonda era `() => false` y el paquete sólo miraba las variables que
// Nest inyecta en SUS terminales. Un editor que lanza `npx nest-memory mcp` por su cuenta
// —Cursor, VS Code, Codex— nunca las tiene, así que con Nest abierto el paquete abría la base
// por su lado y escribía sin el daemon que sincroniza en vivo.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { makeTmpDir, cleanupTmp } from './setup'
import { MemoryIpcServer } from '../memory-ipc-server'
import { MemoryStore } from '../memory-store'
import { daemonSocketPath } from '../memory-protocol'
import { leerLocalAuthMaterial, ensureLocalAuthMaterial } from '../memory-local-auth'
import { dondeHablarleANest, buscarNestVivo } from '../nest-vivo-del-paquete'

const isWin = process.platform === 'win32'
let raven: string

beforeEach(() => { raven = makeTmpDir('nest-vivo-') })
afterEach(() => cleanupTmp(raven))

describe('leerLocalAuthMaterial', () => {
  it('no crea nada: sin Nest instalado devuelve null y no deja archivos', () => {
    expect(leerLocalAuthMaterial(raven)).toBeNull()
    // `ensureLocalAuthMaterial` lo habría creado; el paquete no tiene por qué dejar rastro
    // en la carpeta de Nest de una máquina que no tiene Nest.
    expect(leerLocalAuthMaterial(raven)).toBeNull()
  })

  it('lee lo que dejó Nest', () => {
    const m = ensureLocalAuthMaterial(raven)
    expect(leerLocalAuthMaterial(raven)).toEqual(m)
  })

  it('un archivo corrupto es null, no una excepción', () => {
    mkdirSync(join(raven, '.raven-nest', 'memory'), { recursive: true })
    writeFileSync(join(raven, '.raven-nest', 'memory', 'pipe-auth.json'), '{roto')
    expect(leerLocalAuthMaterial(raven)).toBeNull()
  })
})

describe('dondeHablarleANest', () => {
  it('las variables de la terminal de Nest van primero', () => {
    expect(dondeHablarleANest({ NEST_MEMORY_SOCKET: 's', NEST_MEMORY_TOKEN: 't' }, raven, isWin))
      .toEqual([{ socket: 's', token: 't' }])
  })

  it('sin variables, sale del disco — que es el caso de un editor lanzado por su cuenta', () => {
    const m = ensureLocalAuthMaterial(raven)
    expect(dondeHablarleANest({}, raven, isWin))
      .toEqual([{ socket: daemonSocketPath(raven, isWin, m.pipeId), token: m.token }])
  })

  it('con las dos fuentes, prueba las dos (la variable puede ser de un Nest que ya cerró)', () => {
    const m = ensureLocalAuthMaterial(raven)
    expect(dondeHablarleANest({ NEST_MEMORY_SOCKET: 's', NEST_MEMORY_TOKEN: 't' }, raven, isWin)).toEqual([
      { socket: 's', token: 't' },
      { socket: daemonSocketPath(raven, isWin, m.pipeId), token: m.token },
    ])
  })

  it('sin variables ni Nest instalado, no hay dónde', () => {
    expect(dondeHablarleANest({}, raven, isWin)).toEqual([])
  })
})

describe('buscarNestVivo — contra un daemon de verdad', () => {
  let store: MemoryStore
  let server: MemoryIpcServer | null = null

  beforeEach(() => { store = new MemoryStore(join(raven, 'db', 'memory.db')) })
  afterEach(() => { server?.stop(); server = null; store.close() })

  function levantarNest() {
    const m = ensureLocalAuthMaterial(raven)
    const socket = daemonSocketPath(raven, isWin, m.pipeId)
    mkdirSync(join(raven, '.raven-nest', 'memory'), { recursive: true })
    server = new MemoryIpcServer({ store, socketPath: socket, authToken: m.token })
    server.start()
    return { socket, token: m.token }
  }

  it('con Nest abierto lo encuentra por el disco, sin ninguna variable', async () => {
    const nest = levantarNest()
    expect(await buscarNestVivo({}, raven, isWin)).toEqual(nest)
  })

  it('con Nest cerrado no lo encuentra, aunque el archivo de auth siga ahí', async () => {
    ensureLocalAuthMaterial(raven)
    expect(await buscarNestVivo({}, raven, isWin, 300)).toBeNull()
  })

  it('una variable vieja que apunta a un socket muerto no gana sobre el Nest vivo del disco', async () => {
    const nest = levantarNest()
    const muerto = isWin ? '\\\\.\\pipe\\nest-memory-muerto-x' : join(raven, 'muerto.sock')
    expect(await buscarNestVivo({ NEST_MEMORY_SOCKET: muerto, NEST_MEMORY_TOKEN: 'viejo' }, raven, isWin, 300))
      .toEqual(nest)
  })

  it('un token equivocado no cuenta como vivo: no podría hablarle', async () => {
    const nest = levantarNest()
    expect(await buscarNestVivo({ NEST_MEMORY_SOCKET: nest.socket, NEST_MEMORY_TOKEN: 'otro' }, join(raven, 'nada'), isWin, 300))
      .toBeNull()
  })
})
