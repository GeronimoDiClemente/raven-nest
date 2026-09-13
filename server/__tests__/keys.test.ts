import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { randomUUID, createHmac } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { enrollDeviceKey, getKeyState, publishWraps } from '../src/keys'

const pool = getPool()
let userId: string
let deviceA: string
let deviceB: string
const authFor = (deviceId: string) => ({ deviceId, userId, plan: 'pro' })

// La misma derivacion que `electron/memory-crypto.ts#rotateVerifier`. Se repite aca a
// proposito: el servidor NO importa nada del cliente, y un test que compartiera la funcion
// dejaria de detectar que las dos derivaciones se separen.
const verificador = (maestra: string, epoca: number) =>
  createHmac('sha256', Buffer.from(maestra)).update(`nest-memory/rotate-v1/${epoca}`).digest('hex')

beforeAll(async () => { await migrate(pool) })

beforeEach(async () => {
  userId = randomUUID()
  deviceA = randomUUID()
  deviceB = randomUUID()
  await pool.query("insert into users (id, plan) values ($1, 'pro')", [userId])
  for (const [id, nombre] of [[deviceA, 'mac'], [deviceB, 'pc']] as const) {
    await pool.query(
      "insert into devices (id, user_id, name, token_hash) values ($1, $2, $3, $4)",
      [id, userId, nombre, 'hash-' + id]
    )
  }
})

