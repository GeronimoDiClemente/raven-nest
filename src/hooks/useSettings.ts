import { useState, useEffect, useCallback, useRef } from 'react'
import { AppSettings, DEFAULT_SETTINGS, Keybindings } from '../lib/keybindings'
import { normalizarMemoryPrefs } from '../lib/memory-prefs'
import { encolarEscrituraDeSettings } from '../lib/cola-de-settings'

/**
 * Escribe SÓLO lo que cambió, sobre lo que está guardado AHORA. App y
 * SettingsPanel tienen cada uno su instancia de este hook, y useMemoryPrefs escribe
 * `memoryPrefs` por su lado: con el objeto entero del estado local, el próximo `set` de una
 * instancia montada desde el arranque pisaría lo que otra guardó después. Va por la
 * misma fila que useMemoryPrefs, así el get de uno no se cruza con el set del otro.
 */
function guardar(patch: Partial<AppSettings>): Promise<void> {
  return encolarEscrituraDeSettings(async () => {
    try {
      const actual = ((await window.settings.get()) ?? {}) as Partial<AppSettings>
      await window.settings.set({ ...DEFAULT_SETTINGS, ...actual, ...patch })
    } catch (err) {
      console.error('[useSettings] save failed:', err)
    }
  })
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const actual = useRef(settings)
  actual.current = settings

  useEffect(() => {
    (async () => {
      try {
        const s = ((await window.settings.get()) ?? {}) as Partial<AppSettings>
        setSettings({
          voiceLanguage: s.voiceLanguage ?? DEFAULT_SETTINGS.voiceLanguage,
          hasSeenMemoryHub: s.hasSeenMemoryHub ?? DEFAULT_SETTINGS.hasSeenMemoryHub,
          hasSeenMemoriesWelcome: s.hasSeenMemoriesWelcome ?? DEFAULT_SETTINGS.hasSeenMemoriesWelcome,
          keybindings: { ...DEFAULT_SETTINGS.keybindings, ...s.keybindings },
          // Sin leerlo acá, el estado arrancaría con los defaults y el próximo set lo pisaría.
          memoryPrefs: normalizarMemoryPrefs(s.memoryPrefs),
        })
      } catch (err) {
        console.error('[useSettings] load failed:', err)
        // Keep DEFAULT_SETTINGS as the initial state on failure.
      }
    })()
  }, [])

  const cambiar = useCallback((patch: Partial<AppSettings>): Promise<void> => {
    actual.current = { ...actual.current, ...patch }
    setSettings((prev) => ({ ...prev, ...patch }))
    return guardar(patch)
  }, [])

  const updateKeybinding = useCallback((action: keyof Keybindings, key: string) => {
    return cambiar({ keybindings: { ...DEFAULT_SETTINGS.keybindings, ...actual.current.keybindings, [action]: key } })
  }, [cambiar])

  const updateVoiceLanguage = useCallback((lang: string) => cambiar({ voiceLanguage: lang }), [cambiar])
  const markMemoryHubSeen = useCallback(() => cambiar({ hasSeenMemoryHub: true }), [cambiar])
  const markMemoriesWelcomeSeen = useCallback(() => cambiar({ hasSeenMemoriesWelcome: true }), [cambiar])

  return { settings, updateKeybinding, updateVoiceLanguage, markMemoryHubSeen, markMemoriesWelcomeSeen }
}
