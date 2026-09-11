// El punto de entrada DIFERIDO al render 3D.
//
// `Graph3D` es el único archivo que importa `react-force-graph-3d`, y eso son 1.37 MB
// crudos. Medido el 2026-09-11: importarlo arriba suma 1379.8 KB al chunk del arranque;
// detrás de un `import()` suma 1.4 KB.
//
// Este módulo existe porque hay DOS consumidores y uno de ellos —`TeamThreadGraph`— cuelga
// de un import estático (`MemoriesWorkspace` → `TeamThreadPanel` → `TeamThreadGraph`). Un
// `import Graph3D from './Graph3D'` ahí adentro devolvería los 1.37 MB al arranque sin que
// nadie lo note. El grafo de memorias no lo necesita: ya se carga a través de su propio
// `lazy()`.
//
// La promesa es una sola para toda la app, así el prefetch y el `lazy` comparten el módulo:
// precargar de verdad evita la espera en vez de duplicar la descarga. Mismo patrón que
// `monacoSetupPromise` en `EditorPane.tsx:35`.
import { lazy } from 'react'

let promesa: Promise<typeof import('./Graph3D')> | null = null

function cargar() {
  promesa ??= import('./Graph3D')
  return promesa
}

/** Dispara la descarga sin montar nada. Se llama al abrir una pantalla que puede llegar a
 *  mostrar un grafo, para que el chunk viaje mientras el usuario mira otra cosa. */
export function prefetchGraph3D(): void {
  void cargar()
}

export const LazyGraph3D = lazy(cargar)
