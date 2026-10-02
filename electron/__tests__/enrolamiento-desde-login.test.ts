import { beforeEach, describe, expect, it, vi } from 'vitest'
import { enrolarDesdeLogin } from '../enrolamiento-desde-login'
import { mensajeDeEnrolamiento } from '../enrolamiento-del-paquete'
import { ensureKeyMaterial, saveKeyMaterial, type SafeStorageLike } from '../memory-key-store'
import { generateDeviceKeyPair, huellaDeClave, wrapForDevice } from '../memory-key-wrap'

vi.mock('../memory-key-store', () => ({ ensureKeyMaterial: vi.fn(), saveKeyMaterial: vi.fn() }))

const device = generateDeviceKeyPair()
const material = { device, master: null, keyEpoch: 0 }
const safe: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: () => { throw new Error('Unexpected keyring write') },
  decryptString: () => { throw new Error('Unexpected keyring read') },
}

function cliente(keyEpoch: number, wrapped: string | null = null) {
  return {
    baseUrl: 'https://memory.invalid', token: 'token-de-prueba', deviceId: 'device-de-prueba',
    fetchImpl: vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      keyEpoch, wrap: wrapped ? { wrapped, wrapMeta: null } : null, devices: [],
    }), { status: 200 })),
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(ensureKeyMaterial).mockReturnValue(material)
})

describe('el enrolamiento cableado al login', () => {
  it('publica la clave de esta máquina con la credencial guardada y muestra su huella', async () => {
    const remoto = cliente(3)
    const resultado = await enrolarDesdeLogin('/home/prueba', safe, remoto)
    expect(ensureKeyMaterial).toHaveBeenCalledWith('/home/prueba', null, safe)
    expect(resultado).toEqual({ estado: 'esperando-autorizacion', huella: huellaDeClave(device.publicKey) })
    expect(remoto.fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      'https://memory.invalid/v1/keys',
      'https://memory.invalid/v1/keys/enroll',
      'https://memory.invalid/v1/keys',
    ])
    const request = remoto.fetchImpl.mock.calls[1]![1]!
    expect(request.method).toBe('POST')
    expect(request.headers).toMatchObject({ Authorization: 'Bearer token-de-prueba', 'X-Device-Test': 'device-de-prueba' })
    expect(JSON.parse(request.body as string)).toEqual({ public_key: device.publicKey, device_id_test: 'device-de-prueba' })
    expect(saveKeyMaterial).not.toHaveBeenCalled()
  })

  it('al reconsultar después de autorizar, abre el sobre y conserva el par de dispositivo', async () => {
    const master = Buffer.alloc(32, 7)
    expect((await enrolarDesdeLogin('/home/prueba', safe, cliente(3))).estado).toBe('esperando-autorizacion')
    const resultado = await enrolarDesdeLogin('/home/prueba', safe, cliente(3, wrapForDevice(device.publicKey, master)))
    expect(resultado).toEqual({ estado: 'lista', keyEpoch: 3 })
    expect(saveKeyMaterial).toHaveBeenCalledWith('/home/prueba', null, safe, {
      ...material, master: master.toString('base64'), keyEpoch: 3,
    })
  })

  it('sin cifrado no pide autorización ni guarda una maestra', async () => {
    const remoto = cliente(0)
    expect(await enrolarDesdeLogin('/home/prueba', safe, remoto)).toEqual({ estado: 'cuenta-sin-cifrado' })
    expect(remoto.fetchImpl).toHaveBeenCalledTimes(1)
    expect(saveKeyMaterial).not.toHaveBeenCalled()
  })

  it('sin llavero no prepara claves ni toca la red', async () => {
    const remoto = cliente(3)
    expect(await enrolarDesdeLogin('/home/prueba', { ...safe, isEncryptionAvailable: () => false }, remoto))
      .toEqual({ estado: 'sin-llavero' })
    expect(ensureKeyMaterial).not.toHaveBeenCalled()
    expect(remoto.fetchImpl).not.toHaveBeenCalled()
  })

  it('una falla al preparar las claves no rechaza la promesa del login', async () => {
    vi.mocked(ensureKeyMaterial).mockImplementation(() => { throw new Error('Permission denied') })
    await expect(enrolarDesdeLogin('/home/prueba', safe, cliente(3)))
      .resolves.toEqual({ estado: 'error', detalle: 'Permission denied' })
  })

  it('una falla del llavero tampoco rechaza la promesa del login', async () => {
    await expect(enrolarDesdeLogin('/home/prueba', {
      ...safe, isEncryptionAvailable: () => { throw new Error('Keyring locked') },
    }, cliente(3))).resolves.toEqual({ estado: 'error', detalle: 'Keyring locked' })
  })

  it('informa errores de red sin perder el detalle', async () => {
    const remoto = cliente(3)
    remoto.fetchImpl.mockRejectedValue(new Error('Service unavailable'))
    await expect(enrolarDesdeLogin('/home/prueba', safe, remoto))
      .resolves.toEqual({ estado: 'error', detalle: 'Service unavailable' })
  })

  it('no anuncia acceso si no pudo persistir la maestra', async () => {
    vi.mocked(saveKeyMaterial).mockImplementation(() => { throw new Error('Disk full') })
    await expect(enrolarDesdeLogin('/home/prueba', safe, cliente(3, wrapForDevice(device.publicKey, Buffer.alloc(32, 7)))))
      .resolves.toEqual({ estado: 'error', detalle: 'Disk full' })
  })
})

describe('mensajes de enrolamiento', () => {
  it('confirma que puede leer lo cifrado sólo cuando está lista', () => {
    expect(mensajeDeEnrolamiento({ estado: 'lista', keyEpoch: 3 }))
      .toEqual(['This machine can read your encrypted memory now.'])
  })

  it('si la cuenta no cifra, no manda a autorizar nada', () => {
    expect(mensajeDeEnrolamiento({ estado: 'cuenta-sin-cifrado' }))
      .toEqual(['Connected. This account does not use encryption. Nothing else to do.'])
  })

  it('muestra siempre la huella pendiente y ofrece autorizar antes que recuperar', () => {
    const texto = mensajeDeEnrolamiento({ estado: 'esperando-autorizacion', huella: '7K4M-92QP-XR3T' }).join('\n')
    expect(texto).toContain('cannot read your encrypted memory yet')
    expect(texto).toContain('Its fingerprint is: 7K4M-92QP-XR3T')
    expect(texto).toContain('Memories → Encryption → Authorize')
    expect(texto).toContain('comparing this fingerprint before authorizing')
    expect(texto.indexOf('Authorize')).toBeLessThan(texto.indexOf('npx nest-memory recover'))
    expect(texto).toContain('one emergency copy')
    expect(texto).toContain('npx nest-memory login')
    expect(texto).toContain('Local memory keeps working')
  })

  it('explica la falta de llavero y que la credencial sigue guardada', () => {
    const texto = mensajeDeEnrolamiento({ estado: 'sin-llavero' }).join('\n')
    expect(texto).toContain('Your credential is saved')
    expect(texto).toContain('no system keyring is available')
    expect(texto).toContain('cannot read encrypted cloud memory')
  })

  it('conserva el error y ofrece reintentar sin pedir otro código', () => {
    const texto = mensajeDeEnrolamiento({ estado: 'error', detalle: 'HTTP 503' }).join('\n')
    expect(texto).toContain('Your credential is saved')
    expect(texto).toContain('encryption enrollment failed: HTTP 503')
    expect(texto).toContain('access could not be confirmed')
    expect(texto).toContain('npx nest-memory login')
  })
})
