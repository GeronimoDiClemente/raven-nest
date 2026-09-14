import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { mergeEditorPreferences } from '../lib/ide-config-mappings'
import type { EditorPreferences, EditorTheme } from '../lib/ide-config-mappings'
import type { TemaDeTerminal } from '../lib/terminal-themes'

interface UserPreferences {
  active_team_id: string | null
  ui_settings: {
    fontSize?: number
    editorOptions?: EditorPreferences
    editorTheme?: EditorTheme
    /** Id del tema de terminal, del catálogo de `lib/terminal-themes.ts`. */
    terminalTheme?: string
    /** Subir al piso de 3:1 los colores del tema que no lo alcancen. */
    terminalThemeAutoContrast?: boolean
    /**
     * Los temas que el usuario importó de Ghostty o de Warp.
     *
     * Se guardan ENTEROS y no una ruta al archivo: el tema tiene que seguir andando si el
     * usuario desinstala Ghostty, mueve la carpeta, o abre Nest en otra máquina. Son ~700
     * bytes cada uno.
     */
    terminalThemesImportados?: TemaDeTerminal[]
    // extensible
  }
}

export function useUserPreferences() {
  const [prefs, setPrefs] = useState<UserPreferences>({
    active_team_id: null,
    ui_settings: {},
  })
  const [userId, setUserId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setLoaded(true); return }
      setUserId(user.id)
      const { data } = await supabase
        .from('user_preferences')
        .select('active_team_id, ui_settings')
        .eq('user_id', user.id)
        .maybeSingle()
      if (data) {
        setPrefs({
          active_team_id: data.active_team_id ?? null,
          ui_settings: (data.ui_settings as UserPreferences['ui_settings']) ?? {},
        })
      }
      setLoaded(true)
    })
  }, [])

  const updatePrefs = useCallback(async (updates: Partial<UserPreferences>) => {
    // Sin usuario logueado (harness E2E, pre-login) el estado local se
    // actualiza igual — la preferencia aplica en esta sesión; solo se saltea
    // la persistencia en Supabase.
    const newPrefs = { ...prefs, ...updates }
    setPrefs(newPrefs)
    if (!userId) return
    await supabase
      .from('user_preferences')
      .upsert({
        user_id: userId,
        ...updates,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
  }, [userId, prefs])

  const setActiveTeam = useCallback((teamId: string | null) => {
    updatePrefs({ active_team_id: teamId })
  }, [updatePrefs])

  const setFontSize = useCallback((size: number) => {
    updatePrefs({ ui_settings: { ...prefs.ui_settings, fontSize: size } })
  }, [updatePrefs, prefs.ui_settings])

  const setEditorOptions = useCallback((options: EditorPreferences, theme?: EditorTheme) => {
    updatePrefs({
      ui_settings: {
        ...prefs.ui_settings,
        // mergeEditorPreferences (Task 1), NOT a plain spread: a plain
        // {...old, ...new} would replace nested groups (minimap, guides,
        // bracketPairColorization, stickyScroll) wholesale instead of merging
        // their sub-fields, silently dropping old sub-fields the new import
        // doesn't happen to redefine (e.g. import #1 sets minimap.enabled,
        // import #2 only sets minimap.scale — a plain spread would lose
        // minimap.enabled even though import #2 never touched it).
        editorOptions: mergeEditorPreferences(prefs.ui_settings.editorOptions ?? {}, options),
        ...(theme ? { editorTheme: theme } : {}),
      },
    })
  }, [updatePrefs, prefs.ui_settings])

  const setEditorTheme = useCallback((theme: EditorTheme) => {
    updatePrefs({ ui_settings: { ...prefs.ui_settings, editorTheme: theme } })
  }, [updatePrefs, prefs.ui_settings])

  const setTerminalTheme = useCallback((id: string) => {
    updatePrefs({ ui_settings: { ...prefs.ui_settings, terminalTheme: id } })
  }, [updatePrefs, prefs.ui_settings])

  const setTerminalThemeAutoContrast = useCallback((on: boolean) => {
    updatePrefs({ ui_settings: { ...prefs.ui_settings, terminalThemeAutoContrast: on } })
  }, [updatePrefs, prefs.ui_settings])

  /** Suma un tema importado, o reemplaza al que ya tenía ese id. */
  const addTerminalTheme = useCallback((tema: TemaDeTerminal) => {
    const previos = prefs.ui_settings.terminalThemesImportados ?? []
    // Por `id`: re-importar el mismo archivo actualiza en vez de duplicar, que es lo que
    // pasa cuando alguien retoca su tema en Ghostty y lo vuelve a traer.
    const sinEse = previos.filter((t) => t.id !== tema.id)
    updatePrefs({
      ui_settings: {
        ...prefs.ui_settings,
        terminalThemesImportados: [...sinEse, tema],
        terminalTheme: tema.id,
      },
    })
  }, [updatePrefs, prefs.ui_settings])

  const removeTerminalTheme = useCallback((id: string) => {
    const previos = prefs.ui_settings.terminalThemesImportados ?? []
    const quedan = previos.filter((t) => t.id !== id)
    updatePrefs({
      ui_settings: {
        ...prefs.ui_settings,
        terminalThemesImportados: quedan,
        // Si estabas usando el que borraste, el select se quedaría apuntando a un id que ya
        // no existe: `temaPorId` cae al propio, pero la preferencia guardada mentiría.
        ...(prefs.ui_settings.terminalTheme === id ? { terminalTheme: undefined } : {}),
      },
    })
  }, [updatePrefs, prefs.ui_settings])

  return {
    prefs, loaded, setActiveTeam, setFontSize, setEditorOptions, setEditorTheme,
    setTerminalTheme, setTerminalThemeAutoContrast, addTerminalTheme, removeTerminalTheme,
  }
}

// A single shared instance of this hook must live in App.tsx and be passed
// down as a prop to every consumer (Sidebar -> SettingsPanel) instead of
// each consumer calling useUserPreferences() itself. Two independent hook
// instances have no shared state or Supabase subscription between them, so
// an update made through one (e.g. SettingsPanel's "Apply" on an imported
// editor config) never reaches the other (e.g. App.tsx's instance, which is
// what actually feeds editorOptions/editorTheme into EditorPane) until a
// full app restart re-mounts both from scratch.
export type UserPreferencesApi = ReturnType<typeof useUserPreferences>
