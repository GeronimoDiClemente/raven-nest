import { describe, it, expect } from 'vitest'
import { deriveKeys, generateMasterKey, isCiphertext, hmacTopicKey } from '../memory-crypto'
import { sealMutationPayload, openPulledRow, looksLikeTopicHmac, localTopicHmac, type EnvelopeContext } from '../memory-envelope'
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
  originAccount: payload.origin_account as string | undefined,
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

  // La fuga que nadie decidió: `NEST_MEMORY_ACCOUNT` sale del directorio
  // `accounts/<ai>/<cuenta>`, y en una máquina real esa `<cuenta>` ES el email del usuario
  // con el punto cambiado por coma. Subía en claro en cada observación que guardaba un
  // agente, y no figuraba en la tabla del §5.2 ni entre los cifrados ni entre los que van en
  // claro a propósito.
  it('el email de la cuenta no sale en claro', () => {
    const sellado = sealMutationPayload(ctx, {
      sync_id: 'obs-1', scope: 'personal', type: 'decision',
      title: 't', content: 'c', tags: [],
      origin_account: 'claude:gerodc06@gmail,com',
    })
    expect(String(sellado.origin_account)).toMatch(/^nmc1:/)
    expect(String(sellado.origin_account)).not.toContain('gmail')
    expect(String(sellado.origin_account)).not.toContain('gerodc06')
  })

  // La regresión: `origin_account` se sumó a los campos sellados y este lado no se actualizó,
  // así que la fila subía cifrada y bajaba sin abrirse — el `nmc1:…` terminaba escrito en la
  // base LOCAL como si fuera el nombre de la cuenta. Todo lo que se sella tiene que abrirse.
  it('todo lo que se sella se vuelve a abrir — incluido origin_account', () => {
    const p = { ...payloadBase(), origin_account: 'claude:gerodc06@gmail,com' }
    const sellado = sealMutationPayload(ctx, p)
    expect(String(sellado.origin_account)).toMatch(/^nmc1:/)

    const { row, undecryptable } = openPulledRow(ctx, filaDe(sellado))
    expect(undecryptable).toBe(false)
    expect(row.originAccount).toBe('claude:gerodc06@gmail,com')
  })

  it('una fila vieja con origin_account en claro pasa tal cual', () => {
    const p = { ...payloadBase(), origin_account: 'claude:alguien' }
    const { row } = openPulledRow(ctx, filaDe(p))
    expect(row.originAccount).toBe('claude:alguien')
  })
})

describe('scope team con teamKeys', () => {
  const masterPersonal = generateMasterKey()
  const keysPersonal = deriveKeys(masterPersonal)
  const masterEquipo = generateMasterKey()
  const keysEquipo = deriveKeys(masterEquipo)

  it('sealMutationPayload cifra una fila team cuando hay clave de equipo para ESE project_key', () => {
    const ctx = { keys: keysPersonal, keyEpoch: 1, teamKeys: (pk: string) => (pk === 'proj-x' ? keysEquipo : null) }
    const sellado = sealMutationPayload(ctx, {
      sync_id: 'abc', scope: 'team', project_key: 'proj-x', title: 'Decisión', content: 'texto', tags: [],
    })
    expect(sellado.title).toMatch(/^nmc1:/)
    expect(sellado.content).toMatch(/^nmc1:/)
  })

  it('sealMutationPayload NO cifra team si teamKeys da null para ese proyecto (sin activar)', () => {
    const ctx = { keys: keysPersonal, keyEpoch: 1, teamKeys: () => null }
    const sellado = sealMutationPayload(ctx, {
      sync_id: 'abc', scope: 'team', project_key: 'proj-x', title: 'Decisión', content: 'texto', tags: [],
    })
    expect(sellado.title).toBe('Decisión')
  })

  it('sealMutationPayload sigue sin tocar scope personal cuando hay teamKeys configurado', () => {
    const ctx = { keys: keysPersonal, keyEpoch: 1, teamKeys: () => keysEquipo }
    const sellado = sealMutationPayload(ctx, {
      sync_id: 'abc', scope: 'personal', project_key: 'proj-x', title: 'Nota', content: 'texto', tags: [],
    })
    expect(sellado.title).toMatch(/^nmc1:/) // cifrada con la PERSONAL, como siempre
  })

  it('openPulledRow descifra una fila team con la clave de equipo correcta', () => {
    const sellado = sealMutationPayload(
      { keys: keysPersonal, keyEpoch: 1, teamKeys: () => keysEquipo },
      { sync_id: 'abc', scope: 'team', project_key: 'proj-x', title: 'Decisión', content: 'texto', tags: [] }
    )
    const { row, undecryptable } = openPulledRow(
      { keys: keysPersonal, keyEpoch: 1, teamKeys: (pk) => (pk === 'proj-x' ? keysEquipo : null) },
      { syncId: 'abc', scope: 'team', projectKey: 'proj-x', title: sellado.title as string, content: sellado.content as string, tags: [] } as never
    )
    expect(row.title).toBe('Decisión')
    expect(undecryptable).toBe(false)
  })

  it('openPulledRow marca undecryptable si la fila es team y no hay clave de equipo para ese proyecto', () => {
    const sellado = sealMutationPayload(
      { keys: keysPersonal, keyEpoch: 1, teamKeys: () => keysEquipo },
      { sync_id: 'abc', scope: 'team', project_key: 'proj-x', title: 'Decisión', content: 'texto', tags: [] }
    )
    const { undecryptable } = openPulledRow(
      { keys: keysPersonal, keyEpoch: 1, teamKeys: () => null },
      { syncId: 'abc', scope: 'team', projectKey: 'proj-x', title: sellado.title as string, content: sellado.content as string, tags: [] } as never
    )
    expect(undecryptable).toBe(true)
  })

  it('el HMAC de tópico de una fila team usa la clave de EQUIPO, no la personal de quien llama', () => {
    // Dos "personas" con personales DISTINTAS pero la MISMA clave de equipo — el caso real:
    // dos miembros de un equipo, cada uno con su propia cuenta cifrada, compartiendo un tema.
    const keysPersonalDeOtraPersona = deriveKeys(generateMasterKey())
    const ctxAutorA = { keys: keysPersonal, keyEpoch: 1, teamKeys: () => keysEquipo }
    const ctxAutorB = { keys: keysPersonalDeOtraPersona, keyEpoch: 1, teamKeys: () => keysEquipo }

    const selladoA = sealMutationPayload(ctxAutorA, {
      sync_id: 'abc', scope: 'team', project_key: 'proj-x', topic_key: 'mismo-tema', title: 't', content: 'c', tags: [],
    })
    const selladoB = sealMutationPayload(ctxAutorB, {
      sync_id: 'def', scope: 'team', project_key: 'proj-x', topic_key: 'mismo-tema', title: 't', content: 'c', tags: [],
    })
    // Si esto usara `ctx.keys` (la personal de cada uno) en vez de la clave de equipo
    // resuelta, los dos HMAC saldrían distintos y el supersede de equipo (`push.ts:537`,
    // que compara por igualdad) dejaría de encontrarlos como el mismo tema.
    expect(selladoA.topic_key).toBe(selladoB.topic_key)
  })
})

