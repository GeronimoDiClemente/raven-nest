// La ventana principal sólo navega a su propia página (electron/navegacion-de-la-ventana.ts).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { esLaPaginaDeLaApp } from '../navegacion-de-la-ventana'

const EMPAQUETADA = 'file:///Applications/Nest.app/Contents/Resources/app.asar/dist/index.html'
const DEV = 'http://localhost:5173/'

describe('esLaPaginaDeLaApp', () => {
  it('empaquetada: la misma página, con o sin hash y query', () => {
    expect(esLaPaginaDeLaApp(EMPAQUETADA, EMPAQUETADA)).toBe(true)
    expect(esLaPaginaDeLaApp(`${EMPAQUETADA}#/settings`, EMPAQUETADA)).toBe(true)
    expect(esLaPaginaDeLaApp(`${EMPAQUETADA}?x=1`, EMPAQUETADA)).toBe(true)
  })

  it('el ataque de la auditoría: un .html arrastrado desde Descargas no carga el bridge', () => {
    expect(esLaPaginaDeLaApp('file:///Users/x/Downloads/evil.html', EMPAQUETADA)).toBe(false)
    expect(esLaPaginaDeLaApp('file:///Applications/Nest.app/Contents/Resources/app.asar/dist/otra.html', EMPAQUETADA)).toBe(false)
  })

  it('un link arrastrado (http, https, data, javascript) no navega la ventana', () => {
    for (const url of ['https://evil.example/', 'http://localhost:5173/', 'data:text/html,<script>1</script>', 'javascript:alert(1)']) {
      expect(esLaPaginaDeLaApp(url, EMPAQUETADA)).toBe(false)
    }
  })

  it('desarrollo: el mismo origen de Vite, cualquier ruta; otro puerto u host no', () => {
    expect(esLaPaginaDeLaApp('http://localhost:5173/index.html', DEV)).toBe(true)
    expect(esLaPaginaDeLaApp('http://localhost:5174/', DEV)).toBe(false)
    expect(esLaPaginaDeLaApp('http://localhost.evil.example:5173/', DEV)).toBe(false)
    expect(esLaPaginaDeLaApp('file:///tmp/evil.html', DEV)).toBe(false)
  })

  it('lo que no parsea no pasa', () => {
    expect(esLaPaginaDeLaApp('no es una url', EMPAQUETADA)).toBe(false)
    expect(esLaPaginaDeLaApp(EMPAQUETADA, '')).toBe(false)
  })
})

describe('main.ts', () => {
  it('pone el guard en la ventana principal: will-navigate y will-redirect', () => {
    const src = readFileSync(resolve(__dirname, '../main.ts'), 'utf8')
    expect(src).toMatch(/win\.webContents\.on\('will-navigate'/)
    expect(src).toMatch(/win\.webContents\.on\('will-redirect'/)
  })
})
