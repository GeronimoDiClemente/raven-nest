import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getPool, migrate } from '../src/db'
import { allocateSeqRange } from '../src/seq'

// Raise the pool above the default max: 10 so the 20-writer test below issues genuinely
// concurrent connections instead of half of them queuing behind the other half — otherwise
// the test's name ("20 concurrent writers") overstates what it actually exercises.
process.env.PG_POOL_MAX = String(Math.max(20, Number(process.env.PG_POOL_MAX ?? 0)))

const pool = getPool()
let userId: string
let projectId: number

beforeAll(async () => {
  await migrate(pool)
  userId = '00000000-0000-0000-0000-0000000000bb'
  await pool.query('insert into users (id) values ($1) on conflict do nothing', [userId])
  const { rows } = await pool.query(
    `insert into projects (user_id, project_key, display_name) values ($1, $2, $2) returning id`,
    [userId, `seq-test-${Date.now()}`]
  )
  projectId = rows[0].id
})

afterAll(async () => { await pool.end() })

describe('allocateSeqRange', () => {
  it('hands out a contiguous range and advances the counter', async () => {
    const client = await pool.connect()
    try {
      await client.query('begin')
      const first = await allocateSeqRange(client, projectId, 3)
      const second = await allocateSeqRange(client, projectId, 2)
      await client.query('commit')
      expect(second).toBe(first + 3)
    } finally {
      client.release()
    }
  })

  // This is the test the spec calls mandatory. The benchmark behind the design ran on
  // PGlite, which is single-connection, so it could not have caught a gap or a duplicate.
  it('produces no gap and no duplicate under 20 concurrent writers', async () => {
    const { rows } = await pool.query(
      `insert into projects (user_id, project_key, display_name) values ($1, $2, $2) returning id, seq_counter`,
      [userId, `seq-race-${Date.now()}`]
    )
    const raceProject = rows[0].id
    const WRITERS = 20
    const PER_WRITER = 5

    const allocated = await Promise.all(
      Array.from({ length: WRITERS }, async () => {
        const client = await pool.connect()
        try {
          await client.query('begin')
          const start = await allocateSeqRange(client, raceProject, PER_WRITER)
          await client.query('commit')
          return Array.from({ length: PER_WRITER }, (_, i) => start + i)
        } finally {
          client.release()
        }
      })
    )

    const seqs = allocated.flat().sort((a, b) => a - b)
    expect(seqs.length).toBe(WRITERS * PER_WRITER)
    expect(new Set(seqs).size).toBe(seqs.length) // no duplicates
    expect(seqs[0]).toBe(1)
    expect(seqs[seqs.length - 1]).toBe(WRITERS * PER_WRITER) // no gaps
    seqs.forEach((s, i) => expect(s).toBe(i + 1))
  })

  // The 20-writer test above cannot catch an allocateSeqRange that opens its own inner
  // transaction: a single atomic UPDATE ... RETURNING yields a contiguous, duplicate-free
  // set either way. What an inner transaction actually destroys is the DURATION of the row
  // lock, and only a held-open transaction can observe that. Verified: with the correct
  // implementation B blocks until A commits; with an inner transaction it returns immediately.
  it('holds the project row lock for the whole caller transaction', async () => {
    const { rows } = await pool.query(
      `insert into projects (user_id, project_key, display_name) values ($1, $2, $2) returning id`,
      [userId, `seq-lock-${Date.now()}`]
    )
    const lockProject = rows[0].id

    const a = await pool.connect()
    const b = await pool.connect()
    try {
      await a.query('begin')
      await allocateSeqRange(a, lockProject, 1)

      let bResolvedAt = 0
      const bStarted = Date.now()
      const bCall = (async () => {
        await b.query('begin')
        await allocateSeqRange(b, lockProject, 1)
        bResolvedAt = Date.now()
        await b.query('commit')
      })()

      // Give B a real chance to finish if the lock were released early.
      await new Promise((r) => setTimeout(r, 300))
      expect(bResolvedAt).toBe(0) // still blocked, because A still holds the row

      const aCommittedAt = Date.now()
      await a.query('commit')
      await bCall

      expect(bResolvedAt).toBeGreaterThanOrEqual(aCommittedAt)
    } finally {
      a.release()
      b.release()
    }
  })
})