describe('/v1/keys', () => {
  it('una cuenta sin cifrado arranca en epoca 0, sin envoltura y sin claves', async () => {
    const estado = await getKeyState(pool, authFor(deviceA))
    expect(estado).toEqual({ keyEpoch: 0, wrap: null, devices: [] })
  })

  it('enrola la publica del dispositivo y la lista para los demas', async () => {
    expect(await enrollDeviceKey(pool, authFor(deviceA), { public_key: 'PUB-A' })).toEqual({ ok: true })
    const estado = await getKeyState(pool, authFor(deviceB))
    expect(estado.devices).toEqual([
      { deviceId: deviceA, name: 'mac', publicKey: 'PUB-A', hasWrap: false },
    ])
  })

  it('re-enrolar el mismo dispositivo pisa su publica, no duplica filas', async () => {
    await enrollDeviceKey(pool, authFor(deviceA), { public_key: 'PUB-A' })
    await enrollDeviceKey(pool, authFor(deviceA), { public_key: 'PUB-A2' })
    const estado = await getKeyState(pool, authFor(deviceA))
    expect(estado.devices).toHaveLength(1)
    expect(estado.devices[0].publicKey).toBe('PUB-A2')
  })

  it('rechaza una publica vacia o que no sea string', async () => {
    expect(await enrollDeviceKey(pool, authFor(deviceA), { public_key: '' }))
      .toEqual({ ok: false, status: 400, error: 'invalid_public_key' })
    expect(await enrollDeviceKey(pool, authFor(deviceA), { public_key: 42 as never }))
      .toEqual({ ok: false, status: 400, error: 'invalid_public_key' })
  })

  it('publicar la epoca 1 activa el cifrado y cada device ve SU envoltura', async () => {
    await enrollDeviceKey(pool, authFor(deviceA), { public_key: 'PUB-A' })
    const res = await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1, mode: 'activate', rotate_verifier: verificador('maestra', 1),
      wraps: [
        { slot: deviceA, kind: 'device', wrapped: 'W-A' },
        { slot: 'recovery', kind: 'recovery', wrapped: 'W-R', wrap_meta: { salt: 'S' } },
      ],
    })
    expect(res).toEqual({ ok: true, keyEpoch: 1 })

    const desdeA = await getKeyState(pool, authFor(deviceA))
    expect(desdeA.keyEpoch).toBe(1)
    expect(desdeA.wrap).toEqual({ wrapped: 'W-A', wrapMeta: null })

    // B todavia no fue autorizado: ve que hay cifrado, pero no tiene con que abrirlo.
    const desdeB = await getKeyState(pool, authFor(deviceB))
    expect(desdeB.keyEpoch).toBe(1)
    expect(desdeB.wrap).toBeNull()
  })

  it('autorizar a B es publicar SU envoltura en la misma epoca', async () => {
    await enrollDeviceKey(pool, authFor(deviceA), { public_key: 'PUB-A' })
    await enrollDeviceKey(pool, authFor(deviceB), { public_key: 'PUB-B' })
    await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1, mode: 'activate', rotate_verifier: verificador('maestra', 1),
      wraps: [{ slot: deviceA, kind: 'device', wrapped: 'W-A' }],
    })
    await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1, mode: 'authorize', rotate_proof: verificador('maestra', 1),
      wraps: [{ slot: deviceB, kind: 'device', wrapped: 'W-B' }],
    })
    expect((await getKeyState(pool, authFor(deviceB))).wrap).toEqual({ wrapped: 'W-B', wrapMeta: null })
    // Y A no perdio la suya.
    expect((await getKeyState(pool, authFor(deviceA))).wrap).toEqual({ wrapped: 'W-A', wrapMeta: null })
  })

  it('hasWrap distingue una maquina autorizada de una que espera', async () => {
    await enrollDeviceKey(pool, authFor(deviceA), { public_key: 'PUB-A' })
    await enrollDeviceKey(pool, authFor(deviceB), { public_key: 'PUB-B' })
    await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1, mode: 'activate', rotate_verifier: verificador('maestra', 1),
      wraps: [{ slot: deviceA, kind: 'device', wrapped: 'W-A' }],
    })
    const porId = new Map((await getKeyState(pool, authFor(deviceA))).devices.map((d) => [d.deviceId, d]))
    expect(porId.get(deviceA)!.hasWrap).toBe(true)
    expect(porId.get(deviceB)!.hasWrap).toBe(false)
  })

  // El 409 que protege al usuario de un cliente confundido: bajar la epoca borraria las
  // envolturas de la maestra vigente y dejaria la memoria de la nube ilegible.
  it('rechaza retroceder de época', async () => {
    await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1, mode: 'activate', rotate_verifier: verificador('maestra', 1),
      wraps: [{ slot: deviceA, kind: 'device', wrapped: 'W-A' }],
    })
    expect(await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1, mode: 'activate', rotate_verifier: verificador('otra', 1),
      wraps: [{ slot: deviceA, kind: 'device', wrapped: 'VIEJA' }],
    })).toEqual({ ok: false, status: 409, error: 'stale_key_epoch' })
    expect((await getKeyState(pool, authFor(deviceA))).wrap).toEqual({ wrapped: 'W-A', wrapMeta: null })
  })

  it('una época NUEVA borra las envolturas de la anterior (rotación)', async () => {
    await enrollDeviceKey(pool, authFor(deviceA), { public_key: 'PUB-A' })
    await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1, mode: 'activate', rotate_verifier: verificador('vieja', 1),
      wraps: [{ slot: deviceA, kind: 'device', wrapped: 'W-A1' }, { slot: deviceB, kind: 'device', wrapped: 'W-B1' }],
    })
    await publishWraps(pool, authFor(deviceA), {
      key_epoch: 2, mode: 'activate',
      rotate_proof: verificador('vieja', 1), rotate_verifier: verificador('nueva', 2),
      wraps: [{ slot: deviceA, kind: 'device', wrapped: 'W-A2' }],
    })
    expect((await getKeyState(pool, authFor(deviceA))).wrap).toEqual({ wrapped: 'W-A2', wrapMeta: null })
    // B queda sin envoltura: le sacaron el acceso, que es de lo que trata rotar.
    expect((await getKeyState(pool, authFor(deviceB))).wrap).toBeNull()
  })

  it('rechaza un body sin envolturas o con una época no positiva', async () => {
    expect(await publishWraps(pool, authFor(deviceA), { key_epoch: 1, mode: 'activate', wraps: [] }))
      .toEqual({ ok: false, status: 400, error: 'no_wraps' })
    expect(await publishWraps(pool, authFor(deviceA), { key_epoch: 0, mode: 'activate', wraps: [{ slot: deviceA, kind: 'device', wrapped: 'W' }] }))
      .toEqual({ ok: false, status: 400, error: 'invalid_key_epoch' })
  })

  it('no se ven las envolturas ni las claves de otra cuenta', async () => {
    await enrollDeviceKey(pool, authFor(deviceA), { public_key: 'PUB-A' })
    const otroUser = randomUUID()
    const otroDevice = randomUUID()
    await pool.query("insert into users (id, plan) values ($1, 'pro')", [otroUser])
    await pool.query(
      "insert into devices (id, user_id, name, token_hash) values ($1, $2, 'ajeno', $3)",
      [otroDevice, otroUser, 'hash-' + otroDevice]
    )
    const estado = await getKeyState(pool, { deviceId: otroDevice, userId: otroUser })
    expect(estado).toEqual({ keyEpoch: 0, wrap: null, devices: [] })
  })
})

