import type { Pool } from 'pg'
import { limitsFor } from './limits'

export interface StatusRosterProject {
  project_key: string
  display_name: string
}

export interface StatusResponse {
  device_id: string
  user_id: string
  plan: string
  next_poll_ms: number
  server_time: string
  quota: { used_bytes: number; max_bytes: number }
  // §5.3.1: the roster — keys and display names only, NEVER rows. `handlePull` only ever
  // returns rows for cursors the device already sent (the M25 hot-loop guarantee), so a
  // project a device has never seen locally can never surface through pull no matter how
  // long it waits. This is the only place a device can learn a project exists at all: the
  // client calls `ensureProject()` for anything here it doesn't already know, and that
  // project's cursor (starting at 0) then travels in the NEXT pull's `cursors` naturally —
  // no row is ever handed back for a cursor the device didn't ask for.
  projects: StatusRosterProject[]
}

const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024

/**
 * `Number(...)` alone put whatever the env said straight into every status response, so
 * `MAX_BYTES_PER_USER=1gb` — or an empty value, which Number() reads as 0 — surfaced as
 * `NaN` (or a zero quota) in the client's UI, on every request, with nothing logged.
 * A misconfigured env var should fall back to the documented default, not silently make
 * the quota unreadable.
 */
export function resolveMaxBytes(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_MAX_BYTES
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_BYTES
}

// Override de INSTANCIA DEDICADA (§10 de la spec de pricing): cuando un deploy sirve a un
// solo cliente, el techo por usuario de la tabla no significa nada y el disco de la máquina
// es el límite real. Sin setear — que es el caso del servicio compartido — manda el plan.
const MAX_BYTES_OVERRIDE = process.env.MAX_BYTES_PER_USER
  ? resolveMaxBytes(process.env.MAX_BYTES_PER_USER)
  : null

// §5.3: this is the device's health check — today the client has no way to tell a dead
// subsystem from a healthy-but-unsynced one — and it is where the server hands back
// `next_poll_ms`, the one real cost lever the design has (~99% of pulls come back empty).
export async function handleStatus(
  pool: Pool,
  auth: { deviceId: string; userId: string; plan: string }
): Promise<StatusResponse> {
  // `where p.user_id = $1` is load-bearing: without it this sums every user's bytes, not
  // just this one's, and leaks the size of other tenants' data through a health check.
  // `coalesce(o.content, '')` is likewise required — a tombstone has null content, and
  // summing octet_length over a raw null would blow up rather than count as zero.
  const { rows } = await pool.query(
    `select coalesce(sum(octet_length(coalesce(o.content, ''))), 0)::bigint as used
       from observations o join projects p on p.id = o.project_id
      where p.user_id = $1`,
    [auth.userId]
  )

  // `where user_id = $1` is load-bearing here too, same as the quota query above: without
  // it every user's project roster leaks into every other user's status response.
  const { rows: projectRows } = await pool.query(
    `select project_key, display_name from projects where user_id = $1 order by project_key`,
    [auth.userId]
  )

  const limits = limitsFor(auth.plan)

  return {
    device_id: auth.deviceId,
    user_id: auth.userId,
    plan: auth.plan,
    next_poll_ms: limits.nextPollMs,
    server_time: new Date().toISOString(),
    quota: { used_bytes: Number(rows[0].used), max_bytes: MAX_BYTES_OVERRIDE ?? limits.maxBytes },
    projects: projectRows.map((r) => ({ project_key: r.project_key, display_name: r.display_name })),
  }
}
