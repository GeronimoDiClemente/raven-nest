import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MemoryStore } from '../memory-store'
import { recortar, CONTEXT_MAX_CHARS } from '../memory-reads'

/**
 * El presupuesto de `memory_context`, que es lo que separa un índice de un volcado.
 *
 * Devolvía diez memorias con el cuerpo ENTERO en cada arranque de sesión. Con el promedio
 * real del corpus (1793 bytes) son ~18 KB, unos 4.500 tokens — y la descripción de la
 * herramienta le decía al modelo que era "cheap", que es justo lo que hace que la llame sin
 * pensarlo. Medido acá: 4.525 tokens contra 980.
 *
 * Este test existe para que ese número no vuelva a subir sin que alguien lo decida.
 */
describe('memory_context es un índice, no un volcado', () => {
  const conDiezMemorias = () => {
    const dir = mkdtempSync(join(tmpdir(), 'nest-presupuesto-'))
    const store = new MemoryStore(join(dir, 'm.db'))
    store.ensureProject({ projectKey: 'p', displayName: 'p' })
    const cuerpo = 'Lo que se decidió y por qué, con el detalle al lado. '.repeat(40)
    for (let i = 0; i < 10; i++) {
      store.save({
        projectKey: 'p', scope: 'personal', type: 'decision',
        title: `Decisión número ${i}`, content: cuerpo, source: 'mcp',
      })
    }
    return { dir, store }
  }
  const pesar = (xs: Array<{ title: string; content: string }>) =>
    xs.reduce((n, x) => n + x.title.length + x.content.length, 0)

  it('el índice pesa menos de la cuarta parte del volcado', () => {
    const { dir, store } = conDiezMemorias()
    const volcado = pesar(store.context('p', 10, null))
    const indice = pesar(store.context('p', 10))
    expect(indice).toBeLessThan(volcado / 4)
    store.close(); rmSync(dir, { recursive: true, force: true })
  })

  it('lo que se corta se declara cortado', () => {
    const { dir, store } = conDiezMemorias()
    const items = store.context('p', 10)
    // Todo lo que quedó cortado lo dice: un agente que trate un cuerpo truncado como completo
    // saca conclusiones de lo que no leyó, y ése es el modo de falla que importa.
    for (const item of items) {
      expect(item.contentTruncated, item.title).toBe(true)
      expect(item.content.length).toBeLessThanOrEqual(CONTEXT_MAX_CHARS)
    }
    store.close(); rmSync(dir, { recursive: true, force: true })
  })

  it('una memoria corta pasa entera y no se marca', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nest-presupuesto-corta-'))
    const store = new MemoryStore(join(dir, 'm.db'))
    store.ensureProject({ projectKey: 'p', displayName: 'p' })
    store.save({
      projectKey: 'p', scope: 'personal', type: 'decision',
      title: 'Corta', content: 'Dos líneas y nada más.', source: 'mcp',
    })
    const [item] = store.context('p', 10)
    expect(item.content).toBe('Dos líneas y nada más.')
    expect(item.contentTruncated).toBeUndefined()
    store.close(); rmSync(dir, { recursive: true, force: true })
  })

  // Pedir el texto entero sigue siendo posible: es el tercer escalón, y el que la lista de
  // la app usa. Sin esto, "presupuesto" sería "no se puede leer una memoria completa".
  it('se puede pedir el volcado explícitamente', () => {
    const { dir, store } = conDiezMemorias()
    const entero = store.context('p', 10, null)
    for (const item of entero) expect(item.contentTruncated).toBeUndefined()
    expect(pesar(entero)).toBeGreaterThan(10_000)
    store.close(); rmSync(dir, { recursive: true, force: true })
  })
})

/**
 * El corte tiene que caer en un límite limpio. Cortar a mitad de palabra le hace creer al
 * modelo que el texto sigue y lo empuja a completarlo en vez de pedirlo — que es exactamente
 * el modo de falla que un índice truncado tiene que evitar.
 */
describe('recortar', () => {
  it('prefiere terminar en un párrafo', () => {
    const texto = 'Primer párrafo completo.\n\nSegundo párrafo que se pasa del límite y sigue.'
    const r = recortar(texto, 40)
    expect(r.cortado).toBe(true)
    expect(r.texto).toBe('Primer párrafo completo.')
  })

  it('si no hay párrafo, corta en una oración', () => {
    const texto = 'Una oración que entra. Otra que ya no entra porque se pasa del límite.'
    const r = recortar(texto, 40)
    expect(r.cortado).toBe(true)
    expect(r.texto.endsWith('.')).toBe(true)
  })

  it('nunca devuelve algo que no sea un prefijo del original', () => {
    const texto = 'palabra '.repeat(100)
    const r = recortar(texto, 50)
    expect(texto.startsWith(r.texto)).toBe(true)
  })

  it('un texto más corto que el límite pasa intacto', () => {
    expect(recortar('corto', 400)).toEqual({ texto: 'corto', cortado: false })
  })

  /**
   * El corte limpio se busca sólo en la segunda mitad de la ventana. Si el único separador
   * está muy al principio —un título de dos palabras seguido de un párrafo largo— cortar ahí
   * tiraría casi todo el presupuesto por nada, y es mejor cortar en la palabra más cercana al
   * límite.
   */
  it('no tira el presupuesto por un separador que está al principio', () => {
    const texto = 'Hola.\n\n' + 'texto largo que sigue y sigue '.repeat(20)
    const r = recortar(texto, 200)
    expect(r.texto.length).toBeGreaterThan(100)
  })
})
