// La fuente única del nombre del paquete portátil publicado en npm.
//
// Decisión de Gero (2026-10-19): se publica como `@nestmux/memory` y no `nest-memory` — ese
// nombre se confunde con el ecosistema de NestJS. **No cambia** la carpeta `packages/nest-memory`,
// el directorio de datos `~/.nest-memory/` ni el nombre del servidor MCP (`nest_memory`, ver
// `NOMBRE_DEL_SERVIDOR` en `setup-del-paquete.ts`): son internos, y renombrarlos dejaría
// huérfanas las bases y credenciales que ya existen.
//
// Ruling de la revisión de seguridad: el comando tiene que salir de UNA sola constante para que
// la ayuda de la CLI y la UI no puedan divergir. El renderer (tsconfig.web, `src/**`) no puede
// importar de acá —no puede importar nada de `electron/`—, así que `src/lib/nombre-del-paquete.ts`
// es un espejo con el mismo valor. `electron/__tests__/nombre-del-paquete.test.ts` lee los dos
// archivos como texto y falla si se desincronizan entre sí o contra
// `packages/nest-memory/package.json`.
export const NOMBRE_DEL_PAQUETE = '@nestmux/memory'

/** Cómo se le dice al usuario que corra un subcomando: `comando('login')` → `npx @nestmux/memory login`. */
export function comando(subcomando: string): string {
  return `npx ${NOMBRE_DEL_PAQUETE} ${subcomando}`
}
