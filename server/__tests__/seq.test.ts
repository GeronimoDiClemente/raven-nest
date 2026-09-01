import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getPool, migrate } from '../src/db'
import { allocateSeqRange } from '../src/seq'

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
})
