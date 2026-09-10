import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * `text-fs-*` (nuestra escala tipográfica — ver `@theme` en tailwind.css) usa el mismo
 * prefijo `text-` que un color de texto, y tailwind-merge por default la clasifica como
 * COLOR, no como font-size — confirmado: `twMerge('text-fs', 'text-muted-foreground')`
 * devolvía `'text-muted-foreground'`, comiéndose el tamaño en silencio porque dos
 * "colores" (uno de ellos en realidad un tamaño) entran en conflicto y tailwind-merge se
 * queda con el último. Encontrado en la review de la Task 8 (2026-09-10), con daño ya
 * vivo en TRES migraciones aprobadas: `TabBar.tsx:85` perdía `text-fs-sm`,
 * `Sidebar.tsx:377` perdía `text-fs`, y `ResourceBar.tsx:62` perdía `text-fs-sm` (este
 * último lo encontró el barrido del paso 5 de Task 8b, no la review original) — los
 * tres silenciosos porque nada mide el className final contra el fuente.
 *
 * El fix: registrar los siete escalones de `--fs-*` en el grupo real de tailwind-merge
 * (`font-size`, la misma clave que ya usa `text-base`/`text-sm`/etc.), así que
 * `text-fs-sm` deja de competir con `text-<color>` y sí compite -correctamente- con
 * `text-sm`/otro `text-fs-*` (dos tamaños siguen resolviendo al último, que es el
 * comportamiento que se quiere conservar).
 *
 * `src/__tests__/lib/cn-escala.test.ts` prueba las dos direcciones contra este `cn`,
 * contra un `twMerge` sin extender (para que quede registrado qué pasa sin el fix), y
 * contra el paquete `"cn"` (aliaseado a este módulo en `vitest.config.ts` y en
 * `electron.vite.config.ts` — ver los comentarios ahí) que es lo que usan los
 * componentes stock de `src/components/ui/`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['fs-2xs', 'fs-xs', 'fs-sm', 'fs', 'fs-lg', 'fs-xl', 'fs-2xl'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
