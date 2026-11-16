#!/usr/bin/env node
// Mints a device token directly against the sync service's own Postgres.
//
// This is the MANUAL half of §9.2. The productised path (the client calls the Supabase
// `memory-token` edge function) still writes its token hashes into SUPABASE, not into this
// service's `devices` table, so a token minted there authenticates as nobody here. Until
// §9.2 moves issuance into this service, every beta device is provisioned with this script.
//
// The token is written to a file, never printed: stdout of an agent session is a transcript,
// and a bearer token in a transcript is a leaked credential.
//
// Two modes, because the plaintext token must never travel to a machine that does not need
// it — and on Railway the database has no public endpoint, so the seeding runs in the
// container while the token stays on the operator's machine:
//
//   Local (generates the token, writes it to --out):
//     DATABASE_URL=... node scripts/mint-device-token.mjs \
//       --email gero@example.com --device "PC Windows" --out ./token.txt [--plan pro]
//
//   Remote (seeds only the hash; the caller generated the token and kept it):
//     ssh <service> "cd /app && node --input-type=module - \
//       --email gero@example.com --device 'PC Windows' --token-hash <sha256hex>" \
//       < scripts/mint-device-token.mjs

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import pg from 'pg'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const email = arg('email')
const deviceName = arg('device', 'unnamed-device')
const plan = arg('plan', 'pro')
const out = arg('out')
const givenHash = arg('token-hash')

if (!email || (!out && !givenHash)) {
  console.error('usage: --email <email> (--out <file> | --token-hash <sha256hex>) [--device <name>] [--plan pro|team|enterprise]')
  process.exit(2)
}
if (givenHash && !/^[0-9a-f]{64}$/.test(givenHash)) {
  console.error('--token-hash must be 64 lowercase hex chars (sha256 of the token)')
  process.exit(2)
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required')
  process.exit(2)
}

// Same shape the edge function mints (`nmk_` + base64url), so nothing downstream has to
// care which half of §9.2 issued it.
const token = givenHash ? null : `nmk_${randomBytes(24).toString('base64url')}`
const tokenHash = givenHash ?? createHash('sha256').update(token).digest('hex')

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const client = await pool.connect()

try {
  await client.query('begin')

  // Find-or-create by email. Re-running this for the same person must not orphan their
  // existing observations under a second user id.
  const found = await client.query('select id, plan from users where email = $1', [email])
  let userId
  if (found.rows.length > 0) {
    userId = found.rows[0].id
    if (found.rows[0].plan !== plan) {
      await client.query('update users set plan = $2 where id = $1', [userId, plan])
    }
  } else {
    userId = randomUUID()
    await client.query('insert into users (id, email, plan) values ($1, $2, $3)', [userId, email, plan])
  }

  // The allowlist is the beta gate (§9.3): a user off it gets 403 not_in_beta even on a
  // paid plan. Minting a token without this row produces a credential that cannot work.
  await client.query('insert into allowlist (user_id, note) values ($1, $2) on conflict (user_id) do nothing', [
    userId,
    'minted by scripts/mint-device-token.mjs',
  ])

  const deviceId = randomUUID()
  await client.query(
    'insert into devices (id, user_id, name, token_hash) values ($1, $2, $3, $4)',
    [deviceId, userId, deviceName, tokenHash]
  )

  await client.query('commit')

  if (token) writeFileSync(out, token, { encoding: 'utf8', mode: 0o600 })
  console.log(`user_id=${userId}`)
  console.log(`device_id=${deviceId}`)
  console.log(`plan=${plan}`)
  console.log(token ? `token written to ${out} (not printed on purpose)` : 'seeded from --token-hash; no plaintext touched this machine')
} catch (err) {
  await client.query('rollback')
  throw err
} finally {
  client.release()
  await pool.end()
}
