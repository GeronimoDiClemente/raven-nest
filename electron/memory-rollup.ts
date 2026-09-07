/**
 * El resumen de una sesión, armado desde el transcript que la CLI ya escribió.
 *
 * Layer B (§5.2 de la arquitectura) era la deuda más grande del subsistema: `SessionStart`
 * sólo leía, **`Stop` no escribía nada** y `PreCompact` dejaba un placeholder que prometía
 * un rollup "on session close" que nunca llegaba. O sea que la memoria no capturaba lo que
 * decía capturar.
 *
 * **Sin LLM, a propósito.** Nest es BYOK y promete no medir el uso: gastar tokens del
 * usuario en cada cierre de sesión, en silencio, sería romper eso. Y no hace falta —
 * Claude Code ya escribe en el transcript un `ai-title` (un título generado de la sesión) y
 * los prompts. El resumen ya está hecho; lo único que faltaba era leerlo.
 *
 * El formato no está inferido de la documentación: sale de leer transcripts reales
 * (`{accountDir}/.claude/projects/<slug>/<sessionId>.jsonl`) el 2026-09-03. Igual todo el
 * parseo es tolerante: una línea que no entendemos se saltea, nunca tira la sesión entera.
 */

/** Cuántos prompts entran. Los últimos son los que dicen dónde quedaste. */
const MAX_PROMPTS = 20
/** Tope por prompt. Un pegote de 3000 líneas no aporta más que su principio. */
const MAX_PROMPT_CHARS = 600
const MAX_TITLE_CHARS = 120

interface LineaTranscript {
  type?: string
  isMeta?: boolean
  aiTitle?: string
  message?: { role?: string; content?: unknown }
}

/** El texto de un `message.content`, que puede ser un string o bloques. */
function textoDelContenido(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    // `tool_result` es salida de una herramienta, no lo que pidió el usuario. Guardarlo
    // sería llenar la memoria con stdout.
    .filter((b) => b && typeof b === 'object' && (b as { type?: string }).type === 'text')
    .map((b) => String((b as { text?: unknown }).text ?? ''))
    .join('\n')
}

export interface SessionRollup {
  title: string
  content: string
}

/**
 * Devuelve el resumen de la sesión, o `null` si no hay nada que recordar.
 *
 * Que devuelva `null` es una decisión, no un descuido: una memoria que dice "hubo una
 * sesión" es ruido, y el ruido en memoria es peor que el silencio porque se lo comen todas
 * las sesiones siguientes cuando piden contexto.
 */
export function buildSessionRollup(transcriptJsonl: string): SessionRollup | null {
  const prompts: string[] = []
  let aiTitle: string | null = null

  for (const linea of transcriptJsonl.split('\n')) {
    if (!linea.trim()) continue
    let d: LineaTranscript
    try {
      d = JSON.parse(linea) as LineaTranscript
    } catch {
      continue  // una línea rota no puede costar la sesión entera
    }

    // El último gana: es el que se generó con más contexto de la sesión.
    if (d.type === 'ai-title' && typeof d.aiTitle === 'string' && d.aiTitle.trim()) {
      aiTitle = d.aiTitle.trim()
      continue
    }

    if (d.type !== 'user') continue
    // `isMeta` marca lo que la CLI se inyecta a sí misma (el caveat de local-command, por
    // ejemplo). Es ruido de la herramienta, no del usuario.
    if (d.isMeta) continue

    const texto = textoDelContenido(d.message?.content).trim()
    if (!texto) continue
    prompts.push(texto.length > MAX_PROMPT_CHARS ? `${texto.slice(0, MAX_PROMPT_CHARS)}…` : texto)
  }

  if (prompts.length === 0) return null

  const ultimos = prompts.slice(-MAX_PROMPTS)
  const recortados = prompts.length - ultimos.length
  const encabezado = recortados > 0 ? `(${recortados} earlier prompts omitted)\n\n` : ''

  const title = aiTitle ?? prompts[0]
  return {
    title: title.length > MAX_TITLE_CHARS ? `${title.slice(0, MAX_TITLE_CHARS)}…` : title,
    content: `${encabezado}${ultimos.map((p) => `- ${p}`).join('\n')}`,
  }
}
