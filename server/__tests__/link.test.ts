// El flujo de vinculación por código: cómo se conecta una máquina SIN navegador.
//
// NECESITA POSTGRES, como el resto de `server/`. La parte pura (el alfabeto del código y la
// máquina de estados del poll) se prueba sin base; el resto va contra la real.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { authenticate, hashToken } from '../src/auth'
import {
  generarCodigoDeUsuario, ALFABETO_DEL_CODIGO, VIGENCIA_MS, INTERVALO_MS,
  iniciarVinculacion, aprobarVinculacion, reclamarVinculacion,
} from '../src/link'

const pool = getPool()
let userId: string

beforeAll(async () => {
  await migrate(pool)
  userId = randomUUID()
  await pool.query('insert into users (id, plan) values ($1, $2) on conflict do nothing', [userId, 'cloud'])
  await pool.query('insert into allowlist (user_id) values ($1) on conflict do nothing', [userId])
})

afterAll(async () => { await pool.end() })

const identidad = () => ({ userId, email: 'gero@nestmux.com' })

describe('el código que ve el usuario', () => {
  it('viene en dos grupos de cuatro, separados por un guión', () => {
    expect(generarCodigoDeUsuario()).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
  })

  it('no usa caracteres que se confunden al leerlos en voz alta', () => {
    // Alguien va a leer esto de una pantalla y tipearlo en otra. O/0, I/1 y S/5 son la
    // forma clásica de que ese trámite falle y el usuario crea que el sistema está roto.
    for (const c of ['O', '0', 'I', '1', 'S', '5', 'B', '8']) {
      expect(ALFABETO_DEL_CODIGO).not.toContain(c)
    }
  })

  it('no se repite', () => {
    const vistos = new Set(Array.from({ length: 200 }, () => generarCodigoDeUsuario()))
    expect(vistos.size).toBe(200)
  })
})

describe('iniciar', () => {
  it('devuelve un código para mostrar y otro, distinto, para preguntar', async () => {
    const r = await iniciarVinculacion(pool, Date.now())
    // Son dos valores separados a propósito: el de la pantalla lo ve cualquiera que mire
    // por encima del hombro. Si fuera el mismo, mirar la pantalla alcanzaría para robarse
    // el token cuando el usuario apruebe.
    expect(r.codigoDeUsuario).not.toBe(r.codigoDeDispositivo)
    expect(r.codigoDeDispositivo.length).toBeGreaterThanOrEqual(32)
  })

  it('el código del dispositivo NO se guarda en claro', async () => {
    const r = await iniciarVinculacion(pool, Date.now())
    const { rows } = await pool.query('select * from link_requests where user_code = $1', [r.codigoDeUsuario])
    expect(JSON.stringify(rows[0])).not.toContain(r.codigoDeDispositivo)
    expect(rows[0].device_code_hash).toBe(hashToken(r.codigoDeDispositivo))
  })

  it('vence', async () => {
    const ahora = Date.now()
    const r = await iniciarVinculacion(pool, ahora)
    expect(r.venceEn).toBe(VIGENCIA_MS)
  })
})

describe('el camino completo', () => {
  it('pendiente, aprobado, y el token que sale sirve para autenticar', async () => {
    const ahora = Date.now()
    const r = await iniciarVinculacion(pool, ahora)

    const antes = await reclamarVinculacion(pool, r.codigoDeDispositivo, ahora + INTERVALO_MS)
    expect(antes).toEqual({ estado: 'pendiente' })

    const ap = await aprobarVinculacion(pool, identidad(), r.codigoDeUsuario, ahora + 1000)
    expect(ap.ok).toBe(true)

    const despues = await reclamarVinculacion(pool, r.codigoDeDispositivo, ahora + 2 * INTERVALO_MS)
    expect(despues.estado).toBe('vinculado')
    if (despues.estado !== 'vinculado') return
    await expect(authenticate(pool, `Bearer ${despues.token}`)).resolves.toMatchObject({ ok: true, userId })
  })

  it('el token se entrega UNA sola vez', async () => {
    const ahora = Date.now()
    const r = await iniciarVinculacion(pool, ahora)
    await aprobarVinculacion(pool, identidad(), r.codigoDeUsuario, ahora + 1000)
    const primera = await reclamarVinculacion(pool, r.codigoDeDispositivo, ahora + INTERVALO_MS)
    expect(primera.estado).toBe('vinculado')
    const segunda = await reclamarVinculacion(pool, r.codigoDeDispositivo, ahora + 2 * INTERVALO_MS)
    expect(segunda.estado).not.toBe('vinculado')
  })
})

