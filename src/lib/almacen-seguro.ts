// localStorage puede tirar (perfil sin storage, cuota) o volver vacío: nada de lo que se
// guarda acá es indispensable, así que un fallo vuelve al valor por defecto y listo.
export function leer(clave: string): string | null {
  try { return window.localStorage.getItem(clave) } catch { return null }
}
export function escribir(clave: string, valor: string): void {
  try { window.localStorage.setItem(clave, valor) } catch { /* sin storage: se pierde la preferencia */ }
}
export const almacenDePaneles = { getItem: leer, setItem: escribir }
