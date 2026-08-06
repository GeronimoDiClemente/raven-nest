import { useState, useEffect, useCallback } from 'react'
import { AppSettings, DEFAULT_SETTINGS, Keybindings } from '../lib/keybindings'

// Settings live in per-component state, but several components read them at once
// (the Settings panel, the App keyboard handler, terminals). A change in one
// place MUST reach the others within the same session — otherwise an edited or
// tmux-imported keybinding wouldn't take effect until the app restarts. Each
// mutation persists via window.settings.set AND broadcasts the new value on a
// window event that every useSettings() instance re-syncs from.
const SETTINGS_CHANGED = 'nest:settings-changed'

function persistAndBroadcast(next: AppSettings) {
  window.settings.set(next)
  // Defer the dispatch out of the setState updater so we never update another
  // component while React is mid-render of this one.
  queueMicrotask(() =>
    window.dispatchEvent(new CustomEvent<AppSettings>(SETTINGS_CHANGED, { detail: next })),
  )
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)

  useEffect(() => {
    (async () => {
      try {
        const s = await window.settings.get()
        setSettings({
          voiceLanguage: (s as AppSettings).voiceLanguage ?? DEFAULT_SETTINGS.voiceLanguage,
          scrollback: (s as AppSettings).scrollback ?? DEFAULT_SETTINGS.scrollback,
          keybindings: { ...DEFAULT_SETTINGS.keybindings, ...s.keybindings }
        })
      } catch (err) {
        console.error('[useSettings] load failed:', err)
        // Keep DEFAULT_SETTINGS as the initial state on failure.
      }
    })()
  }, [])

  // Re-sync when any other useSettings() instance changes a setting this session.
  useEffect(() => {
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<AppSettings>).detail
      if (next) setSettings(next)
    }
    window.addEventListener(SETTINGS_CHANGED, onChange)
    return () => window.removeEventListener(SETTINGS_CHANGED, onChange)
  }, [])

  const updateKeybinding = useCallback(async (action: keyof Keybindings, key: string) => {
    setSettings(prev => {
      const next: AppSettings = {
        ...DEFAULT_SETTINGS,
        ...prev,
        keybindings: { ...DEFAULT_SETTINGS.keybindings, ...prev.keybindings, [action]: key },
      }
      persistAndBroadcast(next)
      return next
    })
  }, [])

  const updateVoiceLanguage = useCallback((lang: string) => {
    setSettings(prev => {
      const next: AppSettings = { ...DEFAULT_SETTINGS, ...prev, voiceLanguage: lang }
      persistAndBroadcast(next)
      return next
    })
  }, [])

  const updateScrollback = useCallback((lines: number) => {
    setSettings(prev => {
      const next: AppSettings = { ...DEFAULT_SETTINGS, ...prev, scrollback: lines }
      persistAndBroadcast(next)
      return next
    })
  }, [])

  return { settings, updateKeybinding, updateVoiceLanguage, updateScrollback }
}
