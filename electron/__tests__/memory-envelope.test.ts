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
