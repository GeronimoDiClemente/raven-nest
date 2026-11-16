import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

interface GitlabState {
  isConnected: boolean
  gitlabLogin: string | null
  gitlabToken: string | null
  loading: boolean
  error: string | null
}

export function useGitlab() {
  const [state, setState] = useState<GitlabState>({
    isConnected: false,
    gitlabLogin: null,
    gitlabToken: null,
    loading: true,
    error: null,
  })

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setState(s => ({ ...s, loading: false })); return }
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('gitlab_login, gitlab_token')
          .eq('id', user.id)
          .maybeSingle()
        if (error) { setState(s => ({ ...s, loading: false })); return }
        setState({
          // "Connected" requires a token — login alone (e.g. Sign in via
          // Supabase OAuth) is not enough to call the GitLab API.
          isConnected: !!data?.gitlab_token,
          gitlabLogin: data?.gitlab_login ?? null,
          gitlabToken: data?.gitlab_token ?? null,
          loading: false,
          error: null,
        })
      } catch {
        setState(s => ({ ...s, loading: false }))
      }
    })
  }, [])

  const connectGitlab = useCallback(async () => {
    setState(s => ({ ...s, error: null }))
    // Un solo flujo OAuth pendiente a la vez, igual que useGitHub: `onOAuthCode` apila
    // handlers, y un Connect abandonado seguido de otro canjeaba el mismo código dos
    // veces (el segundo canje falla y pisa el estado con un error).
    window.gitlab.removeOAuthListener()
    window.gitlab.onOAuthCode(async (code) => {
      window.gitlab.removeOAuthListener()
      try {
        const { data, error } = await supabase.functions.invoke('gitlab-oauth', { body: { code } })
        if (error) throw error
        // Edge function persisted the long-lived token to profiles; pull it
        // back so isConnected and gitlabToken reflect the new state.
        const { data: { user } } = await supabase.auth.getUser()
        let token: string | null = null
        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('gitlab_token')
            .eq('id', user.id)
            .maybeSingle()
          token = profile?.gitlab_token ?? null
        }
        setState({
          isConnected: !!token,
          gitlabLogin: data.username,
          gitlabToken: token,
          loading: false,
          error: null,
        })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        setState(s => ({ ...s, error: message, loading: false }))
      }
    })
    await window.gitlab.openOAuth()
  }, [])

  const disconnectGitlab = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('profiles').update({ gitlab_token: null, gitlab_login: null }).eq('id', user.id)
    setState({ isConnected: false, gitlabLogin: null, gitlabToken: null, loading: false, error: null })
  }, [])

  return { ...state, connectGitlab, disconnectGitlab }
}
