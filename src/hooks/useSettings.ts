import { useState, useEffect, useCallback } from 'react'
import { AppSettings, DEFAULT_SETTINGS, Keybindings } from '../lib/keybindings'

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)

  useEffect(() => {
    (async () => {
      try {
        const s = await window.settings.get()
        setSettings({
          voiceLanguage: (s as AppSettings).voiceLanguage ?? DEFAULT_SETTINGS.voiceLanguage,
          keybindings: { ...DEFAULT_SETTINGS.keybindings, ...s.keybindings }
        })
      } catch (err) {
        console.error('[useSettings] load failed:', err)
        // Keep DEFAULT_SETTINGS as the initial state on failure.
      }
    })()
  }, [])

  const updateKeybinding = useCallback(async (action: keyof Keybindings, key: string) => {
    setSettings(prev => {
      const next: AppSettings = {
        ...DEFAULT_SETTINGS,
        ...prev,
        keybindings: { ...DEFAULT_SETTINGS.keybindings, ...prev.keybindings, [action]: key },
      }
      window.settings.set(next)
      return next
    })
  }, [])

  const updateVoiceLanguage = useCallback((lang: string) => {
    setSettings(prev => {
      const next: AppSettings = { ...DEFAULT_SETTINGS, ...prev, voiceLanguage: lang }
      window.settings.set(next)
      return next
    })
  }, [])

  return { settings, updateKeybinding, updateVoiceLanguage }
}
