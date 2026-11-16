import { describe, it, expect, beforeAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'

const pool = getPool()
beforeAll(async () => { await migrate(pool) })

describe('migración 009 — team_keys / team_key_wraps', () => {
  it('crea las tablas con las columnas esperadas', async () => {
    const teamId = randomUUID()
    const userId = randomUUID()
    await pool.query('insert into users (id) values ($1)', [userId])
    await pool.query(
      'insert into team_keys (team_id, activated_by) values ($1, $2)',
      [teamId, userId]
    )
    const { rows } = await pool.query('select * from team_keys where team_id = $1', [teamId])
    expect(rows[0].activated_by).toBe(userId)
    expect(rows[0].activated_at).toBeInstanceOf(Date)

    await pool.query(
      `insert into team_key_wraps (team_id, slot, kind, wrapped, wrap_meta)
       values ($1, $2, 'device', 'W', null)`,
      [teamId, userId]
    )
    const wraps = await pool.query('select * from team_key_wraps where team_id = $1', [teamId])
    expect(wraps.rows).toHaveLength(1)
  })

  it('borra las wraps en cascada si se borra la fila de team_keys', async () => {
    const teamId = randomUUID()
    const userId = randomUUID()
    await pool.query('insert into users (id) values ($1)', [userId])
    await pool.query('insert into team_keys (team_id, activated_by) values ($1, $2)', [teamId, userId])
    await pool.query(
      `insert into team_key_wraps (team_id, slot, kind, wrapped) values ($1, 'recovery', 'recovery', 'W')`,
      [teamId]
    )
    await pool.query('delete from team_keys where team_id = $1', [teamId])
    const { rows } = await pool.query('select * from team_key_wraps where team_id = $1', [teamId])
    expect(rows).toHaveLength(0)
  })

  it('rechaza un kind que no sea device ni recovery', async () => {
    const teamId = randomUUID()
    const userId = randomUUID()
    await pool.query('insert into users (id) values ($1)', [userId])
    await pool.query('insert into team_keys (team_id, activated_by) values ($1, $2)', [teamId, userId])
    await expect(
      pool.query(
        `insert into team_key_wraps (team_id, slot, kind, wrapped) values ($1, 'x', 'bogus', 'W')`,
        [teamId]
      )
    ).rejects.toThrow()
  })
})
