// Layer B: hasta ahora `Stop` cerraba la sesión y NO escribía nada, y `PreCompact` dejaba
// un placeholder que decía "rollup pending on session close" — un rollup que nunca llegaba.
// El resultado era que la memoria no capturaba lo que decía capturar.
//
// El resumen se arma SIN LLM y sin gastar un token, que es lo correcto para un producto
// BYOK que promete no medir el uso: Claude Code ya escribe en el transcript un `ai-title`
// (un título generado de la sesión) y los prompts del usuario. Todo lo que hace falta ya
// está en el archivo.
//
// El formato de las fixtures no está inventado: sale de leer transcripts reales de esta
// máquina el 2026-09-03.
import { describe, it, expect } from 'vitest'
import { buildSessionRollup } from '../memory-rollup'

const linea = (o: unknown) => JSON.stringify(o)

const USUARIO = (text: string, extra: Record<string, unknown> = {}) =>
  linea({ type: 'user', message: { role: 'user', content: text }, timestamp: '2026-09-03T10:00:00Z', ...extra })

describe('buildSessionRollup', () => {
  it('usa el ai-title de Claude Code como titulo: ya viene resumido y es gratis', () => {
    const jsonl = [
      USUARIO('arreglá el login que tira 500'),
      linea({ type: 'ai-title', aiTitle: 'Arreglar el 500 del login', sessionId: 's1' }),
    ].join('\n')

    expect(buildSessionRollup(jsonl)?.title).toBe('Arreglar el 500 del login')
  })

  it('si hay varios ai-title gana el ultimo, que es el mas informado', () => {
    const jsonl = [
      USUARIO('algo'),
      linea({ type: 'ai-title', aiTitle: 'Primera idea', sessionId: 's1' }),
      linea({ type: 'ai-title', aiTitle: 'Lo que resulto ser', sessionId: 's1' }),
    ].join('\n')

    expect(buildSessionRollup(jsonl)?.title).toBe('Lo que resulto ser')
  })

  it('sin ai-title cae al primer prompt del usuario', () => {
    const jsonl = USUARIO('migrar la tabla de usuarios a la nueva forma')

    expect(buildSessionRollup(jsonl)?.title).toContain('migrar la tabla de usuarios')
  })

  it('el contenido son los prompts del usuario, que es lo que dice donde quedaste', () => {
    const jsonl = [USUARIO('primero esto'), USUARIO('ahora lo otro')].join('\n')

    const r = buildSessionRollup(jsonl)
    expect(r?.content).toContain('primero esto')
    expect(r?.content).toContain('ahora lo otro')
  })

  // isMeta marca lo que Claude Code se inyecta a si mismo (el caveat de local-command, por
  // ejemplo). Meterlo en la memoria seria guardar ruido de la herramienta como si fuera del
  // usuario. Salio de leer transcripts reales: aparece seguido.
  it('descarta los mensajes isMeta, que son ruido de la herramienta', () => {
    const jsonl = [
      USUARIO('<local-command-caveat>Caveat: the messages below…</local-command-caveat>', { isMeta: true }),
      USUARIO('lo que pidio el usuario de verdad'),
    ].join('\n')

    const r = buildSessionRollup(jsonl)
    expect(r?.content).not.toContain('Caveat')
    expect(r?.content).toContain('lo que pidio el usuario de verdad')
  })

  it('entiende el content como array de bloques, no solo como string', () => {
    const jsonl = linea({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'el prompt vino en bloques' }] },
    })

    expect(buildSessionRollup(jsonl)?.content).toContain('el prompt vino en bloques')
  })

  it('ignora los tool_result, que son salida de herramientas y no lo que pidio el usuario', () => {
    const jsonl = [
      linea({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'exit 0' }] } }),
      USUARIO('esto si'),
    ].join('\n')

    const r = buildSessionRollup(jsonl)
    expect(r?.content).not.toContain('exit 0')
    expect(r?.content).toContain('esto si')
  })

  it('sobrevive a lineas rotas en vez de tirar la sesion entera', () => {
    const jsonl = ['{ esto no es json', USUARIO('pero esto si'), ''].join('\n')

    expect(buildSessionRollup(jsonl)?.content).toContain('pero esto si')
  })

  // Sin prompts no hay nada que recordar. Escribir "hubo una sesion" es ruido, y el ruido en
  // memoria es peor que el silencio: se lo comen todas las sesiones siguientes.
  it('devuelve null cuando no hubo un solo prompt del usuario', () => {
    const jsonl = [
      linea({ type: 'assistant', message: { role: 'assistant', content: 'hola' } }),
      linea({ type: 'ai-title', aiTitle: 'Una sesion vacia', sessionId: 's1' }),
    ].join('\n')

    expect(buildSessionRollup(jsonl)).toBeNull()
  })

  it('devuelve null con un transcript vacio', () => {
    expect(buildSessionRollup('')).toBeNull()
  })

  // Una sesion larga no puede entrar entera: hay un tope de 1 MB por observacion del lado
  // del servicio, y una memoria de 200 prompts no la lee nadie.
  it('acota una sesion larga en vez de guardar todo', () => {
    const jsonl = Array.from({ length: 200 }, (_, i) => USUARIO(`prompt numero ${i} `.repeat(50))).join('\n')

    const r = buildSessionRollup(jsonl)
    expect(r).not.toBeNull()
    expect(r!.content.length).toBeLessThan(20_000)
    // Los ULTIMOS son los que dicen donde quedaste, asi que son los que sobreviven.
    expect(r!.content).toContain('prompt numero 199')
  })
})
