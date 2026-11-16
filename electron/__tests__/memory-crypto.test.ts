import { describe, it, expect } from 'vitest'
import {
  CIPHER_PREFIX, generateMasterKey, deriveKeys, isCiphertext, fieldAad,
  encryptField, decryptField, hmacTopicKey, huellaDeMaestra, rotateVerifier, MemoryDecryptError,
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

  // La prueba que sostiene la promesa entera: que el sobre no deje ver nada del texto.
  // Los otros tests verifican que el round-trip funciona y que la autenticacion corta —
  // ninguno mira si adentro del sobre quedo el plaintext, que es lo unico que le importa
  // a alguien con acceso a la base del servidor.
  it('el sobre no contiene una sola palabra del texto original', () => {
    const secreto = 'el token de produccion es ghp_ABCDEF y la password admin123'
    const env = encryptField(keys, secreto, fieldAad('obs_1', 'content'))
    const crudo = Buffer.from(env.slice(CIPHER_PREFIX.length), 'base64')
    for (const frag of ['token', 'ghp_', 'admin123', 'produccion', 'password']) {
      expect(env.includes(frag), `"${frag}" visible en el base64`).toBe(false)
      expect(crudo.includes(Buffer.from(frag)), `"${frag}" visible en los bytes`).toBe(false)
    }
  })

  // El sobrecosto esta medido en el plan (D9) y la cuota del servidor se calcula con el:
  // `5 + ceil((28 + n) / 3) * 4`. Si el formato cambia y esto no, la cuota miente.
  it('el sobre cuesta exactamente lo que la cuota del servidor supone', () => {
    for (const texto of ['', 'corto', 'x'.repeat(1500)]) {
      const n = Buffer.byteLength(texto, 'utf8')
      const esperado = 5 + Math.ceil((28 + n) / 3) * 4
      expect(encryptField(keys, texto, fieldAad('o', 'content')).length).toBe(esperado)
    }
  })

  /**
   * El separador, que hasta acá era sólo un comentario.
   *
   * Sin el `|`, el par (`proj`, `1personal`) y (`proj1`, `personal`) dan el MISMO HMAC, y dos
   * temas distintos colapsan en uno: el servidor supersede por igualdad de este valor, así
   * que una colisión no es un detalle teórico — una memoria pisa a la otra.
   *
   * **Lo que el separador NO hace**, y que el comentario del código afirmaba de más: cerrar la
   * ambigüedad en general. `('proj','personal','a|b')` y `('proj','personal|a','b')` dan el
   * mismo string — probado al escribir este test. Lo que la cierra de verdad es que sólo el
   * ÚLTIMO componente es texto libre: el project_key es hex y el scope un enum, así que no hay
   * dónde mover el corte. El día que un componente del medio deje de estar restringido, el
   * separador no alcanza.
   *
   * Sacando el separador, los 1909 tests de `electron/` y los 315 del servidor seguían en
   * verde (cuarta revisión adversarial, 2026-09-21).
   */
  it('hmacTopicKey no colapsa dos temas cuando el corte cae en otro lado', () => {
    expect(hmacTopicKey(keys, 'proj', '1personal', 'deploy'))
      .not.toBe(hmacTopicKey(keys, 'proj1', 'personal', 'deploy'))
    expect(hmacTopicKey(keys, 'proj1', 'personal', 'deploy'))
      .not.toBe(hmacTopicKey(keys, 'proj1person', 'al', 'deploy'))
  })

  /**
   * `rotateVerifier` va atado a la ÉPOCA, y eso tampoco lo fijaba nada — ni acá ni en el
   * servidor, porque el cliente todavía no tiene ningún camino que rote y
   * `keys-cliente-real.test.ts` no puede ejercitar una rotación.
   *
   * Sin la época, el verificador de una época vieja sirve en la nueva: es la diferencia
   * entre una prueba de posesión que caduca y una que no.
   */
  it('rotateVerifier cambia con la época y con la maestra', () => {
    const master = generateMasterKey()
    expect(rotateVerifier(master, 1)).not.toBe(rotateVerifier(master, 2))
    expect(rotateVerifier(master, 1)).toBe(rotateVerifier(master, 1))
    expect(rotateVerifier(master, 1)).not.toBe(rotateVerifier(generateMasterKey(), 1))
  })

  it('hmacTopicKey cambia con la maestra', () => {
    const otras = deriveKeys(generateMasterKey())
    expect(hmacTopicKey(otras, 'proj1', 'personal', 'deploy'))
      .not.toBe(hmacTopicKey(keys, 'proj1', 'personal', 'deploy'))
  })

  // Envolver no requiere ningún secreto: quien tenga escritura sobre la base del servicio
  // puede sellar SU maestra para la pública de la víctima y pisar la envoltura. La máquina
  // desenvuelve 32 bytes válidos, sin ningún error, y a partir de ahí cifra para el atacante.
  // El sealed box no lo detecta —no autentica al remitente— así que hace falta poder comparar
  // si dos máquinas tienen la MISMA maestra.
  it('la huella de la maestra distingue una clave de otra sin revelarla', () => {
    const a = generateMasterKey()
    const b = generateMasterKey()
    expect(huellaDeMaestra(a)).toBe(huellaDeMaestra(a))
    expect(huellaDeMaestra(a)).not.toBe(huellaDeMaestra(b))
    expect(huellaDeMaestra(a)).toMatch(/^[0-9a-f]{16}$/)
    // Y no filtra la maestra: la huella es un HMAC truncado, no un prefijo.
    expect(a.toString('hex')).not.toContain(huellaDeMaestra(a))
  })
})
