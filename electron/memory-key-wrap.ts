// Camino B de la spec §5.3: la clave maestra es aleatoria y viaja ENVUELTA — nunca en
// claro, nunca derivada de una contraseña (el login de Nest es OAuth de GitHub y no hay
// contraseña de la cual derivar, que es lo que mata al camino A).
//
// Dos envolturas, la misma idea: un secreto que el servidor guarda y no puede abrir.
//   - Por dispositivo: sealed box X25519. Una maquina ya autorizada envuelve para la
//     publica de la nueva, sin tener su privada.
//   - Por codigo de recuperacion: scrypt sobre los 120 bits que el usuario guarda. Es la
//     respuesta a "perdi todas mis maquinas" (D8). Son 24 caracteres de un alfabeto de 32,
//     o sea 24 x 5 = 120 bits — medido, no estimado; este comentario decia 128.
//
// Puro y sin dependencias, mismo motivo que memory-crypto.ts.
import {
  randomBytes, randomInt, hkdfSync, createCipheriv, createDecipheriv,
  generateKeyPairSync, createPublicKey, createPrivateKey, diffieHellman, scryptSync,
} from 'crypto'

/** Un X25519 exportado como SPKI DER mide siempre 44 bytes: 12 de cabecera + 32 de clave. */
const SPKI_BYTES = 44
const IV_BYTES = 12
const TAG_BYTES = 16

/**
 * scrypt y no Argon2id: Argon2 no esta en `node:crypto` y traerlo seria una dependencia
 * nativa (Global Constraint). El costo de la eleccion es acotado porque el codigo de
 * recuperacion NO es una contraseña elegida por una persona — son 128 bits del CSPRNG, y
 * contra eso ninguna KDF importa: no hay diccionario que probar.
 *
 * N = 2^17 con r = 8 son ~134 MB y ~200 ms medidos en la Mac del 2026-09-09. `maxmem` hay
 * que subirlo a mano: el default de Node (32 MB) rechaza este N.
 */
const SCRYPT_PARAMS = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 } as const

/** Sin I, L, O ni U — las cuatro que se confunden copiando de una pantalla. */
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const RECOVERY_GROUPS = 6
const RECOVERY_GROUP_LEN = 4

/** No abrio la envoltura: clave equivocada, codigo equivocado o bytes cambiados. */
export class MemoryUnwrapError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MemoryUnwrapError'
  }
}

export interface DeviceKeyPair {
  /** SPKI DER en base64url. Es lo que se publica al servidor. */
  publicKey: string
  /** PKCS8 DER en base64url. NUNCA sale de la maquina (memory-key-store.ts la guarda). */
  privateKey: string
}

export function generateDeviceKeyPair(): DeviceKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('x25519')
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64url'),
  }
}

/**
 * Sealed box: efimera + ECDH + HKDF + AES-256-GCM. El emisor genera un par de un solo uso,
 * hace ECDH contra la publica del destinatario y tira su privada efimera; el destinatario
 * rehace el mismo secreto con SU privada y la publica efimera que viaja en el blob.
 *
 * La publica efimera va tambien como `info` del HKDF: ata la clave de envoltura a ESTE
 * blob, asi que un blob armado para otro destinatario no deriva la misma clave aunque
 * alguien mezcle las partes.
 *
 * Formato: `ephSpki(44) || iv(12) || tag(16) || ciphertext` en base64.
 */
export function wrapForDevice(recipientPublicKey: string, secret: Buffer): string {
  const recipient = createPublicKey({
    key: Buffer.from(recipientPublicKey, 'base64url'), format: 'der', type: 'spki',
  })
  const eph = generateKeyPairSync('x25519')
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: recipient })
  const ephSpki = eph.publicKey.export({ type: 'spki', format: 'der' })
  const wrapKey = Buffer.from(hkdfSync('sha256', shared, ephSpki, 'nest-memory/wrap-v1', 32))

  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', wrapKey, iv)
  const ct = Buffer.concat([cipher.update(secret), cipher.final()])
  return Buffer.concat([ephSpki, iv, cipher.getAuthTag(), ct]).toString('base64')
}

