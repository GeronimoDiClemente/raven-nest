// El nombre que ve una persona para el proyecto de una memoria.
//
// `__global__` es la clave interna de las memorias que no están atadas a ningún repo (las que
// se crean con New memory sin vincular uno, o las que guarda un agente fuera de un repo), y
// no debe llegar a la pantalla tal cual. «Global» dice «vale en todos lados», que es lo que
// significa ese proyecto.
//
// La clave se mira ANTES que el nombre guardado: main.ts registra ese proyecto con la clave
// como `display_name`, así que con un `displayName ?? projectKey` seguiría saliendo igual.
const CLAVE_GLOBAL = '__global__'

export function nombreDeProyecto(projectKey: string, displayName: string | null | undefined): string {
  if (projectKey === CLAVE_GLOBAL) return 'Global'
  return displayName ?? projectKey
}
