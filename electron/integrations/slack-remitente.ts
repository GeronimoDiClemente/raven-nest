// Quién puede manejar Nest desde Slack: sólo quien lo conectó.
//
// Una mención a @Nest hace cosas en ESTA máquina: `list` publica en el thread los tickets del
// dueño, `grab` crea un worktree y mueve el ticket, y cualquier otra arma un worktree y abre un
// pane con el texto de la mención como primer input. Antes la hacía cualquiera que pudiera
// mencionar al bot en el workspace —un compañero, un invitado, alguien por Slack Connect—
// (auditoría 2026-11-05). Los botones de Block Kit (`fix_ci`) igual.
//
// El dueño es el `authed_user.id` del OAuth: quien instaló la app desde Nest. Una instalación
// de antes de guardarlo no tiene dueño conocido y no obedece a nadie hasta reconectar.
//
// Puro a propósito: se testea con strings.

/** Dónde se guarda el id de Slack del dueño, en el store de credenciales de plugins. */
export const CREDENCIAL_DEL_DUENO = 'slack-owner'

export type Remitente = { ok: true } | { ok: false; motivo: 'sin-dueno' | 'otro-usuario' }

export function autorizarRemitente(user: string, dueno: string | null): Remitente {
  if (!dueno) return { ok: false, motivo: 'sin-dueno' }
  return user !== '' && user === dueno ? { ok: true } : { ok: false, motivo: 'otro-usuario' }
}

/** Lo que el bot contesta en el thread cuando no obedece. No dice nada del dueño ni de sus tickets. */
export function respuestaSinPermiso(motivo: 'sin-dueno' | 'otro-usuario'): string {
  return motivo === 'sin-dueno'
    ? 'Nest needs to be reconnected to Slack before it takes requests. Reconnect Slack from Integrations in Nest.'
    : 'Only the person who connected Nest to Slack can ask it for things.'
}
