/**
 * Ink se carga acá y en ningún otro lado.
 *
 * Ink 5 es sólo ESM y tiene top-level await en su grafo; el paquete compila a CommonJS y tsc
 * convierte un `import('ink')` en `require('ink')`, que revienta con ERR_REQUIRE_ASYNC_MODULE.
 * Por eso el `import()` se arma con `new Function`: tsc no lo ve y Node hace un import de
 * verdad. Los componentes piden `ink()` al dibujar, nunca `import ... from 'ink'`.
 *
 * El tipo sale con `resolution-mode: 'import'` porque bajo `moduleResolution: node` (el
 * tsconfig del paquete) `'ink'` no resuelve: su package.json sólo declara `exports`.
 */
export type Ink = typeof import('ink', { with: { 'resolution-mode': 'import' } })

let cargado: Ink | null = null
let cargando: Promise<Ink> | null = null

type Importar = (m: string) => Promise<unknown>

const importarNativo = new Function('m', 'return import(m)') as Importar

/**
 * `importar` existe por vitest: su runner evalúa los módulos en un contexto sin callback de
 * import dinámico, y ahí el `import()` de `new Function` tira «A dynamic import callback was
 * not specified». El test le pasa un `import()` de los suyos; el paquete usa siempre el nativo.
 */
export function cargarInk(importar: Importar = importarNativo): Promise<Ink> {
  if (cargado) return Promise.resolve(cargado)
  cargando ??= (importar('ink') as Promise<Ink>).then((m) => (cargado = m)).catch((err) => {
    cargando = null
    throw err
  })
  return cargando
}

export function ink(): Ink {
  if (!cargado) throw new Error('Ink not loaded — call cargarInk() first')
  return cargado
}
