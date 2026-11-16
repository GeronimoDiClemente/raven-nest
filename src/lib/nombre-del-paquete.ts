// Espejo de `electron/nombre-del-paquete.ts` para el renderer, que no puede importar nada de
// `electron/` (tsconfig.web no lo permite). `electron/__tests__/nombre-del-paquete.test.ts` lee
// los dos archivos como texto y falla si se desincronizan entre sí o contra
// `packages/nest-memory/package.json`.
export const NOMBRE_DEL_PAQUETE = '@nestmux/memory'

/** Cómo se le dice al usuario que corra un subcomando: `comando('login')` → `npx @nestmux/memory login`. */
export function comando(subcomando: string): string {
  return `npx ${NOMBRE_DEL_PAQUETE} ${subcomando}`
}
