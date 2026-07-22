import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { MultiplexerStage, ShieldMark, GoogleMark, GithubMark, GitlabMark } from './auth/AuthArt'

type Mode = 'login' | 'register' | 'forgot'
type OAuthProvider = 'google' | 'github' | 'gitlab'

// Redirect URL registered in Supabase Auth → URL Configuration → Redirect URLs
const OAUTH_REDIRECT = 'nest://auth/callback'
// Persisted last OAuth method → shows the "Last used" badge on next launch.
const LAST_OAUTH_KEY = 'nest:last-oauth'

interface AuthScreenProps {
  recoveryMode?: boolean
  oauthError?: string | null
  onDismissOauthError?: () => void
}

/** Wordmark NestMux con escudo + cursor parpadeante. */
function Wordmark({ cursor = false }: { cursor?: boolean }) {
  return (
    <div className="nx-wm">
      <ShieldMark size={20} />
      Nest<span className="nx-mx">Mux</span>
      {cursor && <span className="nx-cur nx-cur-lg" />}
    </div>
  )
}

/** Shell centrado (sin multiplexer) para vistas secundarias: reset, confirmación, etc. */
function CenteredShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="nx-root nx-centered">
      <section className="nx-auth">
        <div className="nx-card">
          <Wordmark />
          {children}
        </div>
      </section>
    </div>
  )
}

