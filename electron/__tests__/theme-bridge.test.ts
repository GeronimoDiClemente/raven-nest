import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, readdirSync } from 'fs'
import { join } from 'path'
import AdmZip from 'adm-zip'
import { makeTmpDir, cleanupTmp } from './setup'
import {
  listInstalledThemes,
  saveInstalledTheme,
  deleteInstalledTheme,
  scanVSCodeThemes,
  importVSCodeTheme,
  searchOpenVSX,
  installOpenVSX,
  type FetchLike,
} from '../theme-bridge'

const dracula = {
  name: 'Dracula',
  type: 'dark',
  colors: { 'editor.background': '#282a36' },
  tokenColors: [{ scope: 'comment', settings: { foreground: '#6272a4' } }],
}

describe('installed themes store', () => {
  let themesDir: string

  beforeEach(() => { themesDir = join(makeTmpDir('themes-'), 'themes') })
  afterEach(() => { cleanupTmp(join(themesDir, '..')) })

  it('saves a theme and lists it back with slug name and display name', async () => {
    const saved = await saveInstalledTheme(themesDir, 'Dracula', dracula)
    expect(saved.ok).toBe(true)
    if (saved.ok) expect(saved.name).toBe('dracula')

    const listed = await listInstalledThemes(themesDir)
    expect(listed).toHaveLength(1)
    expect(listed[0].name).toBe('dracula')
    expect(listed[0].displayName).toBe('Dracula')
    expect(listed[0].isDark).toBe(true)
    expect(listed[0].theme.colors?.['editor.background']).toBe('#282a36')
  })

  it('lists an empty array when the dir does not exist yet', async () => {
    expect(await listInstalledThemes(themesDir)).toEqual([])
  })

  it('skips a corrupt installed theme instead of failing the whole list', async () => {
    await saveInstalledTheme(themesDir, 'Dracula', dracula)
    writeFileSync(join(themesDir, 'broken.json'), 'no es json {')
    const listed = await listInstalledThemes(themesDir)
    expect(listed).toHaveLength(1)
    expect(listed[0].name).toBe('dracula')
  })

  it('rejects saving something that is not a theme', async () => {
    const res = await saveInstalledTheme(themesDir, 'Nope', { 'editor.fontSize': 12 } as never)
    expect(res.ok).toBe(false)
  })

  it('deletes an installed theme by slug', async () => {
    await saveInstalledTheme(themesDir, 'Dracula', dracula)
    const res = await deleteInstalledTheme(themesDir, 'dracula')
    expect(res.ok).toBe(true)
    expect(await listInstalledThemes(themesDir)).toEqual([])
  })

  it('rejects delete names that are not plain slugs (path traversal)', async () => {
    for (const evil of ['../evil', 'a/b', 'a\\b', '..']) {
      const res = await deleteInstalledTheme(themesDir, evil)
      expect(res.ok).toBe(false)
    }
  })
})

describe('scanVSCodeThemes', () => {
  let homeDir: string

  beforeEach(() => { homeDir = makeTmpDir('vscode-home-') })
  afterEach(() => { cleanupTmp(homeDir) })

  function writeExtension(dirName: string, pkg: unknown) {
    const dir = join(homeDir, '.vscode', 'extensions', dirName)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), typeof pkg === 'string' ? pkg : JSON.stringify(pkg))
    return dir
  }

  it('returns contributed themes with label and absolute path', async () => {
    const extDir = writeExtension('acme.dark-theme-1.0.0', {
      name: 'dark-theme',
      contributes: {
        themes: [
          { label: 'Acme Dark', uiTheme: 'vs-dark', path: './themes/acme-dark.json' },
          { label: 'Acme Light', uiTheme: 'vs', path: './themes/acme-light.json' },
        ],
      },
    })
    writeExtension('acme.not-a-theme-2.0.0', { name: 'not-a-theme', contributes: { commands: [] } })
    writeExtension('acme.broken-0.1.0', 'esto no es json')

    const res = await scanVSCodeThemes(homeDir)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.themes).toHaveLength(2)
      expect(res.themes[0].label).toBe('Acme Dark')
      expect(res.themes[0].path).toBe(join(extDir, 'themes', 'acme-dark.json'))
    }
  })

  it('fails with an actionable error when there is no extensions dir', async () => {
    const res = await scanVSCodeThemes(homeDir)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/VS Code/)
  })
})

