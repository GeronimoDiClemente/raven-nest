import { describe, it, expect } from 'vitest'
import {
  destinosDeSetup, planDeSetup, conEntrada, sinEntrada, NOMBRE_DEL_SERVIDOR,
  planDeDeshacer,
  type EntradaDelServidor,
} from '../setup-del-paquete'

const HOME = '/home/geronimo'
const ENTRADA: EntradaDelServidor = { command: 'npx', args: ['-y', 'nest-memory', 'mcp'] }

function destino(id: string, home = HOME, plataforma: NodeJS.Platform = 'darwin') {
  const d = destinosDeSetup(home, plataforma).find((x) => x.id === id)
  if (!d) throw new Error(`no hay destino ${id}`)
  return d
}

describe('el catálogo de destinos', () => {
  it('cubre los siete editores', () => {
    const ids = destinosDeSetup(HOME, 'darwin').map((d) => d.id).sort()
    expect(ids).toEqual(['claude', 'codex', 'cursor', 'gemini', 'opencode', 'qwen', 'vscode'])
  })

  it('VS Code usa la clave `servers`, no `mcpServers` como todos los demás', () => {
    // Verificado contra la documentación de VS Code el 2026-09-18. Adivinarlo habría
    // escrito una entrada que el editor ignora en silencio.
    expect(destino('vscode').clave).toEqual(['servers', NOMBRE_DEL_SERVIDOR])
    expect(destino('cursor').clave).toEqual(['mcpServers', NOMBRE_DEL_SERVIDOR])
  })

  it('opencode anida bajo `mcp`, no bajo `mcpServers`', () => {
    expect(destino('opencode').clave).toEqual(['mcp', NOMBRE_DEL_SERVIDOR])
  })

  it('codex es TOML y el resto no', () => {
    expect(destino('codex').formato).toBe('toml')
    expect(destino('opencode').formato).toBe('jsonc')
    expect(destino('claude').formato).toBe('json')
  })

  it('el config de VS Code cambia de lugar según la plataforma', () => {
    expect(destino('vscode', HOME, 'darwin').path).toContain('Application Support/Code/User')
    expect(destino('vscode', HOME, 'linux').path).toContain('.config/Code/User')
  })

  it('todos los paths cuelgan del home que le pasan', () => {
    for (const d of destinosDeSetup('/otro/home', 'darwin')) expect(d.path.startsWith('/otro/home')).toBe(true)
  })
})

describe('el plan', () => {
  const sondas = (archivos: Record<string, string>, dirs: string[] = []) => ({
    existe: (p: string) => p in archivos || dirs.includes(p),
    leer: (p: string) => archivos[p] ?? '',
  })

  it('un editor sin config ni directorio está ausente: no se toca', () => {
    const pasos = planDeSetup([destino('gemini')], sondas({}), ENTRADA)
    expect(pasos[0]!.accion).toBe('ausente')
  })

  it('un editor instalado pero sin archivo de config todavía: se crea', () => {
    const d = destino('gemini')
    const pasos = planDeSetup([d], sondas({}, [d.dirDeDeteccion!]), ENTRADA)
    expect(pasos[0]!.accion).toBe('crear')
  })

  it('un config que ya existe sin nuestra entrada: se actualiza', () => {
    const d = destino('claude')
    const pasos = planDeSetup([d], sondas({ [d.path]: '{"otra": 1}' }), ENTRADA)
    expect(pasos[0]!.accion).toBe('actualizar')
  })

  it('correrlo dos veces no cambia nada la segunda', () => {
    const d = destino('claude')
    const primero = planDeSetup([d], sondas({ [d.path]: '{"otra": 1}' }), ENTRADA)[0]!
    const segundo = planDeSetup([d], sondas({ [d.path]: primero.textoNuevo! }), ENTRADA)[0]!
    expect(segundo.accion).toBe('ya-esta')
  })

  it('el plan trae el texto que escribiría, para poder mostrarlo antes de tocar nada', () => {
    const d = destino('claude')
    const paso = planDeSetup([d], sondas({ [d.path]: '{}' }), ENTRADA)[0]!
    expect(paso.textoNuevo).toContain(NOMBRE_DEL_SERVIDOR)
    expect(paso.textoNuevo).toContain('nest-memory')
  })

  it('un paso ausente no trae texto: no hay nada que escribir', () => {
    const paso = planDeSetup([destino('qwen')], sondas({}), ENTRADA)[0]!
    expect(paso.textoNuevo).toBeNull()
  })
})