export default function AuthScreen({ recoveryMode = false, oauthError, onDismissOauthError }: AuthScreenProps) {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState(() => localStorage.getItem('nest:remembered-email') ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [lastOauth, setLastOauth] = useState<string | null>(() => localStorage.getItem(LAST_OAUTH_KEY))

  useEffect(() => {
    if (oauthError) setError(oauthError)
  }, [oauthError])
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState(false)
  const [registered, setRegistered] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('')
  const [passwordUpdated, setPasswordUpdated] = useState(false)


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
      else localStorage.setItem('nest:remembered-email', email)
    } else {
      const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: OAUTH_REDIRECT } })
      if (error) setError(error.message)
      else setRegistered(true)
    }
    setLoading(false)
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: OAUTH_REDIRECT,
    })
    if (error) setError(error.message)
    else setResetSent(true)
    setLoading(false)
  }

  // Recuerda el último proveedor OAuth usado para pintar el badge "Last used".
  const rememberOauth = (provider: OAuthProvider) => {
    localStorage.setItem(LAST_OAUTH_KEY, provider)
    setLastOauth(provider)
  }

  const handleGoogle = async () => {
    setError(null); onDismissOauthError?.()
    setOauthLoading(true)
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: OAUTH_REDIRECT,
        skipBrowserRedirect: true,
        scopes: 'openid email profile',
      },
    })
    if (error) { setError(error.message); setOauthLoading(false); return }
    if (data.url) { rememberOauth('google'); window.electronShell?.openExternal(data.url) }
    setOauthLoading(false)
  }

  const handleGitHub = async () => {
    setError(null); onDismissOauthError?.()
    setOauthLoading(true)
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: OAUTH_REDIRECT,
        skipBrowserRedirect: true,
        // read:user + user:email for identity, repo for My Repos/Teams integration.
        scopes: 'read:user user:email repo',
      },
    })
    if (error) { setError(error.message); setOauthLoading(false); return }
    if (data.url) { rememberOauth('github'); window.electronShell?.openExternal(data.url) }
    setOauthLoading(false)
  }

  const handleGitlab = async () => {
    setError(null); onDismissOauthError?.()
    setOauthLoading(true)
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'gitlab',
      options: {
        redirectTo: OAUTH_REDIRECT,
        skipBrowserRedirect: true,
        // read_api + read_repository to drive My Repos / Actions panel.
        scopes: 'read_api read_repository read_user',
      },
    })
    if (error) { setError(error.message); setOauthLoading(false); return }
    if (data.url) { rememberOauth('gitlab'); window.electronShell?.openExternal(data.url) }
    setOauthLoading(false)
  }


  const handleSetNewPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (newPassword !== newPasswordConfirm) { setError('Passwords do not match'); return }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) setError(error.message)
    else setPasswordUpdated(true)
    setLoading(false)
  }

  if (passwordUpdated) {
    return (
      <CenteredShell>
        <h2 className="nx-h2">Password updated</h2>
        <p className="nx-sub">Your password has been changed. You're now signed in.</p>
      </CenteredShell>
    )
  }

  if (recoveryMode) {
    return (
      <CenteredShell>
        <h2 className="nx-h2">Set new password</h2>
        <p className="nx-sub">Enter your new password below</p>
        <form className="nx-form" onSubmit={handleSetNewPassword}>
          <input
            className="nx-fld"
            type="password"
            placeholder="New password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            required
            minLength={6}
            autoFocus
          />
          <input
            className="nx-fld"
            type="password"
            placeholder="Confirm new password"
            value={newPasswordConfirm}
            onChange={e => setNewPasswordConfirm(e.target.value)}
            required
            minLength={6}
          />
          {error && <p className="nx-error">{error}</p>}
          <button className="nx-signin" type="submit" disabled={loading}>
            {loading ? '…' : 'Update password'}
          </button>
        </form>
      </CenteredShell>
    )
  }

  if (resetSent) {
    return (
      <CenteredShell>
        <h2 className="nx-h2">Check your email</h2>
        <p className="nx-sub">
          We sent a password reset link to <strong>{email}</strong>
        </p>
        <button className="nx-back" onClick={() => { setResetSent(false); setMode('login') }}>
          ← Back to login
        </button>
      </CenteredShell>
    )
  }

  if (mode === 'forgot') {
    return (
      <CenteredShell>
        <h2 className="nx-h2">Reset password</h2>
        <p className="nx-sub">Enter your email and we'll send you a reset link</p>
        <form className="nx-form" onSubmit={handleForgotPassword}>
          <input
            className="nx-fld"
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoFocus
          />
          {error && <p className="nx-error">{error}</p>}
          <button className="nx-signin" type="submit" disabled={loading}>
            {loading ? '…' : 'Send reset link'}
          </button>
        </form>
        <button className="nx-back" onClick={() => { setMode('login'); setError(null) }}>
          ← Back to login
        </button>
      </CenteredShell>
    )
  }

  if (registered) {
    return (
      <CenteredShell>
        <h2 className="nx-h2">Check your email</h2>
        <p className="nx-sub">
          We sent a confirmation link to <strong>{email}</strong>
        </p>
        <button className="nx-back" onClick={() => { setRegistered(false); setMode('login') }}>
          ← Back to login
        </button>
      </CenteredShell>
    )
  }

  return (
    <div className="nx-root">
      <MultiplexerStage />

      <section className="nx-auth">
        <div className="nx-card">
          <Wordmark cursor />
          <p className="nx-sub">
            {mode === 'login' ? 'Sign in to your workspace' : 'Create your free account'}
          </p>

          {/* OAuth providers */}
          <div className="nx-row3">
            <button
              className={`nx-ob${lastOauth === 'google' ? ' nx-last' : ''}`}
              onClick={handleGoogle}
              disabled={oauthLoading}
              title="Continue with Google"
            >
              {lastOauth === 'google' && <span className="nx-badge">Last used</span>}
              <GoogleMark /> Google
            </button>
            <button
              className={`nx-ob${lastOauth === 'github' ? ' nx-last' : ''}`}
              onClick={handleGitHub}
              disabled={oauthLoading}
              title="Continue with GitHub"
            >
              {lastOauth === 'github' && <span className="nx-badge">Last used</span>}
              <GithubMark /> GitHub
            </button>
            <button
              className={`nx-ob${lastOauth === 'gitlab' ? ' nx-last' : ''}`}
              onClick={handleGitlab}
              disabled={oauthLoading}
              title="Continue with GitLab"
            >
              {lastOauth === 'gitlab' && <span className="nx-badge">Last used</span>}
              <GitlabMark /> GitLab
            </button>
          </div>

          <div className="nx-or">OR</div>

          <form className="nx-form" onSubmit={handleSubmit}>
            <input
              className="nx-fld"
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
            />
            <input
              className="nx-fld"
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={6}
            />
            {error && <p className="nx-error">{error}</p>}
            <button className="nx-signin" type="submit" disabled={loading}>
              {loading ? '…' : mode === 'login' ? 'Sign in →' : 'Create account →'}
            </button>
          </form>

          {mode === 'login' && (
            <button className="nx-back" onClick={() => { setMode('forgot'); setError(null) }}>
              Forgot your password?
            </button>
          )}

          <div className="nx-foot">
            {mode === 'login' ? (
              <>New here?{' '}
                <span className="nx-lk" onClick={() => { setMode('register'); setError(null) }}>
                  Create an account
                </span>
              </>
            ) : (
              <>Already have an account?{' '}
                <span className="nx-lk" onClick={() => { setMode('login'); setError(null) }}>
                  Sign in
                </span>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
