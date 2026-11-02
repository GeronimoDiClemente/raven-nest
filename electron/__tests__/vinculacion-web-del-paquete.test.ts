import { describe, it, expect, vi } from 'vitest'
import {
  BASE_WEB_POR_DEFECTO, webDelPaquete, urlDeVinculacion, urlDeUpgrade, textoDeVinculacion,
  cuerpoDeInicio, hayDondeAbrir, comandoParaAbrir, abrirNavegador, iniciarVinculacion,
  type ProcesoLanzado, type DepsDeInicio,
} from '../vinculacion-web-del-paquete'

describe('la base de la página', () => {
  it('sin env es nestmux.com; con env, la del env sin barra final', () => {
    expect(webDelPaquete(undefined)).toBe(BASE_WEB_POR_DEFECTO)
    expect(BASE_WEB_POR_DEFECTO).toBe('https://nestmux.com')
    expect(webDelPaquete('http://localhost:4321/')).toBe('http://localhost:4321')
  })

  it('un env que no es http(s) se ignora: no se abre un file: ni un javascript:', () => {
    expect(webDelPaquete('javascript:alert(1)')).toBe(BASE_WEB_POR_DEFECTO)
    expect(webDelPaquete('file:///etc/passwd')).toBe(BASE_WEB_POR_DEFECTO)
  })
})

describe('el link y el texto del login', () => {
  it('el link lleva el código como ?code=', () => {
    expect(urlDeVinculacion('https://nestmux.com', 'WXYZ-1234')).toBe('https://nestmux.com/link?code=WXYZ-1234')
    expect(urlDeUpgrade('https://nestmux.com')).toBe('https://nestmux.com/upgrade')
  })

  it('el texto es el del spec, con el código y los minutos', () => {
    expect(textoDeVinculacion({ url: 'https://nestmux.com/link?code=WXYZ-1234', codigo: 'WXYZ-1234', venceEnSeg: 600 })).toEqual([
      'To connect this machine, open:',
      '  https://nestmux.com/link?code=WXYZ-1234',
      'and sign in with your Nest account. Code: WXYZ-1234 (expires in 10 minutes)',
    ])
    expect(textoDeVinculacion({ url: 'u', codigo: 'c', venceEnSeg: 60 })[2]).toMatch(/expires in 1 minute\)$/)
  })

  it('al arrancar manda el nombre y la plataforma', () => {
    expect(cuerpoDeInicio('gero-laptop', 'darwin')).toEqual({ name: 'gero-laptop', platform: 'darwin' })
  })
})

