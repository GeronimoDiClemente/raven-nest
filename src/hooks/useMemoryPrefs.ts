// Lee y escribe las preferencias de Memories (spec §6). Lo usa MemoriesWorkspace y las
// reparte por props: nada de components/memories/ importa este hook (requisito del plugin).
import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_MEMORY_PREFS, normalizarMemoryPrefs, type MemoryPrefs } from '../lib/memory-prefs'
import { encolarEscrituraDeSettings, __reiniciarColaDeSettings } from '../lib/cola-de-settings'

type PuenteDeSettings = { get: () => Promise<unknown>; set: (data: unknown) => Promise<unknown> }

function puente(): PuenteDeSettings | null {
  const s = (window as unknown as { settings?: PuenteDeSettings }).settings
  return s && typeof s.get === 'function' && typeof s.set === 'function' ? s : null
}

// Caché de sesión, como las pestañas: reabrir el overlay no espera al preload ni dibuja un
// cuadro con los defaults antes de lo guardado. Sólo se llena con una lectura que salió bien:
// mientras es null, nada se escribe (final review M4), porque se guardarían los defaults más el
// cambio encima de lo que hay en disco.
let cache: MemoryPrefs | null = null

async function persistir(next: MemoryPrefs): Promise<void> {
  const api = puente()
  if (!api) return
  try {
    // Read-modify-write (D15): sólo memoryPrefs, sobre lo que está guardado AHORA.
    const actual = ((await api.get()) ?? {}) as Record<string, unknown>
    await api.set({ ...actual, memoryPrefs: next })
  } catch (err) {
    console.error('[useMemoryPrefs] save failed:', err)
  }
}

export function useMemoryPrefs() {
  const [prefs, setPrefs] = useState<MemoryPrefs>(cache ?? DEFAULT_MEMORY_PREFS)
  const [cargadas, setCargadas] = useState(cache !== null)
  const prefsRef = useRef(prefs)

  useEffect(() => {
    if (cache) return
    let vivo = true
    void (async () => {
      let leidas: MemoryPrefs
      try {
        // Sin window.settings (tests, renderer fuera de Electron) no hay nada que leer ni
        // pisar: cuenta como cargada con los defaults.
        const s = (await puente()?.get()) as { memoryPrefs?: unknown } | null | undefined
        leidas = normalizarMemoryPrefs(s?.memoryPrefs)
      } catch (err) {
        // Queda sin cargar (controles deshabilitados, sin escrituras) y la próxima apertura
        // vuelve a intentar.
        console.error('[useMemoryPrefs] load failed:', err)
        return
      }
      cache = leidas
      if (!vivo) return
      prefsRef.current = leidas
      setPrefs(leidas)
      setCargadas(true)
    })()
    return () => { vivo = false }
  }, [])

  /** Estable. Sirve también después de desmontar (el flush de los filtros del grafo). */
  const actualizar = useCallback((cambio: (p: MemoryPrefs) => MemoryPrefs) => {
    const next = normalizarMemoryPrefs(cambio(prefsRef.current))
    prefsRef.current = next
    setPrefs(next)
    // Sin una lectura buena todavía (pendiente o fallida) el cambio vale sólo en pantalla.
    if (cache === null) return
    cache = next
    void encolarEscrituraDeSettings(() => persistir(next))
  }, [])

  return { prefs, cargadas, actualizar }
}

/** Sólo para tests: vacía la caché de sesión. */
export function __reiniciarMemoryPrefs(): void { cache = null; __reiniciarColaDeSettings() }
