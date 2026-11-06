// Adónde puede navegar la ventana principal: sólo a la página de la app.
//
// La ventana principal carga el preload, y el preload expone `window.pty` y el resto del bridge
// sin mirar el origen de la página. Si la ventana navega a otro lado, el preload corre de nuevo
// en la página nueva: un link o un .html arrastrado sobre una zona sin handler de drop (la
// sidebar, la barra de título) la llevaba a contenido ajeno con un shell a mano (auditoría
// 2026-11-05). La app no navega nunca —es una SPA y los links salen por setWindowOpenHandler—,
// así que se fija el destino a la página que se cargó al abrir.
//
// Puro a propósito: se testea con strings.

/**
 * ¿`destino` es la página de la app? En desarrollo es el server de Vite (mismo origen, cualquier
 * ruta: un reload completo de HMR puede volver con otra). Empaquetada es un `file://` y ahí el
 * origen no sirve —es `null` para cualquier archivo del disco—, así que tiene que ser el mismo
 * archivo. La query y el hash no cuentan.
 */
export function esLaPaginaDeLaApp(destino: string, inicial: string): boolean {
  let d: URL
  let i: URL
  try {
    d = new URL(destino)
    i = new URL(inicial)
  } catch {
    return false
  }
  if (i.protocol === 'file:') return d.protocol === 'file:' && d.host === i.host && d.pathname === i.pathname
  if (i.protocol === 'http:' || i.protocol === 'https:') return d.origin === i.origin
  return false
}
