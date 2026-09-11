// El modo sin daemon: leer la memoria con Nest cerrado.
//
// Es lo que decide si la memoria es una feature del PLUGIN o una función de la APP. Hasta
// ahora el shim se apagaba con "memory is disabled for this session" cuando no encontraba el
// socket, y quien se llevaba el plugin a otro editor se quedaba sin nada.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MemoryStore } from '../memory-store'
import { MemoryReadonlyClient, SIN_APP, esMetodoDeLectura } from '../memory-mcp/readonly'
import { writeActivePointer, readActivePointer, activePointerPath } from '../memory-active-store'
import type { ObservationSummary } from '../memory-protocol'

let home: string

beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'raven-ro-')) })
afterEach(() => { try { rmSync(home, { recursive: true, force: true }) } catch { /* ya no está */ } })

/** Una base real con memorias, en el layout que la app usa. */
function sembrar(userId: string | null = null): string {
  const dir = join(home, '.raven-nest', 'memory', userId ?? '_local')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'memory.db')
  const store = new MemoryStore(path)
  // OJO con el topicKey: guardar dos veces con el MISMO reemplaza por merge (es el
  // comportamiento documentado para un tema que evoluciona), asi que dos memorias distintas
  // necesitan topics distintos. Lo que las conecta aca es la RAMA.
  store.save({
    projectKey: 'raven-nest', type: 'decision', source: 'mcp', gitBranch: 'feat/auth',
    title: 'Auth pasa a cookies de sesión', content: 'El token en localStorage era legible.',
    topicKey: 'auth-cookies', tags: ['auth'],
  })
  store.save({
    projectKey: 'raven-nest', type: 'architecture', source: 'mcp', gitBranch: 'feat/auth',
    title: 'El refresh token se rota', content: 'Cada uso rota el refresh token.',
    topicKey: 'auth-refresh', tags: ['auth'],
  })
  // Un segundo proyecto: sin él no se puede distinguir "filtró por este repo" de "trajo
  // todo", que es justo la diferencia que varios tests de acá abajo miden.
  store.save({
    projectKey: 'otro-repo', type: 'bugfix', source: 'mcp', gitBranch: 'main',
    title: 'El mismo bug de auth acá', content: 'La cookie iba sin SameSite.',
    topicKey: 'auth-samesite', tags: ['auth'],
  })
  store.close()
  writeActivePointer(home, userId, path)
  return path
}

describe('el puntero de cuenta activa', () => {
  it('se escribe y se vuelve a leer', () => {
    const path = sembrar()
    const p = readActivePointer(home)
    expect(p?.storePath).toBe(path)
    expect(p?.userId).toBeNull()
  })

  it('sin puntero devuelve null, no revienta', () => {
    expect(readActivePointer(home)).toBeNull()
  })

  // Un puntero que sobrevivió a que borren la base es peor que no tener puntero: mandaría a
  // abrir un archivo que no está, y better-sqlite3 lo CREARÍA vacío.
  it('un puntero que apunta a un .db que ya no existe se trata como si no hubiera', () => {
    sembrar()
    const p = readActivePointer(home)!
    rmSync(p.storePath)
    expect(readActivePointer(home)).toBeNull()
  })

  it('un puntero corrupto se trata como si no hubiera', () => {
    mkdirSync(join(home, '.raven-nest', 'memory'), { recursive: true })
    writeFileSync(activePointerPath(home), '{ esto no es json', 'utf8')
    expect(readActivePointer(home)).toBeNull()
  })
})

describe('qué sabe responder sin la app', () => {
  // Leer es TODO lo que el modo sin daemon tiene que saber hacer. Antes sólo estaba el
  // grafo —no por diseño, sino porque era la única lectura que ya vivía como función sobre
  // `db`— y el resultado era que con el plugin en otro editor veías el dibujo de tus
  // memorias pero no podías abrir ninguna.
  it('las cuatro lecturas sí', () => {
    for (const m of ['memory.graph', 'memory.search', 'memory.context', 'memory.get'] as const) {
      expect(esMetodoDeLectura(m)).toBe(true)
    }
  })

  // Escribir sin el daemon es lo único que este diseño no permite: es quien sincroniza,
  // resuelve conflictos y lleva el lamport. Un segundo escritor sin esa coordinación produce
  // divergencias que el merge no puede arreglar después.
  it('guardar, actualizar y promover NO', () => {
    for (const m of ['memory.save', 'memory.update', 'memory.promote', 'memory.delete'] as const) {
      expect(esMetodoDeLectura(m)).toBe(false)
    }
  })
})