// Lo que la revisión adversarial del 2026-09-12 marcó como crítico: dos máquinas activando
// el cifrado casi a la vez leían las dos `key_epoch = 0`, generaban cada una su PROPIA
// maestra y publicaban época 1. El lock las serializaba pero no decidía: la segunda no era
// `<` (sin 409) ni `>` (sin rotar), así que pisaba el slot de recuperación con el suyo y
// quedaban dos maestras vivas en la misma época.
describe('activar contra autorizar — el empate de época', () => {
  it('una segunda activación con la misma época se rechaza en vez de pisar', async () => {
    const deviceId = deviceA
    const primera = await publishWraps(pool, authFor(deviceId), {
      key_epoch: 1, mode: 'activate', rotate_verifier: verificador('la-primera', 1),
      wraps: [
        { slot: deviceId, kind: 'device', wrapped: 'w-A' },
        { slot: 'recovery', kind: 'recovery', wrapped: 'r-A', wrap_meta: { salt: 's' } },
      ],
    })
    expect(primera.ok).toBe(true)

    const segunda = await publishWraps(pool, authFor(deviceId), {
      key_epoch: 1, mode: 'activate', rotate_verifier: verificador('la-segunda', 1),
      wraps: [
        { slot: deviceId, kind: 'device', wrapped: 'w-B' },
        { slot: 'recovery', kind: 'recovery', wrapped: 'r-B', wrap_meta: { salt: 's' } },
      ],
    })
    expect(segunda.ok).toBe(false)
    if (!segunda.ok) expect(segunda.error).toBe('stale_key_epoch')

    // Y lo decisivo: la envoltura de recuperación sigue siendo la de la PRIMERA. Si se
    // hubiera pisado, el código que se le mostró a esa máquina ya no abriría nada.
    const { rows } = await pool.query(
      "select wrapped from key_wraps where user_id = $1 and slot = 'recovery'", [userId]
    )
    expect(rows[0]?.wrapped).toBe('r-A')
  })

  it('autorizar con la época vigente sí suma una envoltura, sin rotar', async () => {
    const deviceId = deviceA
    await publishWraps(pool, authFor(deviceId), {
      key_epoch: 1, mode: 'activate', rotate_verifier: verificador('maestra', 1),
      wraps: [{ slot: deviceId, kind: 'device', wrapped: 'w-A' }],
    })
    const otra = await publishWraps(pool, authFor(deviceId), {
      key_epoch: 1, mode: 'authorize', rotate_proof: verificador('maestra', 1),
      wraps: [{ slot: deviceB, kind: 'device', wrapped: 'w-2' }],
    })
    expect(otra.ok).toBe(true)
    const { rows } = await pool.query(
      'select count(*)::int as n from key_wraps where user_id = $1', [userId]
    )
    expect(rows[0].n).toBe(2)
  })

  // Autorizar sobre una cuenta que nunca activó escribía envolturas huérfanas que después
  // nadie podía usar.
  it('autorizar sobre una cuenta sin activar se rechaza', async () => {
    const res = await publishWraps(pool, authFor(deviceA), {
      key_epoch: 0, mode: 'authorize',
      wraps: [{ slot: deviceA, kind: 'device', wrapped: 'w' }],
    })
    expect(res.ok).toBe(false)
  })

  // Rotar DESTRUYE: borra todas las envolturas, incluida la de recuperación. Hasta el
  // 2026-09-12 alcanzaba con un token válido de la cuenta — ni tener la maestra, ni haber
  // sido autorizado nunca.
  it('un device sin envoltura vigente NO puede rotar la época', async () => {
    await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1, mode: 'activate', rotate_verifier: verificador('maestra', 1),
      wraps: [
        { slot: deviceA, kind: 'device', wrapped: 'w-A' },
        { slot: 'recovery', kind: 'recovery', wrapped: 'r-A', wrap_meta: { salt: 's' } },
      ],
    })
    // B nunca fue autorizado: no tiene la maestra. El request va BIEN FORMADO —con su
    // verificador y todo— para que lo único que lo rechace sea la prueba de posesión y no
    // una validación de forma.
    const res = await publishWraps(pool, authFor(deviceB), {
      key_epoch: 2, mode: 'activate',
      rotate_verifier: verificador('la-de-B', 2), rotate_proof: verificador('adivinada', 1),
      wraps: [{ slot: deviceB, kind: 'device', wrapped: 'w-B' }],
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('not_authorized_to_rotate')

    // Y lo que importa: la envoltura de recuperación sigue ahí.
    const { rows } = await pool.query(
      "select wrapped from key_wraps where user_id = $1 and slot = 'recovery'", [userId]
    )
    expect(rows[0]?.wrapped).toBe('r-A')
  })

  it('un device que SÍ tiene la clave puede rotar', async () => {
    await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1, mode: 'activate', rotate_verifier: verificador('vieja', 1),
      wraps: [{ slot: deviceA, kind: 'device', wrapped: 'w-A' }],
    })
    const res = await publishWraps(pool, authFor(deviceA), {
      key_epoch: 2, mode: 'activate',
      // Rotar son DOS valores: la prueba de la maestra vigente y el verificador de la nueva.
      rotate_proof: verificador('vieja', 1), rotate_verifier: verificador('nueva', 2),
      wraps: [{ slot: deviceA, kind: 'device', wrapped: 'w-A2' }],
    })
    expect(res.ok).toBe(true)
  })

  /**
   * La regresión que el arreglo de la posesión introdujo, verificada contra Postgres el
   * 2026-09-13: un solo campo hacía las dos cosas —probar la maestra vigente y guardarse para
   * la próxima— y rotar quedaba imposible para TODO el mundo, dueño incluido. El cliente
   * manda el verificador de su maestra nueva, el servidor lo compara contra el de la vieja, y
   * no coinciden nunca: son derivados de maestras distintas.
   */
  it('la prueba es de la maestra VIEJA; mandar la de la nueva no alcanza', async () => {
    await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1, mode: 'activate', rotate_verifier: verificador('vieja', 1),
      wraps: [{ slot: deviceA, kind: 'device', wrapped: 'w-A' }],
    })
    const res = await publishWraps(pool, authFor(deviceA), {
      key_epoch: 2, mode: 'activate',
      rotate_proof: verificador('nueva', 2), rotate_verifier: verificador('nueva', 2),
      wraps: [{ slot: deviceA, kind: 'device', wrapped: 'w-A2' }],
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('not_authorized_to_rotate')
  })

  // Y lo que queda guardado después de rotar es el verificador de la maestra NUEVA: si
  // siguiera el viejo, la rotación siguiente pediría probar una maestra que ya no existe.
  it('rotar deja guardado el verificador de la maestra nueva', async () => {
    await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1, mode: 'activate', rotate_verifier: verificador('m1', 1),
      wraps: [{ slot: deviceA, kind: 'device', wrapped: 'w1' }],
    })
    await publishWraps(pool, authFor(deviceA), {
      key_epoch: 2, mode: 'activate',
      rotate_proof: verificador('m1', 1), rotate_verifier: verificador('m2', 2),
      wraps: [{ slot: deviceA, kind: 'device', wrapped: 'w2' }],
    })
    const tercera = await publishWraps(pool, authFor(deviceA), {
      key_epoch: 3, mode: 'activate',
      rotate_proof: verificador('m2', 2), rotate_verifier: verificador('m3', 3),
      wraps: [{ slot: deviceA, kind: 'device', wrapped: 'w3' }],
    })
    expect(tercera.ok).toBe(true)
  })

  /**
   * `mode` OBLIGATORIO, el caso exacto que la revisión pidió cubrir: mismo escenario que
   * "un device sin envoltura vigente NO puede rotar la época", omitiendo el campo.
   *
   * Dejarlo opcional "por compatibilidad" hacía que las reglas estrictas —la prueba de
   * posesión incluida— sólo corrieran cuando el llamador las pedía. Verificado contra
   * Postgres: este mismo request, sin `mode`, rotaba la época y borraba todas las
   * envolturas incluida la de recuperación.
   */
  it('sin `mode` el request se rechaza y la envoltura de recuperación queda intacta', async () => {
    await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1, mode: 'activate', rotate_verifier: verificador('maestra', 1),
      wraps: [
        { slot: deviceA, kind: 'device', wrapped: 'w-A' },
        { slot: 'recovery', kind: 'recovery', wrapped: 'r-A', wrap_meta: { salt: 's' } },
      ],
    })
    const res = await publishWraps(pool, authFor(deviceB), {
      key_epoch: 2,
      wraps: [{ slot: deviceB, kind: 'device', wrapped: 'w-B' }],
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.status).toBe(400)
      expect(res.error).toBe('invalid_mode')
    }

    const { rows } = await pool.query(
      "select wrapped from key_wraps where user_id = $1 and slot = 'recovery'", [userId]
    )
    expect(rows[0]?.wrapped, 'la copia de recuperación sigue siendo la original').toBe('r-A')
    const { rows: epoca } = await pool.query('select key_epoch from users where id = $1', [userId])
    expect(Number(epoca[0].key_epoch), 'la época no se movió').toBe(1)
  })

  /**
   * La prueba tiene que ser de algo que el sujeto NO pueda escribir él mismo. La primera
   * versión miraba si existía una fila en `key_wraps` para el slot del llamador — y el
   * llamador puede escribirla con un `authorize` sobre su propio slot.
   */
  it('un device no se fabrica su propia prueba autorizándose a sí mismo', async () => {
    await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1, mode: 'activate', rotate_verifier: verificador('maestra', 1),
      wraps: [
        { slot: deviceA, kind: 'device', wrapped: 'w-A' },
        { slot: 'recovery', kind: 'recovery', wrapped: 'r-A', wrap_meta: { salt: 's' } },
      ],
    })

    // Paso 1: B se escribe su propia envoltura con un blob cualquiera.
    const auto = await publishWraps(pool, authFor(deviceB), {
      key_epoch: 1, mode: 'authorize',
      wraps: [{ slot: deviceB, kind: 'device', wrapped: 'lo-que-sea' }],
    })
    expect(auto.ok, 'sin probar la maestra no puede escribir su propio slot').toBe(false)

    // Paso 2: y aunque lo hubiera logrado, esa fila no le sirve de prueba para rotar.
    const rotar = await publishWraps(pool, authFor(deviceB), {
      key_epoch: 2, mode: 'activate', rotate_verifier: verificador('de-B', 2),
      wraps: [{ slot: deviceB, kind: 'device', wrapped: 'w-B' }],
    })
    expect(rotar.ok).toBe(false)
    if (!rotar.ok) expect(rotar.error).toBe('not_authorized_to_rotate')

    const { rows } = await pool.query(
      "select wrapped from key_wraps where user_id = $1 and slot = 'recovery'", [userId]
    )
    expect(rows[0]?.wrapped).toBe('r-A')
  })

  // `has_wrap` mira si EXISTE una fila, no si corresponde a la pública actual. Cualquier
  // regeneración del par local —un keys.bin corrupto, un llavero restaurado— dejaba una
  // envoltura sellada para una clave que ya no existe: la máquina no podía abrirla, pero
  // tampoco aparecía como pendiente, así que la otra nunca ofrecía autorizarla. Afuera de
  // forma permanente y en silencio.
  it('si un device cambia su clave pública, su envoltura vieja se borra', async () => {
    await enrollDeviceKey(pool, authFor(deviceA), { public_key: 'pub-vieja' })
    await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1, mode: 'activate', rotate_verifier: verificador('maestra', 1),
      wraps: [{ slot: deviceA, kind: 'device', wrapped: 'sellada-para-la-vieja' }],
    })
    expect((await getKeyState(pool, authFor(deviceA))).devices.find((d) => d.deviceId === deviceA)?.hasWrap).toBe(true)

    // La máquina regenera su par y vuelve a inscribirse.
    await enrollDeviceKey(pool, authFor(deviceA), { public_key: 'pub-nueva' })

    const estado = await getKeyState(pool, authFor(deviceA))
    const yo = estado.devices.find((d) => d.deviceId === deviceA)
    expect(yo?.publicKey).toBe('pub-nueva')
    expect(yo?.hasWrap, 'vuelve a figurar como pendiente de autorización').toBe(false)
  })

  it('re-inscribir la MISMA clave no borra nada', async () => {
    await enrollDeviceKey(pool, authFor(deviceA), { public_key: 'pub-1' })
    await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1, mode: 'activate', rotate_verifier: verificador('maestra', 1),
      wraps: [{ slot: deviceA, kind: 'device', wrapped: 'w' }],
    })
    await enrollDeviceKey(pool, authFor(deviceA), { public_key: 'pub-1' })
    expect((await getKeyState(pool, authFor(deviceA))).devices.find((d) => d.deviceId === deviceA)?.hasWrap).toBe(true)
  })
})


