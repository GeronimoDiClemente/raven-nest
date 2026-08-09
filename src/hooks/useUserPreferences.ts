import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { mergeEditorPreferences } from '../lib/ide-config-mappings'
import type { EditorPreferences, EditorTheme } from '../lib/ide-config-mappings'

interface UserPreferences {
  active_team_id: string | null
  ui_settings: {
    fontSize?: number
    editorOptions?: EditorPreferences
    editorTheme?: EditorTheme
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
    if (!userId) return
    const newPrefs = { ...prefs, ...updates }
    setPrefs(newPrefs)
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

  return { prefs, loaded, setActiveTeam, setFontSize, setEditorOptions }
}
