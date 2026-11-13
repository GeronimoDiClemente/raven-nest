# Cifrado del lado del cliente para Nest Memories — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el servidor de sync guarde la memoria del usuario sin poder leerla — `content`, `title`, `tags`, `content_hash` y `project_display_name` cifrados en el cliente, `topic_key` por HMAC — con la clave maestra envuelta por dispositivo y un código de recuperación.

**Architecture:** Camino B de la spec §5.3. Una clave maestra aleatoria de 32 bytes por cuenta, que nunca sale del cliente. De ella se derivan por HKDF dos subclaves: una de campo (AES-256-GCM) y una de tópico (HMAC-SHA256). La maestra viaja **envuelta**: una copia sellada con la clave pública X25519 de cada dispositivo autorizado, y una copia sellada con un código de recuperación de 128 bits que el usuario guarda al activar. El servidor almacena las envolturas y las claves públicas, nunca la maestra. El cifrado se enchufa en **dos puntos y solo dos**: el armado del payload en `doPush()` (`electron/memory-daemon.ts:604`) y el mapeo de la fila que vuelve del pull (`mapRawPulledRow` / `applyPulledRow`). Todo lo demás — cuota, límites, merge LWW, supersede por tópico, import, vault, búsqueda FTS5 local — queda intacto porque el servidor ya trata esos campos como bytes opacos (spec §2.3).

**Tech Stack:** Node `node:crypto` (X25519, HKDF-SHA256, AES-256-GCM, scrypt) — **cero dependencias nuevas**, verificado corriendo en este repo el 2026-09-09. Electron `safeStorage` para las claves en reposo. better-sqlite3 para el store local. Postgres para las envolturas del lado del servidor. Vitest.

**Spec:** `docs/superpowers/specs/2026-09-09-nest-memories-plugin-y-cifrado.md`

## Alcance de este plan

La spec cubre **dos** subsistemas: el paquete `@nestmux/memories` con su TUI (§4) y el cifrado (§5). Este plan implementa **solo el cifrado**, que es lo que la §7 de la spec pone primero y por una razón que caduca: hoy hay una sola cuenta con memoria en la nube (la de Gero) y migrarla cuesta una tarde; cada usuario que sumemos multiplica ese costo. El paquete y la TUI son un plan aparte, que se escribe después y que consume el formato que este plan define.

Dentro del cifrado, esta pasada implementa lo que la spec §9 dejó cerrado:

- **Se cifra lo personal.** El scope `team` queda **en claro, anunciado como tal** (decisión 1 del §9). La clave por equipo del §5.4 es la v2 del cifrado y no entra acá.
- **El gate de nube no cambia.** Sin device token no hay push ni pull, que es exactamente el gate que ya existe (decisión 2 del §9).

## Decisiones que este plan toma, y que hay que confirmar

Tres puntos que la spec dejó abiertos en su §9.1 y que el plan no puede esquivar porque definen código. Se implementan como está escrito acá; si alguna se contesta distinto, la Task que la toca es la que cambia.

1. **D8 — la estrategia de backup.** Bauti dijo que el backup lo tiene el usuario en su PC, y eso no cubre ni a la máquina nueva ni a la memoria escrita por otro. Este plan lo cierra separando las dos cosas que D8 mezcla:
   - **El backup de los datos** ya existe y no cambia: `server/src/backup.ts` vuelca a R2. Después de esta pasada ese dump es **texto cifrado**, que es estrictamente mejor que hoy.
   - **El backup de la clave** es el código de recuperación de la Task 2, obligatorio al activar. Sin él, un usuario que pierde todas sus máquinas pierde la memoria de la nube de forma irreversible — y eso es la consecuencia inevitable de lo que Bauti pidió, no un defecto del diseño. Va escrito en la pantalla de activación (Task 12) con esas palabras.
2. **D9 — el límite de bytes por cuenta.** No hace falta un número nuevo. La cuota ya se aplica por `maxBytesFor(plan)` (`server/src/limits.ts`) y a partir de acá mide *ciphertext*. El sobrecosto es exacto y está medido: un campo de `n` bytes ocupa `5 + ceil((28 + n) / 3) * 4` bytes en el sobre (prefijo `nmc1:` + base64 de IV de 12 + tag de 16 + ciphertext). Para la observación promedio del corpus real (1.506 B) son 2.051 B, o sea **1,36×**. El tope de 1 MB por observación pasa a morder a los ~750 KB de texto plano, que siguen siendo **12 veces** la memoria más grande medida (59,4 KB). No cambia nada práctico.
3. **§9.1.1 — el back-office.** `aira-admin` es **otro repo** (`RavenProjects/aira-admin`), así que no se toca acá. La Task 13 deja escrito qué columnas dejan de ser legibles, para que ese repo lo lea antes de romperse solo.

## Global Constraints

Valores copiados textual de la spec y de lo verificado en disco. Toda Task los hereda.

- **Cero dependencias nuevas.** Todo el cifrado sale de `node:crypto`. Motivo: el riesgo 2 de la spec (§8) es que el paquete de la fase 2 tarde dos minutos en instalar por un módulo nativo; sumar `libsodium` o `argon2` acá lo empeoraría. Argon2id aparece en la spec solo dentro del **camino A**, que quedó descartado.
- **Qué se cifra** (spec §5.2, tabla): `content`, `title`, `project_display_name`, `tags` (como blob), `content_hash`. **`topic_key` va por HMAC** — el servidor necesita igualdad (`server/src/push.ts:537`), no el texto.
- **Qué NO se cifra, a propósito** (spec §5.2): `type`, `scope`, `git_branch`, `lamport`, los timestamps, `sync_id`, `project_key` (que ya es `sha256[0:16]`). `scope` decide autorización del lado del servidor y cifrarlo rompería el modelo de permisos.
- **El scope `team` no se cifra en la v1** (spec §9 decisión 1). Una observación con `scope === 'team'` viaja en claro, exactamente como hoy.
- **La máquina del usuario queda fuera del modelo de amenaza** (spec §5.1). La base local está en claro y tiene que estarlo: la búsqueda es FTS5 local y el agente necesita el texto.
- **Nada falla en silencio.** Una fila que no se puede descifrar se bloquea con `reason_code` y aparece en el doctor (spec §5.5.4), que es el camino que ya construyó la fase 1.
- **Prefijo del sobre: `nmc1:`.** Es lo que separa una fila cifrada de una en claro durante la migración, y lo que permite que un cliente lea las dos.
- **Compatibilidad hacia atrás obligatoria durante la migración.** Todo lo que descifra tiene que aceptar texto plano sin sobre y devolverlo tal cual: mientras la Task 11 no termine, la nube tiene las dos cosas mezcladas.

## File Structure

**Nuevos, cliente:**

| Archivo | Responsabilidad |
|---|---|
| `electron/memory-crypto.ts` | El sobre de campo y las subclaves. Puro, sin I/O ni Electron. |
| `electron/memory-key-wrap.ts` | Envolver/desenvolver la maestra: sealed box X25519 y código de recuperación. Puro. |
| `electron/memory-key-store.ts` | Las claves en reposo: `safeStorage` + 0600, una partición por cuenta. |
| `electron/memory-envelope.ts` | El mapa de campos: sellar un payload de mutación, abrir una fila del pull. Puro; recibe las claves por parámetro. |
| `electron/memory-keys-client.ts` | El cliente HTTP de `/v1/keys*`. Aislado para poder testear activación y autorización con un `fetch` falso. |
| `electron/memory-reencrypt.ts` | Re-encolar todo lo local como upsert para que el push normal lo re-suba cifrado. |
| `src/components/MemoryEncryptionCard.tsx` | La tarjeta de cifrado en el overlay Memories. |

**Nuevos, servidor:**

| Archivo | Responsabilidad |
|---|---|
| `server/migrations/006_e2ee.sql` | `device_keys`, `key_wraps`, `users.key_epoch`. |
| `server/src/keys.ts` | `enrollDeviceKey`, `getKeyState`, `publishWraps`. |

**Modificados:**

| Archivo | Qué cambia |
|---|---|
| `electron/memory-store.ts` | `SCHEMA_VERSION` 3 → 4: columna `topic_key_hmac` + `findActiveTopicOwnerByHmac()`. |
| `electron/memory-daemon.ts` | El armado del payload en `doPush()` (~:604) y la apertura en `applyPulledRow()` (~:1100); nueva razón `undecryptable`. |
| `electron/memory-doctor.ts` | `undecryptable` como razón reversible con texto propio. |
| `electron/main.ts` | Los handlers IPC de cifrado, y pasarle las claves al daemon. |
| `electron/preload.ts`, `src/types.ts` | Exponer y tipar esos handlers. |
| `src/hooks/useMemories.ts`, `src/components/MemoriesWorkspace.tsx` | El estado de cifrado y la tarjeta. |
| `server/src/http.ts` | Las tres rutas nuevas. |

---

### Task 1: El sobre de campo y las subclaves

`electron/memory-crypto.ts`. Es la pieza de la que cuelga todo lo demás y no depende de nada: ni de Electron, ni de la base, ni de la red. Se puede aprobar o rechazar sola.

**Files:**
- Create: `electron/memory-crypto.ts`
- Test: `electron/__tests__/memory-crypto.test.ts`

**Interfaces:**
- Consumes: nada (solo `node:crypto`).
- Produces:
  - `export const CIPHER_PREFIX = 'nmc1:'`
  - `export interface MemoryKeys { field: Buffer; topic: Buffer }`
  - `export function generateMasterKey(): Buffer` — 32 bytes aleatorios
  - `export function deriveKeys(master: Buffer): MemoryKeys`
  - `export function isCiphertext(value: unknown): value is string`
  - `export function fieldAad(syncId: string, field: string): string`
  - `export function encryptField(keys: MemoryKeys, plaintext: string, aad: string): string`
  - `export function decryptField(keys: MemoryKeys, envelope: string, aad: string): string` — lanza `MemoryDecryptError` si no abre
  - `export class MemoryDecryptError extends Error`
  - `export function hmacTopicKey(keys: MemoryKeys, projectKey: string, scope: string, topicKey: string): string`

- [ ] **Step 1: Escribir el test que falla**

Crear `electron/__tests__/memory-crypto.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  CIPHER_PREFIX, generateMasterKey, deriveKeys, isCiphertext, fieldAad,
  encryptField, decryptField, hmacTopicKey, MemoryDecryptError,
} from '../memory-crypto'

const keys = deriveKeys(generateMasterKey())

describe('memory-crypto', () => {
  it('genera una maestra de 32 bytes distinta cada vez', () => {
    const a = generateMasterKey()
    const b = generateMasterKey()
    expect(a.length).toBe(32)
    expect(a.equals(b)).toBe(false)
  })

  it('deriva subclaves distintas entre si y estables para la misma maestra', () => {
    const master = generateMasterKey()
    const k1 = deriveKeys(master)
    const k2 = deriveKeys(master)
    expect(k1.field.equals(k2.field)).toBe(true)
    expect(k1.topic.equals(k2.topic)).toBe(true)
    expect(k1.field.equals(k1.topic)).toBe(false)
  })

  it('round-trip de un texto con acentos y emoji', () => {
    const aad = fieldAad('obs_1', 'content')
    const env = encryptField(keys, 'la decision fue no cifrar el scope ñ 😀', aad)
    expect(env.startsWith(CIPHER_PREFIX)).toBe(true)
    expect(decryptField(keys, env, aad)).toBe('la decision fue no cifrar el scope ñ 😀')
  })

  it('dos cifrados del mismo texto dan sobres distintos (IV aleatorio)', () => {
    const aad = fieldAad('obs_1', 'content')
    expect(encryptField(keys, 'hola', aad)).not.toBe(encryptField(keys, 'hola', aad))
  })

  // Lo que el AAD compra: el servidor no puede mover un ciphertext de un campo a otro
  // ni de una fila a otra sin que el cliente lo note.
  it('un sobre no abre con el AAD de otro campo', () => {
    const env = encryptField(keys, 'secreto', fieldAad('obs_1', 'content'))
    expect(() => decryptField(keys, env, fieldAad('obs_1', 'title'))).toThrow(MemoryDecryptError)
  })

  it('un sobre no abre con el AAD de otra fila', () => {
    const env = encryptField(keys, 'secreto', fieldAad('obs_1', 'content'))
    expect(() => decryptField(keys, env, fieldAad('obs_2', 'content'))).toThrow(MemoryDecryptError)
  })

  it('un sobre no abre con otra clave', () => {
    const otras = deriveKeys(generateMasterKey())
    const env = encryptField(keys, 'secreto', fieldAad('obs_1', 'content'))
    expect(() => decryptField(otras, env, fieldAad('obs_1', 'content'))).toThrow(MemoryDecryptError)
  })

  it('un sobre con un byte cambiado no abre — GCM autentica', () => {
    const env = encryptField(keys, 'secreto largo para que haya cuerpo', fieldAad('obs_1', 'content'))
    const raw = Buffer.from(env.slice(CIPHER_PREFIX.length), 'base64')
    raw[raw.length - 1] ^= 0xff
    const roto = CIPHER_PREFIX + raw.toString('base64')
    expect(() => decryptField(keys, roto, fieldAad('obs_1', 'content'))).toThrow(MemoryDecryptError)
  })

  it('basura sin prefijo lanza MemoryDecryptError, no un TypeError del runtime', () => {
    expect(() => decryptField(keys, 'texto en claro', fieldAad('obs_1', 'content'))).toThrow(MemoryDecryptError)
    expect(() => decryptField(keys, CIPHER_PREFIX + '!!!', fieldAad('obs_1', 'content'))).toThrow(MemoryDecryptError)
  })

  it('isCiphertext distingue el sobre del texto en claro', () => {
    expect(isCiphertext(encryptField(keys, 'x', fieldAad('o', 'content')))).toBe(true)
    expect(isCiphertext('la reunion fue el martes')).toBe(false)
    expect(isCiphertext(null)).toBe(false)
    expect(isCiphertext(42)).toBe(false)
  })

  it('el string vacio round-trip-ea (title vacio es un caso real del store)', () => {
    const aad = fieldAad('obs_1', 'title')
    expect(decryptField(keys, encryptField(keys, '', aad), aad)).toBe('')
  })

  // El HMAC del topic_key tiene que ser DETERMINISTICO: el servidor superseded por
  // igualdad (push.ts:537) y dos maquinas de la misma cuenta tienen que producir el
  // mismo valor para el mismo tema, o el supersede deja de funcionar.
  it('hmacTopicKey es determinístico para la misma maestra', () => {
    const a = hmacTopicKey(keys, 'proj1', 'personal', 'deploy')
    const b = hmacTopicKey(keys, 'proj1', 'personal', 'deploy')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{32}$/)
  })

  it('hmacTopicKey separa proyecto, scope y tema', () => {
    const base = hmacTopicKey(keys, 'proj1', 'personal', 'deploy')
    expect(hmacTopicKey(keys, 'proj2', 'personal', 'deploy')).not.toBe(base)
    expect(hmacTopicKey(keys, 'proj1', 'team', 'deploy')).not.toBe(base)
    expect(hmacTopicKey(keys, 'proj1', 'personal', 'release')).not.toBe(base)
  })

  it('hmacTopicKey cambia con la maestra', () => {
    const otras = deriveKeys(generateMasterKey())
    expect(hmacTopicKey(otras, 'proj1', 'personal', 'deploy'))
      .not.toBe(hmacTopicKey(keys, 'proj1', 'personal', 'deploy'))
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npm run native:node && npx vitest run electron/__tests__/memory-crypto.test.ts`
Expected: FAIL — `Failed to resolve import "../memory-crypto"`.

- [ ] **Step 3: Escribir el módulo**

Crear `electron/memory-crypto.ts`:

```ts
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
export function hmacTopicKey(keys: MemoryKeys, projectKey: string, scope: string, topicKey: string): string {
  return createHmac('sha256', keys.topic)
    .update(`${projectKey}|${scope}|${topicKey}`)
    .digest('hex')
    .slice(0, 32)
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run electron/__tests__/memory-crypto.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add electron/memory-crypto.ts electron/__tests__/memory-crypto.test.ts
git commit -m "feat(cifrado): el sobre de campo y las subclaves"
```

---

### Task 2: Envolver la maestra — sealed box y código de recuperación

`electron/memory-key-wrap.ts`. La otra mitad pura del cifrado: cómo la clave maestra llega a una segunda máquina sin pasar en claro por el servidor. Independiente de la Task 1 salvo por el tipo `Buffer` que se pasan.

**Files:**
- Create: `electron/memory-key-wrap.ts`
- Test: `electron/__tests__/memory-key-wrap.test.ts`

**Interfaces:**
- Consumes: nada (solo `node:crypto`).
- Produces:
  - `export interface DeviceKeyPair { publicKey: string; privateKey: string }` — DER base64url (SPKI / PKCS8)
  - `export function generateDeviceKeyPair(): DeviceKeyPair`
  - `export function wrapForDevice(recipientPublicKey: string, secret: Buffer): string`
  - `export function unwrapWithDevice(privateKey: string, wrapped: string): Buffer`
  - `export function generateRecoveryCode(): string`
  - `export function normalizeRecoveryCode(input: string): string`
  - `export interface RecoveryWrap { wrapped: string; salt: string }`
  - `export function wrapForRecovery(code: string, secret: Buffer): RecoveryWrap`
  - `export function unwrapWithRecovery(code: string, wrap: RecoveryWrap): Buffer`
  - `export class MemoryUnwrapError extends Error`

- [ ] **Step 1: Escribir el test que falla**