describe('abrir el navegador', () => {
  it('por SSH o en un Linux sin pantalla no intenta', () => {
    expect(hayDondeAbrir({ SSH_CONNECTION: '1.2.3.4 22 5.6.7.8 22' }, 'darwin')).toBe(false)
    expect(hayDondeAbrir({ SSH_TTY: '/dev/pts/0' }, 'win32')).toBe(false)
    expect(hayDondeAbrir({}, 'linux')).toBe(false)
    expect(hayDondeAbrir({ DISPLAY: ':0' }, 'linux')).toBe(true)
    expect(hayDondeAbrir({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux')).toBe(true)
    expect(hayDondeAbrir({}, 'darwin')).toBe(true)
  })

  it('un comando por sistema, sin shell: la URL va como argumento suelto', () => {
    const url = 'https://nestmux.com/link?code=WXYZ-1234'
    expect(comandoParaAbrir('win32', url)).toEqual({ cmd: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] })
    expect(comandoParaAbrir('darwin', url)).toEqual({ cmd: 'open', args: [url] })
    expect(comandoParaAbrir('linux', url)).toEqual({ cmd: 'xdg-open', args: [url] })
  })

  it('lanza desacoplado y escucha el error para que no tumbe el proceso', () => {
    const on = vi.fn()
    const unref = vi.fn()
    const lanzar = vi.fn((): ProcesoLanzado => ({ on, unref }))
    expect(abrirNavegador('https://x', 'darwin', lanzar)).toBe(true)
    expect(lanzar).toHaveBeenCalledWith('open', ['https://x'])
    expect(on).toHaveBeenCalledWith('error', expect.any(Function))
    expect(unref).toHaveBeenCalled()
    // El error asíncrono (no hay xdg-open) se traga: el link ya está impreso.
    expect(() => (on.mock.calls[0]![1] as (e: Error) => void)(new Error('ENOENT'))).not.toThrow()
  })

  it('si el abridor tira, devuelve false y no lanza: el login sigue esperando', () => {
    const lanzar = vi.fn((): ProcesoLanzado => { throw new Error('spawn EACCES') })
    expect(abrirNavegador('https://x', 'linux', lanzar)).toBe(false)
  })
})

describe('iniciarVinculacion: el cableado del login', () => {
  const respuesta = (cuerpo: unknown, ok = true, status = 200) =>
    ({ ok, status, json: async () => cuerpo }) as Response
  const armar = (extra: Partial<DepsDeInicio> = {}) => {
    const impreso: string[] = []
    const fetchFalso = vi.fn(async () => respuesta({ user_code: 'WXYZ-1234', device_code: 'dev', expires_in: 600, interval: 2 }))
    const abrir = vi.fn()
    const deps: DepsDeInicio = {
      base: 'https://sync.test', baseWeb: 'https://nestmux.com', nombre: 'gero-laptop', plataforma: 'darwin',
      env: {}, fetch: fetchFalso as unknown as typeof fetch, abrir, imprimir: (l) => impreso.push(l), tenue: (t) => t,
      ...extra,
    }
    return { deps, impreso, fetchFalso, abrir }
  }

  it('manda nombre y plataforma, imprime el link con el código y abre ese link', async () => {
    const { deps, impreso, fetchFalso, abrir } = armar()
    const r = await iniciarVinculacion(deps)
    const [url, init] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://sync.test/v1/link/start')
    expect(JSON.parse(init.body as string)).toEqual({ name: 'gero-laptop', platform: 'darwin' })
    expect(impreso.join('\n')).toContain('https://nestmux.com/link?code=WXYZ-1234')
    expect(abrir).toHaveBeenCalledWith('https://nestmux.com/link?code=WXYZ-1234')
    expect(r).toMatchObject({ ok: true, codigo: 'WXYZ-1234', deviceCode: 'dev' })
  })

  it('si el abridor tira, igual devuelve el arranque: el login sigue esperando', async () => {
    const { deps } = armar({ abrir: () => { throw new Error('spawn EACCES') } })
    await expect(iniciarVinculacion(deps)).resolves.toMatchObject({ ok: true, deviceCode: 'dev' })
  })

  it('sin pantalla (SSH) imprime el link pero no abre nada', async () => {
    const { deps, impreso, abrir } = armar({ env: { SSH_CONNECTION: 'x' } })
    await iniciarVinculacion(deps)
    expect(abrir).not.toHaveBeenCalled()
    expect(impreso.join('\n')).toContain('/link?code=WXYZ-1234')
  })

  it('un rechazo HTTP o una respuesta ilegible se devuelven sin imprimir ni abrir', async () => {
    const a = armar({ fetch: (async () => respuesta({}, false, 503)) as unknown as typeof fetch })
    expect(await iniciarVinculacion(a.deps)).toEqual({ ok: false, motivo: 'http', status: 503 })
    const b = armar({ fetch: (async () => respuesta({ user_code: 'X' })) as unknown as typeof fetch })
    expect(await iniciarVinculacion(b.deps)).toEqual({ ok: false, motivo: 'ilegible' })
    expect(a.impreso.length + b.impreso.length).toBe(0)
    expect(a.abrir).not.toHaveBeenCalled()
  })
})