/**
 * Lo que la regla `cannot_authorize_self` rompió sin que ningún test lo notara, verificado
 * contra Postgres el 2026-09-13.
 *
 * `recoverWithCode` (spec §5.3 camino B, D8) abre la copia de recuperación con el código y
 * después se AUTO-AUTORIZA, para que el próximo arranque no vuelva a pedirlo. La regla
 * "authorize nunca escribe el slot propio" mataba exactamente ese paso: el único camino que
 * queda cuando no hay ninguna máquina viva contestaba 403.
 *
 * La distinción que faltaba: esa máquina SÍ tiene la maestra en ese momento —acaba de
 * abrirla— y lo puede probar. Auto-autorizarse sin la prueba sigue prohibido.
 */
describe('el camino de recuperación (D8)', () => {
  it('una máquina que probó tener la maestra puede escribir su propio slot', async () => {
    await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1, mode: 'activate', rotate_verifier: verificador('maestra', 1),
      wraps: [
        { slot: deviceA, kind: 'device', wrapped: 'w-A' },
        { slot: 'recovery', kind: 'recovery', wrapped: 'r-A', wrap_meta: { salt: 's' } },
      ],
    })
    // B abrió la copia de recuperación con el código: tiene la maestra y lo demuestra.
    const res = await publishWraps(pool, authFor(deviceB), {
      key_epoch: 1, mode: 'authorize', rotate_proof: verificador('maestra', 1),
      wraps: [{ slot: deviceB, kind: 'device', wrapped: 'w-B' }],
    })
    expect(res.ok, 'la recuperación es el único camino cuando no queda ninguna máquina viva').toBe(true)
    expect((await getKeyState(pool, authFor(deviceB))).wrap).toEqual({ wrapped: 'w-B', wrapMeta: null })
  })

  it('sin la prueba, auto-autorizarse sigue prohibido', async () => {
    await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1, mode: 'activate', rotate_verifier: verificador('maestra', 1),
      wraps: [{ slot: deviceA, kind: 'device', wrapped: 'w-A' }],
    })
    const res = await publishWraps(pool, authFor(deviceB), {
      key_epoch: 1, mode: 'authorize', rotate_proof: verificador('inventada', 1),
      wraps: [{ slot: deviceB, kind: 'device', wrapped: 'w-B' }],
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('cannot_authorize_self')
  })

  // Pisar `recovery` con un blob que no abre nada invalida el código que el usuario tiene
  // anotado. Ni siquiera con la maestra en la mano: rotar es el camino, y rotar publica una
  // copia nueva.
  it('ni con la prueba se puede pisar la copia de recuperación desde `authorize`', async () => {
    await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1, mode: 'activate', rotate_verifier: verificador('maestra', 1),
      wraps: [
        { slot: deviceA, kind: 'device', wrapped: 'w-A' },
        { slot: 'recovery', kind: 'recovery', wrapped: 'r-A', wrap_meta: { salt: 's' } },
      ],
    })
    const res = await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1, mode: 'authorize', rotate_proof: verificador('maestra', 1),
      wraps: [{ slot: 'recovery', kind: 'recovery', wrapped: 'r-PISADA' }],
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('cannot_overwrite_recovery')

    const { rows } = await pool.query(
      "select wrapped from key_wraps where user_id = $1 and slot = 'recovery'", [userId]
    )
    expect(rows[0]?.wrapped).toBe('r-A')
  })
})

