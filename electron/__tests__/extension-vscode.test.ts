import { describe, it, expect, vi } from 'vitest'
import { activar, htmlDelPanel, type ApiDeVSCode } from '../extension-vscode'
import { estadoDelPanel } from '../panel-de-la-extension'

function apiFalsa() {
  const comandos = new Map<string, (...a: unknown[]) => unknown>()
  const mensajes: string[] = []
  const paneles: Array<{ titulo: string; html: string }> = []
  const api: ApiDeVSCode = {
    registrarComando: (id, fn) => { comandos.set(id, fn); return { dispose: () => comandos.delete(id) } },
    mostrarMensaje: (m) => { mensajes.push(m) },
    mostrarPanel: (titulo) => {
      const panel = { titulo, html: '' }
      paneles.push(panel)
      return { set html(v: string) { panel.html = v } }
    },
    copiarAlPortapapeles: vi.fn(async () => {}),
  }
  return { api, comandos, mensajes, paneles }
}

const entradaBase = {
  base: { modo: 'propia' as const, path: '/x/memory.db', nueva: false },
  cuentaConectada: false,
  enrolamiento: { estado: 'cuenta-sin-cifrado' as const },
  memorias: 120,
  ilegibles: 0,
}

describe('activar', () => {
  it('registra los comandos que la extensión declara', () => {
    const { api, comandos } = apiFalsa()
    activar(api, { configurar: () => ({ escritos: [], yaEstaban: ['/x'], saltados: [], fallados: [] }), leerEstado: () => entradaBase })
    expect([...comandos.keys()].sort()).toEqual(['nest-memory.setup', 'nest-memory.status'])
  })

  it('al activarse configura el editor que la hospeda', () => {
    // Es el punto de la extensión: hacer sola lo que hoy el usuario hace a mano.
    const { api } = apiFalsa()
    const configurar = vi.fn(() => ({ escritos: ['/x/mcp.json'], yaEstaban: [], saltados: [], fallados: [] }))
    activar(api, { configurar, leerEstado: () => entradaBase })
    expect(configurar).toHaveBeenCalledTimes(1)
  })

  it('si ya estaba configurado NO molesta con un mensaje', () => {
    // Un aviso en cada arranque de VS Code es ruido: la extensión corre siempre.
    const { api, mensajes } = apiFalsa()
    activar(api, { configurar: () => ({ escritos: [], yaEstaban: ['/x'], saltados: [], fallados: [] }), leerEstado: () => entradaBase })
    expect(mensajes).toEqual([])
  })

  it('la primera vez sí avisa que quedó configurado', () => {
    const { api, mensajes } = apiFalsa()
    activar(api, { configurar: () => ({ escritos: ['/x/mcp.json'], yaEstaban: [], saltados: [], fallados: [] }), leerEstado: () => entradaBase })
    expect(mensajes.join(' ')).toMatch(/nest memory/i)
  })

  it('un fallo al configurar se avisa, no se traga', () => {
    const { api, mensajes } = apiFalsa()
    activar(api, {
      configurar: () => ({ escritos: [], yaEstaban: [], saltados: [], fallados: [{ path: '/x', error: 'EACCES' }] }),
      leerEstado: () => entradaBase,
    })
    expect(mensajes.join(' ')).toContain('EACCES')
  })

  it('que la activación falle NO puede tumbar el editor', () => {
    // Una extensión que tira en `activate` deja a VS Code mostrando un error rojo por algo
    // que no le impide trabajar. Lo peor que puede pasar acá es quedarse sin memoria.
    const { api, mensajes } = apiFalsa()
    expect(() => activar(api, {
      configurar: () => { throw new Error('disco lleno') },
      leerEstado: () => entradaBase,
    })).not.toThrow()
    expect(mensajes.join(' ')).toContain('disco lleno')
  })

  it('el comando de status abre el panel con lo que se ve', () => {
    const { api, comandos, paneles } = apiFalsa()
    activar(api, { configurar: () => ({ escritos: [], yaEstaban: [], saltados: [], fallados: [] }), leerEstado: () => entradaBase })
    comandos.get('nest-memory.status')!()
    expect(paneles).toHaveLength(1)
    expect(paneles[0]!.html).toContain('120')
  })
})

describe('htmlDelPanel', () => {
  const html = (over = {}) => htmlDelPanel(estadoDelPanel({ ...entradaBase, ...over }))

  it('muestra el titular y la cantidad', () => {
    const h = html()
    expect(h).toContain('120')
    expect(h).toContain('Your memory lives on this machine only')
  })

  it('la huella se muestra cuando hay que compararla', () => {
    const h = html({ cuentaConectada: true, enrolamiento: { estado: 'esperando-autorizacion', huella: '7K4M-92QP' } })
    expect(h).toContain('7K4M-92QP')
  })

  it('escapa lo que viene de afuera', () => {
    // El detalle del error lo escribe el servicio, no nosotros. Un `<script>` ahí adentro
    // corre en el contexto del panel si se pega crudo.
    const h = html({ cuentaConectada: true, enrolamiento: { estado: 'error', detalle: '<img src=x onerror=alert(1)>' } })
    expect(h).not.toContain('<img src=x')
    expect(h).toContain('&lt;img')
  })

  it('no trae scripts ni recursos de afuera', () => {
    expect(html()).not.toMatch(/<script|https?:\/\//)
  })

  it('usa los colores del tema del editor y no los suyos', () => {
    // Un panel con fondo blanco adentro de un editor oscuro se ve como un bug.
    expect(html()).toContain('var(--vscode-')
  })
})
