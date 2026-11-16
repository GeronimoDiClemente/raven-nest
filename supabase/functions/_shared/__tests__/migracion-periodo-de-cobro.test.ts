import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const sql = readFileSync(resolve(__dirname, '../../../migrations/20261029000000_profiles_billing_period.sql'), 'utf8')
const COLUMNAS = ['billing_interval', 'current_period_end', 'cancel_at_period_end']

describe('migración del período de cobro', () => {
  it('agrega las tres columnas', () => {
    expect(sql).toMatch(/billing_interval\s+text[^;]*check\s*\(\s*billing_interval\s+in\s*\('monthly',\s*'annual'\)\)/i)
    expect(sql).toMatch(/current_period_end\s+timestamptz/i)
    expect(sql).toMatch(/cancel_at_period_end\s+boolean\s+not\s+null\s+default\s+false/i)
  })
  it('el trigger revierte cada columna en la rama del trial Y en la del cliente', () => {
    const cuerpo = sql.slice(sql.search(/create or replace function protect_profile_billing_columns/i))
    for (const c of COLUMNAS) expect(cuerpo.match(new RegExp(`NEW\\.${c}\\s*:=\\s*OLD\\.${c}`, 'gi'))?.length).toBe(2)
  })
  it('no esconde las columnas del select propio', () => {
    expect(sql).not.toMatch(/revoke\s+select/i)
  })
})
