import { describe, it, expect } from 'vitest'
import {
  AYUDA_DE_NUEVA,
  parsearMemoria,
  plantillaDeNueva,
  serializarMemoria,
  type MemoriaEscrita,
} from '../tui-del-paquete/frontmatter'

const base: MemoriaEscrita = {
  title: 'Encryption is mandatory on connect',
  type: 'decision',
  tags: ['encryption', 'sync'],
  content: 'Body in Markdown. [[Wikilinks]] work.\n\nSecond paragraph.',
}

function ok(texto: string): MemoriaEscrita {
  const r = parsearMemoria(texto)
  if (!r.ok) throw new Error(r.error)
  return r.memoria
}

describe('frontmatter de la memoria', () => {
  it('serializa con el formato del spec', () => {
    expect(serializarMemoria(base)).toBe(
      '---\ntitle: Encryption is mandatory on connect\ntype: decision\ntags: [encryption, sync]\n---\n' +
        base.content +
        '\n',
    )
  })

  it('ida y vuelta', () => {
    expect(ok(serializarMemoria(base))).toEqual(base)
  })

  it('un título con : y # sobrevive a la ida y vuelta', () => {
    for (const title of ['Fix: login #42', '[WIP] algo', '"entre comillas" raro', 'a "b" \\ c: d']) {
      expect(ok(serializarMemoria({ ...base, title })).title).toBe(title)
    }
  })

  it('error: sin frontmatter', () => {
    const r = parsearMemoria('solo cuerpo')
    expect(r).toEqual({ ok: false, error: 'Missing frontmatter (--- … ---) at the top' })
    expect(parsearMemoria('---\ntitle: x\n')).toEqual({
      ok: false,
      error: 'Missing frontmatter (--- … ---) at the top',
    })
  })

  it('error: título vacío', () => {
    expect(parsearMemoria('---\ntitle:\ntype: decision\n---\nx')).toEqual({
      ok: false,
      error: "title can't be empty",
    })
    expect(parsearMemoria('---\ntitle: ""\ntype: decision\n---\nx')).toEqual({
      ok: false,
      error: "title can't be empty",
    })
  })

  it('error: tipo desconocido, con la lista', () => {
    const r = parsearMemoria('---\ntitle: x\ntype: banana\n---\nx')
    expect(r).toEqual({
      ok: false,
      error:
        'Unknown type "banana". Use one of: decision, bugfix, architecture, discovery, pattern, config, preference, session, handoff',
    })
  })

  it('error: tags que no son lista', () => {
    expect(parsearMemoria('---\ntitle: x\ntype: decision\ntags: a, b\n---\nx')).toEqual({
      ok: false,
      error: 'tags must be a list like [a, b]',
    })
  })

  it('tags: [] es lista vacía y si falta tags es []', () => {
    expect(ok('---\ntitle: x\ntype: bugfix\ntags: []\n---\nx').tags).toEqual([])
    expect(ok('---\ntitle: x\ntype: bugfix\n---\nx').tags).toEqual([])
    expect(ok(serializarMemoria({ ...base, tags: [] })).tags).toEqual([])
  })

  it('CRLF parsea igual', () => {
    const crlf = serializarMemoria(base).replace(/\n/g, '\r\n')
    expect(ok(crlf)).toEqual(base)
  })

  it('la plantilla de nueva: decision, título vacío, ayuda como cuerpo', () => {
    const t = plantillaDeNueva()
    expect(t).toBe(
      '---\ntitle:\ntype: decision\ntags: []\n---\n' + AYUDA_DE_NUEVA + '\n',
    )
    expect(AYUDA_DE_NUEVA).toMatch(/^<!-- Write the memory here/)
    // con un título puesto, el cuerpo igual a la ayuda queda vacío
    const r = ok(t.replace('title:', 'title: Algo'))
    expect(r.content).toBe('')
    expect(r.title).toBe('Algo')
  })

  it('la ayuda junto a otro texto se saca', () => {
    const t = `---\ntitle: x\ntype: decision\n---\n${AYUDA_DE_NUEVA}\nMi texto\n`
    expect(ok(t).content).toBe('Mi texto')
  })
})
