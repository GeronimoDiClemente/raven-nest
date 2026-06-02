import React, { useState, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import AuthScreen from './components/AuthScreen'
import { supabase } from './lib/supabase'
import '@fontsource-variable/inter'
import '@fontsource-variable/geist-mono'
import './styles/global.css'
import '@xterm/xterm/css/xterm.css'

// Apply platform class once so CSS can adapt layout (traffic lights vs Win controls)
const platform = (window as unknown as { platform?: { isWin?: boolean; isMac?: boolean } }).platform
if (platform?.isWin) document.body.classList.add('platform-win')
else if (platform?.isMac) document.body.classList.add('platform-mac')

// session.provider_token only arrives at fresh OAuth sign-in (not on refresh).
// When the user signs in via GitHub, mirror the token into profiles so My Repos
// and Teams work without forcing a second OAuth from Settings.
async function autoLinkGithubIdentity(userId: string, providerToken: string) {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${providerToken}`, Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) return
    const ghUser = await res.json() as { login?: string }
    if (!ghUser.login) return
    await supabase.from('profiles').update({
      github_login: ghUser.login,
      github_token: providerToken,
    }).eq('id', userId)
  } catch {
    // RLS or network failure → user can still connect manually from Settings → Account.
  }
}

async function autoLinkGitlabIdentity(userId: string, providerToken: string) {
  // GitLab Supabase OAuth provider_token has a short TTL (~2h) and no refresh,
  // so storing it as gitlab_token would silently 401 after the first hours.
  // Instead we record the username only — the user gets a long-lived token by
  // clicking Connect GitLab from Settings (uses our gitlab-oauth edge fn).
  try {
    const res = await fetch('https://gitlab.com/api/v4/user', {
      headers: { Authorization: `Bearer ${providerToken}` },
    })
    if (!res.ok) return
    const glUser = await res.json() as { username?: string }
    if (!glUser.username) return
    await supabase.from('profiles').update({
      gitlab_login: glUser.username,
    }).eq('id', userId)
  } catch {
    // RLS or network failure → user can still connect manually from Settings → Account.
  }
}

function Root() {
  const [session, setSession] = useState<boolean | null>(null) // null = loading
  const [recoveryMode, setRecoveryMode] = useState(false)
  const [oauthError, setOauthError] = useState<string | null>(null)
  const recoveryModeRef = useRef(false)
  const setRecovery = (val: boolean) => { recoveryModeRef.current = val; setRecoveryMode(val) }

  // Process a nest:// deep link URL — called from both pull (on mount) and push (runtime)
  const handleDeepLinkUrl = async (url: string) => {
    // Errors come back as query params (?error=...&error_description=...);
    // success tokens come back in the hash fragment.
    const queryRaw = url.includes('?') ? url.split('?')[1].split('#')[0] : ''
    const query = new URLSearchParams(queryRaw)
    const errorCode = query.get('error_code') || query.get('error')
    const errorDescription = query.get('error_description')
    if (errorCode || errorDescription) {
      const desc = (errorDescription ?? '').toLowerCase()
      const isLinkConflict =
        errorCode === 'identity_already_exists' ||
        errorCode === 'email_exists' ||
        desc.includes('already') && (desc.includes('email') || desc.includes('identity') || desc.includes('user'))
      setOauthError(isLinkConflict
        ? 'This email is already linked to another sign-in method (Google or email/password). Sign in with that method first, then connect GitHub from Settings → Account.'
        : (errorDescription ?? errorCode ?? 'Sign-in failed.'))
      return
    }

    const hash = url.split('#')[1] ?? ''
    const params = new URLSearchParams(hash)
    const access_token = params.get('access_token')
    const refresh_token = params.get('refresh_token')
    const type = params.get('type')
    if (access_token && refresh_token) {
      setOauthError(null)
      // Set recovery mode BEFORE setSession so the SIGNED_IN event doesn't route to App
      if (type === 'recovery') setRecovery(true)
      await supabase.auth.setSession({ access_token, refresh_token })
    }
  }

  useEffect(() => {
    if (window.appFlags?.e2eBypass) {
      setSession(true)
      return () => {}
    }
    const timeout = setTimeout(() => setSession(false), 5000)
    supabase.auth.getSession().then(({ data }) => {
      clearTimeout(timeout)
      setSession(!!data.session)
    }).catch(() => {
      clearTimeout(timeout)
      setSession(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'USER_UPDATED') {
        setRecovery(false)
        setSession(!!session)
        return
      }
      // Don't override recoveryMode if we're in a recovery flow
      if (recoveryModeRef.current) return
      setSession(!!session)
      if (event === 'SIGNED_IN' && session?.user) {
        supabase.functions.invoke('on-signup', {
          body: { user: { id: session.user.id, email: session.user.email } }
        }).catch(() => {})

        const provider = (session.user.app_metadata as { provider?: string } | undefined)?.provider
        if (provider === 'github' && session.provider_token) {
          autoLinkGithubIdentity(session.user.id, session.provider_token)
        } else if (provider === 'gitlab' && session.provider_token) {
          autoLinkGitlabIdentity(session.user.id, session.provider_token)
        }
      }
    })

    // Pull: consume any URL buffered before renderer was ready (cold launch)
    if (window.electronShell?.consumePendingDeepLink) {
      window.electronShell.consumePendingDeepLink().then(url => {
        if (url) handleDeepLinkUrl(url)
      })
    }

    // Push: handle deep links arriving while app is running
    if (window.electronShell?.onDeepLink) {
      window.electronShell.onDeepLink(handleDeepLinkUrl)
    }

    return () => subscription.unsubscribe()
  }, [])

  if (session === null) return (
    <>
      <div className="global-titlebar-drag" />
      <div style={{ width: '100%', height: '100vh', background: '#0d0d0d' }} />
    </>
  )

  return (
    <>
      <div className="global-titlebar-drag" />
      {session && !recoveryMode ? <App /> : <AuthScreen recoveryMode={recoveryMode} oauthError={oauthError} onDismissOauthError={() => setOauthError(null)} />}
    </>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <Root />
)
