/**
 * El estado de la TUI de Nest Memory, sin Ink y sin I/O.
 *
 * `reducir` recibe el estado y una acción (una tecla, o el resultado de algo que pidió) y
 * devuelve el estado nuevo MÁS los efectos que hay que ejecutar. Quien los ejecuta es un
 * runner aparte: acá nada toca disco, red ni procesos, así que todo se prueba con vitest.
 *
 * La cancelación del debounce de búsqueda también es del runner: `buscar` lleva `enMs` y un
 * pedido nuevo reemplaza al anterior.
 */
import type { ObservationSummary, WikilinkResuelto } from '../memory-protocol'
import { enmascararCodigo } from '../wikilinks'

export type Pestana = 'recent' | 'search' | 'status' | 'doctor'

export interface Vista { tipo: 'detalle'; syncId: string; linkEnfocado: number | null; scroll: number }

/** Lo que devuelve `memory.get`, sin los vecinos. */
export interface DetalleDeMemoria {
  item: ObservationSummary
  resolvedLinks: WikilinkResuelto[]
  pendingLinks: string[]
}

export interface EstadoDeLaTui {
  pestana: Pestana
  todosLosProyectos: boolean
  lista: ObservationSummary[]
  cursor: number
  consulta: string
  /** Vacía = se ve la pestaña; el tope es el detalle visible. */
  pila: Vista[]
  /** El del tope de la pila. */
  detalle: DetalleDeMemoria | null
  aviso: { texto: string; tipo: 'info' | 'error' } | null
  confirmando: { syncId: string; titulo: string } | null
  errorDeEditor: { mensaje: string; archivo: string } | null
  ayuda: boolean
  cargando: boolean
}

/** Los campos de `key` de Ink `useInput` que usamos; no importamos ink para no atar el reducer. */
export interface Tecla {
  upArrow?: boolean
  downArrow?: boolean
  return?: boolean
  escape?: boolean
  tab?: boolean
  shift?: boolean
  ctrl?: boolean
  meta?: boolean
  backspace?: boolean
  delete?: boolean
}

export type Accion =
  | { tipo: 'tecla'; input: string; key: Tecla }
  | { tipo: 'lista-cargada'; lista: ObservationSummary[] }
  | { tipo: 'detalle-cargado'; detalle: DetalleDeMemoria | null }
  /** Se guardó (nueva o editada): refresca lo que se ve. */
  | { tipo: 'escrito'; syncId: string | null }
  | { tipo: 'borrado'; syncId: string }
  | { tipo: 'error-de-editor'; mensaje: string; archivo: string }
  | { tipo: 'fallo'; mensaje: string }
  | { tipo: 'limpiar-aviso' }

export type Efecto =
  | { tipo: 'cargar-recientes'; todos: boolean }
  | { tipo: 'buscar'; consulta: string; enMs: 150 }
  | { tipo: 'abrir'; syncId: string }
  | { tipo: 'editar'; syncId: string | null }
  | { tipo: 'reabrir-editor'; archivo: string }
  | { tipo: 'borrar'; syncId: string }
  | { tipo: 'cargar-status' }
  | { tipo: 'cargar-doctor' }
  | { tipo: 'salir' }

type Resultado = { estado: EstadoDeLaTui; efectos: Efecto[] }

const PESTANAS: Pestana[] = ['recent', 'search', 'status', 'doctor']

export function estadoInicial(): EstadoDeLaTui {
  return {
    pestana: 'recent', todosLosProyectos: false, lista: [], cursor: 0, consulta: '',
    pila: [], detalle: null, aviso: null, confirmando: null, errorDeEditor: null,
    ayuda: false, cargando: true,
  }
}

const sin = (estado: EstadoDeLaTui, efectos: Efecto[] = []): Resultado => ({ estado, efectos })

/** Pide de nuevo lo que la pestaña actual muestra. */
function refrescar(e: EstadoDeLaTui): Efecto[] {
  switch (e.pestana) {
    case 'recent': return [{ tipo: 'cargar-recientes', todos: e.todosLosProyectos }]
    case 'search': return e.consulta ? [{ tipo: 'buscar', consulta: e.consulta, enMs: 150 }] : []
    case 'status': return [{ tipo: 'cargar-status' }]
    case 'doctor': return [{ tipo: 'cargar-doctor' }]
  }
}

function irAPestana(e: EstadoDeLaTui, p: Pestana): Resultado {
  if (p === e.pestana) return sin(e)
  const base: EstadoDeLaTui = { ...e, pestana: p, lista: [], cursor: 0, aviso: null }
  if (p === 'recent') return sin({ ...base, cargando: true }, refrescar(base))
  if (p === 'search') {
    const hay = base.consulta !== ''
    return sin({ ...base, cargando: hay }, refrescar(base))
  }
  return sin({ ...base, cargando: true }, refrescar(base))
}

/** Índices de `resolvedLinks` a los que se puede ir (los huecos se saltean). */
function linksNavegables(d: DetalleDeMemoria | null): number[] {
  if (!d) return []
  const r: number[] = []
  d.resolvedLinks.forEach((l, i) => { if (l.syncId) r.push(i) })
  return r
}

