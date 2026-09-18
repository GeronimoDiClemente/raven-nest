/**
 * Links estilo Obsidian dentro del texto de una memoria: `[[otra memoria]]`.
 *
 * La idea que copiamos: el autor AFIRMA la relación en el momento en que la tiene en la
 * cabeza, y cuesta dos corchetes. Después recuperar es caminar aristas en vez de buscar.
 * Las otras seis clases de arista del grafo se infieren de campos compartidos (mismo topic,
 * mismo tag, misma sesión); ésta, como la manual, es la que alguien dijo.
 *
 * El texto es la fuente de verdad y el índice se deriva — igual que en Obsidian, donde el
 * archivo manda y `resolvedLinks` es caché. Por eso esto es un parser puro: no toca la base
 * ni resuelve nombres, sólo dice qué nombres se mencionaron.
 */

/** Un fence de ``` abre y cierra; uno sin cerrar se considera abierto hasta el final. */
function sinBloquesDeCodigo(texto: string): string {
  const lineas = texto.split('\n')
  const salida: string[] = []
  let dentro = false
  for (const linea of lineas) {
    if (/^\s*```/.test(linea)) { dentro = !dentro; continue }
    salida.push(dentro ? '' : linea)
  }
  return salida.join('\n')
}

/** Código en línea con backticks: `[[ -f x ]]` es bash, no un link. */
function sinCodigoEnLinea(texto: string): string {
  return texto.replace(/`[^`\n]*`/g, '')
}

/**
 * Los nombres mencionados como `[[...]]`, en orden de aparición y sin repetir.
 *
 * Acepta las formas de Obsidian y se queda siempre con el DESTINO: `[[a|alias]]` → `a`,
 * `[[a#sección]]` → `a`, `[[a#^bloque]]` → `a`, y el embed `![[a]]` → `a`.
 *
 * Lo que se descarta antes de mirar nada es el código. Las memorias de este repo guardan
 * bash a mano llena y `[[ -n "$x" ]]` es sintaxis del shell: sin esta guarda, cada memoria
 * con un `if` se inventaría un link llamado `-n "$x"`.
 */
export function parsearWikilinks(texto: string): string[] {
  if (!texto) return []
  const limpio = sinCodigoEnLinea(sinBloquesDeCodigo(texto))
  const nombres: string[] = []
  const vistos = new Set<string>()
  // `[^\[\]]` en vez de `.`: sin eso un `[[a]] ... [[b]]` se toma como un solo match
  // gigante en cuanto aparece algo raro en el medio.
  for (const m of limpio.matchAll(/\[\[([^\[\]]+?)\]\]/g)) {
    const crudo = m[1]!
    // El destino es lo que va antes del primer `|` (alias) y del primer `#` (sección o
    // bloque). El orden no importa: cortamos por los dos.
    const destino = crudo.split('|')[0]!.split('#')[0]!.trim()
    if (!destino) continue
    const clave = destino.toLowerCase()
    if (vistos.has(clave)) continue
    vistos.add(clave)
    nombres.push(destino)
  }
  return nombres
}

/** Lo mínimo que hace falta de una memoria para resolver un nombre contra ella. */
export interface CandidatoMemoria {
  syncId: string
  title: string
  topicKey: string | null
  /** Los otros nombres que la memoria declaró para sí misma. Ver `parsearAlias`. */
  aliases?: string[]
}

/**
 * De un nombre escrito entre corchetes al `sync_id` al que apunta, o `null`.
 *
 * `null` NO es un error: es el link sin resolver de Obsidian. Es justamente lo que hace
 * barato linkear de más — podés apuntar a una memoria que todavía no escribiste, el link
 * queda marcando el hueco, y el día que esa memoria exista resuelve solo, porque acá no se
 * guarda ningún id: se resuelve por NOMBRE cada vez.
 *
 * El `topic_key` gana sobre el título porque es el identificador estable —el análogo del
 * nombre de archivo en un vault—, mientras que el título cambia cuando alguien reescribe
 * la memoria.
 */
export function resolverWikilink(nombre: string, candidatos: CandidatoMemoria[]): string | null {
  const buscado = nombre.trim().toLowerCase()
  if (!buscado) return null

  const porTopic = candidatos.filter((x) => (x.topicKey ?? '').trim().toLowerCase() === buscado)
  if (porTopic.length > 0) return masEstable(porTopic)

  // El ÚLTIMO tramo del topic, que es el análogo del nombre de archivo: en Obsidian
  // `[[nota]]` encuentra `carpeta/nota.md` sin que haga falta escribir la carpeta.
  //
  // No es teoría. Medido contra el corpus real el 2026-09-17: las 120 memorias vivas tienen
  // topic con prefijo de namespace del importador (`claude-memory/...`, `imported/...`) y
  // los 116 links ya escritos dicen el slug pelado. Sin esta regla no resolvía NINGUNO.
  const porTramo = candidatos.filter((x) => ultimoTramo(x.topicKey) === buscado)
  if (porTramo.length > 0) return masEstable(porTramo)

  // El alias va antes que el título porque es una DECLARACIÓN explícita del autor —"a esto
  // también llamale así"— mientras que el título es prosa y cambia cuando alguien reescribe.
  const porAlias = candidatos.filter((x) => (x.aliases ?? []).some((a) => a.trim().toLowerCase() === buscado))
  if (porAlias.length > 0) return masEstable(porAlias)

  const porTitulo = candidatos.filter((x) => x.title.trim().toLowerCase() === buscado)
  if (porTitulo.length > 0) return masEstable(porTitulo)

  return null
}

function ultimoTramo(topicKey: string | null): string {
  const t = (topicKey ?? '').trim().toLowerCase()
  return t.slice(t.lastIndexOf('/') + 1)
}

/**
 * Con varios empatados hay que elegir uno SIEMPRE IGUAL: si el desempate dependiera del
 * orden en que vino la consulta, el grafo cambiaría de forma entre dos lecturas idénticas.
 */
function masEstable(filas: CandidatoMemoria[]): string {
  return filas.map((x) => x.syncId).sort()[0]!
}

/**
 * Los alias que una memoria declara para sí misma, en un frontmatter al principio del texto.
 *
 * Es el `aliases:` de Obsidian, y va en el CONTENIDO por la misma razón que los links: el
 * texto es la fuente de verdad y el índice se deriva. Meter una columna nueva habría obligado
 * a una migración de esquema que arrastra el mutation_log, el protocolo de sync y el camino
 * de cifrado — mucho costo para lo que es, en el fondo, otro nombre.
 *
 * Formas aceptadas, que son las que alguien escribe de verdad:
 *
 *     ---                    ---                    ---
 *     aliases: uno, dos      aliases: [uno, dos]    aliases:
 *     ---                    ---                      - uno
 *                                                     - dos
 *                                                   ---
 *
 * El bloque tiene que abrir en la PRIMERA línea y cerrar: sin eso, cualquier memoria que
 * explique qué es un alias —y hay varias en este repo— se autodeclararía uno.
 */
/**
 * Cuántos caracteres del principio del contenido alcanzan para encontrar el frontmatter.
 *
 * Quien resuelve nombres necesita los alias de TODAS las candidatas, y traer el texto entero
 * de cada una para eso sería absurdo. El frontmatter va al principio por definición, así que
 * un prefijo acotado alcanza — y deja el costo fijo por fila en vez de proporcional al largo.
 */
export const CHARS_DE_FRONTMATTER = 512

export function parsearAlias(contenido: string): string[] {
  if (!contenido) return []
  const lineas = contenido.split('\n')
  if (lineas[0]?.trim() !== '---') return []
  const cierre = lineas.findIndex((l, i) => i > 0 && l.trim() === '---')
  if (cierre === -1) return []

  const nombres: string[] = []
  for (let i = 1; i < cierre; i++) {
    // `alias(?:es)?` y no `aliases?`: el `?` se aplica a la letra anterior, así que
    // `aliases?` es "aliase" con la "s" opcional — nunca matchea "alias".
    const m = /^\s*alias(?:es)?\s*:\s*(.*)$/i.exec(lineas[i]!)
    if (!m) continue
    const resto = m[1]!.trim()
    if (resto) {
      // `uno, dos` o `[uno, dos]` — los corchetes de YAML son decoración acá.
      nombres.push(...resto.replace(/^\[|\]$/g, '').split(','))
    } else {
      // Clave sola: los valores vienen abajo como lista de guiones, hasta la próxima clave.
      for (let j = i + 1; j < cierre; j++) {
        const item = /^\s*-\s+(.*)$/.exec(lineas[j]!)
        if (!item) break
        nombres.push(item[1]!)
      }
    }
  }

  const limpios: string[] = []
  const vistos = new Set<string>()
  for (const crudo of nombres) {
    const n = crudo.trim().replace(/^["']|["']$/g, '').trim()
    if (!n) continue
    const clave = n.toLowerCase()
    if (vistos.has(clave)) continue
    vistos.add(clave)
    limpios.push(n)
  }
  return limpios
}
