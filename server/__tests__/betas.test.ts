// La distribución de la beta cerrada. Las funciones puras no necesitan nada; las rutas,
// POSTGRES (allowlist y tokens de device son filas reales). R2 se reemplaza por dobles: lo que
// se prueba acá es quién recibe qué, no el S3 de Cloudflare.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { getPool, migrate } from '../src/db'
import { hashToken } from '../src/auth'
import {
  betasConfigFromEnv, firmarLinkDeBeta, verificarLinkDeBeta, esArchivoDeBeta, esFeedDelUpdater,
  parsearManifiesto, htmlDeDescarga, urlPrefirmada, handleBeta, type BetasConfig, type DepsDeBetas,
} from '../src/betas'

const SECRETO = 'x'.repeat(40)
const AHORA = 1_800_000_000_000
const ID = '7b8ea973-6c01-417c-83bd-a606eae81dee'

describe('el link personal', () => {
  it('vuelve el userId mientras no venza', () => {
    const link = firmarLinkDeBeta(SECRETO, ID, AHORA + 1000)
    expect(verificarLinkDeBeta(SECRETO, link, AHORA)).toBe(ID)
  })

  it('vencido no sirve', () => {
    const link = firmarLinkDeBeta(SECRETO, ID, AHORA)
    expect(verificarLinkDeBeta(SECRETO, link, AHORA)).toBeNull()
  })

  it('cambiarle el usuario o el vencimiento rompe la firma', () => {
    const link = firmarLinkDeBeta(SECRETO, ID, AHORA + 1000)
    const [, vence, mac] = link.split('.')
    expect(verificarLinkDeBeta(SECRETO, `${randomUUID()}.${vence}.${mac}`, AHORA)).toBeNull()
    expect(verificarLinkDeBeta(SECRETO, `${ID}.${Number(vence) + 10_000_000}.${mac}`, AHORA)).toBeNull()
  })

  it('firmado con otro secreto no sirve', () => {
    const link = firmarLinkDeBeta('y'.repeat(40), ID, AHORA + 1000)
    expect(verificarLinkDeBeta(SECRETO, link, AHORA)).toBeNull()
  })

  it('basura no tira, devuelve null', () => {
    for (const l of ['', 'a.b', 'a.b.c', `${ID}.abc.x`, `${ID}..x`, '...']) {
      expect(verificarLinkDeBeta(SECRETO, l, AHORA)).toBeNull()
    }
  })

  it('sin un secreto largo la beta no se configura', () => {
    const base = { R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c', R2_BETAS_BUCKET: 'd' }
    expect(betasConfigFromEnv({ ...base, BETA_LINK_SECRET: 'corto' })).toBeNull()
    expect(betasConfigFromEnv({ ...base, BETA_LINK_SECRET: SECRETO })).not.toBeNull()
    expect(betasConfigFromEnv({ BETA_LINK_SECRET: SECRETO })).toBeNull()
  })
})

describe('qué archivos se pueden pedir', () => {
  it('nombres planos de instaladores, sí', () => {
    for (const n of ['Nest-Setup-1.6.0-beta.1.exe', 'Nest-1.6.0-beta.1-arm64.dmg', 'nest_1.6.0-beta.1_amd64.deb', 'latest-mac.yml', 'Nest-Setup-1.6.0-beta.1.exe.blockmap']) {
      expect(esArchivoDeBeta(n)).toBe(true)
    }
  })

  it('nada que pueda salir del canal', () => {
    for (const n of ['../backups/x.dump', 'a/b', '..', '.env', 'x..y', '', 'a'.repeat(200)]) {
      expect(esArchivoDeBeta(n)).toBe(false)
    }
  })

  it('el feed del updater se reconoce para devolverlo en vez de redirigirlo', () => {
    expect(esFeedDelUpdater('latest.yml')).toBe(true)
    expect(esFeedDelUpdater('latest-mac.yml')).toBe(true)
    expect(esFeedDelUpdater('latest-linux.yml')).toBe(true)
    expect(esFeedDelUpdater('Nest-Setup.exe')).toBe(false)
    expect(esFeedDelUpdater('builder-debug.yml')).toBe(false)
  })
})

describe('el manifiesto y la página', () => {
  const manifiesto = Buffer.from(JSON.stringify({
    version: '1.6.0-beta.1',
    files: [
      { name: 'Nest-Setup-1.6.0-beta.1.exe', os: 'windows', label: 'Installer' },
      { name: '../fuera', os: 'linux', label: 'malo' },
      { name: 'x.dmg', os: 'beos', label: 'malo' },
    ],
  }))

  it('descarta entradas que no son archivos del canal', () => {
    const m = parsearManifiesto(manifiesto)!
    expect(m.files.map((f) => f.name)).toEqual(['Nest-Setup-1.6.0-beta.1.exe'])
  })

  it('un manifiesto roto es null, no una excepción', () => {
    expect(parsearManifiesto(Buffer.from('{'))).toBeNull()
    expect(parsearManifiesto(Buffer.from('{"files":[]}'))).toBeNull()
  })

  it('la página no ejecuta nada y escapa lo que viene del manifiesto', () => {
    const h = htmlDeDescarga({ version: '<b>1</b>', files: [{ name: 'a.exe', os: 'windows', label: '<img src=x>' }] }, 'L')
    expect(h).not.toMatch(/<script/i)
    expect(h).toContain('&lt;img')
    expect(h).toContain('href="/beta/L/a.exe"')
    expect(h).toContain('noindex')
  })
})

describe('la URL prefirmada', () => {
  it('lleva credencial en la query y vence', async () => {
    const u = new URL(await urlPrefirmada({ accountId: 'acc', accessKeyId: 'AK', secretAccessKey: 'SK', bucket: 'betas' }, 'Nest.exe', 300))
    expect(u.host).toBe('acc.r2.cloudflarestorage.com')
    expect(u.pathname).toBe('/betas/Nest.exe')
    // electron-updater saca el `authorization` del device SOLO si ve esto en el destino.
    expect(u.searchParams.get('X-Amz-Credential')).toMatch(/^AK\//)
    expect(u.searchParams.get('X-Amz-Expires')).toBe('300')
    expect(u.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('las rutas (NECESITA POSTGRES)', () => {
  const pool = getPool()
  const cfg: BetasConfig = { accountId: 'acc', accessKeyId: 'AK', secretAccessKey: 'SK', bucket: 'betas', linkSecret: SECRETO }
  const bucket = new Map<string, string>([
    ['manifest.json', JSON.stringify({ version: '1.6.0-beta.1', files: [{ name: 'Nest-Setup-1.6.0-beta.1.exe', os: 'windows', label: 'Installer' }] })],
    ['latest.yml', 'version: 1.6.0-beta.1\npath: Nest-Setup-1.6.0-beta.1.exe\n'],
  ])
  let configurado = true
  const deps: DepsDeBetas = {
    config: () => (configurado ? cfg : null),
    ahora: () => Date.now(),
    leer: async (_c, key) => (bucket.has(key) ? Buffer.from(bucket.get(key)!) : null),
    prefirmar: async (_c, key) => `https://acc.r2.cloudflarestorage.com/betas/${key}?X-Amz-Credential=AK`,
  }
  let server: Server
  let base: string
  let adentro: string
  let afuera: string
  let tokenAdentro: string
  let tokenAfuera: string

  async function conDevice(userId: string): Promise<string> {
    const token = `nmk_${randomBytes(24).toString('base64url')}`
    await pool.query('insert into devices (id, user_id, name, token_hash) values ($1, $2, $3, $4)', [randomUUID(), userId, 'test', hashToken(token)])
    return token
  }

  beforeAll(async () => {
    await migrate(pool)
    adentro = randomUUID()
    afuera = randomUUID()
    await pool.query(`insert into users (id, plan) values ($1, 'free'), ($2, 'free')`, [adentro, afuera])
    await pool.query('insert into allowlist (user_id) values ($1)', [adentro])
    tokenAdentro = await conDevice(adentro)
    tokenAfuera = await conDevice(afuera)
    server = createServer((req, res) => {
      const path = new URL(req.url ?? '/', 'http://x').pathname
      handleBeta(pool, req, res, path, deps).then((tomada) => {
        if (!tomada) { res.writeHead(418); res.end() }
      }).catch(() => { res.writeHead(500); res.end() })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()))
    await pool.query('delete from users where id = any($1)', [[adentro, afuera]])
    await pool.end()
  })

  const get = (path: string, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { headers, redirect: 'manual' })
  const linkDe = (userId: string, vence = Date.now() + 60_000) => firmarLinkDeBeta(SECRETO, userId, vence)

  it('una ruta que no es de la beta no la toma', async () => {
    expect((await get('/v1/sync/status')).status).toBe(418)
  })

  it('el link de alguien en la lista muestra la página', async () => {
    const r = await get(`/beta/${linkDe(adentro)}`)
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(await r.text()).toContain('Nest-Setup-1.6.0-beta.1.exe')
  })

  it('y el instalador es un 302 a R2, sin pasar por el servicio', async () => {
    const r = await get(`/beta/${linkDe(adentro)}/Nest-Setup-1.6.0-beta.1.exe`)
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toContain('X-Amz-Credential')
  })

  it('un link firmado pero de alguien fuera de la lista da 404, igual que uno falso', async () => {
    expect((await get(`/beta/${linkDe(afuera)}`)).status).toBe(404)
    expect((await get(`/beta/${linkDe(afuera)}/Nest-Setup-1.6.0-beta.1.exe`)).status).toBe(404)
    expect((await get('/beta/no-es-un-link')).status).toBe(404)
  })

  it('sacar a alguien de la lista corta su link en el acto', async () => {
    const otro = randomUUID()
    await pool.query(`insert into users (id) values ($1)`, [otro])
    await pool.query('insert into allowlist (user_id) values ($1)', [otro])
    const link = linkDe(otro)
    expect((await get(`/beta/${link}`)).status).toBe(200)
    await pool.query('delete from allowlist where user_id = $1', [otro])
    expect((await get(`/beta/${link}`)).status).toBe(404)
    await pool.query('delete from users where id = $1', [otro])
  })

  it('un link vencido da 404', async () => {
    expect((await get(`/beta/${linkDe(adentro, Date.now() - 1)}`)).status).toBe(404)
  })

  it('un nombre que sale del canal da 404 aunque el link sea bueno', async () => {
    expect((await get(`/beta/${linkDe(adentro)}/..%2Fbackups%2Fx.dump`)).status).toBe(404)
  })

  it('el updater con un device de la lista recibe el feed como YAML', async () => {
    const r = await get('/v1/beta/update/latest.yml', { authorization: `Bearer ${tokenAdentro}` })
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toMatch(/yaml/)
    expect(await r.text()).toContain('version: 1.6.0-beta.1')
  })

  it('y el instalador como 302', async () => {
    const r = await get('/v1/beta/update/Nest-Setup-1.6.0-beta.1.exe', { authorization: `Bearer ${tokenAdentro}` })
    expect(r.status).toBe(302)
  })

  it('el updater sin token, o con uno fuera de la lista, no recibe nada', async () => {
    expect((await get('/v1/beta/update/latest.yml')).status).toBe(401)
    const r = await get('/v1/beta/update/latest.yml', { authorization: `Bearer ${tokenAfuera}` })
    expect(r.status).toBe(403)
    expect(await r.text()).toBe('not_in_beta')
  })

  it('sin la beta configurada es un 503, no un 500', async () => {
    configurado = false
    try {
      expect((await get(`/beta/${linkDe(adentro)}`)).status).toBe(503)
    } finally {
      configurado = true
    }
  })

  it('sin manifiesto publicado todavía, la página lo dice', async () => {
    const guardado = bucket.get('manifest.json')!
    bucket.delete('manifest.json')
    try {
      const r = await get(`/beta/${linkDe(adentro)}`)
      expect(r.status).toBe(503)
      expect(await r.text()).toMatch(/No beta has been published/)
    } finally {
      bucket.set('manifest.json', guardado)
    }
  })
})
