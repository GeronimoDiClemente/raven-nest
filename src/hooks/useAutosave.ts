// Autoguardado de una nota de Memories: 1500 ms después del último cambio, sin botón. Lo que
// importa no perder (Review Focus 2): si la pestaña se cierra dentro de esos 1,5 s, el
// desmontaje guarda igual, sin esperar la respuesta.
import { useCallback, useEffect, useRef, useState } from 'react'

export interface ResultadoDeGuardado { ok: boolean; reason?: string | null; error?: string }
export type EstadoDeGuardado = 'limpio' | 'pendiente' | 'guardando' | 'guardado' | 'error' | 'reemplazada' | 'borrada'

type Valor = { title: string; content: string }

const igual = (a: Valor, b: Valor) => a.title === b.title && a.content === b.content
const clave = (v: Valor) => `${v.title.length}:${v.title}\u0000${v.content}`

export function useAutosave(opts: {
  valor: Valor
  base: Valor
  guardar: (v: Valor) => Promise<ResultadoDeGuardado>
  demoraMs?: number
  habilitado: boolean
}): { estado: EstadoDeGuardado; error: string | null; flush: () => Promise<void>; reintentar: () => void; sucio: boolean } {
  const { valor, base, guardar, demoraMs = 1500, habilitado } = opts
  const [estado, setEstado] = useState<EstadoDeGuardado>('limpio')
  const [error, setError] = useState<string | null>(null)

  // Lo último guardado, junto con la base que había cuando se guardó: si la base cambia
  // después (vino una versión nueva del store), la referencia vuelve a ser la base.
  const guardadoRef = useRef<{ baseKey: string; v: Valor } | null>(null)
  const baseKey = clave(base)
  const referencia = guardadoRef.current && guardadoRef.current.baseKey === baseKey ? guardadoRef.current.v : base
  const sucio = !igual(valor, referencia)

  const valorRef = useRef(valor)
  const baseRef = useRef(base)
  const referenciaRef = useRef(referencia)
  const guardarRef = useRef(guardar)
  const habilitadoRef = useRef(habilitado)
  valorRef.current = valor
  baseRef.current = base
  referenciaRef.current = referencia
  guardarRef.current = guardar
  habilitadoRef.current = habilitado

  const terminalRef = useRef(false)
  const enVueloRef = useRef<Valor | null>(null)
  const otraVezRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const montadoRef = useRef(true)

  const limpiarTimer = () => {
    if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null }
  }

  const flush = useCallback(async (): Promise<void> => {
    limpiarTimer()
    if (terminalRef.current || !habilitadoRef.current) return
    const v = valorRef.current
    if (v.title.trim() === '' || igual(v, referenciaRef.current)) return
    // Uno a la vez: si llega otro pedido con un guardado en vuelo, se repite al terminar.
    if (enVueloRef.current) { otraVezRef.current = true; return }
    enVueloRef.current = v
    const baseAlGuardar = clave(baseRef.current)
    if (montadoRef.current) setEstado('guardando')
    let siguiente: EstadoDeGuardado
    let mensaje: string | null = null
    try {
      const r = await guardarRef.current(v)
      if (r.ok || r.reason === 'unchanged') {
        guardadoRef.current = { baseKey: baseAlGuardar, v }
        siguiente = 'guardado'
      } else if (r.reason === 'superseded') {
        terminalRef.current = true
        siguiente = 'reemplazada'
      } else if (r.reason === 'deleted' || r.reason === 'not_found') {
        terminalRef.current = true
        siguiente = 'borrada'
      } else {
        siguiente = 'error'
        mensaje = r.error ?? null
      }
    } catch (e) {
      siguiente = 'error'
      mensaje = e instanceof Error ? e.message : String(e)
    } finally {
      enVueloRef.current = null
    }
    // Se siguió escribiendo durante el guardado: todavía hay algo pendiente.
    if (siguiente === 'guardado' && !igual(valorRef.current, v)) siguiente = 'pendiente'
    if (montadoRef.current) { setEstado(siguiente); setError(mensaje) }
    if (otraVezRef.current) {
      otraVezRef.current = false
      if (!terminalRef.current) await flush()
    }
  }, [])

  const refKey = clave(referencia)
  useEffect(() => {
    limpiarTimer()
    if (!habilitado || terminalRef.current) return
    if (!sucio) {
      setEstado((e) => (e === 'pendiente' || e === 'error' ? 'limpio' : e))
      return
    }
    setEstado((e) => (e === 'guardando' ? e : 'pendiente'))
    if (valor.title.trim() === '') return
    timerRef.current = setTimeout(() => { void flush() }, demoraMs)
    return limpiarTimer
    // `sucio` y `refKey` se derivan de valor/base/último guardado.
  }, [valor.title, valor.content, refKey, habilitado, demoraMs, sucio, flush])

  // Desmontaje con cambios: guardar sin esperar (fire-and-forget).
  useEffect(() => {
    montadoRef.current = true
    return () => {
      montadoRef.current = false
      limpiarTimer()
      const v = valorRef.current
      if (!habilitadoRef.current || terminalRef.current) return
      if (v.title.trim() === '' || igual(v, referenciaRef.current)) return
      if (enVueloRef.current && igual(enVueloRef.current, v)) return
      try {
        void guardarRef.current(v).catch(() => {})
      } catch {
        // El componente ya no está: no hay dónde mostrar el error.
      }
    }
  }, [])

  const reintentar = useCallback(() => { void flush() }, [flush])

  return { estado, error, flush, reintentar, sucio }
}
