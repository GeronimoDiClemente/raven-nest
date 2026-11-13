import { randomUUID } from 'node:crypto'
import { describe, it, expect, afterAll } from 'vitest'
import { getPool, migrate } from '../src/db'

const pool = getPool()

// The test database persists between runs, so every identifier a test writes must be
// unique per run — observations.sync_id is a global primary key, not scoped per project.
const RUN = randomUUID().slice(0, 8)
const id = (name: string) => `${RUN}-${name}`

describe('migrations', () => {
  afterAll(async () => { await pool.end() })

  it('creates every table on a fresh database', async () => {
    await migrate(pool)
    const { rows } = await pool.query(
      `select table_name from information_schema.tables where table_schema = 'public' order by table_name`
    )
    const names = rows.map((r) => r.table_name)
    for (const t of ['users', 'devices', 'projects', 'observations', 'push_receipts', 'allowlist', 'schema_migrations']) {
      expect(names).toContain(t)
    }
  })

  it('is idempotent — a second run applies nothing', async () => {
    await migrate(pool)
    const applied = await migrate(pool)
    expect(applied).toBe(0)
  })

  it('the topic index admits only one live row per (project, scope, topic)', async () => {
    await migrate(pool)
    const userId = '00000000-0000-0000-0000-0000000000aa'
    await pool.query(`insert into users (id) values ($1) on conflict do nothing`, [userId])
    const { rows: [project] } = await pool.query(
      `insert into projects (user_id, project_key, display_name) values ($1, $2, $2)
       on conflict (user_id, project_key) do update set display_name = excluded.display_name
       returning id`,
      [userId, id(`idx-test-${Date.now()}`)]
    )
    const base = [project.id, 'personal', 'a-topic', 'title', 0, new Date(), new Date(), userId]
    await pool.query(
      `insert into observations (sync_id, project_id, project_seq, scope, topic_key, title, lamport,
        client_updated_at, client_created_at, author_id, type)
       values ($9, $1, 1, $2, $3, $4, $5, $6, $7, $8, 'decision')`,
      [...base, id('one')]
    )
    await expect(
      pool.query(
        `insert into observations (sync_id, project_id, project_seq, scope, topic_key, title, lamport,
          client_updated_at, client_created_at, author_id, type)
         values ($9, $1, 2, $2, $3, $4, $5, $6, $7, $8, 'decision')`,
        [...base, id('two')]
      )
    ).rejects.toThrow(/obs_topic_uniq/)
  })
})
