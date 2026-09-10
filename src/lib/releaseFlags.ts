// Flags de RELEASE, no de runtime: se cambian en el código y se rebuildea — a
// diferencia de `window.appFlags` (src/types.ts), que el main process arma para
// bypass de e2e y plan simulado y que un build de producción no puede leer para
// decidir qué compilar.
//
// Integrations y Orchestration (el board de graph orchestration) no salen en
// esta release — decisión del usuario, 2026-09-10. El hito 1 de integrations ya
// está terminado y commiteado (docs/INTEGRATIONS_ORCA_BACKLOG.md tiene el resto
// del plan); esto no borra nada, solo apaga el punto de entrada en la sidebar.
//
// Para prenderlo: poner esta constante en `true` y rebuildear.
export const ENABLE_INTEGRATIONS_ORCHESTRATION = false
