import type { Pool } from 'pg'
import { NEXT_POLL_MS } from './pull'

export interface StatusResponse {
  device_id: string
  user_id: string
  plan: string
  next_poll_ms: number
  server_time: string
  quota: { used_bytes: number; max_bytes: number }
}

const MAX_BYTES = Number(process.env.MAX_BYTES_PER_USER ?? 1024 * 1024 * 1024)

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
  return {
    device_id: auth.deviceId,
    user_id: auth.userId,
    plan: auth.plan,
    next_poll_ms: NEXT_POLL_MS,
    server_time: new Date().toISOString(),
    quota: { used_bytes: Number(rows[0].used), max_bytes: MAX_BYTES },
  }
}
