import { describe, it, expect } from 'vitest'
import { r2ConfigFromEnv, putObject, getObject, listKeys, type R2Config } from '../src/r2'

const CFG: R2Config = {
  accountId: 'acct123',
  accessKeyId: 'AKIAFAKE',
  secretAccessKey: 'secretofake',
  bucket: 'nest-memory-backups',
}

/** Un `fetch` falso que guarda el Request firmado y devuelve lo que le digan. */
function spyFetch(response: Response) {
  const seen: Request[] = []
  const impl = (async (input: Request | string, init?: RequestInit) => {
    seen.push(input instanceof Request ? input : new Request(input, init))
    return response
  }) as unknown as typeof fetch
  return { impl, seen }
}

describe('r2ConfigFromEnv', () => {
  it('devuelve null si falta cualquiera de las cuatro variables', () => {
    const completo = {
      R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b',
      R2_SECRET_ACCESS_KEY: 'c', R2_BUCKET: 'd',
    }
    expect(r2ConfigFromEnv(completo as NodeJS.ProcessEnv)).not.toBeNull()
    for (const falta of Object.keys(completo)) {
      const parcial = { ...completo, [falta]: '' }
      expect(r2ConfigFromEnv(parcial as NodeJS.ProcessEnv), `sin ${falta}`).toBeNull()
    }
  })
})

describe('putObject', () => {
  it('pega un PUT firmado a la URL S3 del bucket', async () => {
    const { impl, seen } = spyFetch(new Response(null, { status: 200 }))
    await putObject(CFG, 'nest-memory/x.dump', new Uint8Array([1, 2, 3]), { fetchImpl: impl })

    expect(seen).toHaveLength(1)
    const req = seen[0]
    expect(req.method).toBe('PUT')
    expect(req.url).toBe('https://acct123.r2.cloudflarestorage.com/nest-memory-backups/nest-memory/x.dump')
    // Que la firma exista es la mitad del contrato con R2; la otra mitad es el hash del
    // cuerpo, que S3 exige y que aws4fetch calcula solo para el servicio s3.
    expect(req.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 /)
    expect(req.headers.get('x-amz-content-sha256')).toBeTruthy()
  })

  // Un 200 falso no existe: si R2 rechaza, el backup NO fue. Tragarse esto es exactamente el
  // "backup que falla callado" que la tabla `backups` existe para evitar.
  it('tira si R2 responde con error, incluyendo el cuerpo en el mensaje', async () => {
    const { impl } = spyFetch(new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 }))
    await expect(
      putObject(CFG, 'k', new Uint8Array([1]), { fetchImpl: impl })
    ).rejects.toThrow(/403[\s\S]*AccessDenied/)
  })
})

describe('getObject', () => {
  it('devuelve los bytes tal cual', async () => {
    const { impl, seen } = spyFetch(new Response(new Uint8Array([9, 8, 7])))
    const bytes = await getObject(CFG, 'nest-memory/x.dump', { fetchImpl: impl })
    expect(Array.from(bytes)).toEqual([9, 8, 7])
    expect(seen[0].method).toBe('GET')
  })

  it('tira si el objeto no existe', async () => {
    const { impl } = spyFetch(new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 }))
    await expect(getObject(CFG, 'no-existe', { fetchImpl: impl })).rejects.toThrow(/404/)
  })
})

describe('listKeys', () => {
  const xml = (keys: string[], truncated = false) =>
    `<?xml version="1.0"?><ListBucketResult>` +
    keys.map((k) => `<Contents><Key>${k}</Key></Contents>`).join('') +
    `<IsTruncated>${truncated}</IsTruncated></ListBucketResult>`

  it('devuelve las claves ordenadas', async () => {
    const { impl, seen } = spyFetch(new Response(xml([
      'nest-memory/2026-09-03T00-00-00-000Z.dump',
      'nest-memory/2026-09-01T00-00-00-000Z.dump',
    ])))
    const keys = await listKeys(CFG, 'nest-memory/', { fetchImpl: impl })
    expect(keys).toEqual([
      'nest-memory/2026-09-01T00-00-00-000Z.dump',
      'nest-memory/2026-09-03T00-00-00-000Z.dump',
    ])
    expect(seen[0].url).toContain('list-type=2')
    expect(seen[0].url).toContain('prefix=nest-memory%2F')
  })

  // Las claves llevan el timestamp adelante, así que orden lexicográfico = orden cronológico
  // y "la última" es la del final. Con una lista truncada, "la última" sería la última de la
  // PRIMERA página: se restauraría un backup viejo creyendo que es el de anoche. Preferimos
  // romper a mentir.
  it('tira si la respuesta viene truncada, en vez de devolver media lista', async () => {
    const { impl } = spyFetch(new Response(xml(['a'], true)))
    await expect(listKeys(CFG, 'nest-memory/', { fetchImpl: impl })).rejects.toThrow(/truncada/i)
  })
})