const esTexto = (input: string, key: Tecla) => input.length > 0 && !key.ctrl && !key.meta

function conTope(e: EstadoDeLaTui, cambio: Partial<Vista>): EstadoDeLaTui {
  const pila = e.pila.slice()
  pila[pila.length - 1] = { ...pila[pila.length - 1]!, ...cambio }
  return { ...e, pila }
}

function apilar(e: EstadoDeLaTui, syncId: string): Resultado {
  return sin(
    { ...e, pila: [...e.pila, { tipo: 'detalle', syncId, linkEnfocado: null, scroll: 0 }], detalle: null, cargando: true },
    [{ tipo: 'abrir', syncId }],
  )
}

function teclaEnDetalle(e: EstadoDeLaTui, input: string, key: Tecla): Resultado {
  const tope = e.pila[e.pila.length - 1]!
  if (key.escape) {
    const pila = e.pila.slice(0, -1)
    const previa = pila[pila.length - 1]
    // Volvemos a la memoria anterior: su detalle ya no está a mano, hay que pedirlo otra vez.
    if (previa) return sin({ ...e, pila, detalle: null, cargando: true }, [{ tipo: 'abrir', syncId: previa.syncId }])
    return sin({ ...e, pila, detalle: null, cargando: false })
  }
  if (key.tab) {
    const nav = linksNavegables(e.detalle)
    if (nav.length === 0) return sin(e)
    const pos = tope.linkEnfocado === null ? -1 : nav.indexOf(tope.linkEnfocado)
    const siguiente = key.shift
      ? nav[pos <= 0 ? nav.length - 1 : pos - 1]!
      : nav[(pos + 1) % nav.length]!
    return sin(conTope(e, { linkEnfocado: siguiente }))
  }
  if (key.return) {
    const l = tope.linkEnfocado === null ? null : e.detalle?.resolvedLinks[tope.linkEnfocado]
    return l?.syncId ? apilar(e, l.syncId) : sin(e)
  }
  if (key.upArrow || input === 'k') return sin(conTope(e, { scroll: Math.max(0, tope.scroll - 1) }))
  if (key.downArrow || input === 'j') return sin(conTope(e, { scroll: tope.scroll + 1 }))
  if (input === 'n') return sin(e, [{ tipo: 'editar', syncId: null }])
  if (input === 'e') return sin(e, [{ tipo: 'editar', syncId: tope.syncId }])
  if (input === 'd') {
    const titulo = e.detalle?.item.syncId === tope.syncId ? e.detalle.item.title : tope.syncId
    return sin({ ...e, confirmando: { syncId: tope.syncId, titulo } })
  }
  return sin(e)
}

function teclaEnSearch(e: EstadoDeLaTui, input: string, key: Tecla): Resultado | null {
  if (key.escape) return sin(e.consulta ? { ...e, consulta: '', lista: [], cursor: 0, cargando: false } : e)
  if (key.backspace || key.delete) {
    if (!e.consulta) return sin(e)
    const consulta = e.consulta.slice(0, -1)
    return sin(
      { ...e, consulta, lista: consulta ? e.lista : [], cursor: 0, cargando: consulta !== '' },
      [{ tipo: 'buscar', consulta, enMs: 150 }],
    )
  }
  if (esTexto(input, key) && !key.tab && !key.return) {
    const consulta = e.consulta + input
    return sin({ ...e, consulta, cursor: 0, cargando: true }, [{ tipo: 'buscar', consulta, enMs: 150 }])
  }
  return null // flechas, ⏎, Tab y Ctrl: las resuelve la lógica común
}

function teclaEnPestana(e: EstadoDeLaTui, input: string, key: Tecla): Resultado {
  const enLista = e.pestana === 'recent' || e.pestana === 'search'
  if (key.tab) {
    const i = PESTANAS.indexOf(e.pestana)
    return irAPestana(e, PESTANAS[(i + (key.shift ? PESTANAS.length - 1 : 1)) % PESTANAS.length]!)
  }
  if (enLista) {
    if (key.upArrow || (e.pestana === 'recent' && input === 'k')) return sin({ ...e, cursor: Math.max(0, e.cursor - 1) })
    if (key.downArrow || (e.pestana === 'recent' && input === 'j')) {
      return sin({ ...e, cursor: Math.max(0, Math.min(e.lista.length - 1, e.cursor + 1)) })
    }
    if (key.return) {
      const f = e.lista[e.cursor]
      return f ? apilar(e, f.syncId) : sin(e)
    }
  }
  // En Search las letras son texto: lo que sigue sólo vale en las otras pestañas.
  if (e.pestana !== 'search') {
    if (input >= '1' && input <= '4' && input.length === 1) return irAPestana(e, PESTANAS[Number(input) - 1]!)
    if (input === '/') return irAPestana(e, 'search')
    if (input === 'q') return sin(e, [{ tipo: 'salir' }])
    if (input === '?') return sin({ ...e, ayuda: true })
    if (input === 'n') return sin(e, [{ tipo: 'editar', syncId: null }])
    if (enLista) {
      const f = e.lista[e.cursor]
      if (input === 'e' && f) return sin(e, [{ tipo: 'editar', syncId: f.syncId }])
      if (input === 'd' && f) return sin({ ...e, confirmando: { syncId: f.syncId, titulo: f.title } })
      if (input === 'g' && e.pestana === 'recent') {
        const todosLosProyectos = !e.todosLosProyectos
        return sin({ ...e, todosLosProyectos, cursor: 0, cargando: true }, [{ tipo: 'cargar-recientes', todos: todosLosProyectos }])
      }
    }
  }
  return sin(e)
}

