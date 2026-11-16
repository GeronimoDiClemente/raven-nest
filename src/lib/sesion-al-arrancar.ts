// ¿Arranca la app con sesión? La decisión del primer render, separada para poder testearla.
//
// Antes, sin red o con Supabase caído, la app mandaba al login a quien tenía una sesión
// perfectamente buena: el access token vence a la hora, `getSession()` intenta refrescarlo, el
// refresh falla por red y devuelve `session: null`; encima había un tope de 5s que mandaba al
// login aunque Supabase sólo estuviera lento. Y en la pantalla de login no hay terminales: la
// app entera quedaba inutilizable por una dependencia que la terminal no necesita.
//
// La regla ahora la pone auth-js mismo: cuando el refresh falla por RED conserva la sesión en
// el storage, y cuando falla porque el refresh token ya no sirve (revocado, vencido) la borra
// (`_callRefreshToken`, auth-js 2.101). Así que "quedó una sesión guardada" distingue los dos
// casos sin mirar tipos de error. Sin red se entra con la sesión guardada; cuando vuelve, el
// auto-refresh la renueva o, si ya no sirve, emite SIGNED_OUT y ahí sí va al login.
//
// No abre nada nuevo: lo que la sesión guardada habilita es la app local. Todo lo que habla
// con un servidor sigue necesitando un token que el servidor acepte.

/** `true` si el storage tiene una sesión con refresh token (la forma que guarda auth-js). */
export function haySesionGuardada(crudo: string | null): boolean {
  if (!crudo) return false
  try {
    const v = JSON.parse(crudo) as { refresh_token?: unknown } | null
    return !!v && typeof v.refresh_token === 'string' && v.refresh_token.length > 0
  } catch {
    return false
  }
}

export interface ClienteDeSesion {
  getSession(): Promise<{ data: { session: unknown | null } }>
}

export interface DepsDeArranque {
  cliente: ClienteDeSesion
  /** Si quedó una sesión guardada, leído EN EL MOMENTO (auth-js la puede haber borrado). */
  guardada: () => boolean
  fijar: (conSesion: boolean) => void
  setTimer: (cb: () => void, ms: number) => unknown
  clearTimer: (t: unknown) => void
}

/** Lo que se espera a `getSession()` antes de decidir con lo que hay guardado. */
export const ESPERA_DE_SESION_MS = 5000

export function decidirSesionAlArrancar(d: DepsDeArranque): void {
  let resuelto = false
  // Si Supabase tarda, no se deja la pantalla en negro: se decide con lo guardado. Cuando
  // `getSession()` termine, su resultado manda igual.
  const timer = d.setTimer(() => { if (!resuelto) d.fijar(d.guardada()) }, ESPERA_DE_SESION_MS)
  d.cliente.getSession().then(({ data }) => {
    resuelto = true
    d.clearTimer(timer)
    d.fijar(!!data.session || d.guardada())
  }).catch(() => {
    resuelto = true
    d.clearTimer(timer)
    d.fijar(d.guardada())
  })
}

/**
 * `INITIAL_SESSION` no decide nada: auth-js lo emite con `null` cuando el refresh falla por red
 * (`_emitInitialSession`), y eso pisaba la decisión de arriba. El estado inicial lo pone
 * `decidirSesionAlArrancar`; los eventos que importan después son SIGNED_IN, SIGNED_OUT,
 * TOKEN_REFRESHED y USER_UPDATED.
 */
export function eventoDecideSesion(evento: string): boolean {
  return evento !== 'INITIAL_SESSION'
}
