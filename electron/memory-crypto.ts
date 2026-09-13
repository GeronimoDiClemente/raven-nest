// Cifrado del lado del cliente para la memoria sincronizada — spec
// `2026-09-09-nest-memories-plugin-y-cifrado.md` §5.2.
//
// Puro a proposito: sin Electron, sin base, sin red. Es la pieza de la que cuelga todo el
// resto del cifrado, asi que tiene que poder testearse sin montar nada.
//
// Solo `node:crypto`: sumar libsodium o argon2 traeria un modulo nativo, que es el riesgo
// 8.2 de la spec (el paquete npm de la fase 2 tiene que instalar rapido).
import { randomBytes, hkdfSync, createCipheriv, createDecipheriv, createHmac } from 'crypto'

/**
 * Marca de sobre. Existe por la migracion (§5.5.3): durante la re-encriptacion la nube
 * tiene filas cifradas y filas en claro mezcladas, y `isCiphertext()` es lo unico que las
 * separa. El `1` es la version del formato: un `nmc2:` futuro convive con este.
 */
export const CIPHER_PREFIX = 'nmc1:'

const IV_BYTES = 12   // el tamaño nominal de GCM; cualquier otro fuerza a GHASH extra
const TAG_BYTES = 16

export interface MemoryKeys {
  /** AES-256-GCM sobre los campos de texto. */
  field: Buffer
  /** HMAC-SHA256 sobre `topic_key`. */
  topic: Buffer
}

/** No abrio el sobre. Un tipo propio para que el llamador distinga esto de un bug. */
export class MemoryDecryptError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MemoryDecryptError'
  }
}

/** 32 bytes del CSPRNG del SO. Se genera UNA vez por cuenta y no sale del cliente. */
export function generateMasterKey(): Buffer {
  return randomBytes(32)
}

/**
 * Subclaves por proposito, no la maestra directo en los dos usos. Es la practica estandar:
 * el HMAC de tópico viaja al servidor y se compara ahi, asi que un dia podria filtrarse la
 * subclave de tópico sin que eso toque la de contenido.
 *
 * Sin sal: HKDF admite `salt` vacio y la maestra ya es uniforme (32 bytes del CSPRNG), que
 * es justo el caso donde la sal no aporta. Los `info` distintos son lo que separa.
 */
export function deriveKeys(master: Buffer): MemoryKeys {
  const sub = (info: string) => Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), info, 32))
  return { field: sub('nest-memory/field-v1'), topic: sub('nest-memory/topic-v1') }
}

export function isCiphertext(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(CIPHER_PREFIX)
}

/**
 * Datos autenticados pero no cifrados. Atan el ciphertext a SU fila y a SU campo: un
 * servidor hostil que copie el `content` de una observacion al `title` de otra produce un
 * sobre que no abre, en vez de una memoria falsificada que el cliente acepta.
 */
export function fieldAad(syncId: string, field: string): string {
  return `${syncId}|${field}`
}

export function encryptField(keys: MemoryKeys, plaintext: string, aad: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', keys.field, iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return CIPHER_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')
}

export function decryptField(keys: MemoryKeys, envelope: string, aad: string): string {
  if (!isCiphertext(envelope)) {
    throw new MemoryDecryptError('no es un sobre nmc1')
  }
  const raw = Buffer.from(envelope.slice(CIPHER_PREFIX.length), 'base64')
  // El minimo son IV + tag; un cuerpo de 0 bytes es legitimo (el string vacio).
  if (raw.length < IV_BYTES + TAG_BYTES) {
    throw new MemoryDecryptError('sobre truncado')
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', keys.field, raw.subarray(0, IV_BYTES))
    decipher.setAAD(Buffer.from(aad, 'utf8'))
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES))
    return Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8')
  } catch (err) {
    // `final()` tira un Error generico cuando el tag no valida — clave equivocada, AAD
    // equivocado o bytes cambiados son el MISMO sintoma y no se pueden distinguir, que es
    // exactamente lo que GCM promete. Se normaliza a un tipo propio.
    throw new MemoryDecryptError(`no se pudo descifrar: ${(err as Error).message}`)
  }
}

/**
 * `topic_key` no se puede cifrar: el servidor supersede la version anterior de un tema
 * buscando por igualdad (`server/src/push.ts:537`), y un AES-GCM con IV aleatorio da un
 * valor distinto cada vez. Un HMAC deriva un valor estable que el servidor puede comparar
 * sin poder leer el tema — que es todo lo que necesita.
 *
 * Los tres componentes van con separador y no concatenados a secas: sin el `|`, el par
 * (`proj`, `1personal`) y (`proj1`, `personal`) darian el mismo HMAC. Ningun componente
 * puede contener `|` en la practica (project_key es hex, scope es un enum), pero la
 * ambiguedad se cierra por construccion y no por suerte.
 *
 * 32 hex = 128 bits: sobra para que no colisionen dos temas y entra comodo en la columna
 * `text` que el servidor ya tiene.
 */
/**
 * Una marca corta y publica de una clave maestra, para detectar que te dieron OTRA.
 *
 * El adversario que la spec §5.1 nombra tiene ESCRITURA sobre la base del servicio. Envolver
 * no requiere ningun secreto: cualquiera puede calcular `wrapForDevice(pkVictima, suMaestra)`
 * y pisar `key_wraps.wrapped`. La maquina desenvuelve 32 bytes validos, sin ningun error, los
 * guarda como maestra, y a partir de ahi cifra para el atacante — que puede leer todo lo que
 * esa maquina suba.
 *
 * El sealed box no lo puede evitar: no autentica al remitente, y ponerle firma exigiria que
 * el remitente tuviera una identidad verificable, que es justo lo que el servidor podria
 * falsificar. Lo que SI se puede hacer es publicar una marca derivada de la maestra —que no
 * la revela: es un HMAC truncado con una etiqueta de dominio— para que dos maquinas
 * comparen si tienen la MISMA. Si no coinciden, alguien puso una clave que no es la tuya.
 */
export function huellaDeMaestra(master: Buffer): string {
  return createHmac('sha256', master)
    .update('nest-memory/master-fingerprint-v1')
    .digest('hex')
    .slice(0, 16)
}

/**
 * La prueba de que esta maquina TIENE la maestra, para poder rotar la epoca.
 *
 * Rotar borra todas las envolturas de la cuenta, incluida la de recuperacion. El servidor no
 * puede verificarlo mirando sus propias tablas —lo que ahi hay lo puede escribir el que
 * pide rotar— asi que la unica prueba real es conocer la maestra. Va atado a la EPOCA para
 * que el verificador de una epoca vieja no sirva en la nueva.
 *
 * El servidor lo guarda y lo compara. No puede derivarlo, y no le sirve para abrir nada.
 */
export function rotateVerifier(master: Buffer, keyEpoch: number): string {
  return createHmac('sha256', master)
    .update(`nest-memory/rotate-v1/${keyEpoch}`)
    .digest('hex')
}

export function hmacTopicKey(keys: MemoryKeys, projectKey: string, scope: string, topicKey: string): string {
  return createHmac('sha256', keys.topic)
    .update(`${projectKey}|${scope}|${topicKey}`)
    .digest('hex')
    .slice(0, 32)
}