Crear `electron/__tests__/memory-key-wrap.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { randomBytes } from 'crypto'
import {
  generateDeviceKeyPair, wrapForDevice, unwrapWithDevice,
  generateRecoveryCode, normalizeRecoveryCode, wrapForRecovery, unwrapWithRecovery,
  MemoryUnwrapError,
} from '../memory-key-wrap'

describe('memory-key-wrap — sealed box por dispositivo', () => {
  it('genera pares distintos, serializados como strings', () => {
    const a = generateDeviceKeyPair()
    const b = generateDeviceKeyPair()
    expect(typeof a.publicKey).toBe('string')
    expect(typeof a.privateKey).toBe('string')
    expect(a.publicKey).not.toBe(b.publicKey)
  })

  // El caso central: la maquina que envuelve NO tiene la privada de la que va a abrir.
  it('envuelve con la publica del destinatario y abre con su privada', () => {
    const dispositivo = generateDeviceKeyPair()
    const master = randomBytes(32)
    const wrapped = wrapForDevice(dispositivo.publicKey, master)
    expect(unwrapWithDevice(dispositivo.privateKey, wrapped).equals(master)).toBe(true)
  })

  it('dos envolturas del mismo secreto son distintas (efimera aleatoria)', () => {
    const d = generateDeviceKeyPair()
    const master = randomBytes(32)
    expect(wrapForDevice(d.publicKey, master)).not.toBe(wrapForDevice(d.publicKey, master))
  })

  it('otra privada no abre la envoltura', () => {
    const destinatario = generateDeviceKeyPair()
    const intruso = generateDeviceKeyPair()
    const wrapped = wrapForDevice(destinatario.publicKey, randomBytes(32))
    expect(() => unwrapWithDevice(intruso.privateKey, wrapped)).toThrow(MemoryUnwrapError)
  })

  it('una envoltura con un byte cambiado no abre', () => {
    const d = generateDeviceKeyPair()
    const raw = Buffer.from(wrapForDevice(d.publicKey, randomBytes(32)), 'base64')
    raw[raw.length - 1] ^= 0xff
    expect(() => unwrapWithDevice(d.privateKey, raw.toString('base64'))).toThrow(MemoryUnwrapError)
  })

  it('basura lanza MemoryUnwrapError y no revienta el proceso', () => {
    const d = generateDeviceKeyPair()
    expect(() => unwrapWithDevice(d.privateKey, 'no-es-base64-valido!!')).toThrow(MemoryUnwrapError)
    expect(() => unwrapWithDevice(d.privateKey, '')).toThrow(MemoryUnwrapError)
  })
})

describe('memory-key-wrap — código de recuperación', () => {
  it('el código tiene 6 grupos de 4 del alfabeto sin ambigüedades', () => {
    const code = generateRecoveryCode()
    expect(code).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}(-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}){5}$/)
    // Nunca I, L, O ni U: se confunden al copiarlas a mano de una pantalla.
    expect(code).not.toMatch(/[ILOU]/)
  })

  it('dos códigos seguidos son distintos', () => {
    expect(generateRecoveryCode()).not.toBe(generateRecoveryCode())
  })

  // El usuario lo va a tipear a mano. Que un espacio de mas o una minuscula le
  // devuelvan "codigo incorrecto" seria un error nuestro, no de el.
  it('normaliza minúsculas, espacios y guiones faltantes', () => {
    const code = generateRecoveryCode()
    const sucio = ' ' + code.toLowerCase().replace(/-/g, ' ') + '  '
    expect(normalizeRecoveryCode(sucio)).toBe(code)
  })

  it('round-trip con el código correcto', () => {
    const code = generateRecoveryCode()
    const master = randomBytes(32)
    const wrap = wrapForRecovery(code, master)
    expect(unwrapWithRecovery(code, wrap).equals(master)).toBe(true)
  })

  it('round-trip con el código tipeado sucio', () => {
    const code = generateRecoveryCode()
    const master = randomBytes(32)
    const wrap = wrapForRecovery(code, master)
    expect(unwrapWithRecovery(code.toLowerCase().replace(/-/g, ''), wrap).equals(master)).toBe(true)
  })

  it('un código equivocado no abre', () => {
    const wrap = wrapForRecovery(generateRecoveryCode(), randomBytes(32))
    expect(() => unwrapWithRecovery(generateRecoveryCode(), wrap)).toThrow(MemoryUnwrapError)
  })

  it('la misma clave con otra sal da otra envoltura', () => {
    const code = generateRecoveryCode()
    const master = randomBytes(32)
    const a = wrapForRecovery(code, master)
    const b = wrapForRecovery(code, master)
    expect(a.salt).not.toBe(b.salt)
    expect(a.wrapped).not.toBe(b.wrapped)
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run electron/__tests__/memory-key-wrap.test.ts`
Expected: FAIL — `Failed to resolve import "../memory-key-wrap"`.

- [ ] **Step 3: Escribir el módulo**

Crear `electron/memory-key-wrap.ts`:

```ts
// Camino B de la spec §5.3: la clave maestra es aleatoria y viaja ENVUELTA — nunca en
// claro, nunca derivada de una contraseña (el login de Nest es OAuth de GitHub y no hay
// contraseña de la cual derivar, que es lo que mata al camino A).
//
// Dos envolturas, la misma idea: un secreto que el servidor guarda y no puede abrir.
//   - Por dispositivo: sealed box X25519. Una maquina ya autorizada envuelve para la
//     publica de la nueva, sin tener su privada.
//   - Por codigo de recuperacion: scrypt sobre 128 bits que el usuario guarda. Es la
//     respuesta a "perdi todas mis maquinas" (D8).
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
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run electron/__tests__/memory-key-wrap.test.ts`
Expected: PASS, 13 tests. Los de recuperación tardan ~200 ms cada uno por scrypt; el archivo entero queda bajo los 3 s.

- [ ] **Step 5: Commit**

```bash
git add electron/memory-key-wrap.ts electron/__tests__/memory-key-wrap.test.ts
git commit -m "feat(cifrado): sealed box por dispositivo y codigo de recuperacion"
```

---

### Task 3: Las claves en reposo

`electron/memory-key-store.ts`. Dónde viven la privada del dispositivo y la maestra desenvuelta entre arranques. Mismo trato que el device token: `safeStorage` + modo 0600, y una partición **por cuenta de Nest** — igual que `resolveStorePath()`, porque dos cuentas en la misma máquina tienen memorias distintas y por lo tanto maestras distintas.

**Files:**
- Create: `electron/memory-key-store.ts`
- Test: `electron/__tests__/memory-key-store.test.ts`

**Interfaces:**
- Consumes: `DeviceKeyPair`, `generateDeviceKeyPair` (Task 2).
- Produces:
  - `export interface SafeStorageLike { isEncryptionAvailable(): boolean; encryptString(s: string): Buffer; decryptString(b: Buffer): string }`
  - `export interface KeyMaterial { device: DeviceKeyPair; master: string | null; keyEpoch: number }` — `master` en base64, `null` = el cifrado todavía no está activado en esta máquina
  - `export function keyFilePath(ravenHomeDir: string, userId: string | null): string`
  - `export function loadKeyMaterial(ravenHomeDir: string, userId: string | null, safe: SafeStorageLike): KeyMaterial | null`
  - `export function saveKeyMaterial(ravenHomeDir: string, userId: string | null, safe: SafeStorageLike, material: KeyMaterial): void`
  - `export function ensureKeyMaterial(ravenHomeDir: string, userId: string | null, safe: SafeStorageLike): KeyMaterial` — crea el par del dispositivo la primera vez
  - `export function clearKeyMaterial(ravenHomeDir: string, userId: string | null): void`

- [ ] **Step 1: Escribir el test que falla**

Crear `electron/__tests__/memory-key-store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import {
  keyFilePath, loadKeyMaterial, saveKeyMaterial, ensureKeyMaterial, clearKeyMaterial,
  type SafeStorageLike,
} from '../memory-key-store'

// safeStorage falso: un ROT invertible alcanza para probar que el modulo lo USA (que no
// escribe texto plano) sin depender de Electron ni del llavero del SO.
const safe: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(Buffer.from(s, 'utf8').map((b) => b ^ 0x5a)),
  decryptString: (b) => Buffer.from(b.map((x) => x ^ 0x5a)).toString('utf8'),
}
const safeSinCifrado: SafeStorageLike = { ...safe, isEncryptionAvailable: () => false }

let home: string
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'nest-keys-')) })
afterEach(() => { rmSync(home, { recursive: true, force: true }) })

describe('memory-key-store', () => {
  it('particiona por cuenta, igual que el store', () => {
    const a = keyFilePath(home, 'user-a')
    const b = keyFilePath(home, 'user-b')
    expect(a).not.toBe(b)
    expect(a).toContain('user-a')
    // Sin cuenta logueada cae en `_local`, no en la de nadie.
    expect(keyFilePath(home, null)).toContain('_local')
    expect(keyFilePath(home, '  ')).toBe(keyFilePath(home, null))
  })

  it('sin archivo devuelve null en vez de lanzar', () => {
    expect(loadKeyMaterial(home, 'u1', safe)).toBeNull()
  })

  it('ensureKeyMaterial crea el par del dispositivo y lo persiste', () => {
    const primero = ensureKeyMaterial(home, 'u1', safe)
    expect(primero.device.publicKey).toBeTruthy()
    expect(primero.master).toBeNull()
    expect(primero.keyEpoch).toBe(0)
    // La segunda llamada NO rota el par: rotarlo dejaria huerfanas las envolturas que el
    // servidor ya tiene para este dispositivo.
    expect(ensureKeyMaterial(home, 'u1', safe).device.publicKey).toBe(primero.device.publicKey)
  })

  it('round-trip de la maestra y del epoch', () => {
    const m = ensureKeyMaterial(home, 'u1', safe)
    saveKeyMaterial(home, 'u1', safe, { ...m, master: Buffer.alloc(32, 7).toString('base64'), keyEpoch: 1 })
    const leido = loadKeyMaterial(home, 'u1', safe)!
    expect(leido.master).toBe(Buffer.alloc(32, 7).toString('base64'))
    expect(leido.keyEpoch).toBe(1)
    expect(leido.device.privateKey).toBe(m.device.privateKey)
  })

  it('el archivo NO contiene la privada en claro', () => {
    const m = ensureKeyMaterial(home, 'u1', safe)
    const bytes = readFileSync(keyFilePath(home, 'u1'))
    expect(bytes.includes(Buffer.from(m.device.privateKey, 'utf8'))).toBe(false)
  })

  it('el archivo queda 0600', () => {
    ensureKeyMaterial(home, 'u1', safe)
    if (process.platform !== 'win32') {
      expect(statSync(keyFilePath(home, 'u1')).mode & 0o777).toBe(0o600)
    }
  })

  // §6.2: sin cifrado del SO no se guarda una clave maestra en disco. Se REHUSA, no se
  // degrada a texto plano.
  it('sin safeStorage disponible, guardar lanza y no deja archivo', () => {
    expect(() => ensureKeyMaterial(home, 'u1', safeSinCifrado)).toThrow(/safeStorage/i)
    expect(existsSync(keyFilePath(home, 'u1'))).toBe(false)
  })

  it('un archivo corrupto devuelve null en vez de tumbar la memoria entera', () => {
    const path = keyFilePath(home, 'u1')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, Buffer.from('no es esto'))
    expect(loadKeyMaterial(home, 'u1', safe)).toBeNull()
  })

  it('clearKeyMaterial borra y es idempotente', () => {
    ensureKeyMaterial(home, 'u1', safe)
    clearKeyMaterial(home, 'u1')
    expect(existsSync(keyFilePath(home, 'u1'))).toBe(false)
    expect(() => clearKeyMaterial(home, 'u1')).not.toThrow()
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run electron/__tests__/memory-key-store.test.ts`
Expected: FAIL — `Failed to resolve import "../memory-key-store"`.

- [ ] **Step 3: Escribir el módulo**

Crear `electron/memory-key-store.ts`:

```ts
// Las claves del cifrado en reposo. Mismo trato que `credential.bin` (spec §6.2):
// safeStorage encima, 0600 abajo, defensa en profundidad.
//
// Particionado por CUENTA DE NEST, con la misma regla que `resolveStorePath()` en
// memory-store.ts: dos cuentas en la misma maquina tienen bases distintas, asi que tienen
// maestras distintas. Sin cuenta logueada, `_local`.
import { join, dirname } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, chmodSync } from 'fs'
import { generateDeviceKeyPair, type DeviceKeyPair } from './memory-key-wrap'

/** Lo que este modulo necesita de `electron.safeStorage`, para poder testearlo sin Electron. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plaintext: string): Buffer
  decryptString(encrypted: Buffer): string
}

export interface KeyMaterial {
  /** El par de ESTA maquina. Se genera una vez y no rota. */
  device: DeviceKeyPair
  /** La maestra desenvuelta, base64. `null` = el cifrado no esta activo en esta maquina. */
  master: string | null
  /** La epoca de clave que corresponde a esa maestra. `0` = ninguna. */
  keyEpoch: number
}

export function keyFilePath(ravenHomeDir: string, userId: string | null): string {
  const account = userId && userId.trim() ? userId : '_local'
  return join(ravenHomeDir, '.raven-nest', 'memory', account, 'keys.bin')
}

/**
 * Devuelve `null` en CUALQUIER falla de lectura, igual que memory-connection-state.ts y por
 * el mismo motivo: el peor caso es "esta maquina se tiene que volver a autorizar", que es
 * recuperable, y lanzar desde acá apagaria toda la memoria (main.ts atrapa y pone
 * `memory = null`).
 */
export function loadKeyMaterial(
  ravenHomeDir: string,
  userId: string | null,
  safe: SafeStorageLike
): KeyMaterial | null {
  const path = keyFilePath(ravenHomeDir, userId)
  if (!existsSync(path)) return null
  try {
    if (!safe.isEncryptionAvailable()) return null
    const parsed = JSON.parse(safe.decryptString(readFileSync(path))) as Partial<KeyMaterial>
    if (!parsed?.device?.publicKey || !parsed?.device?.privateKey) return null
    return {
      device: { publicKey: parsed.device.publicKey, privateKey: parsed.device.privateKey },
      master: typeof parsed.master === 'string' ? parsed.master : null,
      keyEpoch: typeof parsed.keyEpoch === 'number' ? parsed.keyEpoch : 0,
    }
  } catch {
    return null
  }
}

/**
 * Escribir SI lanza cuando no hay cifrado del SO: guardar una clave maestra en texto plano
 * seria peor que no cifrar nada, porque la promesa de la landing pasaria a ser falsa.
 */
export function saveKeyMaterial(
  ravenHomeDir: string,
  userId: string | null,
  safe: SafeStorageLike,
  material: KeyMaterial
): void {
  if (!safe.isEncryptionAvailable()) {
    throw new Error('safeStorage no está disponible en este sistema — no se guardan claves en claro (§6.2)')
  }
  const path = keyFilePath(ravenHomeDir, userId)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, safe.encryptString(JSON.stringify(material)), { mode: 0o600 })
  // `mode` de writeFileSync queda sujeto a la umask; el chmod explicito es el que manda.
  // No-op en Windows (ACLs, no bits POSIX), donde DPAPI es la proteccion real.
  try { chmodSync(path, 0o600) } catch { /* best effort */ }
}

/** Lee lo que haya; si no hay par de dispositivo todavia, lo genera y lo persiste. */
export function ensureKeyMaterial(
  ravenHomeDir: string,
  userId: string | null,
  safe: SafeStorageLike
): KeyMaterial {
  const existente = loadKeyMaterial(ravenHomeDir, userId, safe)
  if (existente) return existente
  const nuevo: KeyMaterial = { device: generateDeviceKeyPair(), master: null, keyEpoch: 0 }
  saveKeyMaterial(ravenHomeDir, userId, safe, nuevo)
  return nuevo
}

export function clearKeyMaterial(ravenHomeDir: string, userId: string | null): void {
  const path = keyFilePath(ravenHomeDir, userId)
  try { if (existsSync(path)) unlinkSync(path) } catch { /* best effort */ }
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run electron/__tests__/memory-key-store.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add electron/memory-key-store.ts electron/__tests__/memory-key-store.test.ts
git commit -m "feat(cifrado): las claves en reposo, por cuenta y con safeStorage"
```

---

### Task 4: El servidor guarda envolturas que no puede abrir

Migración 006 y tres rutas. El servidor no aprende nada nuevo: guarda claves públicas y blobs sellados. Es una tarea de servidor entera y se revisa sola.

**Files:**
- Create: `server/migrations/006_e2ee.sql`
- Create: `server/src/keys.ts`
- Modify: `server/src/http.ts` (routing, junto a `isShare`)
- Test: `server/__tests__/keys.test.ts`

**Interfaces:**
- Consumes: `AuthResult` de `server/src/auth.ts`.
- Produces:
  - `export interface DeviceKeyRow { deviceId: string; name: string; publicKey: string; hasWrap: boolean }`
  - `export interface KeyState { keyEpoch: number; wrap: { wrapped: string; wrapMeta: Record<string, unknown> | null } | null; devices: DeviceKeyRow[] }`
  - `export async function enrollDeviceKey(pool, auth, body): Promise<{ ok: true } | { ok: false; status: 400; error: string }>`
  - `export async function getKeyState(pool, auth): Promise<KeyState>`
  - `export async function publishWraps(pool, auth, body): Promise<{ ok: true; keyEpoch: number } | { ok: false; status: 400 | 409; error: string }>`

> **Nota de diseño:** el servidor NO valida que una envoltura sea la de la maestra correcta — no puede, ese es el punto. Lo único que vigila es la **época**: `publishWraps` rechaza con 409 un intento de bajar la época o de re-escribir la actual desde una máquina que no está autorizada, para que un cliente confundido no le pise al usuario la envoltura buena con una de otra maestra.

- [ ] **Step 1: Escribir el test que falla**

Crear `server/__tests__/keys.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { enrollDeviceKey, getKeyState, publishWraps } from '../src/keys'

const pool = getPool()
let userId: string
let deviceA: string
let deviceB: string
const authFor = (deviceId: string) => ({ deviceId, userId, plan: 'pro' })

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
      key_epoch: 1,
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
      key_epoch: 1, wraps: [{ slot: deviceA, kind: 'device', wrapped: 'W-A' }],
    })
    await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1, wraps: [{ slot: deviceB, kind: 'device', wrapped: 'W-B' }],
    })
    expect((await getKeyState(pool, authFor(deviceB))).wrap).toEqual({ wrapped: 'W-B', wrapMeta: null })
    // Y A no perdio la suya.
    expect((await getKeyState(pool, authFor(deviceA))).wrap).toEqual({ wrapped: 'W-A', wrapMeta: null })
  })

  it('hasWrap distingue una maquina autorizada de una que espera', async () => {
    await enrollDeviceKey(pool, authFor(deviceA), { public_key: 'PUB-A' })
    await enrollDeviceKey(pool, authFor(deviceB), { public_key: 'PUB-B' })
    await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1, wraps: [{ slot: deviceA, kind: 'device', wrapped: 'W-A' }],
    })
    const porId = new Map((await getKeyState(pool, authFor(deviceA))).devices.map((d) => [d.deviceId, d]))
    expect(porId.get(deviceA)!.hasWrap).toBe(true)
    expect(porId.get(deviceB)!.hasWrap).toBe(false)
  })

  // El 409 que protege al usuario de un cliente confundido: bajar la epoca borraria las
  // envolturas de la maestra vigente y dejaria la memoria de la nube ilegible.
  it('rechaza retroceder de época', async () => {
    await publishWraps(pool, authFor(deviceA), {
      key_epoch: 2, wraps: [{ slot: deviceA, kind: 'device', wrapped: 'W-A' }],
    })
    expect(await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1, wraps: [{ slot: deviceA, kind: 'device', wrapped: 'VIEJA' }],
    })).toEqual({ ok: false, status: 409, error: 'stale_key_epoch' })
    expect((await getKeyState(pool, authFor(deviceA))).wrap).toEqual({ wrapped: 'W-A', wrapMeta: null })
  })

  it('una época NUEVA borra las envolturas de la anterior (rotación)', async () => {
    await enrollDeviceKey(pool, authFor(deviceA), { public_key: 'PUB-A' })
    await publishWraps(pool, authFor(deviceA), {
      key_epoch: 1,
      wraps: [{ slot: deviceA, kind: 'device', wrapped: 'W-A1' }, { slot: deviceB, kind: 'device', wrapped: 'W-B1' }],
    })
    await publishWraps(pool, authFor(deviceA), {
      key_epoch: 2, wraps: [{ slot: deviceA, kind: 'device', wrapped: 'W-A2' }],
    })
    expect((await getKeyState(pool, authFor(deviceA))).wrap).toEqual({ wrapped: 'W-A2', wrapMeta: null })
    // B queda sin envoltura: le sacaron el acceso, que es de lo que trata rotar.
    expect((await getKeyState(pool, authFor(deviceB))).wrap).toBeNull()
  })

  it('rechaza un body sin envolturas o con una época no positiva', async () => {
    expect(await publishWraps(pool, authFor(deviceA), { key_epoch: 1, wraps: [] }))
      .toEqual({ ok: false, status: 400, error: 'no_wraps' })
    expect(await publishWraps(pool, authFor(deviceA), { key_epoch: 0, wraps: [{ slot: deviceA, kind: 'device', wrapped: 'W' }] }))
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
    const estado = await getKeyState(pool, { deviceId: otroDevice, userId: otroUser, plan: 'pro' })
    expect(estado).toEqual({ keyEpoch: 0, wrap: null, devices: [] })
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Levantar Postgres si no está arriba:

```bash
docker run -d --name nest-memory-pg -e POSTGRES_PASSWORD=nestmem \
  -e POSTGRES_DB=nest_memory -p 55432:5432 postgres:16-alpine