describe('JSON: agregar y sacar', () => {
  const d = destino('claude')

  it('agrega la entrada sin tocar lo que ya estaba', () => {
    const r = conEntrada('{"proyectos": {"a": 1}}', d, ENTRADA)
    const parsed = JSON.parse(r)
    expect(parsed.proyectos).toEqual({ a: 1 })
    expect(parsed.mcpServers[NOMBRE_DEL_SERVIDOR]).toEqual(ENTRADA)
  })

  it('sobre un archivo vacío arma el documento', () => {
    expect(JSON.parse(conEntrada('', d, ENTRADA)).mcpServers[NOMBRE_DEL_SERVIDOR]).toEqual(ENTRADA)
  })

  it('pisa una entrada vieja en vez de duplicarla', () => {
    const viejo = JSON.stringify({ mcpServers: { [NOMBRE_DEL_SERVIDOR]: { command: 'viejo', args: [] } } })
    const parsed = JSON.parse(conEntrada(viejo, d, ENTRADA))
    expect(parsed.mcpServers[NOMBRE_DEL_SERVIDOR]).toEqual(ENTRADA)
  })

  it('convive con otros servidores MCP del usuario', () => {
    const otro = JSON.stringify({ mcpServers: { github: { command: 'gh' } } })
    const parsed = JSON.parse(conEntrada(otro, d, ENTRADA))
    expect(parsed.mcpServers.github).toEqual({ command: 'gh' })
    expect(parsed.mcpServers[NOMBRE_DEL_SERVIDOR]).toBeDefined()
  })

  it('sacarla deja el resto intacto y no borra el archivo', () => {
    const con = conEntrada(JSON.stringify({ mcpServers: { github: { command: 'gh' } }, otra: 2 }), d, ENTRADA)
    const parsed = JSON.parse(sinEntrada(con, d))
    expect(parsed.mcpServers[NOMBRE_DEL_SERVIDOR]).toBeUndefined()
    expect(parsed.mcpServers.github).toEqual({ command: 'gh' })
    expect(parsed.otra).toBe(2)
  })

  it('sacarla de un archivo que nunca la tuvo no rompe', () => {
    expect(() => sinEntrada('{"otra": 1}', d)).not.toThrow()
    expect(JSON.parse(sinEntrada('{"otra": 1}', d)).otra).toBe(1)
  })

  it('sacarla de un archivo vacío no rompe', () => {
    expect(() => sinEntrada('', d)).not.toThrow()
  })
})

describe('JSONC: los comentarios del usuario sobreviven', () => {
  const d = destino('opencode')

  it('conserva un comentario que estaba antes', () => {
    const texto = '{\n  // esto lo escribí yo\n  "theme": "dark"\n}'
    const r = conEntrada(texto, d, ENTRADA)
    expect(r).toContain('// esto lo escribí yo')
    expect(r).toContain(NOMBRE_DEL_SERVIDOR)
  })

  it('al sacarla el comentario sigue ahí', () => {
    const texto = '{\n  // esto lo escribí yo\n  "theme": "dark"\n}'
    expect(sinEntrada(conEntrada(texto, d, ENTRADA), d)).toContain('// esto lo escribí yo')
  })
})

describe('TOML: codex', () => {
  const d = destino('codex')

  it('agrega el bloque con el nombre de tabla que usa codex', () => {
    const r = conEntrada('', d, ENTRADA)
    expect(r).toContain(`[mcp_servers.${NOMBRE_DEL_SERVIDOR}]`)
    expect(r).toContain('command = "npx"')
    expect(r).toContain('args = ["-y", "nest-memory", "mcp"]')
  })

  it('no toca lo que el usuario ya tenía', () => {
    const suyo = 'model = "o3"\n\n[mcp_servers.otro]\ncommand = "algo"\n'
    const r = conEntrada(suyo, d, ENTRADA)
    expect(r).toContain('model = "o3"')
    expect(r).toContain('[mcp_servers.otro]')
    expect(r).toContain('command = "algo"')
  })

  it('correrlo dos veces da exactamente el mismo texto', () => {
    const una = conEntrada('model = "o3"\n', d, ENTRADA)
    expect(conEntrada(una, d, ENTRADA)).toBe(una)
  })

  it('sacarlo deja el archivo como estaba antes', () => {
    const original = 'model = "o3"\n\n[mcp_servers.otro]\ncommand = "algo"\n'
    expect(sinEntrada(conEntrada(original, d, ENTRADA), d)).toBe(original)
  })

  it('sacar el bloque se lleva también sus sub-tablas', () => {
    const texto = `model = "o3"\n\n[mcp_servers.${NOMBRE_DEL_SERVIDOR}]\ncommand = "viejo"\n\n[mcp_servers.${NOMBRE_DEL_SERVIDOR}.env]\nFOO = "bar"\n\n[otra_cosa]\nx = 1\n`
    const r = sinEntrada(texto, d)
    expect(r).not.toContain('FOO')
    expect(r).not.toContain('viejo')
    expect(r).toContain('[otra_cosa]')
    expect(r).toContain('x = 1')
  })

  it('no confunde una tabla cuyo nombre EMPIEZA igual', () => {
    const texto = `[mcp_servers.${NOMBRE_DEL_SERVIDOR}_otro]\ncommand = "no tocar"\n`
    expect(sinEntrada(texto, d)).toContain('no tocar')
  })

  it('sacarlo de un archivo que no lo tiene no rompe', () => {
    expect(sinEntrada('model = "o3"\n', d)).toBe('model = "o3"\n')
  })
})

