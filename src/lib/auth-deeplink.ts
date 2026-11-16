// Qué hacer con un `nest://auth/callback` que llega del navegador o del sistema.
//
// El cliente de Supabase usa PKCE (src/lib/supabase.ts): el callback trae un `?code=` que sólo se
// canjea con el verificador que ESTA instalación guardó al empezar el login. Antes era el flujo
// implícito —los tokens en el fragmento— y la app hacía `setSession` con lo que viniera: un link
// `nest://x#access_token=…&refresh_token=…` armado con la cuenta de otro reemplazaba tu sesión
// por la suya sin avisar (auditoría 2026-11-05). Los tokens del fragmento ya no se aceptan nunca.
//
// Puro a propósito: sin Supabase ni React, se testea con strings.

export type AccionDeDeepLink =
  | { tipo: 'canjear'; code: string }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'ignorar' }

const CONFLICTO_DE_IDENTIDAD =
  'This email is already linked to another sign-in method (Google or email/password). Sign in with that method first, then connect GitHub from Settings → Account.'

/** Lo que se muestra cuando llega un link con tokens: viejo (de antes de PKCE) o armado por otro. */
export const LINK_NO_VALIDO = "This sign-in link can't be used. Start the sign-in again from Nest."

export function leerDeepLinkDeAuth(url: string): AccionDeDeepLink {
  if (!url.startsWith('nest://auth/callback')) return { tipo: 'ignorar' }
  const queryRaw = url.includes('?') ? url.split('?')[1]!.split('#')[0]! : ''
  const query = new URLSearchParams(queryRaw)

  // Los errores vuelven como query (?error=...&error_description=...).
  const errorCode = query.get('error_code') || query.get('error')
  const errorDescription = query.get('error_description')
  if (errorCode || errorDescription) {
    const desc = (errorDescription ?? '').toLowerCase()
    const conflicto =
      errorCode === 'identity_already_exists' ||
      errorCode === 'email_exists' ||
      (desc.includes('already') && (desc.includes('email') || desc.includes('identity') || desc.includes('user')))
    return { tipo: 'error', mensaje: conflicto ? CONFLICTO_DE_IDENTIDAD : (errorDescription ?? errorCode ?? 'Sign-in failed.') }
  }

  const code = query.get('code')
  if (code) return { tipo: 'canjear', code }

  const fragmento = new URLSearchParams(url.split('#')[1] ?? '')
  if (fragmento.get('access_token') || fragmento.get('refresh_token')) return { tipo: 'error', mensaje: LINK_NO_VALIDO }
  return { tipo: 'ignorar' }
}

/**
 * ¿El canje que viene es el de un reset de contraseña? auth-js guarda `"<verificador>/PASSWORD_RECOVERY"`
 * (JSON) en `<storageKey>-code-verifier` al pedir el reset, y el canje emite SIGNED_IN, no
 * PASSWORD_RECOVERY: la app tiene que saberlo ANTES de canjear para no entrar a la App con la
 * sesión de recuperación.
 */
export function esCanjeDeRecuperacion(guardado: string | null): boolean {
  if (!guardado) return false
  let valor: unknown
  try { valor = JSON.parse(guardado) } catch { return false } // auth-js lo guarda con JSON.stringify
  return typeof valor === 'string' && valor.split('/')[1] === 'PASSWORD_RECOVERY'
}