```

Run: `cd server && npx vitest run __tests__/keys.test.ts`
Expected: FAIL — `Cannot find module '../src/keys'`.

- [ ] **Step 3: Escribir la migración**

Crear `server/migrations/006_e2ee.sql`:

```sql
-- Cifrado del lado del cliente (spec 2026-09-09 §5.3, camino B). El servicio guarda
-- claves PUBLICAS y blobs SELLADOS: nada de esto le sirve para leer una memoria.

-- La publica X25519 de cada maquina, publicada por ella misma con su propio device token.
create table if not exists device_keys (
  device_id   uuid primary key references devices(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  public_key  text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Sirve "que maquinas de esta cuenta puedo autorizar", que es el unico query que se hace.
create index if not exists device_keys_by_user on device_keys (user_id);

-- Una fila por destinatario de la clave maestra. `slot` es el device_id (como texto) o el
-- literal 'recovery'. Un solo espacio de nombres a proposito: el codigo de recuperacion es
-- un destinatario mas, no un caso especial con su propia tabla.
create table if not exists key_wraps (
  user_id    uuid not null references users(id) on delete cascade,
  slot       text not null,
  kind       text not null check (kind in ('device', 'recovery')),
  key_epoch  integer not null,
  wrapped    text not null,
  -- Solo para 'recovery': la sal de scrypt. No es secreta.
  wrap_meta  jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, slot)
);

create index if not exists key_wraps_by_epoch on key_wraps (user_id, key_epoch);

-- 0 = esta cuenta no tiene el cifrado activado. Es lo que el cliente mira para saber si
-- tiene que cifrar antes de pushear.
alter table users add column if not exists key_epoch integer not null default 0;
```

- [ ] **Step 4: Escribir el módulo**

Crear `server/src/keys.ts`:

```ts
// Spec §5.3 camino B, del lado del servicio. Tres operaciones y ninguna mira adentro de
// nada: publicar la clave publica de una maquina, leer el estado de claves de la cuenta, y
// publicar envolturas de la maestra.
//
// Lo que el servicio SI vigila es la epoca. No puede validar que una envoltura contenga la
// maestra correcta — ese es justamente el punto — pero si puede impedir que un cliente
// confundido pise las envolturas de la maestra vigente con las de otra, que dejaria la
// memoria de la nube ilegible para siempre. De ahi el 409.
import type { Pool } from 'pg'

export interface KeysAuth {
  deviceId: string
  userId: string
}

export interface DeviceKeyRow {
  deviceId: string
  name: string
  publicKey: string
  hasWrap: boolean
}

export interface KeyState {
  keyEpoch: number
  /** La envoltura de ESTE device, o null si todavia no fue autorizado. */
  wrap: { wrapped: string; wrapMeta: Record<string, unknown> | null } | null
  devices: DeviceKeyRow[]
}

export interface WrapInput {
  slot: string
  kind: 'device' | 'recovery'
  wrapped: string
  wrap_meta?: Record<string, unknown> | null
}

type Fail<S extends number> = { ok: false; status: S; error: string }

export async function enrollDeviceKey(
  pool: Pool,
  auth: KeysAuth,
  body: { public_key?: unknown }
): Promise<{ ok: true } | Fail<400>> {
  const publicKey = body?.public_key
  if (typeof publicKey !== 'string' || publicKey.trim() === '') {
    return { ok: false, status: 400, error: 'invalid_public_key' }
  }
  await pool.query(
    `insert into device_keys (device_id, user_id, public_key)
     values ($1, $2, $3)
     on conflict (device_id) do update set public_key = excluded.public_key, updated_at = now()`,
    [auth.deviceId, auth.userId, publicKey]
  )
  return { ok: true }
}

export async function getKeyState(pool: Pool, auth: KeysAuth): Promise<KeyState> {
  const { rows: epochRows } = await pool.query(
    'select key_epoch from users where id = $1',
    [auth.userId]
  )
  const keyEpoch = Number(epochRows[0]?.key_epoch ?? 0)

  // Las revocadas no se listan: ofrecerle al usuario autorizar una maquina que ya no puede
  // sincronizar seria mentirle sobre lo que va a pasar.
  const { rows: deviceRows } = await pool.query(
    `select k.device_id, d.name, k.public_key,
            (w.slot is not null) as has_wrap
       from device_keys k
       join devices d on d.id = k.device_id and d.revoked_at is null
       left join key_wraps w
              on w.user_id = k.user_id and w.slot = k.device_id::text and w.key_epoch = $2
      where k.user_id = $1
      order by d.created_at, d.id`,
    [auth.userId, keyEpoch]
  )

  const { rows: wrapRows } = await pool.query(
    `select wrapped, wrap_meta from key_wraps
      where user_id = $1 and slot = $2 and key_epoch = $3`,
    [auth.userId, auth.deviceId, keyEpoch]
  )

  return {
    keyEpoch,
    wrap: wrapRows.length > 0
      ? { wrapped: String(wrapRows[0].wrapped), wrapMeta: wrapRows[0].wrap_meta ?? null }
      : null,
    devices: deviceRows.map((r) => ({
      deviceId: String(r.device_id),
      name: String(r.name),
      publicKey: String(r.public_key),
      hasWrap: Boolean(r.has_wrap),
    })),
  }
}

export async function publishWraps(
  pool: Pool,
  auth: KeysAuth,
  body: { key_epoch?: unknown; wraps?: unknown }
): Promise<{ ok: true; keyEpoch: number } | Fail<400> | Fail<409>> {
  const keyEpoch = Number(body?.key_epoch)
  if (!Number.isInteger(keyEpoch) || keyEpoch < 1) {
    return { ok: false, status: 400, error: 'invalid_key_epoch' }
  }
  const wraps = Array.isArray(body?.wraps) ? (body.wraps as WrapInput[]) : []
  if (wraps.length === 0) return { ok: false, status: 400, error: 'no_wraps' }
  for (const w of wraps) {
    if (typeof w?.slot !== 'string' || w.slot.trim() === '') {
      return { ok: false, status: 400, error: 'invalid_slot' }
    }
    if (w.kind !== 'device' && w.kind !== 'recovery') {
      return { ok: false, status: 400, error: 'invalid_kind' }
    }
    if (typeof w?.wrapped !== 'string' || w.wrapped.trim() === '') {
      return { ok: false, status: 400, error: 'invalid_wrapped' }
    }
  }

  const client = await pool.connect()
  try {
    await client.query('begin')
    // Serializa a dos maquinas de la MISMA cuenta activando el cifrado a la vez: sin esto,
    // las dos leen epoca 0, las dos escriben epoca 1 con maestras distintas, y la que
    // comitea segunda deja a la primera con datos que ya no puede leer.
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `keys:${auth.userId}`,
    ])

    const { rows } = await client.query(
      'select key_epoch from users where id = $1 for update',
      [auth.userId]
    )
    const actual = Number(rows[0]?.key_epoch ?? 0)
    if (keyEpoch < actual) {
      await client.query('rollback')
      return { ok: false, status: 409, error: 'stale_key_epoch' }
    }

    // Rotar es empezar de cero: las envolturas de la epoca vieja no sirven para la maestra
    // nueva y dejarlas seria ofrecerle al cliente una llave que no abre.
    if (keyEpoch > actual) {
      await client.query('delete from key_wraps where user_id = $1', [auth.userId])
      await client.query('update users set key_epoch = $2 where id = $1', [auth.userId, keyEpoch])
    }

    for (const w of wraps) {
      await client.query(
        `insert into key_wraps (user_id, slot, kind, key_epoch, wrapped, wrap_meta)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (user_id, slot) do update set
           kind = excluded.kind, key_epoch = excluded.key_epoch,
           wrapped = excluded.wrapped, wrap_meta = excluded.wrap_meta`,
        [auth.userId, w.slot, w.kind, keyEpoch, w.wrapped, w.wrap_meta ?? null]
      )
    }

    await client.query('commit')
    return { ok: true, keyEpoch }
  } catch (err) {
    await client.query('rollback').catch(() => { /* la conexión ya puede estar rota */ })
    throw err
  } finally {
    client.release()
  }
}
```

- [ ] **Step 5: Cablear las rutas en `server/src/http.ts`**

Importar arriba, junto a `handleShareProject`:

```ts
import { enrollDeviceKey, getKeyState, publishWraps } from './keys'
```

Agregar los tres flags junto a `isShare` (~línea 143):

```ts
  const isKeysEnroll = path === '/v1/keys/enroll'
  const isKeysGet = path === '/v1/keys'
  const isKeysPublish = path === '/v1/keys/publish'
```

Sumarlos al guard del 404:

```ts
  if (!isPush && !isPull && !isStatus && !isDelete && !isShare
      && !isKeysEnroll && !isKeysGet && !isKeysPublish) {
    return send(res, 404, { error: 'not_found' })
  }
```

Y los handlers, adentro del `try` que ya autenticó, antes de `if (isStatus)`:

```ts
    // Pasan por `authenticate` como push y pull: la credencial es el device token, y los
    // gates de allowlist y plan aplican igual — sin nube no hay nada que cifrar.
    if (isKeysGet) {
      if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' })
      return send(res, 200, await getKeyState(pool, auth))
    }
    if (isKeysEnroll) {
      if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' })
      const body = (await readBody(req)) as Record<string, unknown>
      const result = await enrollDeviceKey(pool, auth, body)
      if (!result.ok) return send(res, result.status, { error: result.error })
      return send(res, 200, { ok: true })
    }
    if (isKeysPublish) {
      if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' })
      const body = (await readBody(req)) as Record<string, unknown>
      const result = await publishWraps(pool, auth, body)
      if (!result.ok) return send(res, result.status, { error: result.error })
      return send(res, 200, { ok: true, key_epoch: result.keyEpoch })
    }
```

- [ ] **Step 6: Correr los tests del servidor enteros**

Run: `cd server && npx vitest run`
Expected: PASS. La suite entera, no solo `keys.test.ts`: la migración 006 corre para todos los archivos y un `alter table users` mal escrito los rompe a todos.

- [ ] **Step 7: Commit**

```bash
git add server/migrations/006_e2ee.sql server/src/keys.ts server/src/http.ts server/__tests__/keys.test.ts
git commit -m "feat(cifrado): el servidor guarda envolturas y claves publicas"
```

---

### Task 5: El store local aprende el HMAC de tópico

El agujero que el cifrado abre y que no es obvio: `topic_key` viaja **hasheado**, así que la fila que vuelve del pull trae un HMAC, no el tema. Pero `applyPulledRow()` usa ese valor para buscar el dueño del tópico **en la base local**, que guarda el tema en claro. Sin esta tarea la búsqueda no encuentra nada, dos filas quedan activas sobre el mismo slot, `idx_obs_topic` explota, la excepción sube a `doPull()`, el cursor no avanza y **el dispositivo deja de sincronizar para siempre** — exactamente el fallo que el comentario C2 de `memory-daemon.ts` documenta.

La salida es que la base local guarde las dos: el tema en claro (para la UI y para `save()`) y su HMAC al lado.

**Files:**
- Modify: `electron/memory-store.ts` (`SCHEMA_VERSION`, `MIGRATIONS`, `BASE_SCHEMA`, `ObservationRow`, `save`, `applyIncomingObservation`)
- Test: `electron/__tests__/memory-store-topic-hmac.test.ts`

**Interfaces:**
- Consumes: nada de las tasks anteriores — la función de hash entra **inyectada**, para que el store siga sin saber nada de criptografía.
- Produces:
  - `export type TopicHasher = (projectKey: string, scope: string, topicKey: string) => string`
  - `MemoryStore.setTopicHasher(hasher: TopicHasher | null): void`
  - `MemoryStore.findActiveTopicOwnerByHmac(projectKey: string, scope: string, topicKeyHmac: string, excludeSyncId: string): ObservationRow | null`
  - `MemoryStore.backfillTopicHmacs(): number` — devuelve cuántas filas actualizó
  - `ObservationRow.topic_key_hmac: string | null`
  - `SCHEMA_VERSION = 4`

- [ ] **Step 1: Escribir el test que falla**

Crear `electron/__tests__/memory-store-topic-hmac.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MemoryStore, SCHEMA_VERSION, type TopicHasher } from '../memory-store'

// Hasher de juguete: determinístico y legible en un assert, que es todo lo que el store
// necesita saber de él.
const hasher: TopicHasher = (p, s, t) => `H(${p}|${s}|${t})`

let dir: string
let store: MemoryStore
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nest-store-hmac-'))
  store = new MemoryStore(join(dir, 'memory.db'))
})
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

const guardar = (topicKey: string | null, title = 't') => store.save({
  projectKey: 'proj1', scope: 'personal', type: 'decision', topicKey,
  title, content: 'body', source: 'test',
})

