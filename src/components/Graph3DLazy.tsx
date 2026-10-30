// El punto de entrada DIFERIDO al render 3D.
//
// `Graph3D` es el único archivo que importa `react-force-graph-3d`, y eso son 1.37 MB
// crudos: importarlo arriba suma 1379.8 KB al chunk del arranque; detrás de un `import()`
// suma 1.4 KB.
//
// Este módulo existe porque hay DOS consumidores y uno de ellos —`TeamThreadGraph`— cuelga
// de un import estático (`MemoriesWorkspace` → `TeamThreadPanel` → `TeamThreadGraph`). Un
// `import Graph3D from './Graph3D'` ahí adentro devolvería los 1.37 MB al arranque sin que
// nada falle. El grafo de memorias no lo necesita: ya se carga a través de su propio
// `lazy()`.
import { lazy } from 'react'

export const LazyGraph3D = lazy(() => import('./Graph3D'))
