import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getPool, migrate } from '../src/db'

const pool = getPool()

beforeAll(async () => { await migrate(pool) })
afterAll(async () => { await pool.end() })

describe('la tabla backups', () => {
  it('existe con las columnas que el resto del plan escribe', async () => {
    const { rows } = await pool.query(
      `select column_name, data_type, is_nullable
         from information_schema.columns
        where table_name = 'backups'`
    )
    const byName = new Map(rows.map((r) => [r.column_name, r]))
    for (const c of ['id', 'started_at', 'finished_at', 'ok', 'object_key', 'bytes', 'sha256', 'row_counts', 'error']) {
      expect(byName.has(c), `falta la columna ${c}`).toBe(true)
    }
    expect(byName.get('row_counts')!.data_type).toBe('jsonb')
    expect(byName.get('bytes')!.data_type).toBe('bigint')
  })

  // Un intento que arranca y muere a la mitad tiene que quedar VISIBLE como fallado, no
  // desaparecer. Por eso la fila se inserta al empezar y `ok` arranca en false.
  it('ok arranca en false y finished_at admite nulo', async () => {
    const { rows } = await pool.query(
      `insert into backups (object_key) values ('probe/x.dump') returning ok, finished_at, started_at`
    )
    expect(rows[0].ok).toBe(false)
    expect(rows[0].finished_at).toBeNull()
    expect(rows[0].started_at).toBeInstanceOf(Date)
    await pool.query(`delete from backups where object_key = 'probe/x.dump'`)
  })
})
