import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

interface GitHubState {
  isConnected: boolean
  githubLogin: string | null
  githubToken: string | null
  loading: boolean
  error: string | null
}

export function useGitHub() {
  const [state, setState] = useState<GitHubState>({
    isConnected: false,
    githubLogin: null,
    githubToken: null,
    loading: true,
    error: null,
  })

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setState(s => ({ ...s, loading: false })); return }
      const { data } = await supabase
        .from('profiles')
        .select('github_login, github_token')
        .eq('id', user.id)
        .maybeSingle()
      setState({
        isConnected: !!data?.github_login,
        githubLogin: data?.github_login ?? null,
        githubToken: data?.github_token ?? null,
        loading: false,
        error: null,
      })
    })
  }, [])

  const connectGitHub = useCallback(async () => {
    setState(s => ({ ...s, error: null }))
    // Remove any previously-registered listener BEFORE adding a new one;
    // preload's onOAuthCode stacks ipcRenderer.on() handlers, so without
    // this, repeated calls would fire the callback N times.
    window.github.removeOAuthListener()
    window.github.onOAuthCode(async (code) => {
      window.github.removeOAuthListener()
      try {
        const { data, error } = await supabase.functions.invoke('github-oauth', { body: { code } })
        if (error) throw error
        setState({ isConnected: true, githubLogin: data.login, githubToken: null, loading: false, error: null })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        setState(s => ({ ...s, error: message, loading: false }))
      }
    })
    await window.github.openOAuth()
  }, [])

  const disconnectGitHub = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('profiles').update({ github_token: null, github_login: null }).eq('id', user.id)
    setState({ isConnected: false, githubLogin: null, githubToken: null, loading: false, error: null })
  }, [])

  return { ...state, connectGitHub, disconnectGitHub }
}