describe('MemoryReadonlyClient', () => {
  it('dibuja el grafo leyendo el disco, sin daemon', async () => {
    sembrar()
    const c = new MemoryReadonlyClient(home)
    const { text } = await c.call<{ text: string }>('memory.graph', {})
    expect(text).toContain('Auth pasa a cookies de sesión')
    expect(text).toContain('El refresh token se rota')
    // Las dos se escribieron en la misma rama, así que tiene que haber una relación dibujada.
    expect(text).toContain('misma rama')
    c.close()
  })

  // Quien lee esto tiene que saber que está mirando una foto del disco, que puede estar
  // atrás de lo que la nube ya tiene.
  it('el dibujo avisa que Nest está cerrado', async () => {
    sembrar()
    const c = new MemoryReadonlyClient(home)
    const { text } = await c.call<{ text: string }>('memory.graph', {})
    expect(text).toMatch(/Nest cerrado/)
    c.close()
  })

  it('filtra por tag', async () => {
    sembrar()
    const c = new MemoryReadonlyClient(home)
    const { text } = await c.call<{ text: string }>('memory.graph', { tag: 'auth' })
    expect(text).toContain('#auth')
    const vacio = await c.call<{ text: string }>('memory.graph', { tag: 'no-existe' })
    expect(vacio.text).toMatch(/No hay memorias que coincidan/)
    c.close()
  })

  // El mensaje tiene que decir qué falta y qué hacer: quien lo lee es un agente que tiene que
  // decidir si reintentar o avisarle al usuario.
  it('escribir dice por qué no puede y qué hacer, no un error de transporte', async () => {
    sembrar()
    const c = new MemoryReadonlyClient(home)
    await expect(c.call('memory.save', {})).rejects.toThrow(SIN_APP)
    await expect(c.call('memory.save', {})).rejects.toThrow(/Nest/)
    c.close()
  })

  // Dos fallas distintas necesitan dos mensajes distintos. Antes las dos colapsaban en "no
  // encontré la base, abrí Nest una vez", que cuando el archivo SÍ está es mentira y manda a
  // hacer algo que no arregla nada. Pasó de verdad: con el binding nativo de better-sqlite3
  // compilado para otro ABI, el agente veía "no memory database was found" y el error real
  // quedaba sólo en stderr.
  it('una base que está pero no abre dice ESO, no "no la encontré"', async () => {
    const dir = join(home, '.raven-nest', 'memory', '_local')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'memory.db')
    writeFileSync(path, 'esto no es una base de datos', 'utf8')
    writeActivePointer(home, null, path)

    const c = new MemoryReadonlyClient(home)
    await expect(c.call('memory.graph', {})).rejects.toThrow(/could not be opened/i)
    await expect(c.call('memory.graph', {})).rejects.toThrow(path)
    // Y explícitamente NO el consejo que no sirve para este caso.
    await expect(c.call('memory.graph', {})).rejects.not.toThrow(/no memory database was found/i)
    c.close()
  })

  it('sin puntero, lo dice en vez de inventar una base vacía', async () => {
    const c = new MemoryReadonlyClient(home)
    await expect(c.call('memory.graph', {})).rejects.toThrow(/no memory database was found/i)
    c.close()
  })

  // `ping` es lo que un caller usa para saber si hay alguien del otro lado. Tiene que
  // contestar igual sin daemon, o el caller concluye que no hay memoria en absoluto.
  it('busca por texto, con Nest cerrado', async () => {
    sembrar()
    const c = new MemoryReadonlyClient(home)
    const { items } = await c.call<{ items: ObservationSummary[] }>('memory.search', {
      query: 'refresh', projectKey: 'raven-nest',
    })
    expect(items.map((i) => i.title)).toEqual(['El refresh token se rota'])
    c.close()
  })

  it('trae el contexto del proyecto, con Nest cerrado', async () => {
    sembrar()
    const c = new MemoryReadonlyClient(home)
    const { items } = await c.call<{ items: ObservationSummary[] }>('memory.context', {
      projectKey: 'raven-nest',
    })
    expect(items).toHaveLength(2)
    // Lo más reciente primero — el mismo orden que devuelve el daemon.
    expect(items[0].updatedAt).toBeGreaterThanOrEqual(items[1].updatedAt)
    c.close()
  })

  it('abre una memoria por su id, con Nest cerrado', async () => {
    sembrar()
    const c = new MemoryReadonlyClient(home)
    const { items } = await c.call<{ items: ObservationSummary[] }>('memory.context', {
      projectKey: 'raven-nest',
    })
    const { item } = await c.call<{ item: ObservationSummary | null }>('memory.get', {
      syncId: items[0].syncId,
    })
    expect(item?.title).toBe(items[0].title)
    expect(item?.content).toBeTruthy()
    c.close()
  })

  it('un id que no existe devuelve null, no revienta', async () => {
    sembrar()
    const c = new MemoryReadonlyClient(home)
    const { item } = await c.call<{ item: ObservationSummary | null }>('memory.get', { syncId: 'no-existe' })
    expect(item).toBeNull()
    c.close()
  })

  // El agente manda su `cwd`, no una clave de proyecto: la clave la deriva el daemon, y con
  // la app abierta sale del REMOTE de git. Derivarla del path a secas daría otra clave y la
  // respuesta sería "no hay nada guardado de este repo" siendo mentira — el peor resultado
  // posible, porque parece un dato y es un bug.
  it('resuelve la clave del proyecto por el cwd, incluso si se enroló por su remote', async () => {
    const dir = join(home, '.raven-nest', 'memory', '_local')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'memory.db')
    const store = new MemoryStore(path)
    // Así lo enrola la app: clave derivada del remote, root_path del disco.
    store.ensureProject({
      projectKey: 'github.com/acme/api', displayName: 'api',
      rootPath: '/Users/alguien/code/api', remoteUrl: 'git@github.com:acme/api.git',
    })
    store.save({
      projectKey: 'github.com/acme/api', type: 'decision', source: 'mcp',
      title: 'El rate limit va en el gateway', content: 'Y no en cada handler.',
      topicKey: 'rate-limit',
    })
    store.close()
    writeActivePointer(home, null, path)

    const c = new MemoryReadonlyClient(home)
    const { items } = await c.call<{ items: ObservationSummary[] }>('memory.context', {
      cwd: '/Users/alguien/code/api',
    })
    expect(items.map((i) => i.title)).toEqual(['El rate limit va en el gateway'])
    c.close()
  })

  // Un repo que nunca se abrió en Nest es lo NORMAL para quien se llevó el plugin a otro
  // editor, no la excepción. Filtrar por una clave que la base no conoce devolvería vacío, y
  // ese vacío es indistinguible de "no tenés nada guardado".
  it('desde un repo que Nest no conoce devuelve lo que hay, no vacío', async () => {
    sembrar()
    const c = new MemoryReadonlyClient(home)
    const { items } = await c.call<{ items: ObservationSummary[] }>('memory.context', {
      cwd: '/un/repo/que/nest/nunca/vio',
    })
    expect(items).toHaveLength(3)
    // Y de los dos proyectos, no de uno solo.
    const { items: buscadas } = await c.call<{ items: ObservationSummary[] }>('memory.search', {
      cwd: '/un/repo/que/nest/nunca/vio', query: 'auth',
    })
    expect(buscadas.length).toBeGreaterThan(0)
    c.close()
  })

  // Pero cuando SÍ sabe de qué repo le hablan, filtra: si no, el contexto de un repo vendría
  // contaminado con el de todos los otros y dejaría de servir para lo que existe.
  it('desde un repo enrolado filtra por ese repo', async () => {
    sembrar()
    const dir = join(home, '.raven-nest', 'memory', '_local')
    const store = new MemoryStore(join(dir, 'memory.db'))
    store.ensureProject({
      projectKey: 'otro-repo', displayName: 'otro', rootPath: '/code/otro', remoteUrl: null,
    })
    store.close()

    const c = new MemoryReadonlyClient(home)
    const { items } = await c.call<{ items: ObservationSummary[] }>('memory.context', {
      cwd: '/code/otro',
    })
    expect(items.map((i) => i.title)).toEqual(['El mismo bug de auth acá'])
    c.close()
  })

  // El grafo avisa en su propio texto; las otras tres devuelven JSON y sin esta marca el
  // agente no tiene cómo saber que está leyendo una foto del disco.
  it('las respuestas JSON dicen que vienen de una lectura sin sincronizar', async () => {
    sembrar()
    const c = new MemoryReadonlyClient(home)
    for (const [m, params] of [
      ['memory.search', { query: 'auth' }],
      ['memory.context', {}],
      ['memory.get', { syncId: 'lo-que-sea' }],
    ] as const) {
      const r = await c.call<{ offline?: boolean }>(m, params)
      expect(r.offline).toBe(true)
    }
    c.close()
  })

  it('ping contesta aunque no haya base', async () => {
    const c = new MemoryReadonlyClient(home)
    await expect(c.call('ping', {})).resolves.toEqual({ ok: true })
    c.close()
  })
})
