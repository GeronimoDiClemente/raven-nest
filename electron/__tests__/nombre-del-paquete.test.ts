import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * El nombre del paquete sale de UNA constante (ruling de la revisión de seguridad del Task 9):
 * el renderer no puede importar de `electron/`, así que hay un espejo en `src/lib/` y lo único
 * que los mantiene iguales es este test. Se leen como TEXTO —no se importan como módulos— para
 * no mezclar los dos tsconfig (node/web) adentro de un test que no necesita ejecutar nada de
 * ninguno de los dos lados.
 */
const raiz = join(__dirname, '..', '..')

function constanteDePaquete(path: string): string {
  const fuente = readFileSync(path, 'utf8')
  const m = /export const NOMBRE_DEL_PAQUETE = '([^']+)'/.exec(fuente)
  if (!m) throw new Error(`no encontré NOMBRE_DEL_PAQUETE en ${path}`)
  return m[1]!
}

describe('el nombre del paquete sale de una sola constante', () => {
  const deElectron = constanteDePaquete(join(raiz, 'electron', 'nombre-del-paquete.ts'))
  const deRenderer = constanteDePaquete(join(raiz, 'src', 'lib', 'nombre-del-paquete.ts'))

  it('electron/ y el espejo en src/lib/ dicen lo mismo', () => {
    expect(deElectron).toBe(deRenderer)
  })

  it('coincide con el "name" publicado en packages/nest-memory/package.json', () => {
    const pkg = JSON.parse(
      readFileSync(join(raiz, 'packages', 'nest-memory', 'package.json'), 'utf8'),
    ) as { name: string }
    expect(deElectron).toBe(pkg.name)
    expect(deRenderer).toBe(pkg.name)
  })

  it('es el scope de la marca, no el nombre viejo que se confundía con NestJS', () => {
    expect(deElectron).toBe('@nestmux/memory')
  })
})
