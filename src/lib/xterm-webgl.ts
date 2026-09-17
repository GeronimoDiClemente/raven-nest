/**
 * Engancha el renderer WebGL de xterm.js, con vuelta al DOM si no se puede.
 *
 * Sin addon, xterm cae a su renderer DOM: reescribe spans y rehace layout+paint en cada
 * refresh. Medido el 2026-09-17 con un redibujo tipo TUI de 40 líneas a 20 Hz —o sea, lo
 * que hace Claude Code, no un spinner de un carácter— el renderer pasa de **18-26% de CPU
 * a 4.8%**. Eso es la batería de la app en Mac: el Nest real marca 18-22% de renderer
 * mientras una sesión trabaja, y ~4% cuando no pasa nada.
 *
 * Por qué hay fallback en vez de confiar en WebGL: Chromium limita los contextos WebGL
 * activos (~16) y al pasarse tira context loss — con muchos panes abiertos eso pasa solo.
 * Un context loss sin manejar deja el terminal en negro; descartar el addon devuelve el
 * pane al renderer DOM, que es lento pero dibuja.
 */

/** Lo único que este módulo le pide. Tipar así lo hace testeable sin DOM ni WebGL. */
export interface AddonWebglComoSea {
  dispose(): void
  onContextLoss(cb: () => void): void
  /** No lo llamamos nosotros —lo llama loadAddon— pero sin él un addon de xterm no
   *  encaja donde xterm espera uno, y el tipo del terminal deja de calzar. */
  activate(term: unknown): void
}

export interface TerminalComoSea {
  loadAddon(addon: AddonWebglComoSea): void
}

export interface DepsWebgl {
  crearAddon: () => AddonWebglComoSea
}

export interface RendererAcelerado {
  /** `false` si nunca arrancó, o si se perdió el contexto y volvimos al DOM. */
  readonly activo: boolean
  dispose(): void
}

export function activarWebgl(term: TerminalComoSea, deps: DepsWebgl): RendererAcelerado {
  let addon: AddonWebglComoSea | null = null
  let activo = false

  // Descarta una sola vez: el context loss puede llegar antes del desmontaje, y un
  // segundo dispose() sobre el addon ya muerto tira.
  const descartar = () => {
    const a = addon
    addon = null
    activo = false
    if (!a) return
    try { a.dispose() } catch { /* ya estaba muerto */ }
  }

  try {
    addon = deps.crearAddon()
    addon.onContextLoss(descartar)
    // loadAddon es lo que llama a activate(), y activate() tira si no hay WebGL2 o si
    // Chromium no da más contextos. Hasta acá no hay nada que deshacer; a partir de acá sí.
    term.loadAddon(addon)
    activo = true
  } catch {
    descartar()
  }

  return {
    get activo() { return activo },
    dispose: descartar,
  }
}
