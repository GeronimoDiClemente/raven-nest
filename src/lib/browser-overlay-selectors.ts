/**
 * Overlays del DOM que deben COLAPSAR el WebContentsView de un pane browser.
 *
 * El view es una capa nativa por encima del DOM: si queda con tamaño mientras
 * hay un modal, un popover o una vista full-screen abierta, los tapa por
 * completo y quedan invisibles e inclickeables.
 */
const OVERLAY_SELECTORS = [
  // Dialogs / modals (full-screen backdrops)
  '.dialog-overlay',
  '.confirm-overlay',
  '.team-modal-overlay',
  '.modal-overlay',
  '.cmd-overlay',
  '.global-search-overlay',
  '.repo-picker-overlay',
  '.repo-picker-modal',
  '.upgrade-modal',
  // Full-screen workspace views
  '.teams-workspace',
  // Sidebars / panels
  '.snippet-panel',
  '.mcp-panel',
  '.notification-panel',
  '.conv-overlay',
  '.conv-sidebar',
  '.diff-drawer',
  '.repo-status-panel',
  '.ts-panel',
  // Popovers / inline overlays
  '.layout-popover',
  '.layout-selector-popover',
  '.user-menu-popover',
  '.cmd-panel',
  '.pane-color-popover',
  '.resource-bar-popover',
  '.rb-overlay',
  '.port-chips-popover',
  '.wt-context-menu',
  '.ide-picker-menu',
  '.repo-menu-pop',
  // Pane-level overlays
  '.browser-port-dropdown',
  '.browser-self-origin-overlay',
]

/** Backdrop del zoom de un pane. Es el único overlay que depende de quién soy. */
const ZOOM_BACKDROP = '.zoom-backdrop'

/**
 * Selector de overlays que colapsan ESTE browser.
 *
 * Con el pane zoomeado, su propio `.zoom-backdrop` no cuenta: ahí el view hay
 * que AGRANDARLO al rect, no ocultarlo. Pero el resto de los overlays lo
 * colapsan igual — exceptuar la lista entera dejaba que un browser zoomeado
 * tapara cualquier modal abierto encima (búsqueda global, Settings, upgrade).
 */
export function overlaySelectorFor(zoomed: boolean): string {
  return (zoomed ? OVERLAY_SELECTORS : [ZOOM_BACKDROP, ...OVERLAY_SELECTORS]).join(', ')
}