/**
 * El orden de los chequeos es contrato, no detalle. Con la posesión decidida ANTES que la
 * época, la máquina que PIERDE una carrera de activación recibía `403 not_authorized_to_rotate`
 * en vez de `409 stale_key_epoch` — y el 409 es justo la señal que el cliente usa para
 * adoptar la maestra que ya existe. Con el 403 se quedaba sin clave y sin camino de vuelta.
 */
describe('el orden entre la época y la posesión', () => {
  it('la que pierde la carrera recibe 409 (adoptá), no 403 (no podés rotar)', async () => {
    await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1, mode: 'activate', rotate_verifier: verificador('la-de-A', 1),
      wraps: [
        { slot: deviceA, kind: 'device', wrapped: 'w-A' },
        { slot: 'recovery', kind: 'recovery', wrapped: 'r-A', wrap_meta: { salt: 's' } },
      ],
    })
    // B arrancó su activación leyendo época 0 y pide la 1, con SU maestra.
    const segunda = await publishWraps(pool, authFor(deviceB), {
      key_epoch: 1, mode: 'activate', rotate_verifier: verificador('la-de-B', 1),
      wraps: [
        { slot: deviceB, kind: 'device', wrapped: 'w-B' },
        { slot: 'recovery', kind: 'recovery', wrapped: 'r-B', wrap_meta: { salt: 's' } },
      ],
    })
    expect(segunda.ok).toBe(false)
    if (!segunda.ok) {
      expect(segunda.status).toBe(409)
      expect(segunda.error).toBe('stale_key_epoch')
    }
    const { rows } = await pool.query(
      "select wrapped from key_wraps where user_id = $1 and slot = 'recovery'", [userId]
    )
    expect(rows[0]?.wrapped).toBe('r-A')
  })
})

