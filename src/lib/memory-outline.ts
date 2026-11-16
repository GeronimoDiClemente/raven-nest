// Los encabezados de una memoria, para saltar entre ellos. Ignora lo que está dentro de un
// bloque de código cercado: un `# comentario` de bash no es un título.
export interface EncabezadoDeOutline { nivel: number; texto: string; linea: number }

export function outlineDe(markdown: string): EncabezadoDeOutline[] {
  const out: EncabezadoDeOutline[] = []
  let enCodigo = false
  markdown.split('\n').forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) { enCodigo = !enCodigo; return }
    if (enCodigo) return
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l)
    if (m) out.push({ nivel: m[1].length, texto: m[2], linea: i + 1 })
  })
  return out
}
