import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * El hueco de los semaforos de macOS.
 *
 * La barra de pestanas les reserva 72px fijos, que es correcto MIENTRAS estan: asi los
 * botones no se mueven nunca. Pero en pantalla completa macOS los esconde y ese hueco queda
 * vacio contra el borde izquierdo, con las pestanas arrancando a 72px de nada.
 *
 * Es un guard sobre el CSS y no sobre un render: la regla vive entre 12.000 lineas y se
 * rompe sin querer, y ahi no la ve nadie hasta que alguien abre en pantalla completa.
 */
const css = readFileSync(join(process.cwd(), 'src/styles/global.css'), 'utf8')

describe('el hueco de los semáforos', () => {
  it('con la ventana normal ocupa lugar: los botones no se mueven', () => {
    const i = css.indexOf('\n.tabbar-traffic-lights {')
    expect(i, 'la regla existe').toBeGreaterThan(0)
    expect(css.slice(i, css.indexOf('\n}', i))).toMatch(/width:\s*72px/)
  })

  it('en pantalla completa colapsa a cero', () => {
    const i = css.indexOf('.app.pantalla-completa .tabbar-traffic-lights {')
    expect(i, 'falta la regla de pantalla completa').toBeGreaterThan(0)
    expect(css.slice(i, css.indexOf('}', i))).toMatch(/width:\s*0/)
  })
})
