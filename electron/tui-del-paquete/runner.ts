/**
 * El runner une el `reducir` puro con la `FuenteDeLaTui`: despacha acciones, ejecuta los
 * `Efecto` que devuelve el reducer y vuelve a despachar sus resultados.
 *
 * El estado vive acá, fuera de React: la `App` se suscribe (`useSyncExternalStore`). Así quien
 * suelta la terminal para el editor (Task 8) puede desmontar Ink y volver a montarlo con el
 * mismo runner sin perder dónde estaba el usuario.
 */
import { estadoInicial, reducir, type Accion, type Efecto, type EstadoDeLaTui } from './estado'
import type { FuenteDeLaTui } from './fuente'
import type { DatosDeStatus } from '../status-del-paquete'
import type { DatosDeDoctor } from '../doctor-del-paquete'

export type EfectoDeEditor = Efecto & { tipo: 'editar' | 'reabrir-editor' }
/** `null`: no hay nada que despachar (otra edición ya estaba en curso, o la TUI terminó). */
export type SuspenderYEditar = (e: EfectoDeEditor) => Promise<Accion | null>

export interface Instantanea {
  estado: EstadoDeLaTui
  /** El último status leído: lo usan el encabezado y la pestaña Status. */
  status: DatosDeStatus | null
  doctor: DatosDeDoctor | null
  /** Se pidió salir: la App desmonta Ink. */
  saliendo: boolean
}

export interface Runner {
  instantanea(): Instantanea
  suscribir(cb: () => void): () => void
  despachar(a: Accion): void
  /** Carga Recent y el status del encabezado. Idempotente: un re-montaje no recarga. */
  iniciar(): void
  /** Corta los timers y descarta lo que llegue tarde. */
  detener(): void
}

/** Cuántas memorias pide cada lista. */
const LIMITE = 50
/** Cuánto queda un aviso en la barra antes de volver a las teclas. */
const DURACION_DE_AVISO_MS = 4000

const mensajeDe = (err: unknown) => (err instanceof Error ? err.message : String(err))

export function crearRunner(o: { fuente: FuenteDeLaTui; suspenderYEditar: SuspenderYEditar }): Runner {
  const { fuente } = o
  let actual: Instantanea = { estado: estadoInicial(), status: null, doctor: null, saliendo: false }
  const oyentes = new Set<() => void>()
  let iniciado = false
  let detenido = false
  let busquedaPendiente: ReturnType<typeof setTimeout> | null = null
  let timerDeAviso: ReturnType<typeof setTimeout> | null = null

  function publicar(cambio: Partial<Instantanea>): void {
    actual = { ...actual, ...cambio }
    for (const cb of oyentes) cb()
  }

  function cancelarBusqueda(): void {
    if (busquedaPendiente) clearTimeout(busquedaPendiente)
    busquedaPendiente = null
  }

  /**
   * Una llamada a la fuente: su resultado se despacha salvo que el runner ya se haya detenido.
   * Se arranca dentro de un `then` para que un throw sincrónico de la fuente (o de
   * `suspenderYEditar`) también termine en `fallo`, igual que uno al despachar el resultado.
   */
  function luego<T>(hacer: () => Promise<T>, accion: (v: T) => Accion | null): void {
    Promise.resolve()
      .then(hacer)
      .then((v) => {
        if (detenido) return
        const a = accion(v)
        if (a) despachar(a)
      })
      .catch((err) => {
        if (detenido) return
        // Si despachar el fallo también tira, no hay a quién avisarle: no se deja un rechazo suelto.
        try { despachar({ tipo: 'fallo', mensaje: mensajeDe(err) }) } catch { /* nada */ }
      })
  }

  function ejecutar(ef: Efecto): void {
    switch (ef.tipo) {
      case 'cargar-recientes': {
        const { todos } = ef
        luego(() => fuente.recientes({ todos, limite: LIMITE }), (lista) => ({ tipo: 'lista-cargada', lista, de: { pestana: 'recent', todos } }))
        return
      }
      case 'buscar': {
        cancelarBusqueda()
        const { consulta } = ef
        // Consulta vacía = el usuario borró todo: se cancela lo pendiente y se vacía la lista.
        if (consulta === '') {
          despachar({ tipo: 'lista-cargada', lista: [], de: { pestana: 'search', consulta: '' } })
          return
        }
        busquedaPendiente = setTimeout(() => {
          busquedaPendiente = null
          luego(() => fuente.buscar(consulta, LIMITE), (lista) => ({ tipo: 'lista-cargada', lista, de: { pestana: 'search', consulta } }))
        }, ef.enMs)
        return
      }
      case 'abrir':
        luego(() => fuente.obtener(ef.syncId), (detalle) => ({ tipo: 'detalle-cargado', detalle }))
        return
      case 'editar':
      case 'reabrir-editor':
        luego(() => o.suspenderYEditar(ef), (a) => a)
        return
      case 'borrar': {
        const { syncId } = ef
        luego(() => fuente.borrar(syncId), () => ({ tipo: 'borrado', syncId }))
        return
      }
      case 'cargar-status':
        luego(() => fuente.status(), (status) => { publicar({ status }); return null })
        return
      case 'cargar-doctor':
        luego(() => fuente.doctor(), (doctor) => { publicar({ doctor }); return null })
        return
      case 'salir':
        detener()
        publicar({ saliendo: true })
        return
    }
  }

  function programarLimpiezaDeAviso(aviso: EstadoDeLaTui['aviso']): void {
    if (timerDeAviso) clearTimeout(timerDeAviso)
    timerDeAviso = null
    if (!aviso) return
    timerDeAviso = setTimeout(() => {
      timerDeAviso = null
      // Sólo si sigue siendo el mismo: uno más nuevo tiene su propio plazo.
      if (actual.estado.aviso === aviso) despachar({ tipo: 'limpiar-aviso' })
    }, DURACION_DE_AVISO_MS)
  }

  function despachar(a: Accion): void {
    if (detenido) return
    const antes = actual.estado
    const { estado, efectos } = reducir(antes, a)
    publicar({ estado })
    if (estado.aviso !== antes.aviso) programarLimpiezaDeAviso(estado.aviso)
    // Una búsqueda pendiente que ya no corresponde (Esc limpió la consulta, o se cambió de
    // pestaña) se cancela: si llegara a fallar, su `fallo` no trae `de` y pintaría el error
    // en la pantalla a la que el usuario se fue.
    const pideBuscar = efectos.some((ef) => ef.tipo === 'buscar')
    if (estado.pestana !== 'search' || (estado.consulta !== antes.consulta && !pideBuscar)) cancelarBusqueda()
    for (const ef of efectos) ejecutar(ef)
  }

  function detener(): void {
    detenido = true
    cancelarBusqueda()
    if (timerDeAviso) clearTimeout(timerDeAviso)
    timerDeAviso = null
  }

  return {
    instantanea: () => actual,
    suscribir(cb) {
      oyentes.add(cb)
      return () => { oyentes.delete(cb) }
    },
    despachar,
    iniciar() {
      if (iniciado) return
      iniciado = true
      ejecutar({ tipo: 'cargar-recientes', todos: false })
      ejecutar({ tipo: 'cargar-status' })
    },
    detener,
  }
}
