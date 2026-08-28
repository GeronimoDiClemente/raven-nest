/**
 * Acumula todas las páginas que devuelva un fetcher paginado genérico.
 *
 * Nace del bug del 2026-08-28: `admin.auth.admin.listUsers({ perPage: 1000 })`
 * se llamaba **una sola vez**, asumiendo que ese `perPage` alcanzaba para
 * traer todo. GoTrue no lo respeta tal cual, así que la función devolvía
 * nada más que la primera página — en producción, 80 cuentas de 82 reales,
 * sin ningún aviso. El flag `truncado` de esa versión comparaba contra
 * `total`, un número que GoTrue sólo manda si viene el header `link`, y no
 * vino: un flag que depende de un header opcional no es una red de seguridad.
 *
 * Módulo puro a propósito: sin este archivo, la lógica de paginación vive
 * pegada a `Deno.serve` y a las credenciales de `index.ts`, y no hay forma de
 * testearla sin red. Acá el fetcher se inyecta — `index.ts` es el único que
 * sabe llamar a `listUsers`; este módulo sólo sabe acumular y decidir cuándo
 * cortar.
 */

export interface ResultadoPaginado<T> {
  items: T[]
  /**
   * true sólo cuando se llegó al `maxPaginas` sin ver una página vacía o
   * incompleta. Es la única señal de truncamiento que este módulo conoce de
   * verdad — no depende de `total` ni del header `link` de GoTrue.
   */
  truncado: boolean
}

/**
 * Pide páginas sucesivas (1-based, como `listUsers`) hasta agotar la fuente.
 *
 * El corte no depende de metadata del servidor: una página vacía, o con
 * menos elementos que el `perPage` pedido, es el final — un fetcher bien
 * comportado nunca devuelve menos de lo pedido si todavía queda algo más.
 *
 * `maxPaginas` es un tope de seguridad, no una expectativa: si se alcanza sin
 * ver ninguna de las dos señales de arriba, se corta ahí mismo y se marca
 * `truncado: true` para que quien llama pueda avisar. Sin este tope, un bug
 * del servidor que siempre devuelva una página llena colgaría la función en
 * un loop infinito.
 */
export async function paginarTodo<T>(
  fetchPagina: (page: number) => Promise<T[]>,
  perPage: number,
  maxPaginas = 50,
): Promise<ResultadoPaginado<T>> {
  const items: T[] = []
  for (let page = 1; page <= maxPaginas; page++) {
    const pagina = await fetchPagina(page)
    items.push(...pagina)
    if (pagina.length < perPage) {
      return { items, truncado: false }
    }
  }
  return { items, truncado: true }
}
