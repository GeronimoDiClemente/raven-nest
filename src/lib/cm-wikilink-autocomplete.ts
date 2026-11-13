// Al escribir `[[`, sugerir memorias por título, topic y alias. Inserta el TÍTULO, que es lo
// que main resuelve siempre (topic → último tramo → alias → título).
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'

export interface CandidatoDeLink { syncId: string; title: string; topicKey: string | null; aliases?: string[] }

export function fuenteDeWikilinks(candidatos: () => CandidatoDeLink[]) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/\[\[[^[\]\n]*$/)
    if (!m) return null
    const q = m.text.slice(2).toLowerCase()
    const opciones = candidatos()
      .filter((c) => [c.title, c.topicKey ?? '', ...(c.aliases ?? [])].some((s) => s.toLowerCase().includes(q)))
      .slice(0, 30)
      .map((c) => ({ label: c.title, detail: c.topicKey ?? undefined, apply: `${c.title}]]` }))
    return { from: m.from + 2, options: opciones, validFor: /^[^[\]\n]*$/ }
  }
}

export function autocompletadoDeWikilinks(candidatos: () => CandidatoDeLink[]): Extension {
  return autocompletion({ override: [fuenteDeWikilinks(candidatos)], icons: false })
}
