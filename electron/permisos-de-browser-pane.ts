// Qué permisos del navegador recibe una página dentro de un browser pane.
//
// Los panes usan sesiones `persist:…` propias, y Electron APRUEBA TODO en una sesión sin
// handler: cualquier página abierta en un pane recibía cámara, micrófono, ubicación,
// notificaciones, leer el portapapeles, MIDI… sin que nadie preguntara (auditoría 2026-11-05).
// El único handler de la app estaba en `defaultSession`, que es la de la ventana principal.
//
// La regla: la app que estás desarrollando —servida desde esta máquina— puede usar lo que un
// dev necesita probar; cualquier otro origen, nada más que escribir en el portapapeles (el botón
// "copy" de una doc). Compartir pantalla no tiene handler, y sin handler Electron lo rechaza.
//
// Puro a propósito: se testea con strings.

/** Lo que puede pedir una página servida desde esta máquina. */
const PERMISOS_LOCALES = new Set(['media', 'geolocation', 'notifications', 'clipboard-read', 'clipboard-sanitized-write'])

/** Lo que puede pedir cualquier página. */
const PERMISOS_DE_CUALQUIERA = new Set(['clipboard-sanitized-write'])

/** ¿El origen es esta máquina? `localhost`, `*.localhost`, `127.0.0.0/8` o `[::1]`. */
export function esOrigenLocal(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  const h = u.hostname
  return h === 'localhost' || h.endsWith('.localhost') || h === '[::1]' || /^127(\.\d{1,3}){3}$/.test(h)
}

export function permisoDeBrowserPane(permiso: string, url: string): boolean {
  if (PERMISOS_DE_CUALQUIERA.has(permiso)) return true
  return PERMISOS_LOCALES.has(permiso) && esOrigenLocal(url)
}