describe('importVSCodeTheme', () => {
  let homeDir: string
  let themesDir: string

  beforeEach(() => {
    homeDir = makeTmpDir('vscode-import-')
    themesDir = join(homeDir, 'installed-themes')
  })
  afterEach(() => { cleanupTmp(homeDir) })

  it('copies a theme JSON (JSONC tolerated) into the installed dir', async () => {
    const src = join(homeDir, 'acme-dark.json')
    writeFileSync(src, `{
      // tema de prueba
      "name": "Acme Dark",
      "colors": { "editor.background": "#101010", },
      "tokenColors": [],
    }`)
    const res = await importVSCodeTheme(themesDir, src)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.name).toBe('acme-dark')
    const listed = await listInstalledThemes(themesDir)
    expect(listed[0].displayName).toBe('Acme Dark')
  })

  it('fails on a file that is not a theme', async () => {
    const src = join(homeDir, 'settings.json')
    writeFileSync(src, JSON.stringify({ 'editor.fontSize': 14 }))
    const res = await importVSCodeTheme(themesDir, src)
    expect(res.ok).toBe(false)
  })

  it('fails on a missing file', async () => {
    const res = await importVSCodeTheme(themesDir, join(homeDir, 'nope.json'))
    expect(res.ok).toBe(false)
  })
})

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

describe('searchOpenVSX', () => {
  it('queries the Open VSX search API filtered to themes and maps results', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      extensions: [
        { namespace: 'dracula-theme', name: 'theme-dracula', displayName: 'Dracula Official', description: 'the theme' },
      ],
    })) as unknown as FetchLike
    const res = await searchOpenVSX('dracula', fetchMock)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.results).toEqual([
        { namespace: 'dracula-theme', name: 'theme-dracula', displayName: 'Dracula Official', description: 'the theme' },
      ])
    }
    const url = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(url).toContain('open-vsx.org/api/-/search')
    expect(url).toContain('query=dracula')
    expect(url).toContain('category=Themes')
  })

  it('returns an inline error on network failure (no crash, retry allowed)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline')) as unknown as FetchLike
    const res = await searchOpenVSX('dracula', fetchMock)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/Open VSX/)
  })

  it('returns an inline error on a non-200 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ...jsonResponse({}), ok: false, status: 502 }) as unknown as FetchLike
    const res = await searchOpenVSX('dracula', fetchMock)
    expect(res.ok).toBe(false)
  })
})

describe('installOpenVSX', () => {
  let themesDir: string

  beforeEach(() => { themesDir = join(makeTmpDir('openvsx-'), 'themes') })
  afterEach(() => { cleanupTmp(join(themesDir, '..')) })

  // Un .vsix es un zip: package.json de la extensión + assets bajo extension/.
  // Se arma acá mismo con adm-zip — nada de fixtures binarios en el repo.
  function makeVsix(withThemes: boolean): Buffer {
    const zip = new AdmZip()
    const pkg = {
      name: 'acme-theme',
      contributes: withThemes
        ? { themes: [{ label: 'Acme Dark', uiTheme: 'vs-dark', path: './themes/acme-dark.json' }] }
        : { commands: [] },
    }
    zip.addFile('extension/package.json', Buffer.from(JSON.stringify(pkg)))
    if (withThemes) {
      zip.addFile('extension/themes/acme-dark.json', Buffer.from(JSON.stringify({
        name: 'Acme Dark',
        type: 'dark',
        colors: { 'editor.background': '#101010' },
        tokenColors: [],
      })))
    }
    // JS malicioso/da igual: JAMÁS debe ejecutarse ni persistirse
    zip.addFile('extension/extension.js', Buffer.from('process.exit(1)'))
    return zip.toBuffer()
  }

  function makeFetch(vsix: Buffer) {
    return vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('.vsix') || url.includes('/file/')) {
        return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => vsix.buffer.slice(vsix.byteOffset, vsix.byteOffset + vsix.byteLength) }
      }
      return jsonResponse({ files: { download: 'https://open-vsx.org/api/acme/acme-theme/file/acme.vsix' } })
    }) as unknown as FetchLike
  }

  it('downloads the vsix and installs ONLY the contributed theme JSONs', async () => {
    const res = await installOpenVSX(themesDir, 'acme', 'acme-theme', makeFetch(makeVsix(true)))
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.installed).toEqual(['acme-dark'])

    const listed = await listInstalledThemes(themesDir)
    expect(listed).toHaveLength(1)
    expect(listed[0].displayName).toBe('Acme Dark')
    // el JS de la extensión no se persiste bajo ninguna forma
    const files = readdirSync(themesDir)
    expect(files.every((f) => f.endsWith('.json'))).toBe(true)
  })

  it('fails with an inline error when the extension has no themes', async () => {
    const res = await installOpenVSX(themesDir, 'acme', 'acme-theme', makeFetch(makeVsix(false)))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/color themes/)
  })

  it('fails with an inline error on network failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline')) as unknown as FetchLike
    const res = await installOpenVSX(themesDir, 'acme', 'acme-theme', fetchMock)
    expect(res.ok).toBe(false)
  })
})
