// El JWKS del proyecto de Supabase: de dónde salen las claves públicas con las que se
// verifica un login ES256, y cuándo se vuelven a pedir.
//
// Es la única parte del verificador que habla por red, y habla en el camino de una request
// de usuario. Por eso lo que se prueba acá no es "trae la clave" —eso es una línea— sino las
// tres cosas que hacen que traerla no sea un problema: que no pida en cada request, que una
// rotación de claves no exija un redeploy, y que un `kid` inventado no se convierta en un
// martillo contra Supabase.
import { describe, it, expect, vi } from 'vitest'
import { clavesDeSupabase, TTL_DEL_JWKS, ESPERA_ENTRE_REFRESCOS } from '../src/jwks'

const URL_PROYECTO = 'https://qkqlsytxtshgjxwmafpw.supabase.co'
const KID = 'ec318fd8-53a0-440c-914f-b5167db93c5f'

const CLAVE = {
  alg: 'ES256',
  crv: 'P-256',
  ext: true,
  key_ops: ['verify'],
  kid: KID,
  kty: 'EC',
  use: 'sig',
  x: '4dcxDF9_4EwvgWC3B9WX11Ns93dEwikrZ3xazhiMsBk',
  y: 'hq_hZNlFpK2cw9MV7FB-bCNoGn-xowns1sITJ5D2r8I',
}

function respuesta(cuerpo: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => cuerpo } as unknown as Response
}

/** Un reloj a mano: el TTL no se prueba esperando diez minutos. */
function reloj(inicio = 1_756_900_000_000) {
  let t = inicio
  return { ahora: () => t, avanzar: (ms: number) => { t += ms } }
}

describe('clavesDeSupabase', () => {
  it('pide el JWKS en la ruta que publica Supabase y devuelve la clave del kid', async () => {
    const buscar = vi.fn(async () => respuesta({ keys: [CLAVE] }))
    const claves = clavesDeSupabase(URL_PROYECTO, { buscar, ahora: () => 0 })

    expect(await claves.paraKid(KID)).toMatchObject({ kid: KID, kty: 'EC' })
    expect(buscar).toHaveBeenCalledWith(`${URL_PROYECTO}/auth/v1/.well-known/jwks.json`)
  })

  it('tolera una URL con barra final sin duplicarla', async () => {
    const buscar = vi.fn(async () => respuesta({ keys: [CLAVE] }))
    await clavesDeSupabase(`${URL_PROYECTO}/`, { buscar, ahora: () => 0 }).paraKid(KID)
    expect(buscar).toHaveBeenCalledWith(`${URL_PROYECTO}/auth/v1/.well-known/jwks.json`)
  })

  it('cachea: mil logins seguidos no son mil pedidos a Supabase', async () => {
    const buscar = vi.fn(async () => respuesta({ keys: [CLAVE] }))
    const claves = clavesDeSupabase(URL_PROYECTO, { buscar, ahora: () => 0 })

    for (let i = 0; i < 1000; i++) expect(await claves.paraKid(KID)).not.toBeNull()
    expect(buscar).toHaveBeenCalledTimes(1)
  })

  it('vuelve a pedir cuando el caché venció, para tomar una clave nueva', async () => {
    const buscar = vi.fn(async () => respuesta({ keys: [CLAVE] }))
    const t = reloj()
    const claves = clavesDeSupabase(URL_PROYECTO, { buscar, ahora: t.ahora })

    await claves.paraKid(KID)
    t.avanzar(TTL_DEL_JWKS + 1)
    await claves.paraKid(KID)
    expect(buscar).toHaveBeenCalledTimes(2)
  })

  // Sin esto, rotar la clave del proyecto obligaría a redeployar el servicio: el caché
  // seguiría sirviendo el JWKS viejo hasta que venciera, y mientras tanto todos los logins
  // fallarían con un `kid` que el servicio "no conoce" y que Supabase ya publicó.
  it('un kid desconocido fuerza un refresco: así una rotación no necesita redeploy', async () => {
    const nueva = { ...CLAVE, kid: 'kid-nuevo' }
    const buscar = vi
      .fn()
      .mockResolvedValueOnce(respuesta({ keys: [CLAVE] }))
      .mockResolvedValueOnce(respuesta({ keys: [CLAVE, nueva] }))
    const claves = clavesDeSupabase(URL_PROYECTO, { buscar, ahora: () => 0 })

    await claves.paraKid(KID)
    expect(await claves.paraKid('kid-nuevo')).toMatchObject({ kid: 'kid-nuevo' })
    expect(buscar).toHaveBeenCalledTimes(2)
  })

  // El reverso del test anterior: si cada kid desconocido pidiera el JWKS, cualquiera con un
  // generador de UUIDs convierte a este servicio en un martillo contra Supabase.
  it('no refresca de nuevo por cada kid inventado dentro de la misma ventana', async () => {
    const buscar = vi.fn(async () => respuesta({ keys: [CLAVE] }))
    const claves = clavesDeSupabase(URL_PROYECTO, { buscar, ahora: () => 0 })

    for (let i = 0; i < 50; i++) expect(await claves.paraKid(`inventado-${i}`)).toBeNull()
    expect(buscar).toHaveBeenCalledTimes(2) // el primero, y un solo refresco
  })

  it('pasada la espera, un kid desconocido vuelve a valer un refresco', async () => {
    const buscar = vi.fn(async () => respuesta({ keys: [CLAVE] }))
    const t = reloj()
    const claves = clavesDeSupabase(URL_PROYECTO, { buscar, ahora: t.ahora })

    await claves.paraKid('inventado')
    t.avanzar(ESPERA_ENTRE_REFRESCOS + 1)
    await claves.paraKid('inventado')
    expect(buscar).toHaveBeenCalledTimes(3) // 1 inicial + 1 refresco por ventana
  })

  it('un JWKS que no contesta da null, y el siguiente login lo reintenta', async () => {
    const buscar = vi
      .fn()
      .mockResolvedValueOnce(respuesta({ error: 'nope' }, 500))
      .mockResolvedValueOnce(respuesta({ keys: [CLAVE] }))
    const claves = clavesDeSupabase(URL_PROYECTO, { buscar, ahora: () => 0 })

    expect(await claves.paraKid(KID)).toBeNull()
    expect(await claves.paraKid(KID)).toMatchObject({ kid: KID })
  })

  it('una red caída es null, no una excepción que tumbe la request', async () => {
    const buscar = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    const claves = clavesDeSupabase(URL_PROYECTO, { buscar, ahora: () => 0 })
    await expect(claves.paraKid(KID)).resolves.toBeNull()
  })

  it('un cuerpo que no tiene la forma de un JWKS es null, no un crash', async () => {
    for (const cuerpo of [null, {}, { keys: 'no' }, { keys: [null, 7] }]) {
      const claves = clavesDeSupabase(URL_PROYECTO, { buscar: async () => respuesta(cuerpo), ahora: () => 0 })
      await expect(claves.paraKid(KID)).resolves.toBeNull()
    }
  })

  it('ignora las claves que no son para verificar firmas', async () => {
    const cifrado = { ...CLAVE, kid: 'de-cifrado', use: 'enc' }
    const claves = clavesDeSupabase(URL_PROYECTO, {
      buscar: async () => respuesta({ keys: [cifrado] }),
      ahora: () => 0,
    })
    expect(await claves.paraKid('de-cifrado')).toBeNull()
  })
})
