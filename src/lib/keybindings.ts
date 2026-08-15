export interface Keybindings {
  voiceInput: string
  newPane: string
  globalSearch: string
  commandPalette: string
  hubOverlay: string
  nextPane: string
  prevPane: string
  nextTab: string
  prevTab: string
  toggleZoom: string
  fontSizeUp: string
  fontSizeDown: string
  fontSizeReset: string
}

export interface AppSettings {
  keybindings: Keybindings
  voiceLanguage: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  voiceLanguage: 'es',
  keybindings: {
    voiceInput: 'F5',
    newPane: 'Meta+t',
    globalSearch: 'Meta+f',
    commandPalette: 'Meta+k',
    hubOverlay: 'Meta+Shift+O',
    nextPane: 'Meta+ArrowRight',
    prevPane: 'Meta+ArrowLeft',
    nextTab: 'Ctrl+Tab',
    prevTab: 'Ctrl+Shift+Tab',
    toggleZoom: 'Meta+Shift+Z',
    fontSizeUp: 'Meta+=',
    fontSizeDown: 'Meta+-',
    fontSizeReset: 'Meta+0',
  }
}

const isMacPlatform = () => navigator.platform.toUpperCase().includes('MAC')

export function matchesBinding(e: KeyboardEvent, binding: string): boolean {
  if (!binding) return false
  const parts = binding.split('+')
  const key = parts[parts.length - 1]
  const needsMeta = parts.includes('Meta')
  const needsCtrl = parts.includes('Ctrl')
  const needsShift = parts.includes('Shift')
  const needsAlt = parts.includes('Alt')

  // On Windows/Linux, treat Meta bindings as Ctrl
  if (needsMeta && !isMacPlatform()) {
    return (
      e.key === key &&
      e.ctrlKey === true &&
      e.metaKey === false &&
      e.shiftKey === needsShift &&
      e.altKey === needsAlt
    )
  }

  return (
    e.key === key &&
    e.metaKey === needsMeta &&
    e.ctrlKey === needsCtrl &&
    e.shiftKey === needsShift &&
    e.altKey === needsAlt
  )
}

export function formatBinding(binding: string): string {
  if (!binding) return '—'
  const parts = binding.split('+')
  const key = parts[parts.length - 1]
  const isMac = navigator.platform.toUpperCase().includes('MAC')
  const modifiers = parts.slice(0, -1).map(m => {
    if (m === 'Meta') return isMac ? '⌘' : 'Ctrl'
    if (m === 'Shift') return '⇧'
    if (m === 'Alt') return isMac ? '⌥' : 'Alt'
    if (m === 'Ctrl') return '^'
    return m
  })
  return [...modifiers, key].join('')
}

export function eventToBinding(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.metaKey) parts.push('Meta')
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  parts.push(e.key)
  return parts.join('+')
}
