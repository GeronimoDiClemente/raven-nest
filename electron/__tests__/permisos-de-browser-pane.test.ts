// Una página en un browser pane no recibe permisos sin pedirlos (electron/permisos-de-browser-pane.ts).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { esOrigenLocal, permisoDeBrowserPane } from '../permisos-de-browser-pane'

describe('esOrigenLocal', () => {
  it('localhost, *.localhost, 127.0.0.0/8 y ::1, con cualquier puerto', () => {
    for (const url of ['http://localhost:3000/', 'https://localhost', 'http://app.localhost:5173', 'http://127.0.0.1:8080/x', 'http://127.1.2.3', 'http://[::1]:3000/']) {
      expect(esOrigenLocal(url)).toBe(true)
    }
  })

  it('lo que sólo se parece a local no lo es', () => {
    for (const url of ['https://localhost.evil.example/', 'https://evil.example/?u=http://localhost', 'http://127.0.0.1.evil.example/', 'http://0.0.0.0:3000/', 'http://192.168.1.10/', 'data:text/html,hola', 'file:///tmp/x.html', 'no es una url', '']) {
      expect(esOrigenLocal(url)).toBe(false)
    }
  })
})

describe('permisoDeBrowserPane', () => {
  it('el ataque de la auditoría: una página remota no recibe cámara, micrófono ni ubicación', () => {
    for (const p of ['media', 'geolocation', 'notifications', 'clipboard-read', 'midi', 'midiSysex', 'idle-detection', 'window-management', 'display-capture', 'pointerLock', 'fullscreen', 'openExternal', 'unknown']) {
      expect(permisoDeBrowserPane(p, 'https://evil.example/')).toBe(false)
    }
  })

  it('la app local puede probar cámara, micrófono, ubicación, notificaciones y portapapeles', () => {
    for (const p of ['media', 'geolocation', 'notifications', 'clipboard-read', 'clipboard-sanitized-write']) {
      expect(permisoDeBrowserPane(p, 'http://localhost:3000/')).toBe(true)
    }
  })

  it('ni siquiera la local recibe lo que no está en la lista', () => {
    for (const p of ['midiSysex', 'display-capture', 'openExternal', 'idle-detection']) {
      expect(permisoDeBrowserPane(p, 'http://localhost:3000/')).toBe(false)
    }
  })

  it('escribir en el portapapeles (el botón "copy" de una doc) sí, para cualquiera', () => {
    expect(permisoDeBrowserPane('clipboard-sanitized-write', 'https://docs.example/')).toBe(true)
  })
})

describe('browser-pane-manager.ts', () => {
  it('pone el handler de pedidos, el de chequeo y el de dispositivos en la sesión del pane', () => {
    const src = readFileSync(resolve(__dirname, '../browser-pane-manager.ts'), 'utf8')
    expect(src).toMatch(/\.setPermissionRequestHandler\(/)
    expect(src).toMatch(/\.setPermissionCheckHandler\(/)
    expect(src).toMatch(/\.setDevicePermissionHandler\(/)
  })
})