describe('lo que tiene que fallar', () => {
  it('preguntar con un código de dispositivo inventado no dice si existe o no', async () => {
    const r = await reclamarVinculacion(pool, 'inventado-'.repeat(4), Date.now())
    expect(r.estado).toBe('vencido')
  })

  it('preguntar más seguido que el intervalo devuelve `esperá`, no el token', async () => {
    const ahora = Date.now()
    const r = await iniciarVinculacion(pool, ahora)
    await reclamarVinculacion(pool, r.codigoDeDispositivo, ahora)
    const rapido = await reclamarVinculacion(pool, r.codigoDeDispositivo, ahora + 10)
    expect(rapido).toEqual({ estado: 'muy-seguido' })
  })

  it('un pedido vencido no se puede aprobar', async () => {
    const ahora = Date.now()
    const r = await iniciarVinculacion(pool, ahora)
    const ap = await aprobarVinculacion(pool, identidad(), r.codigoDeUsuario, ahora + VIGENCIA_MS + 1)
    expect(ap).toMatchObject({ ok: false, error: 'expired' })
  })

  it('un pedido vencido después de aprobado tampoco entrega el token', async () => {
    const ahora = Date.now()
    const r = await iniciarVinculacion(pool, ahora)
    await aprobarVinculacion(pool, identidad(), r.codigoDeUsuario, ahora + 1000)
    const tarde = await reclamarVinculacion(pool, r.codigoDeDispositivo, ahora + VIGENCIA_MS + 1)
    expect(tarde.estado).toBe('vencido')
  })

  it('aprobar un código que no existe no crea nada', async () => {
    const ap = await aprobarVinculacion(pool, identidad(), 'ZZZZ-ZZZZ', Date.now())
    expect(ap).toMatchObject({ ok: false, error: 'unknown_code' })
  })

  it('quien no está en el allowlist no consigue token, aunque el código sea válido', async () => {
    const fuera = randomUUID()
    const ahora = Date.now()
    const r = await iniciarVinculacion(pool, ahora)
    await aprobarVinculacion(pool, { userId: fuera, email: 'fuera@x.com' }, r.codigoDeUsuario, ahora + 1000)
    const res = await reclamarVinculacion(pool, r.codigoDeDispositivo, ahora + INTERVALO_MS)
    // El gate del beta y del plan es el MISMO que el de `/v1/devices`: el camino nuevo no
    // puede ser una puerta de atrás que se saltee lo que el viejo exige.
    expect(res.estado).toBe('rechazado')
  })

  it('aprobar dos veces el mismo código con usuarios distintos no cambia el dueño', async () => {
    const otro = randomUUID()
    const ahora = Date.now()
    const r = await iniciarVinculacion(pool, ahora)
    await aprobarVinculacion(pool, identidad(), r.codigoDeUsuario, ahora + 1000)
    const segunda = await aprobarVinculacion(pool, { userId: otro, email: 'otro@x.com' }, r.codigoDeUsuario, ahora + 2000)
    expect(segunda).toMatchObject({ ok: false, error: 'already_approved' })
    const { rows } = await pool.query('select user_id from link_requests where user_code = $1', [r.codigoDeUsuario])
    expect(rows[0].user_id).toBe(userId)
  })
})
