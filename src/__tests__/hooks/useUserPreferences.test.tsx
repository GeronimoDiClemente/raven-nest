import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useUserPreferences } from '../../hooks/useUserPreferences'

// Mismo patrón de mock de supabase que SettingsPanel.test.tsx: el hook habla
// con supabase directamente, acá se stubea la cadena select/eq/maybeSingle y
// el upsert para poder observar qué persiste.
const supabaseMock = vi.hoisted(() => {
  const maybeSingle = vi.fn()
  const upsert = vi.fn().mockResolvedValue({ error: null })
  return {
    auth: { getUser: vi.fn() },
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })),
      upsert,
    })),
    _maybeSingle: maybeSingle,
    _upsert: upsert,
  }
})
vi.mock('../../lib/supabase', () => ({ supabase: supabaseMock }))

describe('useUserPreferences — editorTheme widening', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    supabaseMock._maybeSingle.mockResolvedValue({ data: null })
    supabaseMock._upsert.mockResolvedValue({ error: null })
  })

  it('round-trips an arbitrary shiki theme name from ui_settings (no vs/vs-dark union)', async () => {
    supabaseMock._maybeSingle.mockResolvedValue({
      data: { active_team_id: null, ui_settings: { editorTheme: 'one-dark-pro' } },
    })
    const { result } = renderHook(() => useUserPreferences())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.prefs.ui_settings.editorTheme).toBe('one-dark-pro')
  })

  it('setEditorTheme persists the selected theme name preserving the rest of ui_settings', async () => {
    supabaseMock._maybeSingle.mockResolvedValue({
      data: { active_team_id: null, ui_settings: { fontSize: 13 } },
    })
    const { result } = renderHook(() => useUserPreferences())
    await waitFor(() => expect(result.current.loaded).toBe(true))

    await act(async () => { result.current.setEditorTheme('dracula') })

    expect(result.current.prefs.ui_settings.editorTheme).toBe('dracula')
    expect(result.current.prefs.ui_settings.fontSize).toBe(13)
    expect(supabaseMock._upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'u1',
        ui_settings: expect.objectContaining({ editorTheme: 'dracula', fontSize: 13 }),
      }),
      { onConflict: 'user_id' },
    )
  })

  it('leaves editorTheme undefined when the stored settings have none (consumers fall back to vs-dark)', async () => {
    const { result } = renderHook(() => useUserPreferences())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.prefs.ui_settings.editorTheme).toBeUndefined()
  })
})
