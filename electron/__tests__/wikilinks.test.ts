import { describe, it, expect } from 'vitest'
import { parsearWikilinks } from '../wikilinks'

describe('parsearWikilinks', () => {
  it('saca el nombre de un link simple', () => {
    expect(parsearWikilinks('esto se relaciona con [[el candado de sync]] y nada más'))
      .toEqual(['el candado de sync'])
  })

  it('se queda con el destino, no con el alias', () => {
    expect(parsearWikilinks('ver [[memoria-real|lo que le decimos al lector]]')).toEqual(['memoria-real'])
  })

  it('corta el encabezado y el id de bloque', () => {
    expect(parsearWikilinks('[[nota#Una sección]] y [[otra#^bloque123]]')).toEqual(['nota', 'otra'])
  })

  it('un embed también es un link', () => {
    expect(parsearWikilinks('![[la nota embebida]]')).toEqual(['la nota embebida'])
  })

  it('no repite el mismo destino', () => {
    expect(parsearWikilinks('[[a]] después [[a]] y [[a|con alias]]')).toEqual(['a'])
  })

  it('recorta espacios alrededor del nombre', () => {
    expect(parsearWikilinks('[[  con espacios  ]]')).toEqual(['con espacios'])
  })

  it('ignora un link vacío o sólo espacios', () => {
    expect(parsearWikilinks('[[]] y [[   ]]')).toEqual([])
  })

  it('NO confunde la sintaxis de bash con un link', () => {
    // Es el falso positivo que importa: las memorias guardan código, y `[[ ... ]]` es
    // una construcción de bash. Sin esto cada memoria con un `if` bash inventa un link.
    const memoria = [
      'El script hace la guarda así:',
      '```bash',
      'if [[ -n "$RAVEN_HOME" ]]; then echo ok; fi',
      '```',
      'y se relaciona con [[trampas del entorno]]',
    ].join('\n')
    expect(parsearWikilinks(memoria)).toEqual(['trampas del entorno'])
  })

  it('tampoco lo confunde en código en línea', () => {
    expect(parsearWikilinks('la guarda `[[ -f x ]]` va antes de [[la nota]]')).toEqual(['la nota'])
  })

  it('un bloque de código sin cerrar no se come el resto del texto', () => {
    // Si la memoria abre un fence y no lo cierra, lo de abajo sigue siendo texto: mejor
    // perder un link que quedarse mudo a partir de ahí… pero al revés es peor. Decidimos
    // que un fence abierto CIERRA al final del texto y lo de adentro se ignora.
    expect(parsearWikilinks('```\n[[adentro]]\n')).toEqual([])
  })

  it('devuelve vacío cuando no hay nada', () => {
    expect(parsearWikilinks('')).toEqual([])
    expect(parsearWikilinks('texto sin links')).toEqual([])
  })

  it('no toma un corchete sin cerrar', () => {
    expect(parsearWikilinks('[[esto nunca cierra')).toEqual([])
  })

  it('saca varios de un párrafo', () => {
    expect(parsearWikilinks('viene de [[uno]], pasa por [[dos]] y termina en [[tres]]'))
      .toEqual(['uno', 'dos', 'tres'])
  })
})

import { resolverWikilink, type CandidatoMemoria } from '../wikilinks'

const c = (syncId: string, title: string, topicKey: string | null = null): CandidatoMemoria =>
  ({ syncId, title, topicKey })

describe('resolverWikilink', () => {
  it('resuelve por topic_key exacto', () => {
    const cands = [c('s1', 'Un título cualquiera', 'arquitectura/candado-sync'), c('s2', 'Otra')]
    expect(resolverWikilink('arquitectura/candado-sync', cands)).toBe('s1')
  })

  it('resuelve por título cuando no hay topic', () => {
    expect(resolverWikilink('El candado de sync', [c('s1', 'El candado de sync')])).toBe('s1')
  })

  it('el título no distingue mayúsculas', () => {
    expect(resolverWikilink('el CANDADO de Sync', [c('s1', 'El candado de sync')])).toBe('s1')
  })

  it('el topic_key gana sobre el título', () => {
    // El topic es el identificador estable —el análogo del nombre de archivo—, el título
    // cambia cuando alguien reescribe la memoria.
    const cands = [c('s1', 'candado', 'otro/topic'), c('s2', 'no importa', 'candado')]
    expect(resolverWikilink('candado', cands)).toBe('s2')
  })

  it('devuelve null si no existe — el link queda pendiente, no es un error', () => {
    // Es la pieza que hace barato linkear de más: podés apuntar a una memoria que todavía
    // no escribiste, y cuando exista el link se resuelve solo.
    expect(resolverWikilink('algo que no escribí todavía', [c('s1', 'otra cosa')])).toBeNull()
  })

  it('con varios títulos iguales elige siempre el mismo', () => {
    const cands = [c('s9', 'repetido'), c('s2', 'repetido'), c('s5', 'repetido')]
    expect(resolverWikilink('repetido', cands)).toBe('s2')
    expect(resolverWikilink('repetido', [...cands].reverse())).toBe('s2')
  })

  it('no explota con lista vacía ni con nombre vacío', () => {
    expect(resolverWikilink('lo que sea', [])).toBeNull()
    expect(resolverWikilink('', [c('s1', '')])).toBeNull()
  })
})
