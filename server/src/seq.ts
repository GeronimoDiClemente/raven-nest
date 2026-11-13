import type { PoolClient } from 'pg'

/**
 * Allocates a contiguous block of project_seq values and returns its first number.
 *
 * MUST be called inside the same transaction as the inserts that consume the range. The
 * UPDATE takes a row lock on the project for the rest of that transaction, which is what
 * serializes concurrent pushes to the same project — correct and cheap, because a project
 * has a handful of devices, not thousands.
 *
 * Deliberately NOT a global bigserial. Sequences are consumed outside the transaction, so
 * two concurrent writers can commit 105 before 104; a client polling in between sees 105,
 * advances its cursor past 104, and never pulls it. That loss is silent, which is why the
 * concurrency test around this function is not optional.
 */
export async function allocateSeqRange(
  client: PoolClient,
  projectId: number,
  count: number
): Promise<number> {
  if (count <= 0) throw new Error('allocateSeqRange: count must be positive')
  const { rows } = await client.query(
    'update projects set seq_counter = seq_counter + $2 where id = $1 returning seq_counter',
    [projectId, count]
  )
  if (rows.length === 0) throw new Error(`allocateSeqRange: no project ${projectId}`)
  return Number(rows[0].seq_counter) - count + 1
}