export function unwrapWithDevice(privateKey: string, wrapped: string): Buffer {
  try {
    const raw = Buffer.from(wrapped, 'base64')
    if (raw.length < SPKI_BYTES + IV_BYTES + TAG_BYTES) {
      throw new Error('envoltura truncada')
    }
    const ephSpki = raw.subarray(0, SPKI_BYTES)
    const priv = createPrivateKey({
      key: Buffer.from(privateKey, 'base64url'), format: 'der', type: 'pkcs8',
    })
    const shared = diffieHellman({
      privateKey: priv,
      publicKey: createPublicKey({ key: ephSpki, format: 'der', type: 'spki' }),
    })
    const wrapKey = Buffer.from(hkdfSync('sha256', shared, ephSpki, 'nest-memory/wrap-v1', 32))
    const decipher = createDecipheriv('aes-256-gcm', wrapKey, raw.subarray(SPKI_BYTES, SPKI_BYTES + IV_BYTES))
    decipher.setAuthTag(raw.subarray(SPKI_BYTES + IV_BYTES, SPKI_BYTES + IV_BYTES + TAG_BYTES))
    return Buffer.concat([
      decipher.update(raw.subarray(SPKI_BYTES + IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ])
  } catch (err) {
    throw new MemoryUnwrapError(`no se pudo desenvolver: ${(err as Error).message}`)
  }
}

/**
 * 24 caracteres de un alfabeto de 32 = 120 bits de entropia. `randomInt` y no
 * `randomBytes(n) % 32`: el modulo sobre 256 sesga los primeros valores del alfabeto, y
 * aunque acá 256 es multiplo de 32 y no habria sesgo, escribirlo con randomInt saca el
 * "esto anda de casualidad porque el alfabeto mide una potencia de dos".
 */
export function generateRecoveryCode(): string {
  const grupos: string[] = []
  for (let g = 0; g < RECOVERY_GROUPS; g++) {
    let grupo = ''
    for (let i = 0; i < RECOVERY_GROUP_LEN; i++) {
      grupo += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]
    }
    grupos.push(grupo)
  }
  return grupos.join('-')
}

/**
 * Lo que el usuario tipea contra lo que generamos. Sube a mayusculas, tira todo lo que no
 * este en el alfabeto (espacios, guiones de mas, guiones de menos) y re-agrupa. Un codigo
 * bien tipeado con formato distinto TIENE que abrir: lo contrario es culpar al usuario de
 * un problema nuestro.
 */
export function normalizeRecoveryCode(input: string): string {
  const limpio = input.toUpperCase().split('').filter((c) => RECOVERY_ALPHABET.includes(c)).join('')
  const grupos: string[] = []
  for (let i = 0; i < limpio.length; i += RECOVERY_GROUP_LEN) {
    grupos.push(limpio.slice(i, i + RECOVERY_GROUP_LEN))
  }
  return grupos.join('-')
}

export interface RecoveryWrap {
  /** `iv(12) || tag(16) || ciphertext`, base64. */
  wrapped: string
  /** 16 bytes en base64. Se guarda al lado de la envoltura; no es secreto. */
  salt: string
}

export function wrapForRecovery(code: string, secret: Buffer): RecoveryWrap {
  const salt = randomBytes(16)
  const key = scryptSync(normalizeRecoveryCode(code), salt, 32, SCRYPT_PARAMS)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(secret), cipher.final()])
  return {
    wrapped: Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64'),
    salt: salt.toString('base64'),
  }
}

export function unwrapWithRecovery(code: string, wrap: RecoveryWrap): Buffer {
  try {
    const salt = Buffer.from(wrap.salt, 'base64')
    const key = scryptSync(normalizeRecoveryCode(code), salt, 32, SCRYPT_PARAMS)
    const raw = Buffer.from(wrap.wrapped, 'base64')
    if (raw.length < IV_BYTES + TAG_BYTES) throw new Error('envoltura truncada')
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES))
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES))
    return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()])
  } catch (err) {
    throw new MemoryUnwrapError(`código de recuperación incorrecto: ${(err as Error).message}`)
  }
}