function alApretar(e: EstadoDeLaTui, input: string, key: Tecla): Resultado {
  if (key.ctrl && input === 'c') return sin(e, [{ tipo: 'salir' }])

  if (e.confirmando) {
    const { syncId } = e.confirmando
    const estado = { ...e, confirmando: null }
    return input === 'y' || input === 'Y' ? sin(estado, [{ tipo: 'borrar', syncId }]) : sin(estado)
  }
  if (e.errorDeEditor) {
    if (input === 'r') return sin(e, [{ tipo: 'reabrir-editor', archivo: e.errorDeEditor.archivo }])
    if (input === 'd' || key.escape) return sin({ ...e, errorDeEditor: null })
    return sin(e)
  }
  if (e.ayuda) {
    return input === '?' || key.escape ? sin({ ...e, ayuda: false }) : sin(e)
  }
  if (e.pila.length > 0) {
    if (input === 'q') return sin(e, [{ tipo: 'salir' }])
    if (input === '?') return sin({ ...e, ayuda: true })
    return teclaEnDetalle(e, input, key)
  }
  if (e.pestana === 'search') {
    const r = teclaEnSearch(e, input, key)
    if (r) return r
  }
  return teclaEnPestana(e, input, key)
}

export function reducir(e: EstadoDeLaTui, a: Accion): Resultado {
  switch (a.tipo) {
    case 'tecla':
      return alApretar(e, a.input, a.key)
    case 'lista-cargada':
      return sin({ ...e, lista: a.lista, cursor: Math.min(e.cursor, Math.max(0, a.lista.length - 1)), cargando: false })
    case 'detalle-cargado': {
      const tope = e.pila[e.pila.length - 1]
      // Un detalle que llega tarde, de una memoria que ya no es la del tope, se descarta.
      if (!tope || !a.detalle || a.detalle.item.syncId !== tope.syncId) return sin({ ...e, cargando: tope ? e.cargando : false })
      return sin({ ...e, detalle: a.detalle, cargando: false })
    }
    case 'escrito': {
      const estado = { ...e, errorDeEditor: null, aviso: { texto: 'Saved', tipo: 'info' as const } }
      const tope = e.pila[e.pila.length - 1]
      return sin(estado, [...refrescar(e), ...(tope ? [{ tipo: 'abrir' as const, syncId: tope.syncId }] : [])])
    }
    case 'borrado':
      return sin(
        { ...e, pila: [], detalle: null, aviso: { texto: 'Deleted', tipo: 'info' } },
        refrescar(e),
      )
    case 'error-de-editor':
      return sin({ ...e, errorDeEditor: { mensaje: a.mensaje, archivo: a.archivo } })
    case 'fallo':
      return sin({ ...e, cargando: false, aviso: { texto: a.mensaje, tipo: 'error' } })
    case 'limpiar-aviso':
      return sin({ ...e, aviso: null })
  }
}

/**
 * Parte el texto en tramos, marcando los `[[...]]` que son links de verdad. El código no
 * cuenta: la regla es la de `parsearWikilinks` (ver `enmascararCodigo`), así lo que la
 * pantalla resalta es exactamente lo que el índice resolvió.
 */
export function segmentosDeContenido(
  texto: string,
  links: WikilinkResuelto[],
): Array<{ texto: string; link?: { indice: number; syncId: string | null } }> {
  const salida: Array<{ texto: string; link?: { indice: number; syncId: string | null } }> = []
  const mascara = enmascararCodigo(texto)
  let desde = 0
  for (const m of mascara.matchAll(/\[\[([^\[\]]+?)\]\]/g)) {
    const destino = m[1]!.split('|')[0]!.split('#')[0]!.trim().toLowerCase()
    const indice = destino ? links.findIndex((l) => l.name.trim().toLowerCase() === destino) : -1
    if (indice === -1) continue
    const ini = m.index!
    if (ini > desde) salida.push({ texto: texto.slice(desde, ini) })
    salida.push({ texto: texto.slice(ini, ini + m[0].length), link: { indice, syncId: links[indice]!.syncId } })
    desde = ini + m[0].length
  }
  if (desde < texto.length) salida.push({ texto: texto.slice(desde) })
  return salida
}

/** Dos umbrales: bajo 60 columnas se oculta la fecha; bajo 40 ya no hay forma de dibujar. */
export function columnas(ancho: number): { conFecha: boolean; demasiadoAngosta: boolean } {
  return { conFecha: ancho >= 60, demasiadoAngosta: ancho < 40 }
}