/**
 * La sustitución de clave que la TERCERA revisión encontró, verificada contra Postgres.
 *
 * La prueba de posesión se exigía sólo cuando el request tocaba el slot PROPIO. Escribir el
 * slot de otra máquina no pedía nada — y ése es justamente el que sirve para atacar: sellar
 * no requiere ningún secreto (el sealed box X25519 tiene emisor anónimo) y la pública de la
 * víctima la reparte `GET /v1/keys` a todos los devices de la cuenta. Un device que nunca fue
 * autorizado envolvía SU maestra para la víctima, que la adoptaba sin error ni aviso.
 */
describe('autorizar exige tener la maestra, siempre', () => {
  const activarConA = () => publishWraps(pool, authFor(deviceA), {
    key_epoch: 1, mode: 'activate', rotate_verifier: verificador('la-legitima', 1),
    wraps: [
      { slot: deviceA, kind: 'device', wrapped: 'ENVOLTURA-LEGITIMA' },
      { slot: 'recovery', kind: 'recovery', wrapped: 'R-OK', wrap_meta: { salt: 's' } },
    ],
  })

  it('un device sin la maestra NO puede pisar la envoltura de otro', async () => {
    await activarConA()
    const res = await publishWraps(pool, authFor(deviceB), {
      key_epoch: 1, mode: 'authorize',
      wraps: [{ slot: deviceA, kind: 'device', wrapped: 'ENVOLTURA-DEL-ATACANTE' }],
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.status).toBe(403)
      expect(res.error).toBe('must_hold_master')
    }
    // Lo decisivo: A sigue abriendo con la suya.
    expect((await getKeyState(pool, authFor(deviceA))).wrap).toEqual({
      wrapped: 'ENVOLTURA-LEGITIMA', wrapMeta: null,
    })
  })

  // La variante más silenciosa: plantarle la envoltura a una máquina PENDIENTE la saca de la
  // lista de pendientes (`has_wrap` pasa a true), así que el dueño nunca ve que había que
  // autorizarla y esa máquina adopta la maestra del atacante en su primer arranque.
  it('tampoco puede plantarle una envoltura a una máquina pendiente', async () => {
    await activarConA()
    const laptopNueva = randomUUID()
    await pool.query(
      "insert into devices (id, user_id, name, token_hash) values ($1, $2, 'laptop', $3)",
      [laptopNueva, userId, 'hash-' + laptopNueva]
    )
    await enrollDeviceKey(pool, { deviceId: laptopNueva, userId }, { public_key: 'PUB-LAPTOP' })

    const res = await publishWraps(pool, authFor(deviceB), {
      key_epoch: 1, mode: 'authorize',
      wraps: [{ slot: laptopNueva, kind: 'device', wrapped: 'PLANTADA' }],
    })
    expect(res.ok).toBe(false)

    const laLaptop = (await getKeyState(pool, authFor(deviceA))).devices
      .find((d) => d.deviceId === laptopNueva)
    expect(laLaptop?.hasWrap, 'sigue figurando como pendiente de autorizar').toBe(false)
  })

  it('con la prueba en la mano, autorizar sigue funcionando', async () => {
    await activarConA()
    const res = await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1, mode: 'authorize', rotate_proof: verificador('la-legitima', 1),
      wraps: [{ slot: deviceB, kind: 'device', wrapped: 'W-B' }],
    })
    expect(res.ok).toBe(true)
    expect((await getKeyState(pool, authFor(deviceB))).wrap).toEqual({ wrapped: 'W-B', wrapMeta: null })
  })
})