describe('TOML: casos que una mutación destapó', () => {
  const d = destino('codex')

  it('reconoce nuestra tabla aunque lleve un comentario al lado', () => {
    // TOML permite `[tabla] # comentario`. Comparar el encabezado por igualdad exacta lo
    // dejaba pasar, y entonces `--undo` no deshacía nada.
    const texto = `[mcp_servers.${NOMBRE_DEL_SERVIDOR}] # puesto por nest-memory\ncommand = "viejo"\n`
    expect(sinEntrada(texto, d)).not.toContain('viejo')
  })

  it('no toca el espaciado que el usuario ya tenía', () => {
    // El módulo promete no reescribir lo que no es suyo. Colapsar líneas en blanco de más
    // rompía esa promesa en silencio.
    const original = 'model = "o3"\n\n\n\nsandbox = "workspace"\n'
    expect(sinEntrada(conEntrada(original, d, ENTRADA), d)).toBe(original)
  })

  it('respeta un archivo que termina sin salto de línea', () => {
    const original = 'model = "o3"'
    expect(sinEntrada(conEntrada(original, d, ENTRADA), d)).toBe(original)
  })
})

describe('el plan de deshacer', () => {
  const sondas = (archivos: Record<string, string>) => ({
    existe: (p: string) => p in archivos,
    leer: (p: string) => archivos[p] ?? '',
  })

  it('un config que no existe no se crea para vaciarlo', () => {
    expect(planDeDeshacer([destino('claude')], sondas({}))[0]!.accion).toBe('ausente')
  })

  it('un config que nunca tuvo la entrada queda como está', () => {
    const d = destino('claude')
    expect(planDeDeshacer([d], sondas({ [d.path]: '{"otra": 1}' }))[0]!.accion).toBe('ya-esta')
  })

  it('deshacer devuelve el archivo a como estaba antes del setup', () => {
    const d = destino('claude')
    const original = '{\n  "otra": 1\n}'
    const conNuestra = conEntrada(original, d, ENTRADA)
    const paso = planDeDeshacer([d], sondas({ [d.path]: conNuestra }))[0]!
    expect(paso.accion).toBe('actualizar')
    expect(JSON.parse(paso.textoNuevo!)).toEqual({ otra: 1 })
  })

  it('no se lleva puestos los otros servidores MCP del usuario', () => {
    const d = destino('cursor')
    const conOtro = conEntrada('{"mcpServers": {"github": {"command": "gh"}}}', d, ENTRADA)
    const paso = planDeDeshacer([d], sondas({ [d.path]: conOtro }))[0]!
    expect(JSON.parse(paso.textoNuevo!).mcpServers).toEqual({ github: { command: 'gh' } })
  })
})

describe('deshacer no deja residuo, pero tampoco se lleva lo ajeno', () => {
  it('saca el contenedor que quedó vacío', () => {
    const d = destino('claude')
    expect(sinEntrada(conEntrada('{"otra": 1}', d, ENTRADA), d)).not.toContain('mcpServers')
  })

  it('deja el contenedor si adentro quedó algo del usuario', () => {
    const d = destino('claude')
    const r = sinEntrada(conEntrada('{"mcpServers": {"github": {"command": "gh"}}}', d, ENTRADA), d)
    expect(JSON.parse(r).mcpServers).toEqual({ github: { command: 'gh' } })
  })

  it('también en opencode, que anida bajo `mcp`', () => {
    const d = destino('opencode')
    expect(JSON.parse(sinEntrada(conEntrada('{"theme": "dark"}', d, ENTRADA), d))).toEqual({ theme: 'dark' })
  })
})
