import type { Pool } from 'pg'

export interface DeleteDataResponse {
  ok: true
  deleted: { observations: number; projects: number; push_receipts: number }
}

/**
 * §5.5 — the right to delete (§6.6/§7.5 of the architecture doc), served at
 * `POST /v1/sync/delete-data` and, as an alias, at the Supabase-shaped
 * `/functions/v1/memory-sync/delete-cloud-data` that `electron/main.ts` still posts to.
 *
 * Until this existed the client got a 404 and, because it only reads `res.ok`, the user
 * was told the cloud copy was gone while it was still there — the exact silent failure
 * this whole service exists to eliminate.
 *
 * Scope: everything reachable from `auth.userId` — its observations (via its projects),
 * its projects, and the push receipts of its devices. NOT the user row and NOT its
 * devices: this is "delete my cloud data", not "delete my account", and keeping the
 * device rows means the token the caller just authenticated with still works, so a
 * reconnect does not need re-provisioning.
 *
 * One transaction, so a partial delete can never be observed. The three statements are
 * ordered children-first even though `observations.project_id` and `push_receipts.
 * device_id` both cascade — deleting explicitly is what makes the counts in the response
 * real rather than guessed.
 *
 * Deliberately scoped by PROJECT ownership, not by `observations.author_id`: a row
 * authored by this user inside somebody else's project would be another tenant's data to
 * delete, and after the `sync_id` tenancy fix in push.ts such a row can no longer be
 * created in the first place.
 */
export async function handleDeleteData(
  pool: Pool,
  auth: { userId: string }
): Promise<DeleteDataResponse> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const observations = await client.query(
      `delete from observations o using projects p
        where o.project_id = p.id and p.user_id = $1`,
      [auth.userId]
    )
    const receipts = await client.query(
      `delete from push_receipts r using devices d
        where r.device_id = d.id and d.user_id = $1`,
      [auth.userId]
    )
    const projects = await client.query('delete from projects where user_id = $1', [auth.userId])
    await client.query('commit')

    return {
      ok: true,
      deleted: {
        observations: observations.rowCount ?? 0,
        projects: projects.rowCount ?? 0,
        push_receipts: receipts.rowCount ?? 0,
      },
    }
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
  }
}
