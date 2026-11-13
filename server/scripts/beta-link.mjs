#!/usr/bin/env node
// El link personal de descarga de la beta para UN tester (ver `src/betas.ts`).
//
// Corre ADENTRO del contenedor, que es donde están `BETA_LINK_SECRET` y el dominio público, y
// con `tsx` porque importa de `src/`:
//
//   ssh nest-sync-production "cd /app && npx tsx scripts/beta-link.mjs <user-id> [días]"
//
// El link no es un secreto de por vida: vence (14 días por defecto) y deja de andar en el acto
// si la cuenta sale del allowlist. Para cortar TODOS los links de golpe, se rota
// `BETA_LINK_SECRET` en Railway.
import pg from 'pg'
import { firmarLinkDeBeta, betasConfigFromEnv } from '../src/betas.ts'

const [userId, diasArg] = process.argv.slice(2)
const dias = Number(diasArg ?? 14)

if (!userId || !Number.isFinite(dias) || dias <= 0 || dias > 90) {
  console.error('uso: beta-link.mjs <user-id> [días, 1-90, default 14]')
  process.exit(2)
}
const cfg = betasConfigFromEnv()
if (!cfg) {
  console.error('La beta no está configurada acá: faltan R2_* / R2_BETAS_BUCKET / BETA_LINK_SECRET (>= 32).')
  process.exit(2)
}
const dominio = process.env.RAILWAY_PUBLIC_DOMAIN
if (!dominio) {
  console.error('Falta RAILWAY_PUBLIC_DOMAIN: no sé con qué dominio armar el link.')
  process.exit(2)
}

// Un link para alguien fuera de la lista daría 404 y parecería roto. Mejor avisar acá.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
try {
  const { rows } = await pool.query(
    'select u.email from allowlist a join users u on u.id = a.user_id where a.user_id = $1',
    [userId]
  )
  if (rows.length === 0) {
    console.error(`${userId} no está en el allowlist. Agregalo primero con beta-testers.mjs add.`)
    process.exit(1)
  }
  const vence = Date.now() + dias * 24 * 60 * 60 * 1000
  console.log(`${rows[0].email ?? userId} · vence ${new Date(vence).toISOString().slice(0, 10)}`)
  console.log(`https://${dominio}/beta/${firmarLinkDeBeta(cfg.linkSecret, userId, vence)}`)
} finally {
  await pool.end()
}
