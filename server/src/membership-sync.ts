import type { Pool } from 'pg'
import { UUID_RE } from './uuid'

/**
 * Hueco del 30-oct: `team_memberships` sólo se refrescaba en `registerDevice`, así que a un
 * miembro sacado del equipo su máquina ya conectada le seguía bajando la memoria del equipo.
 * Ahora Supabase avisa cada cambio de `team_members` (trigger + pg_net, ver la migración
 * `20261102000000_membership_sync.sql` de supabase/) con el set COMPLETO de membresías activas
 * del usuario, firmado igual que `/internal/plan` (`verificarFirmaDePlan`, `PLAN_SYNC_SECRET`).
 */
export type AvisoDeMembresias = {
  userId: string
  /** Milisegundos: cuándo calculó Supabase el set. Un aviso más viejo que el último se ignora. */
  asOf: number
  memberships: Array<{ teamId: string; teamName: string | null; role: string | null }>
}

export function leerAvisoDeMembresias(
  cuerpo: string,
):
  | { ok: true; aviso: AvisoDeMembresias }
  | { ok: false; error: 'bad_json' | 'invalid_user_id' | 'invalid_as_of' | 'invalid_memberships' } {
  let parsed: unknown
  try {
    parsed = JSON.parse(cuerpo)
  } catch {
    return { ok: false, error: 'bad_json' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'bad_json' }
  const { user_id: userId, as_of: asOf, memberships } = parsed as { user_id?: unknown; as_of?: unknown; memberships?: unknown }
  if (typeof userId !== 'string' || !UUID_RE.test(userId)) return { ok: false, error: 'invalid_user_id' }
  if (typeof asOf !== 'number' || !Number.isSafeInteger(asOf) || asOf < 0) return { ok: false, error: 'invalid_as_of' }
  if (!Array.isArray(memberships)) return { ok: false, error: 'invalid_memberships' }
  const leidas: AvisoDeMembresias['memberships'] = []
  for (const m of memberships) {
    const { team_id: teamId, team_name: teamName, role } = (m ?? {}) as { team_id?: unknown; team_name?: unknown; role?: unknown }
    if (typeof teamId !== 'string' || !UUID_RE.test(teamId)) return { ok: false, error: 'invalid_memberships' }
    leidas.push({
      teamId,
      teamName: typeof teamName === 'string' ? teamName : null,
      role: typeof role === 'string' ? role : null,
    })
  }
  return { ok: true, aviso: { userId, asOf, memberships: leidas } }
}

/**
 * Reemplaza el espejo en una transacción, con la fila del usuario bloqueada para que dos
 * avisos simultáneos no se intercalen. `false` = el aviso era más viejo que el último aplicado.
 */
export async function aplicarMembresias(pool: Pool, aviso: AvisoDeMembresias): Promise<boolean> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('insert into users (id) values ($1) on conflict (id) do nothing', [aviso.userId])
    const { rows } = await client.query('select memberships_as_of from users where id = $1 for update', [aviso.userId])
    const ultimo = rows[0]?.memberships_as_of
    if (ultimo !== null && ultimo !== undefined && Number(ultimo) > aviso.asOf) {
      await client.query('rollback')
      return false
    }
    await client.query('delete from team_memberships where user_id = $1', [aviso.userId])
    for (const m of aviso.memberships) {
      await client.query(
        `insert into team_memberships (user_id, team_id, team_name, role, status, synced_at)
         values ($1, $2, $3, $4, 'active', now())
         on conflict (user_id, team_id) do nothing`,
        [aviso.userId, m.teamId, m.teamName, m.role]
      )
    }
    await client.query('update users set memberships_as_of = $2 where id = $1', [aviso.userId, aviso.asOf])
    await client.query('commit')
    return true
  } catch (err) {
    await client.query('rollback').catch(() => { /* la conexión ya puede estar rota */ })
    throw err
  } finally {
    client.release()
  }
}