/**
 * Activar sin `rotate_verifier` dejaba la columna en null, y con la prueba cubriendo todo
 * `authorize` eso es una cuenta cifrada SIN SALIDA: ni rotar, ni autorizar otra máquina, ni
 * recuperar con el código. Verificado contra Postgres antes del arreglo: los dos caminos
 * devolvían 403 para siempre.
 */
describe('el verificador es obligatorio al activar', () => {
  it('activar sin verificador se rechaza y no deja la cuenta a medio cifrar', async () => {
    const res = await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1, mode: 'activate',
      wraps: [{ slot: deviceA, kind: 'device', wrapped: 'W-A' }],
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.status).toBe(400)
      expect(res.error).toBe('missing_rotate_verifier')
    }
    const { rows } = await pool.query('select key_epoch from users where id = $1', [userId])
    expect(Number(rows[0].key_epoch), 'la cuenta sigue sin cifrado').toBe(0)
    expect((await getKeyState(pool, authFor(deviceA))).wrap).toBeNull()
  })

  it('un verificador en blanco tampoco cuenta', async () => {
    const res = await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1, mode: 'activate', rotate_verifier: '   ',
      wraps: [{ slot: deviceA, kind: 'device', wrapped: 'W-A' }],
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('missing_rotate_verifier')
  })
})

/**
 * `timingSafeEqual` lanza si los buffers difieren en bytes. La comparación de longitud previa
 * usaba `.length` de string —unidades UTF-16— así que una prueba con un carácter multibyte de
 * la misma longitud en caracteres pasaba el chequeo y hacía lanzar: el handler devolvía 500
 * en vez del 403 que corresponde.
 */
describe('la comparación de la prueba mide bytes, no caracteres', () => {
  it('una prueba multibyte de igual largo en caracteres da 403, no una excepción', async () => {
    await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1, mode: 'activate', rotate_verifier: 'abcd',
      wraps: [{ slot: deviceA, kind: 'device', wrapped: 'W' }],
    })
    const res = await publishWraps(pool, authFor(deviceA), {
      key_epoch: 2, mode: 'activate', rotate_proof: 'abcñ', rotate_verifier: 'x',
      wraps: [{ slot: deviceA, kind: 'device', wrapped: 'W2' }],
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.status).toBe(403)
      expect(res.error).toBe('not_authorized_to_rotate')
    }
  })
})