describe('memory-store — topic_key_hmac', () => {
  it('la base llega a la v4', () => {
    expect(SCHEMA_VERSION).toBe(4)
    expect(store.schemaVersion).toBe(4)
  })

  it('sin hasher el HMAC queda null y nada cambia', () => {
    const { syncId } = guardar('deploy')
    expect(store.get(syncId)!.topic_key_hmac).toBeNull()
  })

  it('con hasher, save() escribe el HMAC junto al tema en claro', () => {
    store.setTopicHasher(hasher)
    const { syncId } = guardar('deploy')
    const row = store.get(syncId)!
    expect(row.topic_key).toBe('deploy')
    expect(row.topic_key_hmac).toBe('H(proj1|personal|deploy)')
  })

  it('una observación sin tema no tiene HMAC', () => {
    store.setTopicHasher(hasher)
    const { syncId } = guardar(null)
    expect(store.get(syncId)!.topic_key_hmac).toBeNull()
  })

  it('findActiveTopicOwnerByHmac encuentra al dueño del slot', () => {
    store.setTopicHasher(hasher)
    const { syncId } = guardar('deploy')
    const owner = store.findActiveTopicOwnerByHmac('proj1', 'personal', 'H(proj1|personal|deploy)', 'otro')
    expect(owner?.sync_id).toBe(syncId)
  })

  it('excluye la propia fila y no cruza proyecto ni scope', () => {
    store.setTopicHasher(hasher)
    const { syncId } = guardar('deploy')
    expect(store.findActiveTopicOwnerByHmac('proj1', 'personal', 'H(proj1|personal|deploy)', syncId)).toBeNull()
    expect(store.findActiveTopicOwnerByHmac('proj2', 'personal', 'H(proj1|personal|deploy)', 'otro')).toBeNull()
    expect(store.findActiveTopicOwnerByHmac('proj1', 'team', 'H(proj1|personal|deploy)', 'otro')).toBeNull()
  })

  it('no devuelve filas borradas ni superseded', () => {
    store.setTopicHasher(hasher)
    const { syncId } = guardar('deploy')
    store.deleteObservation(syncId)
    expect(store.findActiveTopicOwnerByHmac('proj1', 'personal', 'H(proj1|personal|deploy)', 'otro')).toBeNull()
  })

  it('applyIncomingObservation guarda el HMAC que le pasan tal cual', () => {
    store.setTopicHasher(hasher)
    store.applyIncomingObservation({
      syncId: 'obs_remoto', projectKey: 'proj1', scope: 'personal', topicKey: null,
      topicKeyHmac: 'H-DEL-SERVIDOR', type: 'decision', title: 'x', content: 'y',
      updatedAt: Date.now(), lamport: 5, deleted: false,
    })
    const row = store.get('obs_remoto')!
    // El tema en claro NO se puede reconstruir de un HMAC: queda null, y es correcto.
    expect(row.topic_key).toBeNull()
    expect(row.topic_key_hmac).toBe('H-DEL-SERVIDOR')
    expect(store.findActiveTopicOwnerByHmac('proj1', 'personal', 'H-DEL-SERVIDOR', 'otro')?.sync_id)
      .toBe('obs_remoto')
  })

  // El caso de la activacion: hay 866 filas guardadas ANTES de que existiera una clave.
  it('backfillTopicHmacs completa las filas viejas y no toca las que ya tienen', () => {
    const a = guardar('deploy', 'a').syncId
    const b = guardar('release', 'b').syncId
    const c = guardar(null, 'c').syncId
    expect(store.get(a)!.topic_key_hmac).toBeNull()

    store.setTopicHasher(hasher)
    expect(store.backfillTopicHmacs()).toBe(2)
    expect(store.get(a)!.topic_key_hmac).toBe('H(proj1|personal|deploy)')
    expect(store.get(b)!.topic_key_hmac).toBe('H(proj1|personal|release)')
    expect(store.get(c)!.topic_key_hmac).toBeNull()

    // Idempotente: correrlo de nuevo no reescribe nada.
    expect(store.backfillTopicHmacs()).toBe(0)
  })

  it('backfillTopicHmacs sin hasher es un no-op, no una excepción', () => {
    guardar('deploy')
    expect(store.backfillTopicHmacs()).toBe(0)
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run electron/__tests__/memory-store-topic-hmac.test.ts`
Expected: FAIL — `SCHEMA_VERSION` es 3 y no existe `setTopicHasher`.

- [ ] **Step 3: Migración v4 y la columna**

En `electron/memory-store.ts`, subir la constante:

```ts
export const SCHEMA_VERSION = 4
```

Agregar `topic_key_hmac TEXT` a `BASE_SCHEMA`, en `observations`, justo debajo de `topic_key`:

```sql
        topic_key      TEXT,
        topic_key_hmac TEXT,
```

Sumar el paso 4 a `MIGRATIONS` (función, no string — `ALTER TABLE ADD COLUMN` de SQLite no tiene `IF NOT EXISTS`, ver el comentario que ya está arriba de ese objeto):

```ts
  // El cifrado manda `topic_key` por HMAC (spec §5.2), asi que la fila que vuelve del pull
  // no trae el tema sino su hash. `findActiveTopicOwnerByHmac` lo busca contra ESTA
  // columna; sin ella el supersede por topico no encuentra nunca al dueño local, quedan
  // dos filas activas sobre el mismo slot y `idx_obs_topic` tumba el pull entero.
  4: (db) => {
    const columns = db.prepare('PRAGMA table_info(observations)').all() as Array<{ name: string }>
    if (!columns.some((c) => c.name === 'topic_key_hmac')) {
      db.exec('ALTER TABLE observations ADD COLUMN topic_key_hmac TEXT;')
    }
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_obs_topic_hmac
         ON observations(project_key, scope, topic_key_hmac)
       WHERE topic_key_hmac IS NOT NULL;`
    )
  },
```

Sumar el campo a `ObservationRow`, debajo de `topic_key`:

```ts
  /**
   * El `topic_key` pasado por HMAC con la clave de la cuenta (memory-crypto.ts). Es lo
   * unico que el servidor ve del tema, y por lo tanto lo unico que trae una fila del pull:
   * una fila remota tiene `topic_key = null` y ESTE campo lleno. Una fila local tiene los
   * dos, o solo el claro si el cifrado no esta activado.
   */
  topic_key_hmac: string | null
```

- [ ] **Step 4: El hasher inyectado y los tres métodos**

Sobre la clase, el tipo:

```ts
/**
 * Convierte (proyecto, scope, tema) en el valor estable que viaja al servidor. Se INYECTA
 * — el store no importa memory-crypto.ts — para que siga sin saber nada de claves y para
 * que un test pueda usar una funcion legible en vez de un HMAC real.
 */
export type TopicHasher = (projectKey: string, scope: string, topicKey: string) => string
```

En la clase, junto a `currentUserId`:

```ts
  private topicHasher: TopicHasher | null = null

  /** `null` desactiva: sin cifrado activado, `topic_key_hmac` se queda en NULL. */
  setTopicHasher(hasher: TopicHasher | null): void {
    this.topicHasher = hasher
  }

  /**
   * El gemelo de `findActiveTopicOwner` para el camino cifrado. Existen los dos porque
   * conviven: `save()` local resuelve el topico por el tema en claro, y el pull lo resuelve
   * por el HMAC, que es lo unico que el servidor le manda.
   */
  findActiveTopicOwnerByHmac(
    projectKey: string,
    scope: string,
    topicKeyHmac: string,
    excludeSyncId: string
  ): ObservationRow | null {
    return (
      (this.db
        .prepare(
          `SELECT * FROM observations WHERE project_key = ? AND scope = ? AND topic_key_hmac = ?
           AND sync_id != ? AND deleted = 0 AND superseded_by IS NULL`
        )
        .get(projectKey, scope, topicKeyHmac, excludeSyncId) as ObservationRow) ?? null
    )
  }

  /**
   * Completa el HMAC de las filas que se guardaron ANTES de que existiera una clave — o
   * sea, todas, el dia de la activacion. Sin esto, el primer pull despues de activar no
   * encuentra a ningun dueño local y duplica todos los topicos.
   *
   * Idempotente: solo toca filas con tema en claro y sin HMAC.
   */
  backfillTopicHmacs(): number {
    const hasher = this.topicHasher
    if (!hasher) return 0
    const rows = this.db
      .prepare(
        `SELECT sync_id, project_key, scope, topic_key FROM observations
          WHERE topic_key IS NOT NULL AND topic_key_hmac IS NULL`
      )
      .all() as Array<{ sync_id: string; project_key: string; scope: string; topic_key: string }>
    const update = this.db.prepare('UPDATE observations SET topic_key_hmac = ? WHERE sync_id = ?')
    this.db.transaction(() => {
      for (const r of rows) update.run(hasher(r.project_key, r.scope, r.topic_key), r.sync_id)
    })()
    return rows.length
  }
```

- [ ] **Step 5: Escribir la columna en los dos caminos de escritura**

En `save()`, donde se arma el INSERT de `observations`, calcular el HMAC junto al resto de los campos derivados:

```ts
    const topicKeyHmac = input.topicKey && this.topicHasher
      ? this.topicHasher(input.projectKey, scope, input.topicKey)
      : null
```

y sumar `topic_key_hmac` a la lista de columnas y `topicKeyHmac` a los binds.

En `applyIncomingObservation()`, sumar el campo al tipo del parámetro:

```ts
    /**
     * El HMAC que mando el servidor. Va tal cual: de un HMAC no se puede volver al tema,
     * asi que una fila remota se queda con `topic_key = null` y este campo lleno. La UI que
     * hoy muestra el tema en claro solo lo tiene para las filas escritas en esta maquina —
     * limitacion conocida y aceptada del camino B.
     */
    topicKeyHmac?: string | null
```

y escribirlo en el upsert igual que `topic_key`.

- [ ] **Step 6: Correr el test nuevo y toda la suite del store**

Run: `npx vitest run electron/__tests__/memory-store-topic-hmac.test.ts electron/__tests__/memory-store.test.ts electron/__tests__/memory-daemon.test.ts electron/__tests__/memory-legacy-migration.test.ts`
Expected: PASS. Prestar atención a `memory-legacy-migration.test.ts`: es la que verifica el camino v1 → vN y la que va a gritar si el paso 4 no es idempotente.

- [ ] **Step 7: Commit**

```bash
git add electron/memory-store.ts electron/__tests__/memory-store-topic-hmac.test.ts
git commit -m "feat(cifrado): el store guarda el HMAC del topico al lado del tema"
```

---

### Task 6: El mapa de campos — sellar y abrir

`electron/memory-envelope.ts`. La tabla del §5.2 de la spec convertida en dos funciones. Puro: recibe las claves por parámetro y no toca la red ni la base, así que todo el comportamiento raro (scope `team`, filas en claro de antes de la migración, un sobre roto) se prueba acá y no en el daemon.

**Files:**
- Create: `electron/memory-envelope.ts`
- Test: `electron/__tests__/memory-envelope.test.ts`

**Interfaces:**
- Consumes: `MemoryKeys`, `encryptField`, `decryptField`, `isCiphertext`, `fieldAad`, `hmacTopicKey`, `MemoryDecryptError` (Task 1) · `PulledRow` (`electron/memory-daemon.ts`).
- Produces:
  - `export interface EnvelopeContext { keys: MemoryKeys; keyEpoch: number }`
  - `export function sealMutationPayload(ctx: EnvelopeContext | null, payload: Record<string, unknown>): Record<string, unknown>`
  - `export interface OpenedRow { row: PulledRow; undecryptable: boolean }`
  - `export function openPulledRow(ctx: EnvelopeContext | null, row: PulledRow): OpenedRow`
  - `export function looksLikeTopicHmac(value: string): boolean`

- [ ] **Step 1: Escribir el test que falla**

Crear `electron/__tests__/memory-envelope.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { deriveKeys, generateMasterKey, isCiphertext, hmacTopicKey } from '../memory-crypto'
import { sealMutationPayload, openPulledRow, looksLikeTopicHmac, type EnvelopeContext } from '../memory-envelope'
import type { PulledRow } from '../memory-daemon'

const ctx: EnvelopeContext = { keys: deriveKeys(generateMasterKey()), keyEpoch: 1 }

const payloadBase = () => ({
  sync_id: 'obs_1',
  project_key: 'proj1',
  project_display_name: 'raven-nest',
  scope: 'personal',
  type: 'decision',
  topic_key: 'deploy',
  title: 'no notarizar con build.yml',
  content: 'el DMG sin firmar pisa al firmado',
  tags: ['release', 'mac'],
  content_hash: 'abc123',
  git_branch: 'main',
  lamport: 3,
  updated_at: 1_700_000_000_000,
})

const filaDe = (payload: Record<string, unknown>): PulledRow => ({
  syncId: String(payload.sync_id),
  updatedAt: Number(payload.updated_at),
  lamport: Number(payload.lamport),
  deleted: false,
  topicKey: (payload.topic_key as string | null) ?? null,
  scope: String(payload.scope),
  projectKey: String(payload.project_key),
  supersededBy: null,
  title: payload.title as string,
  content: (payload.content as string | null) ?? null,
  type: payload.type as string,
  tags: payload.tags as string[],
  gitBranch: payload.git_branch as string,
  contentHash: payload.content_hash as string,
})

describe('sealMutationPayload', () => {
  it('sin contexto devuelve el payload intacto', () => {
    const p = payloadBase()
    expect(sealMutationPayload(null, p)).toEqual(p)
  })

  it('cifra los cinco campos de la tabla §5.2', () => {
    const s = sealMutationPayload(ctx, payloadBase())
    expect(isCiphertext(s.title)).toBe(true)
    expect(isCiphertext(s.content)).toBe(true)
    expect(isCiphertext(s.project_display_name)).toBe(true)
    expect(isCiphertext(s.content_hash)).toBe(true)
    expect(Array.isArray(s.tags) && (s.tags as string[]).length === 1 && isCiphertext((s.tags as string[])[0])).toBe(true)
  })

  it('deja en claro lo que la spec dice que queda en claro', () => {
    const s = sealMutationPayload(ctx, payloadBase())
    expect(s.sync_id).toBe('obs_1')
    expect(s.project_key).toBe('proj1')
    expect(s.scope).toBe('personal')
    expect(s.type).toBe('decision')
    expect(s.git_branch).toBe('main')
    expect(s.lamport).toBe(3)
    expect(s.updated_at).toBe(1_700_000_000_000)
  })

  it('el topic_key sale por HMAC, no cifrado', () => {
    const s = sealMutationPayload(ctx, payloadBase())
    expect(s.topic_key).toBe(hmacTopicKey(ctx.keys, 'proj1', 'personal', 'deploy'))
    expect(isCiphertext(s.topic_key)).toBe(false)
  })

  // Decision 1 del §9: el scope team NO se cifra en la v1.
  it('una observación de equipo viaja en claro', () => {
    const p = { ...payloadBase(), scope: 'team' }
    expect(sealMutationPayload(ctx, p)).toEqual(p)
  })

  it('un tombstone con content null no rompe', () => {
    const s = sealMutationPayload(ctx, { ...payloadBase(), content: null })
    expect(s.content).toBeNull()
    expect(isCiphertext(s.title)).toBe(true)
  })

  it('sin topic_key el campo queda null', () => {
    expect(sealMutationPayload(ctx, { ...payloadBase(), topic_key: null }).topic_key).toBeNull()
  })

  it('tags vacíos siguen siendo un array vacío (el servidor hace COALESCE sobre jsonb)', () => {
    expect(sealMutationPayload(ctx, { ...payloadBase(), tags: [] }).tags).toEqual([])
  })

  it('no muta el payload que le pasan', () => {
    const p = payloadBase()
    sealMutationPayload(ctx, p)
    expect(p.title).toBe('no notarizar con build.yml')
  })
})

describe('openPulledRow', () => {
  it('round-trip completo: sellar y abrir devuelve lo original', () => {
    const sellado = sealMutationPayload(ctx, payloadBase())
    const { row, undecryptable } = openPulledRow(ctx, filaDe(sellado))
    expect(undecryptable).toBe(false)
    expect(row.title).toBe('no notarizar con build.yml')
    expect(row.content).toBe('el DMG sin firmar pisa al firmado')
    expect(row.tags).toEqual(['release', 'mac'])
    expect(row.contentHash).toBe('abc123')
  })

  it('el tema no vuelve en claro; vuelve como HMAC', () => {
    const sellado = sealMutationPayload(ctx, payloadBase())
    const { row } = openPulledRow(ctx, filaDe(sellado))
    expect(row.topicKey).toBeNull()
    expect(row.topicKeyHmac).toBe(hmacTopicKey(ctx.keys, 'proj1', 'personal', 'deploy'))
  })

  // La ventana de la migracion: la nube tiene filas viejas en claro y filas nuevas
  // cifradas, y el mismo cliente tiene que leer las dos.
  it('una fila en claro pasa tal cual y su HMAC se recalcula local', () => {
    const { row, undecryptable } = openPulledRow(ctx, filaDe(payloadBase()))
    expect(undecryptable).toBe(false)
    expect(row.title).toBe('no notarizar con build.yml')
    expect(row.tags).toEqual(['release', 'mac'])
    expect(row.topicKey).toBe('deploy')
    expect(row.topicKeyHmac).toBe(hmacTopicKey(ctx.keys, 'proj1', 'personal', 'deploy'))
  })

  it('sin contexto, una fila en claro pasa y no se inventa HMAC', () => {
    const { row, undecryptable } = openPulledRow(null, filaDe(payloadBase()))
    expect(undecryptable).toBe(false)
    expect(row.title).toBe('no notarizar con build.yml')
    expect(row.topicKey).toBe('deploy')
    expect(row.topicKeyHmac).toBeNull()
  })

  // §5.5.4: el modo de falla nuevo. Tiene que ser un booleano que el daemon pueda
  // reportar, no una excepcion que tumbe el pull y frene el cursor.
  it('sin contexto, una fila cifrada marca undecryptable en vez de lanzar', () => {
    const sellado = sealMutationPayload(ctx, payloadBase())
    const { undecryptable } = openPulledRow(null, filaDe(sellado))
    expect(undecryptable).toBe(true)
  })

  it('con la clave equivocada marca undecryptable y no lanza', () => {
    const sellado = sealMutationPayload(ctx, payloadBase())
    const otro: EnvelopeContext = { keys: deriveKeys(generateMasterKey()), keyEpoch: 1 }
    expect(() => openPulledRow(otro, filaDe(sellado))).not.toThrow()
    expect(openPulledRow(otro, filaDe(sellado)).undecryptable).toBe(true)
  })

  it('una fila de equipo se abre sin tocar nada', () => {
    const p = { ...payloadBase(), scope: 'team' }
    const { row, undecryptable } = openPulledRow(ctx, filaDe(p))
    expect(undecryptable).toBe(false)
    expect(row.title).toBe('no notarizar con build.yml')
  })

  it('looksLikeTopicHmac separa un HMAC de un tema escrito por una persona', () => {
    expect(looksLikeTopicHmac(hmacTopicKey(ctx.keys, 'p', 'personal', 't'))).toBe(true)
    expect(looksLikeTopicHmac('deploy')).toBe(false)
    expect(looksLikeTopicHmac('release-2026-09')).toBe(false)
    expect(looksLikeTopicHmac('ABCDEF0123456789ABCDEF0123456789')).toBe(false) // mayusculas: no es nuestro formato
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run electron/__tests__/memory-envelope.test.ts`
Expected: FAIL — `Failed to resolve import "../memory-envelope"`.

- [ ] **Step 3: Escribir el módulo**

Crear `electron/memory-envelope.ts`:

```ts
// La tabla del §5.2 de la spec, hecha codigo. Un solo lugar decide que campo se cifra, cual
// se hashea y cual queda en claro — el daemon solo llama a estas dos funciones.
//
// Puro: recibe las claves por parametro. Todo lo raro (el scope team, las filas en claro
// de antes de la migracion, un sobre que no abre) se prueba aca, sin base y sin red.
import {
  encryptField, decryptField, isCiphertext, fieldAad, hmacTopicKey,
  MemoryDecryptError, type MemoryKeys,
} from './memory-crypto'
import type { PulledRow } from './memory-daemon'

export interface EnvelopeContext {
  keys: MemoryKeys
  /** Solo informativo hoy; existe para que un futuro `nmc2:` sepa con que epoca abrir. */
  keyEpoch: number
}

/** Los campos de texto que se cifran, en el orden de la tabla del §5.2. */
const SEALED_FIELDS = ['title', 'content', 'project_display_name', 'content_hash'] as const

/**
 * Decision 1 del §9: en la v1 el scope `team` NO se cifra. La clave por equipo del §5.4
 * necesita un par de claves por usuario que todavia no existe, y hoy los tres equipos de
 * prueba tienen 0 miembros, asi que no hay memoria de equipo real que proteger. Va
 * anunciado en la landing, no escondido.
 */
function esDeEquipo(scope: unknown): boolean {
  return scope === 'team'
}

/** 32 hex en minuscula es exactamente lo que devuelve `hmacTopicKey`. */
export function looksLikeTopicHmac(value: string): boolean {
  return /^[0-9a-f]{32}$/.test(value)
}

export function sealMutationPayload(
  ctx: EnvelopeContext | null,
  payload: Record<string, unknown>
): Record<string, unknown> {
  if (!ctx || esDeEquipo(payload.scope)) return payload

  const syncId = String(payload.sync_id ?? '')
  const sealed: Record<string, unknown> = { ...payload }

  for (const field of SEALED_FIELDS) {
    const value = payload[field]
    // `null` se respeta: un tombstone nulea el content y ese null es informacion que el
    // servidor usa (`incomingDeleted` en push.ts). Cifrar un null lo convertiria en un
    // string y el tombstone dejaria de leerse como tal.
    if (typeof value !== 'string') continue
    sealed[field] = encryptField(ctx.keys, value, fieldAad(syncId, field))
  }

  // Los tags van como UN sobre, no uno por tag: cifrar cada uno por separado filtraria
  // cuantos tags tiene la observacion y dejaria dos tags iguales con longitudes iguales.
  // El array de un elemento es para que el servidor los siga viendo como el jsonb array
  // que su COALESCE espera (memory-daemon.ts documenta por que `[]` y no `null`).
  const tags = payload.tags
  if (Array.isArray(tags) && tags.length > 0) {
    sealed.tags = [encryptField(ctx.keys, JSON.stringify(tags), fieldAad(syncId, 'tags'))]
  }

  // HMAC y no cifrado: el servidor supersede por igualdad (`server/src/push.ts:537`).
  const topicKey = payload.topic_key
  if (typeof topicKey === 'string' && topicKey !== '') {
    sealed.topic_key = hmacTopicKey(
      ctx.keys,
      String(payload.project_key ?? ''),
      String(payload.scope ?? 'personal'),
      topicKey
    )
  }

  return sealed
}

export interface OpenedRow {
  row: PulledRow
  /**
   * §5.5.4: el modo de falla nuevo. La fila llego cifrada y esta maquina no la puede leer
   * — todavia no fue autorizada, o la clave rotó. NO es una excepcion a proposito: tirar
   * desde acá frenaria el cursor del pull y el device dejaria de sincronizar del todo.
   */
  undecryptable: boolean
}

export function openPulledRow(ctx: EnvelopeContext | null, row: PulledRow): OpenedRow {
  if (esDeEquipo(row.scope)) return { row, undecryptable: false }

  const abierto: PulledRow = { ...row }
  let undecryptable = false

  const abrir = (value: string | null | undefined, field: string): string | null | undefined => {
    if (value == null || !isCiphertext(value)) return value // fila en claro: pasa tal cual
    if (!ctx) { undecryptable = true; return value }
    try {
      return decryptField(ctx.keys, value, fieldAad(row.syncId, field))
    } catch (err) {
      if (err instanceof MemoryDecryptError) { undecryptable = true; return value }
      throw err
    }
  }

  abierto.title = abrir(row.title, 'title') ?? undefined
  abierto.content = abrir(row.content, 'content') ?? null
  abierto.contentHash = abrir(row.contentHash, 'content_hash') ?? undefined

  if (Array.isArray(row.tags) && row.tags.length === 1 && isCiphertext(row.tags[0])) {
    const claro = abrir(row.tags[0], 'tags')
    if (claro != null && !isCiphertext(claro)) {
      try {
        const parsed = JSON.parse(claro)
        abierto.tags = Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
      } catch {
        // Descifro pero no es JSON: no puede pasar con lo que sella `sealMutationPayload`,
        // y perder los tags de UNA fila no justifica marcar la fila entera como ilegible.
        abierto.tags = []
      }
    }
  }

  // El tema: lo que llega es el HMAC, y de un HMAC no se vuelve. Una fila anterior a la
  // migracion trae el tema en claro, y en ese caso el HMAC se recalcula acá — asi el
  // `findActiveTopicOwnerByHmac` local encuentra al dueño durante toda la ventana en que
  // la nube tiene las dos cosas mezcladas, sin tener que frenar el pull.
  if (row.topicKey) {
    if (ctx && looksLikeTopicHmac(row.topicKey)) {
      abierto.topicKey = null
      abierto.topicKeyHmac = row.topicKey
    } else if (ctx) {
      abierto.topicKeyHmac = hmacTopicKey(ctx.keys, row.projectKey, row.scope, row.topicKey)
    }
  }

  return { row: abierto, undecryptable }
}
```

> **`import type`, no `import`, y no es un detalle de estilo:** `memory-daemon.ts` importa
> `sealMutationPayload`/`openPulledRow` de este módulo, y este módulo importa `PulledRow` de
> aquel. Con `import type` la referencia se borra al compilar y no hay ciclo en runtime; sin
> el `type`, el ciclo existe y uno de los dos módulos ve al otro a medio evaluar.

- [ ] **Step 4: Agregar `topicKeyHmac` a `PulledRow`**

En `electron/memory-daemon.ts`, junto a `topicKey`:

```ts
  /**
   * El HMAC del tema (Task 5). Lo llena `openPulledRow`: para una fila cifrada es lo que
   * vino en `topic_key`; para una fila en claro se recalcula local.
   */
  topicKeyHmac?: string | null
```

- [ ] **Step 5: Correr el test para verificar que pasa**

Run: `npx vitest run electron/__tests__/memory-envelope.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 6: Commit**

```bash
git add electron/memory-envelope.ts electron/memory-daemon.ts electron/__tests__/memory-envelope.test.ts
git commit -m "feat(cifrado): el mapa de campos, sellar y abrir"
```

---

### Task 7: El push sale cifrado

Un solo punto de enganche en `doPush()`, después del join del display name y antes del `JSON.stringify` del body.

**Files:**
- Modify: `electron/memory-daemon.ts` (`MemoryDaemonDeps`, `doPush`)
- Test: `electron/__tests__/memory-daemon-cifrado-push.test.ts`

**Interfaces:**
- Consumes: `sealMutationPayload`, `EnvelopeContext` (Task 6).
- Produces: `MemoryDaemonDeps.getEnvelopeContext?: () => EnvelopeContext | null` — opcional, para que todo test y todo call site existente siga compilando sin tocarse.

- [ ] **Step 1: Escribir el test que falla**

Crear `electron/__tests__/memory-daemon-cifrado-push.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MemoryStore } from '../memory-store'
import { MemoryDaemon } from '../memory-daemon'
import { deriveKeys, generateMasterKey, isCiphertext, hmacTopicKey } from '../memory-crypto'
import type { EnvelopeContext } from '../memory-envelope'

const ctx: EnvelopeContext = { keys: deriveKeys(generateMasterKey()), keyEpoch: 1 }

let dir: string
let store: MemoryStore
let enviado: any

function daemonCon(getEnvelopeContext: () => EnvelopeContext | null) {
  enviado = null
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    enviado = JSON.parse(String(init.body))
    return {
      ok: true, status: 200,
      json: async () => ({
        results: enviado.mutations.map((m: any) => ({ sync_id: m.sync_id, outcome: 'applied' })),
      }),
    } as unknown as Response
  }) as unknown as typeof fetch

  return new MemoryDaemon({
    store,
    getSyncBaseUrl: () => 'http://sync.test',
    getToken: () => 'nmk_test',
    getDeviceId: () => 'device-1',
    isOnline: () => true,
    fetchImpl,
    getEnvelopeContext,
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nest-push-cifrado-'))
  store = new MemoryStore(join(dir, 'memory.db'))
  store.ensureProject({ projectKey: 'proj1', displayName: 'raven-nest' })
})
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

const guardar = (scope: 'personal' | 'team' = 'personal') => store.save({
  projectKey: 'proj1', scope, type: 'decision', topicKey: 'deploy',
  title: 'no notarizar con build.yml', content: 'el DMG sin firmar pisa al firmado',
  tags: ['release'], source: 'test',
})

describe('doPush con cifrado', () => {
  it('sin contexto el cuerpo sale igual que hoy', async () => {
    guardar()
    await daemonCon(() => null).push()
    const p = enviado.mutations[0].payload
    expect(p.title).toBe('no notarizar con build.yml')
    expect(p.topic_key).toBe('deploy')
  })

  it('con contexto, el cuerpo que sale a la red no tiene texto legible', async () => {
    guardar()
    await daemonCon(() => ctx).push()
    const p = enviado.mutations[0].payload
    expect(isCiphertext(p.title)).toBe(true)
    expect(isCiphertext(p.content)).toBe(true)
    expect(isCiphertext(p.project_display_name)).toBe(true)
    expect(p.topic_key).toBe(hmacTopicKey(ctx.keys, 'proj1', 'personal', 'deploy'))
    // El chequeo que de verdad importa: NADA del texto original aparece en el body entero.
    const crudo = JSON.stringify(enviado)
    expect(crudo).not.toContain('no notarizar')
    expect(crudo).not.toContain('DMG sin firmar')
    expect(crudo).not.toContain('raven-nest')
    expect(crudo).not.toContain('deploy')
  })

  it('lo que queda en claro sigue en claro', async () => {
    guardar()
    await daemonCon(() => ctx).push()
    const p = enviado.mutations[0].payload
    expect(p.project_key).toBe('proj1')
    expect(p.scope).toBe('personal')
    expect(p.type).toBe('decision')
    expect(typeof p.lamport).toBe('number')
  })

  it('una observación de equipo sale en claro (decisión 1 del §9)', async () => {
    guardar('team')
    await daemonCon(() => ctx).push()
    expect(enviado.mutations[0].payload.title).toBe('no notarizar con build.yml')
  })

  it('el sellado NO cambia el mutation_log: lo encolado queda en claro', async () => {
    guardar()
    await daemonCon(() => ctx).push()
    // La cola local es la copia del usuario y vive en su maquina, que la spec §5.1 deja
    // fuera del modelo de amenaza. Cifrarla romperia un reintento con otra clave.
    const filas = store.blockedMutations()
    expect(filas).toEqual([])
    expect(store.pendingMutationCount()).toBe(0)
  })

  it('el ack por sync_id sigue funcionando: el sync_id no se cifra', async () => {
    const { syncId } = guardar()
    await daemonCon(() => ctx).push()
    expect(enviado.mutations[0].payload.sync_id).toBe(syncId)
    expect(store.pendingMutationCount()).toBe(0)
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run electron/__tests__/memory-daemon-cifrado-push.test.ts`
Expected: FAIL — `getEnvelopeContext` no existe en `MemoryDaemonDeps` (error de tipo) y los campos salen en claro.

- [ ] **Step 3: Sumar la dependencia**

En `electron/memory-daemon.ts`, importar arriba:

```ts
import { sealMutationPayload, openPulledRow, type EnvelopeContext } from './memory-envelope'
```

y en `MemoryDaemonDeps`, debajo de `fetchImpl`:

```ts
  /**
   * Las claves de cifrado de la cuenta, o `null` si el cifrado no esta activado en esta
   * maquina. Opcional para que todo call site y todo test que existia antes del cifrado
   * siga andando sin tocarse: sin esta dep, el daemon empuja y baja en claro, exactamente
   * como hasta hoy.
   *
   * Es una FUNCION y no un valor: el usuario puede activar el cifrado con la app abierta y
   * el daemon tiene que ver la clave nueva sin que nadie lo reinicie.
   */
  getEnvelopeContext?: () => EnvelopeContext | null
```

- [ ] **Step 4: Sellar en `doPush()`**

En `doPush()`, dentro del `.map()` de `pending` (`electron/memory-daemon.ts:~609`), reemplazar el `return { seq, sync_id, op, payload: {...} }` por:

```ts
            // El cifrado va ULTIMO en la cadena, despues de la redaccion de secretos (que
            // corre en `save()`, del lado local) y despues del join del display name: si
            // fuera antes, cifrariamos un texto que la redaccion todavia no limpio, o
            // pisariamos con un nombre en claro un campo ya sellado.
            const enClaro = {
              ...rest,
              tags: normalizeTags(payload.tags) ?? [],
              project_display_name: displayNameByProjectKey.get(projectKey) ?? projectKey,
            }
            return {
              seq: m.seq,
              sync_id: m.sync_id,
              op: m.op,
              payload: sealMutationPayload(this.deps.getEnvelopeContext?.() ?? null, enClaro),
            }
```

> **Ojo, y por eso el test lo fija:** el `sync_id` de la mutación (`m.sync_id`) y el `payload.sync_id` no se tocan. El ack del servidor se resuelve por `sync_id` (`resultBySyncId`, `memory-daemon.ts:~702`); cifrarlo dejaría toda mutación sin acuse y la cola crecería para siempre.

- [ ] **Step 5: Correr el test nuevo y la suite del daemon**

Run: `npx vitest run electron/__tests__/memory-daemon-cifrado-push.test.ts electron/__tests__/memory-daemon.test.ts`
Expected: PASS las dos.

- [ ] **Step 6: Commit**

```bash
git add electron/memory-daemon.ts electron/__tests__/memory-daemon-cifrado-push.test.ts
git commit -m "feat(cifrado): el push sale sellado"
```

---

### Task 8: El pull abre, y lo que no abre se ve

El otro punto de enganche, más la razón nueva del §5.5.4. Una fila que esta máquina no puede descifrar **no se aplica** — guardar ciphertext en la base local llenaría la búsqueda y el grafo de basura ilegible — pero **sí se cuenta**, el cursor avanza igual (frenarlo mataría la sincronización entera) y el doctor la muestra.

**Files:**
- Modify: `electron/memory-daemon.ts` (`applyPulledRow`, `doPull`)
- Modify: `electron/memory-store.ts` (`bumpUndecryptable`, `undecryptableCount`, `clearUndecryptable`, `resetPullCursors`)
- Modify: `electron/memory-doctor.ts` (la razón `undecryptable`)
- Test: `electron/__tests__/memory-daemon-cifrado-pull.test.ts`
- Test: `electron/__tests__/memory-doctor.test.ts` (sumar casos)

**Interfaces:**
- Consumes: `openPulledRow` (Task 6) · `findActiveTopicOwnerByHmac` (Task 5).
- Produces:
  - `MemoryStore.bumpUndecryptable(n: number): void`
  - `MemoryStore.undecryptableCount(): number`
  - `MemoryStore.clearUndecryptable(): void`
  - `MemoryStore.resetPullCursors(): void`
  - `export const UNDECRYPTABLE_REASON = 'undecryptable'` en `memory-doctor.ts`
  - `buildDoctorReport(rows, extra?: { undecryptable?: number })` — el segundo parámetro es opcional, así que ningún call site existente cambia

- [ ] **Step 1: Escribir el test que falla**

Crear `electron/__tests__/memory-daemon-cifrado-pull.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MemoryStore } from '../memory-store'
import { MemoryDaemon, mapRawPulledRow } from '../memory-daemon'
import { deriveKeys, generateMasterKey, hmacTopicKey } from '../memory-crypto'
import { sealMutationPayload, type EnvelopeContext } from '../memory-envelope'

const ctx: EnvelopeContext = { keys: deriveKeys(generateMasterKey()), keyEpoch: 1 }

let dir: string
let store: MemoryStore

const filaCruda = (sellado: Record<string, unknown>, overrides: Record<string, unknown> = {}) => ({
  sync_id: sellado.sync_id, project_key: sellado.project_key, scope: sellado.scope,
  type: sellado.type, topic_key: sellado.topic_key, title: sellado.title,
  content: sellado.content, tags: sellado.tags, content_hash: sellado.content_hash,
  lamport: 5, client_updated_at: new Date(1_700_000_000_000).toISOString(),
  deleted: false, superseded_by: null, project_seq: 10, ...overrides,
})

const sellar = (over: Record<string, unknown> = {}) => sealMutationPayload(ctx, {
  sync_id: 'obs_remoto', project_key: 'proj1', project_display_name: 'raven-nest',
  scope: 'personal', type: 'decision', topic_key: 'deploy',
  title: 'la decision remota', content: 'el cuerpo remoto', tags: ['release'],
  content_hash: 'h1', lamport: 5, updated_at: 1_700_000_000_000, ...over,
})

function daemonCon(getEnvelopeContext: () => EnvelopeContext | null) {
  return new MemoryDaemon({
    store,
    getSyncBaseUrl: () => 'http://sync.test',
    getToken: () => 'nmk_test',
    getDeviceId: () => 'device-1',
    isOnline: () => true,
    fetchImpl: (async () => ({ ok: true, status: 200, json: async () => ({ rows: [], cursors: {} }) })) as unknown as typeof fetch,
    getEnvelopeContext,
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nest-pull-cifrado-'))
  store = new MemoryStore(join(dir, 'memory.db'))
  store.ensureProject({ projectKey: 'proj1', displayName: 'raven-nest' })
})
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

describe('applyPulledRow con cifrado', () => {
  it('descifra y guarda el texto en claro en la base local', () => {
    daemonCon(() => ctx).applyPulledRow(mapRawPulledRow(filaCruda(sellar())))
    const row = store.get('obs_remoto')!
    expect(row.title).toBe('la decision remota')
    expect(row.content).toBe('el cuerpo remoto')
    expect(JSON.parse(row.tags!)).toEqual(['release'])
    expect(row.topic_key_hmac).toBe(hmacTopicKey(ctx.keys, 'proj1', 'personal', 'deploy'))
  })

  // El bug que la Task 5 existe para evitar: sin HMAC local, esto duplicaba el slot.
  it('el supersede por tópico encuentra al dueño local por HMAC', () => {
    store.setTopicHasher((p, s, t) => hmacTopicKey(ctx.keys, p, s, t))
    const local = store.save({
      projectKey: 'proj1', scope: 'personal', type: 'decision', topicKey: 'deploy',
      title: 'la vieja', content: 'x', source: 'test',
    })
    // La remota es mas nueva, asi que gana el slot.
    daemonCon(() => ctx).applyPulledRow(mapRawPulledRow(filaCruda(sellar(), {
      client_updated_at: new Date(Date.now() + 60_000).toISOString(),
    })))
    expect(store.get(local.syncId)!.superseded_by).toBe('obs_remoto')
    expect(store.get('obs_remoto')!.superseded_by).toBeNull()
  })

  it('sin clave, la fila NO se aplica y se cuenta como ilegible', () => {
    daemonCon(() => null).applyPulledRow(mapRawPulledRow(filaCruda(sellar())))
    expect(store.get('obs_remoto')).toBeNull()
    expect(store.undecryptableCount()).toBe(1)
  })

  it('con la clave equivocada tampoco se aplica, y no lanza', () => {
    const otro: EnvelopeContext = { keys: deriveKeys(generateMasterKey()), keyEpoch: 1 }
    expect(() => daemonCon(() => otro).applyPulledRow(mapRawPulledRow(filaCruda(sellar())))).not.toThrow()
    expect(store.get('obs_remoto')).toBeNull()
    expect(store.undecryptableCount()).toBe(1)
  })

  it('una fila en claro anterior a la migración se aplica igual', () => {
    const enClaro = {
      sync_id: 'obs_viejo', project_key: 'proj1', scope: 'personal', type: 'decision',
      topic_key: 'deploy', title: 'texto viejo', content: 'cuerpo viejo', tags: ['x'],
      content_hash: 'h', lamport: 1, updated_at: 1_600_000_000_000,
    }
    daemonCon(() => ctx).applyPulledRow(mapRawPulledRow(filaCruda(enClaro)))
    const row = store.get('obs_viejo')!
    expect(row.title).toBe('texto viejo')
    expect(row.topic_key).toBe('deploy')
    expect(row.topic_key_hmac).toBe(hmacTopicKey(ctx.keys, 'proj1', 'personal', 'deploy'))
    expect(store.undecryptableCount()).toBe(0)
  })

  it('resetPullCursors vuelve a traer lo que quedó afuera', () => {
    store.setSyncState('proj1', { pullCursor: 99 })
    store.bumpUndecryptable(3)
    store.resetPullCursors()
    store.clearUndecryptable()
    expect(store.getSyncState('proj1').pullCursor).toBe(0)
    expect(store.undecryptableCount()).toBe(0)
  })
})
```

Sumar a `electron/__tests__/memory-doctor.test.ts`:

```ts
import { UNDECRYPTABLE_REASON } from '../memory-doctor'

describe('buildDoctorReport — memoria ilegible', () => {
  it('sin filas ilegibles el reporte no cambia', () => {
    expect(buildDoctorReport([], { undecryptable: 0 }).groups).toEqual([])
  })

  it('las filas ilegibles entran como un grupo reversible propio', () => {
    const r = buildDoctorReport([], { undecryptable: 4 })
    expect(r.blockedTotal).toBe(4)
    expect(r.groups).toEqual([
      { reason: UNDECRYPTABLE_REASON, count: 4, oldestAt: 0, reversible: true },
    ])
  })

  it('se ordena junto a los demás por tamaño', () => {
    const rows = [
      { seq: 1, sync_id: 'a', op: 'upsert', payload: '{}', created_at: 10, pushed_at: null, last_error: null, blocked_reason: 'quota_exceeded' },
      { seq: 2, sync_id: 'b', op: 'upsert', payload: '{}', created_at: 20, pushed_at: null, last_error: null, blocked_reason: 'quota_exceeded' },
    ] as never
    const r = buildDoctorReport(rows, { undecryptable: 5 })
    expect(r.groups[0].reason).toBe(UNDECRYPTABLE_REASON)
    expect(r.groups[1].reason).toBe('quota_exceeded')
    expect(r.blockedTotal).toBe(7)
  })
})
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run electron/__tests__/memory-daemon-cifrado-pull.test.ts electron/__tests__/memory-doctor.test.ts`
Expected: FAIL — no existen `undecryptableCount`, `bumpUndecryptable`, `resetPullCursors` ni `UNDECRYPTABLE_REASON`.

- [ ] **Step 3: Los cuatro métodos del store**

En `electron/memory-store.ts`, junto a `getOwnerUserId()`:

```ts
  private metaSet(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value)
  }

  /**
   * Cuenta filas que llegaron cifradas y esta maquina no pudo abrir (spec §5.5.4). Vive en
   * `meta` y no en `mutation_log` porque NO es una mutacion nuestra: es algo que la nube
   * tiene y nosotros no podemos leer. El doctor las junta igual, que es lo que el usuario
   * necesita ver.
   */
  bumpUndecryptable(n: number): void {
    if (n <= 0) return
    this.metaSet('undecryptable_rows', String(this.undecryptableCount() + n))
  }

  undecryptableCount(): number {
    return Number(this.metaGet('undecryptable_rows') ?? 0)
  }

  clearUndecryptable(): void {
    this.metaSet('undecryptable_rows', '0')
  }

  /**
   * Vuelve todos los cursores de pull a 0. Se usa despues de que esta maquina consigue la
   * clave: las filas que se saltearon por ilegibles ya quedaron atras del cursor y sin esto
   * no volverian nunca. El pull es idempotente (upsert por sync_id), asi que re-bajar todo
   * es seguro; el costo es una pasada de red, no datos duplicados.
   */
  resetPullCursors(): void {
    this.db.prepare('UPDATE sync_state SET pull_cursor = 0').run()
  }
```

- [ ] **Step 4: Abrir en `applyPulledRow()`**

Al principio de `applyPulledRow()`, antes del `store.get(...)`:

```ts
    const { row: abierta, undecryptable } = openPulledRow(
      this.deps.getEnvelopeContext?.() ?? null,
      incoming
    )
    if (undecryptable) {
      // NO se aplica: guardar ciphertext en la base local llenaria la busqueda FTS5 y el
      // grafo de basura ilegible. Se cuenta y se sigue — el cursor tiene que avanzar
      // igual, porque frenarlo dejaria a este device sin sincronizar NADA, ni siquiera lo
      // que si puede leer. Cuando la maquina se autorice, `resetPullCursors()` las
      // vuelve a traer.
      this.deps.store.bumpUndecryptable(1)
      return
    }
    incoming = abierta
```

y en el bloque de colisión de tópico, usar el HMAC cuando lo haya:

```ts
    if ((incoming.topicKeyHmac || incoming.topicKey) && !incoming.deleted) {
      const existingTopicOwner = incoming.topicKeyHmac
        ? this.deps.store.findActiveTopicOwnerByHmac(
            incoming.projectKey || GLOBAL_PROJECT_KEY,
            incoming.scope,
            incoming.topicKeyHmac,
            incoming.syncId
          )
        : this.deps.store.findActiveTopicOwner(
            incoming.projectKey || GLOBAL_PROJECT_KEY,
            incoming.scope,
            incoming.topicKey!,
            incoming.syncId
          )
```

y pasar el HMAC a `applyIncomingObservation`, junto a `topicKey`:

```ts
      topicKeyHmac: incoming.topicKeyHmac ?? null,
```

- [ ] **Step 5: La razón nueva en el doctor**

En `electron/memory-doctor.ts`:

```ts
/**
 * Spec §5.5.4. No sale de `mutation_log` como las demas: es memoria que la nube tiene
 * cifrada y esta maquina no puede abrir. Reversible por definicion — se destraba sola en
 * cuanto otra maquina autoriza a esta.
 */
export const UNDECRYPTABLE_REASON = 'undecryptable'

export function buildDoctorReport(
  rows: MutationLogRow[],
  extra?: { undecryptable?: number }
): DoctorReport {
```

y antes del `sort`:

```ts
  const ilegibles = extra?.undecryptable ?? 0
  if (ilegibles > 0) {
    // `oldestAt: 0` a proposito: no sabemos desde cuando estan — solo cuantas. Poner
    // `Date.now()` seria inventar un dato ("recien pasó") que la UI mostraria como cierto.
    byReason.set(UNDECRYPTABLE_REASON, {
      reason: UNDECRYPTABLE_REASON, count: ilegibles, oldestAt: 0, reversible: true,
    })
  }
```

Y en `electron/main.ts`, donde el handler `memory:doctor` llama a `buildDoctorReport(...)`, pasarle el conteo:

```ts
  buildDoctorReport(memory.store.blockedMutations(), {
    undecryptable: memory.store.undecryptableCount(),
  })
```

- [ ] **Step 6: Correr las suites afectadas**

Run: `npx vitest run electron/__tests__/memory-daemon-cifrado-pull.test.ts electron/__tests__/memory-doctor.test.ts electron/__tests__/memory-daemon.test.ts electron/__tests__/memory-store.test.ts`
Expected: PASS las cuatro.

- [ ] **Step 7: Commit**

```bash
git add electron/memory-daemon.ts electron/memory-store.ts electron/memory-doctor.ts electron/main.ts electron/__tests__/memory-daemon-cifrado-pull.test.ts electron/__tests__/memory-doctor.test.ts
git commit -m "feat(cifrado): el pull abre, y lo que no abre se ve en el doctor"
```

---

### Task 9: Activar, autorizar y recuperar

`electron/memory-keys-client.ts`. Las tres operaciones que un usuario hace de verdad, escritas contra un `fetch` inyectado para poder probarlas enteras sin servidor ni Electron. Es la tarea donde el camino B se vuelve un flujo y no un puñado de primitivas.

**Files:**
- Create: `electron/memory-keys-client.ts`
- Test: `electron/__tests__/memory-keys-client.test.ts`

**Interfaces:**
- Consumes: `generateMasterKey` (Task 1) · `wrapForDevice`, `unwrapWithDevice`, `wrapForRecovery`, `unwrapWithRecovery`, `generateRecoveryCode`, `MemoryUnwrapError`, `DeviceKeyPair` (Task 2) · `KeyMaterial` (Task 3) · el contrato de `/v1/keys*` (Task 4).
- Produces:
  - `export interface KeysClientDeps { baseUrl: string; token: string; deviceId: string; fetchImpl?: typeof fetch }`
  - `export interface RemoteKeyState { keyEpoch: number; wrap: { wrapped: string; wrapMeta: Record<string, unknown> | null } | null; devices: Array<{ deviceId: string; name: string; publicKey: string; hasWrap: boolean }> }`
  - `export async function enrollPublicKey(deps: KeysClientDeps, publicKey: string): Promise<void>`
  - `export async function fetchKeyState(deps: KeysClientDeps): Promise<RemoteKeyState>`
  - `export async function activateEncryption(deps, device: DeviceKeyPair): Promise<{ master: string; keyEpoch: number; recoveryCode: string }>`
  - `export async function adoptExistingKey(deps, device: DeviceKeyPair): Promise<{ master: string; keyEpoch: number } | null>`
  - `export async function authorizeDevice(deps, master: string, keyEpoch: number, target: { deviceId: string; publicKey: string }): Promise<void>`
  - `export async function recoverWithCode(deps, device: DeviceKeyPair, code: string): Promise<{ master: string; keyEpoch: number }>`
  - `export class KeysHttpError extends Error { readonly status: number }`

- [ ] **Step 1: Escribir el test que falla**

Crear `electron/__tests__/memory-keys-client.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { generateDeviceKeyPair, unwrapWithDevice, MemoryUnwrapError } from '../memory-key-wrap'
import {
  enrollPublicKey, fetchKeyState, activateEncryption, adoptExistingKey,
  authorizeDevice, recoverWithCode, KeysHttpError, type KeysClientDeps,
} from '../memory-keys-client'

// Servidor de mentira con la MISMA semantica que server/src/keys.ts: una epoca por cuenta,
// un slot por destinatario, y rotar borra las envolturas viejas.
function servidorFalso() {
  const wraps = new Map<string, { wrapped: string; wrapMeta: Record<string, unknown> | null }>()
  const publicas = new Map<string, string>()
  let keyEpoch = 0
  const llamadas: string[] = []

  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname
    llamadas.push(path)
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json } as unknown as Response)

    if (path === '/v1/keys/enroll') {
      publicas.set(body.device_id_test, body.public_key)
      return ok({ ok: true })
    }
    if (path === '/v1/keys') {
      const yo = (init as { headers?: Record<string, string> })?.headers?.['X-Device-Test'] ?? ''
      return ok({
        keyEpoch,
        wrap: wraps.get(yo) ?? null,
        devices: [...publicas].map(([deviceId, publicKey]) => ({
          deviceId, name: deviceId, publicKey, hasWrap: wraps.has(deviceId),
        })),
      })
    }
    if (path === '/v1/keys/publish') {
      if (body.key_epoch < keyEpoch) return { ok: false, status: 409, json: async () => ({ error: 'stale_key_epoch' }) } as unknown as Response
      if (body.key_epoch > keyEpoch) { wraps.clear(); keyEpoch = body.key_epoch }
      for (const w of body.wraps) wraps.set(w.slot, { wrapped: w.wrapped, wrapMeta: w.wrap_meta ?? null })
      return ok({ ok: true, key_epoch: keyEpoch })
    }
    return { ok: false, status: 404, json: async () => ({ error: 'not_found' }) } as unknown as Response
  }) as unknown as typeof fetch

  return { fetchImpl, wraps, publicas, llamadas, get epoch() { return keyEpoch } }
}

let srv: ReturnType<typeof servidorFalso>
const depsDe = (deviceId: string): KeysClientDeps =>
  ({ baseUrl: 'http://sync.test', token: 'nmk_x', deviceId, fetchImpl: srv.fetchImpl })

beforeEach(() => { srv = servidorFalso() })

describe('activar el cifrado', () => {
  it('genera maestra, la envuelve para este device y para el código, y publica época 1', async () => {
    const device = generateDeviceKeyPair()
    srv.publicas.set('mac', device.publicKey)
    const res = await activateEncryption(depsDe('mac'), device)

    expect(res.keyEpoch).toBe(1)
    expect(Buffer.from(res.master, 'base64').length).toBe(32)
    expect(res.recoveryCode).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){5}$/)

    // La envoltura del device abre y da EXACTAMENTE la maestra que devolvio.
    const wrap = srv.wraps.get('mac')!
    expect(unwrapWithDevice(device.privateKey, wrap.wrapped).toString('base64')).toBe(res.master)
    // Y hay una de recuperacion, con su sal.
    expect(srv.wraps.get('recovery')!.wrapMeta).toHaveProperty('salt')
  })

  it('enrola la pública antes de publicar — un device sin pública no se puede autorizar', async () => {
    const device = generateDeviceKeyPair()
    await activateEncryption(depsDe('mac'), device)
    expect(srv.llamadas[0]).toBe('/v1/keys/enroll')
  })

  it('la maestra NUNCA viaja en claro', async () => {
    const device = generateDeviceKeyPair()
    const res = await activateEncryption(depsDe('mac'), device)
    for (const w of srv.wraps.values()) {
      expect(w.wrapped).not.toContain(res.master)
    }
  })
})

describe('adoptar la clave que ya existe', () => {
  it('un device con envoltura la desenvuelve y obtiene la maestra', async () => {
    const mac = generateDeviceKeyPair()
    srv.publicas.set('mac', mac.publicKey)
    const activada = await activateEncryption(depsDe('mac'), mac)
    const adoptada = await adoptExistingKey(depsDe('mac'), mac)
    expect(adoptada).toEqual({ master: activada.master, keyEpoch: 1 })
  })

  it('un device sin envoltura devuelve null — no lanza, está esperando autorización', async () => {
    const mac = generateDeviceKeyPair()
    const pc = generateDeviceKeyPair()
    await activateEncryption(depsDe('mac'), mac)
    expect(await adoptExistingKey(depsDe('pc'), pc)).toBeNull()
    // Y de paso dejo publicada MI publica, para que la Mac me pueda autorizar.
    expect(srv.publicas.get('pc')).toBe(pc.publicKey)
  })

  it('una cuenta sin cifrado devuelve null', async () => {
    const mac = generateDeviceKeyPair()
    expect(await adoptExistingKey(depsDe('mac'), mac)).toBeNull()
  })
})

describe('autorizar una segunda máquina', () => {
  it('la Mac envuelve para la PC y la PC la abre', async () => {
    const mac = generateDeviceKeyPair()
    const pc = generateDeviceKeyPair()
    const { master, keyEpoch } = await activateEncryption(depsDe('mac'), mac)
    await adoptExistingKey(depsDe('pc'), pc) // la PC publica su publica

    await authorizeDevice(depsDe('mac'), master, keyEpoch, { deviceId: 'pc', publicKey: pc.publicKey })

    expect(await adoptExistingKey(depsDe('pc'), pc)).toEqual({ master, keyEpoch })
  })

  it('autorizar no le saca la envoltura a las máquinas que ya la tenían', async () => {
    const mac = generateDeviceKeyPair()
    const pc = generateDeviceKeyPair()
    const { master, keyEpoch } = await activateEncryption(depsDe('mac'), mac)
    await authorizeDevice(depsDe('mac'), master, keyEpoch, { deviceId: 'pc', publicKey: pc.publicKey })
    expect(await adoptExistingKey(depsDe('mac'), mac)).toEqual({ master, keyEpoch })
    // Y no rotó: sigue en la epoca 1.
    expect(srv.epoch).toBe(1)
  })
})

describe('recuperar con el código', () => {
  it('una máquina nueva recupera la maestra y se auto-autoriza', async () => {
    const mac = generateDeviceKeyPair()
    const pc = generateDeviceKeyPair()
    const { master, recoveryCode } = await activateEncryption(depsDe('mac'), mac)

    const rec = await recoverWithCode(depsDe('pc'), pc, recoveryCode)
    expect(rec).toEqual({ master, keyEpoch: 1 })
    // Se dejó su propia envoltura, asi que el proximo arranque no vuelve a pedir el codigo.
    expect(await adoptExistingKey(depsDe('pc'), pc)).toEqual({ master, keyEpoch: 1 })
  })

  it('acepta el código tipeado con minúsculas y sin guiones', async () => {
    const mac = generateDeviceKeyPair()
    const pc = generateDeviceKeyPair()
    const { master, recoveryCode } = await activateEncryption(depsDe('mac'), mac)
    const rec = await recoverWithCode(depsDe('pc'), pc, recoveryCode.toLowerCase().replace(/-/g, ''))
    expect(rec.master).toBe(master)
  })

  it('un código equivocado lanza MemoryUnwrapError y no publica nada', async () => {
    const mac = generateDeviceKeyPair()
    const pc = generateDeviceKeyPair()
    await activateEncryption(depsDe('mac'), mac)
    const antes = srv.wraps.size
    await expect(recoverWithCode(depsDe('pc'), pc, 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF'))
      .rejects.toBeInstanceOf(MemoryUnwrapError)
    expect(srv.wraps.size).toBe(antes)
  })

  it('sin envoltura de recuperación en el servidor, lanza con un mensaje propio', async () => {
    const pc = generateDeviceKeyPair()
    await expect(recoverWithCode(depsDe('pc'), pc, 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF'))
      .rejects.toThrow(/no hay una copia de recuperación/i)
  })
})

describe('errores HTTP', () => {
  it('un 4xx sale como KeysHttpError con su status', async () => {
    const deps: KeysClientDeps = {
      baseUrl: 'http://sync.test', token: 'nmk_x', deviceId: 'mac',
      fetchImpl: (async () => ({ ok: false, status: 403, json: async () => ({ error: 'plan_required' }) })) as unknown as typeof fetch,
    }
    await expect(fetchKeyState(deps)).rejects.toMatchObject({ name: 'KeysHttpError', status: 403 })
  })

  it('enrollPublicKey propaga el error en vez de tragárselo', async () => {
    const deps: KeysClientDeps = {
      baseUrl: 'http://sync.test', token: 'nmk_x', deviceId: 'mac',
      fetchImpl: (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch,
    }
    await expect(enrollPublicKey(deps, 'PUB')).rejects.toBeInstanceOf(KeysHttpError)
  })
})
```

> El servidor falso usa `body.device_id_test` y el header `X-Device-Test` para saber quién llama, porque en el servidor real eso sale del token. Es una comodidad del test: el módulo tiene que mandar `deps.deviceId` en los dos lugares para que el falso funcione, y eso es exactamente lo que se quiere fijar.

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run electron/__tests__/memory-keys-client.test.ts`
Expected: FAIL — `Failed to resolve import "../memory-keys-client"`.

- [ ] **Step 3: Escribir el módulo**

Crear `electron/memory-keys-client.ts`:

```ts
// Las tres cosas que un usuario hace con el cifrado, contra `/v1/keys*` (Task 4):
//   activar (esta cuenta todavia no tiene clave), adoptar (esta maquina ya fue autorizada)
//   y recuperar (no queda ninguna maquina viva).
// Mas la cuarta que hace desde la app: autorizar a otra maquina.
//
// `fetch` entra inyectado: todo el flujo se prueba de punta a punta contra un servidor de
// mentira, sin red, sin Postgres y sin Electron.
import { generateMasterKey } from './memory-crypto'
import {
  wrapForDevice, unwrapWithDevice, wrapForRecovery, unwrapWithRecovery,
  generateRecoveryCode, MemoryUnwrapError, type DeviceKeyPair,
} from './memory-key-wrap'

export interface KeysClientDeps {
  baseUrl: string
  token: string
  deviceId: string
  fetchImpl?: typeof fetch
}

export interface RemoteKeyState {
  keyEpoch: number
  wrap: { wrapped: string; wrapMeta: Record<string, unknown> | null } | null
  devices: Array<{ deviceId: string; name: string; publicKey: string; hasWrap: boolean }>
}

export class KeysHttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'KeysHttpError'
    this.status = status
  }
}

async function pedir(
  deps: KeysClientDeps,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown }
): Promise<unknown> {
  const f = deps.fetchImpl ?? fetch
  const response = await f(`${deps.baseUrl}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${deps.token}`,
      'Content-Type': 'application/json',
      // Solo lo lee el servidor falso de los tests; el real saca el device del token.
      'X-Device-Test': deps.deviceId,
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new KeysHttpError(response.status, String((json as { error?: string }).error ?? response.status))
  }
  return json
}

export async function enrollPublicKey(deps: KeysClientDeps, publicKey: string): Promise<void> {
  await pedir(deps, '/v1/keys/enroll', {
    method: 'POST',
    body: { public_key: publicKey, device_id_test: deps.deviceId },
  })
}

export async function fetchKeyState(deps: KeysClientDeps): Promise<RemoteKeyState> {
  const json = (await pedir(deps, '/v1/keys', { method: 'GET' })) as Partial<RemoteKeyState>
  return {
    keyEpoch: Number(json.keyEpoch ?? 0),
    wrap: json.wrap ?? null,
    devices: Array.isArray(json.devices) ? json.devices : [],
  }
}

/**
 * Enciende el cifrado para la cuenta. La maestra se genera ACÁ y no sale de acá sin
 * envolver: lo que se publica son dos sobres, uno para esta maquina y otro para el codigo
 * de recuperacion.
 *
 * El codigo se devuelve al llamador para que lo MUESTRE una vez. No se guarda en ningun
 * lado — guardarlo lo convertiria en el camino C de la spec, que es justo el que se
 * descarto por escrito.
 */
export async function activateEncryption(
  deps: KeysClientDeps,
  device: DeviceKeyPair
): Promise<{ master: string; keyEpoch: number; recoveryCode: string }> {
  // Primero la publica: si publicaramos las envolturas antes, una falla en el medio dejaria
  // una cuenta con cifrado activo y un device sin clave publica, o sea imposible de
  // autorizar desde otro lado.
  await enrollPublicKey(deps, device.publicKey)

  const estado = await fetchKeyState(deps)
  const master = generateMasterKey()
  const recoveryCode = generateRecoveryCode()
  const recovery = wrapForRecovery(recoveryCode, master)
  const keyEpoch = estado.keyEpoch + 1

  await pedir(deps, '/v1/keys/publish', {
    method: 'POST',
    body: {
      key_epoch: keyEpoch,
      wraps: [
        { slot: deps.deviceId, kind: 'device', wrapped: wrapForDevice(device.publicKey, master) },
        { slot: 'recovery', kind: 'recovery', wrapped: recovery.wrapped, wrap_meta: { salt: recovery.salt } },
      ],
    },
  })

  return { master: master.toString('base64'), keyEpoch, recoveryCode }
}

/**
 * "Esta maquina, ¿ya tiene la clave de la cuenta?". `null` es una respuesta legitima y
 * frecuente — la cuenta no cifra todavia, o esta maquina espera que otra la autorice — asi
 * que no lanza. De paso deja publicada la propia clave publica, que es la precondicion
 * para que la otra maquina pueda autorizarla.
 */
export async function adoptExistingKey(
  deps: KeysClientDeps,
  device: DeviceKeyPair
): Promise<{ master: string; keyEpoch: number } | null> {
  await enrollPublicKey(deps, device.publicKey)
  const estado = await fetchKeyState(deps)
  if (estado.keyEpoch === 0 || !estado.wrap) return null
  return {
    master: unwrapWithDevice(device.privateKey, estado.wrap.wrapped).toString('base64'),
    keyEpoch: estado.keyEpoch,
  }
}

/**
 * Autoriza a otra maquina: envuelve la maestra que YA tenemos con la publica de ella. La
 * epoca no cambia — autorizar no es rotar — asi que las envolturas que ya existen quedan
 * donde estan (el servidor solo borra al SUBIR de epoca).
 */
export async function authorizeDevice(
  deps: KeysClientDeps,
  master: string,
  keyEpoch: number,
  target: { deviceId: string; publicKey: string }
): Promise<void> {
  await pedir(deps, '/v1/keys/publish', {
    method: 'POST',
    body: {
      key_epoch: keyEpoch,
      wraps: [{
        slot: target.deviceId, kind: 'device',
        wrapped: wrapForDevice(target.publicKey, Buffer.from(master, 'base64')),
      }],
    },
  })
}

/**
 * El camino sin ninguna maquina viva (D8). Abre la copia de recuperacion con el codigo y
 * despues se auto-autoriza, para que el proximo arranque no vuelva a pedirlo.
 */
export async function recoverWithCode(
  deps: KeysClientDeps,
  device: DeviceKeyPair,
  code: string
): Promise<{ master: string; keyEpoch: number }> {
  await enrollPublicKey(deps, device.publicKey)
  const estado = await fetchKeyState(deps)
  const wrap = estado.keyEpoch > 0 ? await copiaDeRecuperacion(deps) : null
  if (!wrap) {
    throw new Error('No hay una copia de recuperación para esta cuenta.')
  }
  // Lanza MemoryUnwrapError con el codigo equivocado, ANTES de publicar nada.
  const master = unwrapWithRecovery(code, wrap)
  await authorizeDevice(deps, master.toString('base64'), estado.keyEpoch, {
    deviceId: deps.deviceId, publicKey: device.publicKey,
  })
  return { master: master.toString('base64'), keyEpoch: estado.keyEpoch }
}

/**
 * La envoltura de recuperacion no viene en `GET /v1/keys` (ese endpoint devuelve la del
 * device que llama), asi que se pide por el mismo camino con el slot explicito.
 */
async function copiaDeRecuperacion(
  deps: KeysClientDeps
): Promise<{ wrapped: string; salt: string } | null> {
  const json = (await pedir(deps, '/v1/keys?slot=recovery', { method: 'GET' })) as {
    wrap?: { wrapped?: string; wrapMeta?: { salt?: string } | null } | null
  }
  const wrapped = json.wrap?.wrapped
  const salt = json.wrap?.wrapMeta?.salt
  if (typeof wrapped !== 'string' || typeof salt !== 'string') return null
  return { wrapped, salt }
}
```

> **Cambio que esto obliga en la Task 4:** `getKeyState` tiene que aceptar un `slot` opcional. En `server/src/http.ts`, la rama `isKeysGet` pasa `url.searchParams.get('slot')` a `getKeyState(pool, auth, slot)`, y en `server/src/keys.ts` el query de `wrapRows` usa `slot ?? auth.deviceId`. Es una línea en cada lado; si la Task 4 ya se cerró, va como fix acá y con su propio test (`'devuelve la envoltura de recuperación cuando se pide por slot'`).

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run electron/__tests__/memory-keys-client.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Cerrar el `slot` del lado del servidor**

Aplicar el cambio de la nota de arriba y correr `cd server && npx vitest run`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/memory-keys-client.ts electron/__tests__/memory-keys-client.test.ts server/src/keys.ts server/src/http.ts server/__tests__/keys.test.ts
git commit -m "feat(cifrado): activar, adoptar, autorizar y recuperar"
```

---

### Task 10: Re-encriptar lo que ya está en la nube

Spec §5.5.3. Hoy hay **una** cuenta con memoria en la nube y ~866 observaciones: re-encriptarlas es re-encolarlas para push y dejar que el camino normal (ya cifrado por la Task 7) las suba de nuevo. No hace falta un endpoint de migración ni tocar el servidor: el upsert por `sync_id` pisa la fila en claro con la cifrada.

**Files:**
- Create: `electron/memory-reencrypt.ts`
- Modify: `electron/memory-store.ts` (`requeueAllForPush`)
- Test: `electron/__tests__/memory-reencrypt.test.ts`

**Interfaces:**
- Consumes: `MemoryStore` · `MemoryDaemon.push()`.
- Produces:
  - `MemoryStore.requeueAllForPush(): number`
  - `export interface ReencryptProgress { total: number; queued: number }`
  - `export function planReencrypt(store: MemoryStore): ReencryptProgress`
  - `export async function runReencrypt(store: MemoryStore, daemon: { push(): Promise<void> }, onProgress?: (p: ReencryptProgress) => void): Promise<ReencryptProgress>`

- [ ] **Step 1: Escribir el test que falla**

Crear `electron/__tests__/memory-reencrypt.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MemoryStore } from '../memory-store'
import { planReencrypt, runReencrypt } from '../memory-reencrypt'

let dir: string
let store: MemoryStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nest-reencrypt-'))
  store = new MemoryStore(join(dir, 'memory.db'))
  store.ensureProject({ projectKey: 'proj1', displayName: 'raven-nest' })
})
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

const guardar = (n: number) => {
  for (let i = 0; i < n; i++) {
    store.save({
      projectKey: 'proj1', scope: 'personal', type: 'decision', topicKey: null,
      title: `t${i}`, content: `c${i}`, source: 'test',
    })
  }
}

describe('re-encriptar lo ya subido', () => {
  it('encola una mutación por observación viva', () => {
    guardar(3)
    // Vaciar la cola: simula "ya estaba todo pusheado en claro".
    store.markPushed(store.pendingMutations(100).map((m) => m.seq))
    expect(store.pendingMutationCount()).toBe(0)

    expect(store.requeueAllForPush()).toBe(3)
    expect(store.pendingMutationCount()).toBe(3)
  })

  it('no re-encola tombstones ni filas superseded', () => {
    const a = store.save({ projectKey: 'proj1', scope: 'personal', type: 'decision', topicKey: null, title: 'a', content: 'x', source: 'test' })
    guardar(1)
    store.deleteObservation(a.syncId)
    store.markPushed(store.pendingMutations(100).map((m) => m.seq))
    // Solo queda una viva.
    expect(store.requeueAllForPush()).toBe(1)
  })

  // El payload es un snapshot de la fila. Si le subieramos el lamport, esta mutacion le
  // ganaria por LWW a una edicion mas nueva hecha en OTRA maquina: la migracion pisaria
  // datos buenos. Re-subir el mismo snapshot es un upsert idempotente por sync_id.
  it('el payload re-encolado conserva lamport y updated_at originales', () => {
    const { syncId } = store.save({ projectKey: 'proj1', scope: 'personal', type: 'decision', topicKey: null, title: 'a', content: 'x', source: 'test' })
    const original = store.get(syncId)!
    store.markPushed(store.pendingMutations(100).map((m) => m.seq))

    store.requeueAllForPush()
    const payload = JSON.parse(store.pendingMutations(10)[0].payload)
    expect(payload.lamport).toBe(original.lamport)
    expect(payload.updated_at).toBe(original.updated_at)
    expect(payload.sync_id).toBe(syncId)
  })

  it('planReencrypt informa cuánto hay antes de tocar nada', () => {
    guardar(5)
    store.markPushed(store.pendingMutations(100).map((m) => m.seq))
    expect(planReencrypt(store)).toEqual({ total: 5, queued: 0 })
  })

  it('runReencrypt encola y empuja hasta vaciar la cola', async () => {
    guardar(5)
    store.markPushed(store.pendingMutations(100).map((m) => m.seq))

    // Un push que "acepta" 2 por vuelta, para ejercitar el bucle de verdad.
    const push = vi.fn(async () => {
      store.markPushed(store.pendingMutations(2).map((m) => m.seq))
    })
    const res = await runReencrypt(store, { push })
    expect(res).toEqual({ total: 5, queued: 0 })
    expect(store.pendingMutationCount()).toBe(0)
    expect(push.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('runReencrypt reporta progreso', async () => {
    guardar(4)
    store.markPushed(store.pendingMutations(100).map((m) => m.seq))
    const vistos: number[] = []
    await runReencrypt(store, {
      push: async () => { store.markPushed(store.pendingMutations(2).map((m) => m.seq)) },
    }, (p) => vistos.push(p.queued))
    expect(vistos[0]).toBeGreaterThan(0)
    expect(vistos[vistos.length - 1]).toBe(0)
  })

  // Si el push no avanza (sin red, cuota llena, todo bloqueado), la funcion tiene que
  // CORTAR y devolver lo que queda, no girar para siempre.
  it('corta si el push deja de avanzar, y devuelve lo pendiente', async () => {
    guardar(3)
    store.markPushed(store.pendingMutations(100).map((m) => m.seq))
    const res = await runReencrypt(store, { push: async () => { /* no avanza */ } })
    expect(res.queued).toBe(3)
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run electron/__tests__/memory-reencrypt.test.ts`
Expected: FAIL — no existe `requeueAllForPush` ni el módulo.

- [ ] **Step 3: `requeueAllForPush()` en el store**

En `electron/memory-store.ts`, junto a `compactMutationLog()`:

```ts
  /**
   * Vuelve a encolar TODA observacion viva como un upsert, para que el push la re-suba.
   * Es el mecanismo de la migracion del §5.5.3: lo que ya esta en la nube en claro se
   * pisa, por `sync_id`, con la version cifrada.
   *
   * Excepcion consciente a la regla de la Task 13 del plan de la fase 1 ("un re-import sin
   * cambios no re-loguea mutaciones"): aca el contenido no cambió, cambió el FORMATO en que
   * viaja, y esa es justamente la razon para re-loguear. Se llama una vez, a mano, desde la
   * activacion — nunca en un bucle automatico.
   *
   * Sin tombstones ni superseded: una fila borrada ya no tiene contenido que proteger, y
   * una superseded no la devuelve ninguna lectura.
   */
  requeueAllForPush(): number {
    const rows = this.db
      .prepare(
        `SELECT * FROM observations
          WHERE deleted = 0 AND superseded_by IS NULL
            AND (author_user_id IS NULL OR author_user_id = ?)
          ORDER BY updated_at`
      )
      .all(this.currentUserId ?? null) as ObservationRow[]
    this.db.transaction(() => {
      for (const row of rows) this.appendMutation('upsert', row)
    })()
    return rows.length
  }
```

- [ ] **Step 4: Escribir el módulo**

Crear `electron/memory-reencrypt.ts`:

```ts
// Spec §5.5.3: lo que ya esta en la nube en claro hay que subirlo de nuevo cifrado.
//
// No hay endpoint de migracion ni script de servidor y no hacen falta: el push ya cifra
// (Task 7) y el upsert del servidor es por `sync_id`, asi que re-encolar todo y dejar que
// el daemon haga su trabajo ES la migracion. Con una sola cuenta y ~866 observaciones son
// cinco lotes de 200.
import type { MemoryStore } from './memory-store'

export interface ReencryptProgress {
  /** Observaciones vivas que hay que re-subir. */
  total: number
  /** Cuantas siguen esperando en la cola de push. */
  queued: number
}

export function planReencrypt(store: MemoryStore): ReencryptProgress {
  return { total: store.count(), queued: store.pendingMutationCount() }
}

/**
 * Encola todo y empuja hasta que la cola se vacia.
 *
 * El corte por falta de progreso no es una optimizacion, es lo unico que separa esto de un
 * bucle infinito: sin red, con la cuota llena o con todo bloqueado, `push()` vuelve sin
 * haber movido nada y girar de nuevo daria exactamente el mismo resultado. Se corta y se
 * devuelve lo que queda; el daemon lo va a seguir intentando por su cuenta en cada ciclo
 * normal, que es donde ese reintento corresponde.
 */
export async function runReencrypt(
  store: MemoryStore,
  daemon: { push(): Promise<void> },
  onProgress?: (p: ReencryptProgress) => void
): Promise<ReencryptProgress> {
  const total = store.requeueAllForPush()
  let queued = store.pendingMutationCount()
  onProgress?.({ total, queued })

  while (queued > 0) {
    const antes = queued
    await daemon.push()
    queued = store.pendingMutationCount()
    onProgress?.({ total, queued })
    if (queued >= antes) break
  }

  return { total, queued }
}
```

- [ ] **Step 5: Correr el test para verificar que pasa**

Run: `npx vitest run electron/__tests__/memory-reencrypt.test.ts electron/__tests__/memory-store.test.ts`
Expected: PASS las dos.

- [ ] **Step 6: Commit**

```bash
git add electron/memory-reencrypt.ts electron/memory-store.ts electron/__tests__/memory-reencrypt.test.ts
git commit -m "feat(cifrado): re-subir cifrado lo que ya estaba en claro"
```

---

### Task 11: Cablear el cifrado en el proceso main

Hasta acá nada está enchufado: el daemon acepta un `getEnvelopeContext` que nadie le pasa. Esta tarea junta las piezas en `main.ts` y las expone al renderer.

**Files:**
- Modify: `electron/main.ts` (estado de claves, el dep del daemon, cinco handlers IPC)
- Modify: `electron/preload.ts` (exponerlos en `window.memory`)
- Modify: `src/types.ts` (tiparlos como opcionales)
- Test: `electron/__tests__/memory-encryption-wiring.test.ts`

**Interfaces:**
- Consumes: todo lo de las Tasks 1–10.
- Produces, en `window.memory` (todos opcionales, mismo contrato defensivo que el resto de `useMemories`):
  - `encryptionStatus(): Promise<{ available: boolean; active: boolean; keyEpoch: number; pendingDevices: Array<{ deviceId: string; name: string }>; undecryptable: number }>`
  - `encryptionActivate(): Promise<{ ok: true; recoveryCode: string } | { ok: false; error: string }>`
  - `encryptionAuthorize(deviceId: string): Promise<{ ok: boolean; error?: string }>`
  - `encryptionRecover(code: string): Promise<{ ok: boolean; error?: string }>`
  - `encryptionReencrypt(): Promise<{ total: number; queued: number }>`

- [ ] **Step 1: Escribir el test que falla**

Crear `electron/__tests__/memory-encryption-wiring.test.ts`. El main de Electron no se puede importar en un test, así que lo que se prueba es la **función de estado**, extraída a un módulo propio para poder hacerlo:

```ts
import { describe, it, expect } from 'vitest'
import { buildEncryptionStatus } from '../memory-encryption-status'

const base = {
  safeStorageAvailable: true,
  connected: true,
  keyEpoch: 1,
  hasMaster: true,
  devices: [
    { deviceId: 'mac', name: 'mac', publicKey: 'P1', hasWrap: true },
    { deviceId: 'pc', name: 'pc', publicKey: 'P2', hasWrap: false },
  ],
  undecryptable: 0,
}

describe('buildEncryptionStatus', () => {
  it('sin safeStorage el cifrado no está disponible', () => {
    const s = buildEncryptionStatus({ ...base, safeStorageAvailable: false })
    expect(s.available).toBe(false)
    expect(s.active).toBe(false)
  })

  it('sin cuenta conectada tampoco: no hay nube que cifrar', () => {
    expect(buildEncryptionStatus({ ...base, connected: false }).available).toBe(false)
  })

  it('época 0 es disponible pero no activo', () => {
    const s = buildEncryptionStatus({ ...base, keyEpoch: 0, hasMaster: false })
    expect(s.available).toBe(true)
    expect(s.active).toBe(false)
  })

  // El caso que la UI tiene que poder distinguir: la cuenta cifra, pero ESTA maquina no
  // tiene la clave. No es "activo", es "esperando autorizacion".
  it('con época pero sin maestra local, activo es false', () => {
    const s = buildEncryptionStatus({ ...base, hasMaster: false })
    expect(s.available).toBe(true)
    expect(s.active).toBe(false)
  })

  it('lista solo las máquinas que esperan autorización', () => {
    expect(buildEncryptionStatus(base).pendingDevices).toEqual([{ deviceId: 'pc', name: 'pc' }])
  })

  it('pasa el conteo de ilegibles tal cual', () => {
    expect(buildEncryptionStatus({ ...base, undecryptable: 7 }).undecryptable).toBe(7)
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run electron/__tests__/memory-encryption-wiring.test.ts`
Expected: FAIL — no existe `../memory-encryption-status`.

- [ ] **Step 3: Escribir el módulo de estado**

Crear `electron/memory-encryption-status.ts`:

```ts
// La logica de "en que estado esta el cifrado" separada de main.ts, que no se puede
// importar en un test. Pura: entra lo que main.ts sabe, sale lo que la UI muestra.

export interface EncryptionStatusInput {
  safeStorageAvailable: boolean
  connected: boolean
  keyEpoch: number
  hasMaster: boolean
  devices: Array<{ deviceId: string; name: string; publicKey: string; hasWrap: boolean }>
  undecryptable: number
}

export interface EncryptionStatus {
  /** Se puede activar en esta maquina. */
  available: boolean
  /** Esta activo Y esta maquina puede leer. */
  active: boolean
  keyEpoch: number
  /** Maquinas de la cuenta que publicaron su clave publica y esperan una envoltura. */
  pendingDevices: Array<{ deviceId: string; name: string }>
  undecryptable: number
}

export function buildEncryptionStatus(input: EncryptionStatusInput): EncryptionStatus {
  // Sin safeStorage no se guarda una maestra en disco (§6.2), y sin cuenta conectada no hay
  // nube que proteger: en los dos casos la tarjeta se muestra deshabilitada con su motivo,
  // no escondida — esconderla haria parecer que el cifrado no existe.
  const available = input.safeStorageAvailable && input.connected
  return {
    available,
    active: available && input.keyEpoch > 0 && input.hasMaster,
    keyEpoch: input.keyEpoch,
    pendingDevices: input.devices.filter((d) => !d.hasWrap).map((d) => ({ deviceId: d.deviceId, name: d.name })),
    undecryptable: input.undecryptable,
  }
}
```

- [ ] **Step 4: El estado de claves en `main.ts`**

Junto a `let memoryToken` (~línea 248):

```ts
import { ensureKeyMaterial, saveKeyMaterial, type KeyMaterial } from './memory-key-store'
import { deriveKeys, hmacTopicKey } from './memory-crypto'
import type { EnvelopeContext } from './memory-envelope'
import {
  fetchKeyState, activateEncryption, adoptExistingKey, authorizeDevice, recoverWithCode,
  type RemoteKeyState,
} from './memory-keys-client'
import { buildEncryptionStatus } from './memory-encryption-status'
import { runReencrypt } from './memory-reencrypt'

let memoryKeys: KeyMaterial | null = null

/**
 * El contexto que el daemon pide en CADA push y en CADA pull. Se recalcula por llamada a
 * proposito: el usuario puede activar el cifrado con la app abierta, y una constante
 * capturada al arranque lo dejaria empujando en claro hasta el proximo reinicio.
 */
function currentEnvelopeContext(): EnvelopeContext | null {
  if (!memoryKeys?.master) return null
  return { keys: deriveKeys(Buffer.from(memoryKeys.master, 'base64')), keyEpoch: memoryKeys.keyEpoch }
}

/** Deja el store escribiendo `topic_key_hmac` con la clave vigente (Task 5). */
function applyTopicHasher(): void {
  const ctx = currentEnvelopeContext()
  memory?.store.setTopicHasher(
    ctx ? (p, s, t) => hmacTopicKey(ctx.keys, p, s, t) : null
  )
}
```

En la construcción del `MemoryDaemon` (donde ya se pasan `getToken`, `getDeviceId`, etc.), sumar:

```ts
    getEnvelopeContext: currentEnvelopeContext,
```

Y donde arranca el subsistema de memoria, después de resolver el `userId` del store:

```ts
  // El par de esta maquina se genera al primer arranque y no rota. La maestra puede no
  // estar todavia (cifrado no activado, o esta maquina sin autorizar): eso es normal.
  try {
    memoryKeys = ensureKeyMaterial(ravenHome(), memory.store.getOwnerUserId(), safeStorage)
    applyTopicHasher()
  } catch {
    // Sin safeStorage no hay claves y el cifrado no se puede activar — pero la memoria
    // local y el sync en claro tienen que seguir funcionando igual.
    memoryKeys = null
  }
```

- [ ] **Step 5: Los cinco handlers IPC**

En `electron/main.ts`, junto a los demás `memory:*`:

```ts
function keysDeps() {
  const url = getMemorySyncBaseUrl()
  const token = loadMemoryToken()
  const deviceId = memoryConnectionState.deviceId
  if (!url || !token || !deviceId) return null
  return { baseUrl: url, token, deviceId }
}

ipcMain.handle('memory:encryption:status', async () => {
  const deps = keysDeps()
  let keyEpoch = 0
  let devices: RemoteKeyState['devices'] = []
  if (deps) {
    // Best-effort: sin red, la tarjeta muestra lo que sabe local en vez de un error.
    try {
      const estado = await fetchKeyState(deps)
      keyEpoch = estado.keyEpoch
      devices = estado.devices
    } catch { /* offline */ }
  }
  return buildEncryptionStatus({
    safeStorageAvailable: safeStorage.isEncryptionAvailable(),
    connected: Boolean(deps),
    keyEpoch: keyEpoch || (memoryKeys?.keyEpoch ?? 0),
    hasMaster: Boolean(memoryKeys?.master),
    devices,
    undecryptable: memory?.store.undecryptableCount() ?? 0,
  })
})

ipcMain.handle('memory:encryption:activate', async () => {
  const deps = keysDeps()
  if (!deps || !memory) return { ok: false, error: 'La memoria en la nube no está conectada.' }
  if (!memoryKeys) return { ok: false, error: 'Este sistema no permite guardar claves de forma segura.' }
  try {
    // Si otra maquina ya activo, esto NO es una activacion: es adoptar la clave que existe.
    // Activar de nuevo rotaria la epoca y dejaria ilegible todo lo que ya subio la otra.
    const yaExiste = await adoptExistingKey(deps, memoryKeys.device)
    if (yaExiste) {
      memoryKeys = { ...memoryKeys, ...yaExiste }
      saveKeyMaterial(ravenHome(), memory.store.getOwnerUserId(), safeStorage, memoryKeys)
      applyTopicHasher()
      memory.store.backfillTopicHmacs()
      memory.store.resetPullCursors()
      memory.store.clearUndecryptable()
      return { ok: false, error: 'Esta cuenta ya tiene el cifrado activado — esta máquina quedó autorizada.' }
    }
    const res = await activateEncryption(deps, memoryKeys.device)
    memoryKeys = { ...memoryKeys, master: res.master, keyEpoch: res.keyEpoch }
    saveKeyMaterial(ravenHome(), memory.store.getOwnerUserId(), safeStorage, memoryKeys)
    applyTopicHasher()
    memory.store.backfillTopicHmacs()
    return { ok: true, recoveryCode: res.recoveryCode }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('memory:encryption:authorize', async (_e, deviceId: string) => {
  const deps = keysDeps()
  if (!deps || !memoryKeys?.master) return { ok: false, error: 'Esta máquina no tiene la clave.' }
  try {
    const estado = await fetchKeyState(deps)
    const target = estado.devices.find((d) => d.deviceId === deviceId)
    if (!target) return { ok: false, error: 'Esa máquina no publicó su clave todavía.' }
    await authorizeDevice(deps, memoryKeys.master, memoryKeys.keyEpoch, target)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('memory:encryption:recover', async (_e, code: string) => {
  const deps = keysDeps()
  if (!deps || !memory || !memoryKeys) return { ok: false, error: 'La memoria en la nube no está conectada.' }
  try {
    const res = await recoverWithCode(deps, memoryKeys.device, code)
    memoryKeys = { ...memoryKeys, ...res }
    saveKeyMaterial(ravenHome(), memory.store.getOwnerUserId(), safeStorage, memoryKeys)
    applyTopicHasher()
    memory.store.backfillTopicHmacs()
    // Lo que se salteo por ilegible quedo atras del cursor: hay que volver a traerlo.
    memory.store.resetPullCursors()
    memory.store.clearUndecryptable()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('memory:encryption:reencrypt', async () => {
  if (!memory) return { total: 0, queued: 0 }
  return runReencrypt(memory.store, memory.daemon)
})
```

- [ ] **Step 6: Preload y tipos**

En `electron/preload.ts`, adentro de `exposeInMainWorld('memory', {...})`:

```ts
  // Cifrado del lado del cliente (spec §5.3). Opcionales en `window.memory` como todo lo
  // que sumo la fase 1: un preload viejo no los expone y la UI tiene que montar igual.
  encryptionStatus: () => ipcRenderer.invoke('memory:encryption:status'),
  encryptionActivate: () => ipcRenderer.invoke('memory:encryption:activate'),
  encryptionAuthorize: (deviceId: string) => ipcRenderer.invoke('memory:encryption:authorize', deviceId),
  encryptionRecover: (code: string) => ipcRenderer.invoke('memory:encryption:recover', code),
  encryptionReencrypt: () => ipcRenderer.invoke('memory:encryption:reencrypt'),
```

En `src/types.ts`, en la interfaz de `window.memory`, con `?` en todos:

```ts
  encryptionStatus?: () => Promise<{
    available: boolean
    active: boolean
    keyEpoch: number
    pendingDevices: Array<{ deviceId: string; name: string }>
    undecryptable: number
  }>
  encryptionActivate?: () => Promise<{ ok: true; recoveryCode: string } | { ok: false; error: string }>
  encryptionAuthorize?: (deviceId: string) => Promise<{ ok: boolean; error?: string }>
  encryptionRecover?: (code: string) => Promise<{ ok: boolean; error?: string }>
  encryptionReencrypt?: () => Promise<{ total: number; queued: number }>
```

- [ ] **Step 7: Typecheck y suite completa**

```bash
npx tsc -b
git add -A electron src   # ANTES del clean: `git clean` no distingue un .ts nuevo de un .js emitido
git clean -fd
npm test
```

Expected: `tsc -b` sin errores nuevos (hay ~15 preexistentes en `pidusage`, `metrics-collector`, etc. — ver CLAUDE.md). `npm test` verde.

- [ ] **Step 8: Commit**

```bash
git add electron/memory-encryption-status.ts electron/main.ts electron/preload.ts src/types.ts electron/__tests__/memory-encryption-wiring.test.ts
git commit -m "feat(cifrado): cablear las claves en main y exponerlas al renderer"
```

---

### Task 12: La tarjeta de cifrado

`src/components/MemoryEncryptionCard.tsx`, en el overlay Memories junto a `MemoryVaultCard`. Cuatro estados y ninguno decorativo: se puede activar, está activo, esta máquina espera autorización, y esta máquina puede autorizar a otra. Self-contained como `MemoryVaultCard` y por el mismo motivo — el cifrado no tiene estado en vivo que el daemon empuje.

**Files:**
- Create: `src/components/MemoryEncryptionCard.tsx`
- Modify: `src/components/MemoriesWorkspace.tsx` (montarla)
- Modify: `src/styles/global.css` (`.memory-encryption-*`)
- Test: `src/__tests__/components/MemoryEncryptionCard.test.tsx`

**Interfaces:**
- Consumes: `window.memory.encryption*` (Task 11).
- Produces: el componente por default export, sin props.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/__tests__/components/MemoryEncryptionCard.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import MemoryEncryptionCard from '../../components/MemoryEncryptionCard'

const estadoBase = {
  available: true, active: false, keyEpoch: 0, pendingDevices: [], undecryptable: 0,
}

function montarCon(estado: Partial<typeof estadoBase>, extra: Record<string, unknown> = {}) {
  const api = {
    encryptionStatus: vi.fn(async () => ({ ...estadoBase, ...estado })),
    encryptionActivate: vi.fn(async () => ({ ok: true, recoveryCode: 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF' })),
    encryptionAuthorize: vi.fn(async () => ({ ok: true })),
    encryptionRecover: vi.fn(async () => ({ ok: true })),
    encryptionReencrypt: vi.fn(async () => ({ total: 866, queued: 0 })),
    ...extra,
  }
  ;(window as unknown as { memory: unknown }).memory = api
  return api
}

beforeEach(() => { (window as unknown as { memory?: unknown }).memory = undefined })

describe('MemoryEncryptionCard', () => {
  it('con un preload viejo no monta nada, en vez de romper', () => {
    ;(window as unknown as { memory: unknown }).memory = {}
    const { container } = render(<MemoryEncryptionCard />)
    expect(container).toBeEmptyDOMElement()
  })

  it('sin disponibilidad muestra el motivo y no ofrece activar', async () => {
    montarCon({ available: false })
    render(<MemoryEncryptionCard />)
    expect(await screen.findByText(/conectá la memoria en la nube/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /activar/i })).toBeNull()
  })

  it('sin activar ofrece activarlo y dice qué queda en claro', async () => {
    montarCon({})
    render(<MemoryEncryptionCard />)
    expect(await screen.findByRole('button', { name: /activar el cifrado/i })).toBeInTheDocument()
    // La promesa honesta del §5.2, en la tarjeta y no solo en la landing.
    expect(screen.getByText(/tipo, el scope y la rama/i)).toBeInTheDocument()
  })

  // El momento de la verdad: el codigo se muestra UNA vez y hay que obligar a copiarlo.
  it('al activar muestra el código de recuperación y no deja seguir sin confirmar', async () => {
    const api = montarCon({})
    render(<MemoryEncryptionCard />)
    fireEvent.click(await screen.findByRole('button', { name: /activar el cifrado/i }))
    await waitFor(() => expect(api.encryptionActivate).toHaveBeenCalled())
    expect(await screen.findByText('AAAA-BBBB-CCCC-DDDD-EEEE-FFFF')).toBeInTheDocument()
    expect(screen.getByText(/no lo vas a volver a ver/i)).toBeInTheDocument()
    const seguir = screen.getByRole('button', { name: /ya lo guardé/i })
    expect(seguir).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(seguir).toBeEnabled()
  })

  it('activo muestra la época y ofrece re-subir lo viejo', async () => {
    const api = montarCon({ active: true, keyEpoch: 1 })
    render(<MemoryEncryptionCard />)
    expect(await screen.findByText(/cifrado activo/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /re-subir/i }))
    await waitFor(() => expect(api.encryptionReencrypt).toHaveBeenCalled())
    expect(await screen.findByText(/866/)).toBeInTheDocument()
  })

  it('con máquinas esperando, ofrece autorizarlas por nombre', async () => {
    const api = montarCon({ active: true, keyEpoch: 1, pendingDevices: [{ deviceId: 'pc', name: 'la PC' }] })
    render(<MemoryEncryptionCard />)
    fireEvent.click(await screen.findByRole('button', { name: /autorizar la PC/i }))
    await waitFor(() => expect(api.encryptionAuthorize).toHaveBeenCalledWith('pc'))
  })

  // Esta maquina no puede leer: es el estado que la spec §5.5.4 obliga a mostrar fuerte.
  it('con época pero sin clave local, pide autorización o el código', async () => {
    montarCon({ active: false, keyEpoch: 1, undecryptable: 12 })
    render(<MemoryEncryptionCard />)
    expect(await screen.findByText(/esta máquina todavía no está autorizada/i)).toBeInTheDocument()
    expect(screen.getByText(/12/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /usar el código de recuperación/i })).toBeInTheDocument()
  })

  it('recuperar con un código equivocado muestra el error y no cierra el formulario', async () => {
    montarCon({ active: false, keyEpoch: 1 }, {
      encryptionRecover: vi.fn(async () => ({ ok: false, error: 'código de recuperación incorrecto' })),
    })
    render(<MemoryEncryptionCard />)
    fireEvent.click(await screen.findByRole('button', { name: /usar el código de recuperación/i }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'XXXX' } })
    fireEvent.click(screen.getByRole('button', { name: /recuperar/i }))
    expect(await screen.findByText(/incorrecto/i)).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run src/__tests__/components/MemoryEncryptionCard.test.tsx`
Expected: FAIL — no existe el componente.

- [ ] **Step 3: Escribir el componente**

Crear `src/components/MemoryEncryptionCard.tsx` con estos estados y copys exactos (los tests los fijan):

- **`!available`** → texto: *"Conectá la memoria en la nube para poder cifrarla."* Sin botón.
- **`available && keyEpoch === 0`** → botón `Activar el cifrado`, y debajo, en letra chica: *"Ciframos lo que escribiste. El servidor sigue sabiendo cuántas memorias tenés, de qué tipo, el scope y la rama."* (la promesa honesta del §5.2 — misma frase que va en la landing).
- **Después de activar** → panel con el código en grande, *"Guardalo ahora: no lo vas a volver a ver."*, un checkbox *"Lo guardé en un lugar seguro"* y el botón `Ya lo guardé` deshabilitado hasta tildarlo. Al confirmar, dispara `encryptionReencrypt()`.
- **`active`** → *"Cifrado activo"* + época + botón `Re-subir lo que quedó en claro`, que muestra `total`/`queued` al volver.
- **`!active && keyEpoch > 0`** → *"Esta máquina todavía no está autorizada."* + el conteo de `undecryptable` + botón `Usar el código de recuperación` que abre un input y un botón `Recuperar`.
- **`pendingDevices.length > 0 && active`** → una fila por máquina con botón `Autorizar <nombre>`.

Reglas de implementación, no negociables porque son las que los tests fijan:

```tsx
  // Mismo guard defensivo que MemoryVaultCard: preload viejo -> no montar, no romper.
  if (!window.memory?.encryptionStatus) return null
```

```tsx
  // El codigo NUNCA se guarda en estado persistente, ni se loguea, ni se manda a ningun
  // lado: vive en un useState y se pierde al desmontar. Guardarlo seria el camino C de la
  // spec, el que se descarto por escrito.
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null)
```

- [ ] **Step 4: Montarla en el overlay**

En `src/components/MemoriesWorkspace.tsx`, en `.memories-body`, arriba de `<MemoryVaultCard />`:

```tsx
        <MemoryEncryptionCard />
```

- [ ] **Step 5: Los estilos**

En `src/styles/global.css`, junto a los `.memories-*` que ya existen, agregar `.memory-encryption-card`, `.memory-encryption-code` (monoespaciada, `user-select: all`, `letter-spacing: .08em`) y `.memory-encryption-warning`. Reusar las variables de color que ya usa `MemoryVaultCard` — el cifrado no estrena paleta.

- [ ] **Step 6: Correr el test y la suite jsdom**

Run: `npx vitest run --project jsdom`
Expected: PASS, incluidos `MemoriesWorkspace.test.tsx` y `useMemories.test.tsx` (que montan el overlay entero y ahora incluyen la tarjeta nueva).

- [ ] **Step 7: Commit**

```bash
git add src/components/MemoryEncryptionCard.tsx src/components/MemoriesWorkspace.tsx src/styles/global.css src/__tests__/components/MemoryEncryptionCard.test.tsx
git commit -m "feat(cifrado): la tarjeta de cifrado en el overlay Memories"
```

---

### Task 13: Verificarlo en la app real y dejar dicho lo que se rompe

Lo único que ningún test cubre: que el flujo entero ande con dos máquinas de verdad, y que el back-office de otro repo se entere antes de romperse solo.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-09-nest-memories-plugin-y-cifrado.md` (cerrar §9.1)
- Modify: `server/README.md` (qué columnas dejan de ser legibles)
- Modify: `CLAUDE.md` (la nota operativa)

- [ ] **Step 1: El smoke de dos máquinas, a mano**

Con el servidor local arriba (`docker run ... postgres:16-alpine` + `npx tsx src/index.ts`) y **dos** perfiles de Nest apuntando a la misma cuenta:

1. En la máquina A: activar el cifrado, copiar el código, dejar que corra el re-subido.
2. Verificar contra Postgres que **no queda texto legible**:
   ```bash
   psql "postgres://postgres:nestmem@127.0.0.1:55432/nest_memory" -c \
     "select count(*) filter (where content like 'nmc1:%') as cifradas,
             count(*) filter (where content is not null and content not like 'nmc1:%') as en_claro
        from observations o join projects p on p.id = o.project_id
       where o.scope <> 'team'"
   ```
   Esperado: `en_claro = 0`.
3. En la máquina B: abrir Memories. Tiene que decir *"Esta máquina todavía no está autorizada"* y mostrar un conteo de ilegibles distinto de cero.
4. En A: autorizar B por nombre. En B: reabrir Memories — el conteo baja a 0 y las memorias aparecen en el grafo con su texto.
5. Guardar una memoria nueva en B con un tópico que ya exista en A, y verificar en A que **superseda** en vez de duplicar (es lo que la Task 5 existe para que funcione).
6. Borrar el perfil de B entero y volver a entrar: recuperar con el código, y verificar que la memoria vuelve.

Anotar el resultado de los seis pasos en este mismo archivo, debajo de este Step. Si alguno falla, **no** se sigue: es el único punto donde el plan toca datos reales.

- [ ] **Step 2: Cerrar el §9.1 de la spec**

En `docs/superpowers/specs/2026-09-09-nest-memories-plugin-y-cifrado.md`, reemplazar la sección "9.1 Lo que sigue abierto" por lo que este plan resolvió:

- **§9.1.1 (back-office)** → queda abierto **en `aira-admin`, no acá**. Escribir textual qué columnas de `observations` dejan de ser legibles: `title`, `content`, `tags`, `content_hash`, y `projects.display_name`. Un panel que las muestre va a mostrar `nmc1:...`.
- **D8** → cerrado como está escrito en "Decisiones que este plan toma" arriba: el backup de datos es R2 (ahora cifrado), el backup de la clave es el código de recuperación.
- **D9** → cerrado: no hace falta número nuevo, la cuota mide ciphertext y el sobrecosto es 1,36×.

- [ ] **Step 3: La nota en `server/README.md`**

Debajo de la tabla de rutas, una sección corta: qué guarda el servicio cifrado a partir de la migración 006, qué sigue en claro y por qué (`scope` decide autorización, `type` y `git_branch` sirven para diagnóstico), y que `scope: 'team'` no se cifra en la v1.

- [ ] **Step 4: La nota en `CLAUDE.md`**

Una sección `## Cifrado de la memoria — OJO` con lo operativo:

```markdown
La memoria personal sincronizada viaja **cifrada del lado del cliente** desde la migración
`006_e2ee.sql`. Consecuencias que muerden en el día a día:

- Consultar `observations.content` en Postgres devuelve `nmc1:...`. No está roto.
- El scope `team` **no** se cifra (decisión del 2026-09-09, spec §9).
- Las claves viven en `~/.raven-nest/memory/<cuenta>/keys.bin`, cifradas con `safeStorage`.
  Borrar ese archivo deja a la máquina sin poder leer la nube hasta que otra la autorice o
  se use el código de recuperación.
- Sin `safeStorage` (algunos Linux sin keyring) el cifrado no se puede activar. La memoria
  local y el sync en claro siguen andando.
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-09-09-nest-memories-plugin-y-cifrado.md server/README.md CLAUDE.md docs/superpowers/plans/2026-09-09-nest-memories-cifrado.md
git commit -m "docs(cifrado): cerrar D8, D9 y el §9.1, y la nota operativa"
```

---

## Cobertura de la spec

| Sección de la spec | Dónde entra |
|---|---|
| §5.1 (qué amenaza cubre) | Global Constraints + el copy de la Task 12 |
| §5.2 `content`, `title`, `project_display_name`, `content_hash` cifrados | Tasks 1 y 6, verificado en la 7 |
| §5.2 `tags` como blob | Task 6 |
| §5.2 `topic_key` por HMAC | Tasks 1, 5 y 6 |
| §5.2 `type`/`scope`/`git_branch` en claro | Task 6, fijado por test en la 7 |
| §5.3 camino B (clave envuelta por dispositivo) | Tasks 2, 4 y 9 |
| §5.3 código de recuperación obligatorio | Tasks 2, 9 y 12 |
| §5.4 clave por equipo | **Fuera de alcance** — §9 decisión 1, es la v2 |
| §5.5.1 back-office | Task 13 Step 2 (queda en `aira-admin`) |
| §5.5.2 la cuota mide ciphertext | "Decisiones", punto 2 — sin cambio de código |
| §5.5.3 migrar lo ya subido | Task 10 |
| §5.5.4 el modo de falla nuevo, con su `reason_code` | Task 8 |
| §7 orden de trabajo (el cifrado primero) | El alcance de este plan |
| §8.1 riesgo del código de recuperación en el onboarding | Task 12: se muestra al activar, no al conectar |
| §9 decisión 1 (`team` en claro) | Task 6, con test |
| §9 decisión 2 (el plugin local es gratis) | Sin código — el gate por device token ya existe |
| §9.1 D8 y D9 | "Decisiones" + Task 13 |

**Fuera de alcance a propósito:** el paquete `@nestmux/memories` y su TUI (§4, §6) — plan aparte; la clave por equipo (§5.4); rotar la clave por revocación de un device (el servidor ya soporta subir de época, pero no hay UI y no hace falta hasta que haya más de un usuario).

## Riesgos de este plan

1. **La Task 5 es la que puede romper el pull en silencio.** Si `topic_key_hmac` no queda bien escrito en los dos caminos (`save` y `applyIncomingObservation`), el supersede por tópico deja de encontrar al dueño local y `idx_obs_topic` tumba el pull entero — el mismo fallo que el comentario C2 del daemon ya documenta. Por eso tiene test propio y por eso el Step 5 de la Task 13 lo prueba a mano.
2. **La ventana de la migración.** Entre activar y terminar de re-subir, la nube tiene filas cifradas y filas en claro. `openPulledRow` acepta las dos y recalcula el HMAC de las viejas, así que la ventana es soportada por diseño y no por suerte — pero es el lugar donde un error se vería como "algunas memorias desaparecieron".
3. **`safeStorage` no está en todos lados.** En un Linux sin keyring el cifrado simplemente no se puede activar. La tarjeta lo dice; no degrada a guardar claves en claro.
4. **Un solo usuario hoy es lo que hace barata esta migración, y también lo que la hace poco probada.** El smoke de la Task 13 con dos máquinas es la única prueba real que vamos a tener antes de abrir a terceros.
