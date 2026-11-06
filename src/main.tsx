import React, { useState, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom/client'
import { LucideProvider } from 'lucide-react'
import App from './App'
import AuthScreen from './components/AuthScreen'
import { supabase } from './lib/supabase'
import { leerDeepLinkDeAuth, esCanjeDeRecuperacion, LINK_NO_VALIDO } from './lib/auth-deeplink'
import { decidirSesionAlArrancar, haySesionGuardada, eventoDecideSesion } from './lib/sesion-al-arrancar'
// Geist empaquetada: la app se ve igual en Mac, Windows y Linux.
// Van ANTES de global.css para que la @font-face exista cuando el CSS la nombra.
// Sólo el subset latin (normal + italic) — la app es en
// inglés, no hace falta cyrillic/cyrillic-ext/vietnamese/latin-ext. Ver
// styles/geist-latin.css y styles/geist-mono-latin.css.
import './styles/geist-latin.css'
import './styles/geist-mono-latin.css'
import './styles/global.css'
import '@xterm/xterm/css/xterm.css'
import { ICON_SIZE, ICON_STROKE } from './lib/icons'

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

  // Process a nest:// deep link URL — called from both pull (on mount) and push (runtime).
  // PKCE: sólo se canjea un `?code=`; los tokens en el fragmento se rechazan (lib/auth-deeplink.ts).
  const handleDeepLinkUrl = async (url: string) => {
    const accion = leerDeepLinkDeAuth(url)
    if (accion.tipo === 'ignorar') return
    if (accion.tipo === 'error') { setOauthError(accion.mensaje); return }
    setOauthError(null)
    // El canje emite SIGNED_IN aunque sea un reset: el modo recuperación va ANTES, para que ese
    // SIGNED_IN no lleve a la App con la sesión de recuperación.
    const storageKey = (supabase.auth as unknown as { storageKey: string }).storageKey
    let guardado: string | null = null
    try { guardado = localStorage.getItem(`${storageKey}-code-verifier`) } catch { /* sin storage no hay canje */ }
    const recuperacion = esCanjeDeRecuperacion(guardado)
    if (recuperacion) setRecovery(true)
    const { error } = await supabase.auth.exchangeCodeForSession(accion.code)
    if (error) {
      // Sin el verificador de esta instalación (otro login en el medio, o un link ajeno) no hay sesión.
      if (recuperacion) setRecovery(false)
      setOauthError(LINK_NO_VALIDO)
    }
  }

  useEffect(() => {
    if (window.appFlags?.e2eBypass) {
      setSession(true)
      return () => {}
    }
    // Sin red o con Supabase caído, una sesión guardada alcanza para entrar: ver
    // lib/sesion-al-arrancar.ts.
    const storageKey = (supabase.auth as unknown as { storageKey: string }).storageKey
    decidirSesionAlArrancar({
      cliente: supabase.auth,
      guardada: () => { try { return haySesionGuardada(localStorage.getItem(storageKey)) } catch { return false } },
      fijar: setSession,
      setTimer: (cb, ms) => setTimeout(cb, ms),
      clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!eventoDecideSesion(event)) return
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

// El contrato de los iconos se declara UNA vez, aca, y lo hereda todo el arbol — ver
// src/lib/icons.ts para por que. Ponerlo en el provider y no en cada call site es lo que hace
// que un icono agregado manana sin leer nada salga con el peso correcto igual.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <LucideProvider size={ICON_SIZE.md} strokeWidth={ICON_STROKE} nonScalingStroke>
    <Root />
  </LucideProvider>
)