// Task 14 (Problema 1): en el PULL la clave de equipo la elige el team_id que manda el servidor.
describe('openPulledRow con team_id del servidor (Task 14)', () => {
  const keysEquipo = deriveKeys(generateMasterKey())
  const sellado = sealMutationPayload(
    { keys: ctx.keys, keyEpoch: 1, teamKeys: () => keysEquipo },
    { sync_id: 'abc', scope: 'team', project_key: 'proj-x', title: 'Decisión', content: 'texto', tags: [] }
  )
  const fila = (teamId?: string) => ({
    syncId: 'abc', scope: 'team', projectKey: 'proj-x',
    title: sellado.title as string, content: sellado.content as string, tags: [],
    ...(teamId ? { teamId } : {}),
  }) as never

  it('con teamId usa teamKeysById, aunque el project_key local no tenga equipo', () => {
    const c: EnvelopeContext = { ...ctx, teamKeys: () => null, teamKeysById: (t) => (t === 'T1' ? keysEquipo : null) }
    const { row, undecryptable } = openPulledRow(c, fila('T1'))
    expect(undecryptable).toBe(false)
    expect(row.title).toBe('Decisión')
  })

  it('con teamId, manda el servidor: no cae a la clave del proyecto local', () => {
    const c: EnvelopeContext = { ...ctx, teamKeys: () => keysEquipo, teamKeysById: () => null }
    expect(openPulledRow(c, fila('T1')).undecryptable).toBe(true)
  })

  it('sin teamId (servicio viejo) sigue resolviendo por project_key', () => {
    const c: EnvelopeContext = { ...ctx, teamKeys: (pk) => (pk === 'proj-x' ? keysEquipo : null), teamKeysById: () => null }
    expect(openPulledRow(c, fila()).row.title).toBe('Decisión')
  })
})

/**
 * El HMAC que `save()` escribe en la base LOCAL (handoff 2026-10-15, decisión 2).
 *
 * `main.ts` lo calculaba siempre con la clave PERSONAL, también para filas `team`, y el pull
 * trae el HMAC de equipo: `findActiveTopicOwnerByHmac` no encontraba al dueño local y dos
 * versiones del mismo tema, de autores distintos, quedaban vivas en la app.
 */
describe('localTopicHmac', () => {
  const keysPersonal = deriveKeys(generateMasterKey())
  const keysEquipo = deriveKeys(generateMasterKey())
  const ctxEquipo: EnvelopeContext = { keys: keysPersonal, keyEpoch: 1, teamKeys: (pk) => (pk === 'proj-x' ? keysEquipo : null) }

  it('una fila team da el MISMO HMAC que sella el push, o sea el de la clave de equipo', () => {
    const sellado = sealMutationPayload(ctxEquipo, {
      sync_id: 'abc', scope: 'team', project_key: 'proj-x', topic_key: 'deploy', title: 't', content: 'c', tags: [],
    })
    expect(localTopicHmac(ctxEquipo, 'proj-x', 'team', 'deploy')).toBe(sellado.topic_key)
    expect(localTopicHmac(ctxEquipo, 'proj-x', 'team', 'deploy')).not.toBe(hmacTopicKey(keysPersonal, 'proj-x', 'team', 'deploy'))
  })

  it('una fila personal sigue con la clave personal', () => {
    expect(localTopicHmac(ctxEquipo, 'proj-x', 'personal', 'deploy')).toBe(hmacTopicKey(keysPersonal, 'proj-x', 'personal', 'deploy'))
  })

  // El push la sube con el tema en claro y el pull la baja sin HMAC: un HMAC personal acá
  // no lo iguala nadie. `null` además deja que `backfillTopicHmacs` la complete cuando llegue
  // la clave de equipo.
  it('una fila team de un equipo sin clave en este device da null', () => {
    expect(localTopicHmac(ctxEquipo, 'proj-sin-equipo', 'team', 'deploy')).toBeNull()
  })

  it('sin contexto da null', () => {
    expect(localTopicHmac(null, 'proj-x', 'personal', 'deploy')).toBeNull()
  })
})
