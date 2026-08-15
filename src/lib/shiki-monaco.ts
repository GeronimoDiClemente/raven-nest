// Tokenización TextMate real para el Monaco embebido, vía shiki +
// @shikijs/monaco. Todo es lazy y fine-grained: el core, el engine WASM y
// cada grammar/tema se importan on-demand para no engordar el bundle
// inicial. REGLA DE ORO: cualquier falla (WASM, grammar, tema, JSON roto)
// degrada al Monarch + vs-dark de Monaco — nunca un editor roto.
import type { HighlighterCore } from 'shiki/core'
import type { VSCodeThemeJson } from './theme-registry'
import type { InstalledThemeInfo } from '../types'

// Subconjunto de la API de monaco que se usa acá — evita acoplar este módulo
// al import runtime de 'monaco-editor' (llega como instancia desde onMount).
export interface MonacoTextModel {
  uri: { path: string }
  getValue: () => string
  setValue: (text: string) => void
}
export interface MonacoLike {
  editor: {
    setTheme: (name: string) => void
    getModels: () => MonacoTextModel[]
    setModelLanguage: (model: MonacoTextModel, lang: string) => void
  }
}

export interface BundledThemeInfo {
  name: string        // id shiki == slug persistido en editorTheme
  displayName: string
  isDark: boolean
}

// Pack bundleado (~15 temas conocidos de shiki). Cada loader es un dynamic
// import propio → chunk separado, se descarga solo al seleccionarlo.
export const BUNDLED_THEMES: BundledThemeInfo[] = [
  { name: 'dracula', displayName: 'Dracula', isDark: true },
  { name: 'monokai', displayName: 'Monokai', isDark: true },
  { name: 'nord', displayName: 'Nord', isDark: true },
  { name: 'github-dark', displayName: 'GitHub Dark', isDark: true },
  { name: 'github-light', displayName: 'GitHub Light', isDark: false },
  { name: 'one-dark-pro', displayName: 'One Dark Pro', isDark: true },
  { name: 'one-light', displayName: 'One Light', isDark: false },
  { name: 'catppuccin-mocha', displayName: 'Catppuccin Mocha', isDark: true },
  { name: 'catppuccin-latte', displayName: 'Catppuccin Latte', isDark: false },
  { name: 'tokyo-night', displayName: 'Tokyo Night', isDark: true },
  { name: 'solarized-dark', displayName: 'Solarized Dark', isDark: true },
  { name: 'solarized-light', displayName: 'Solarized Light', isDark: false },
  { name: 'vitesse-dark', displayName: 'Vitesse Dark', isDark: true },
  { name: 'vitesse-light', displayName: 'Vitesse Light', isDark: false },
  { name: 'material-theme-ocean', displayName: 'Material Ocean', isDark: true },
  { name: 'gruvbox-dark-medium', displayName: 'Gruvbox Dark', isDark: true },
]

// Vite solo code-splitea dynamic imports analizables — un template string
// sobre node_modules no lo es. Por eso el mapa estático de loaders.
const BUNDLED_THEME_LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
  'dracula': () => import('@shikijs/themes/dracula'),
  'monokai': () => import('@shikijs/themes/monokai'),
  'nord': () => import('@shikijs/themes/nord'),
  'github-dark': () => import('@shikijs/themes/github-dark'),
  'github-light': () => import('@shikijs/themes/github-light'),
  'one-dark-pro': () => import('@shikijs/themes/one-dark-pro'),
  'one-light': () => import('@shikijs/themes/one-light'),
  'catppuccin-mocha': () => import('@shikijs/themes/catppuccin-mocha'),
  'catppuccin-latte': () => import('@shikijs/themes/catppuccin-latte'),
  'tokyo-night': () => import('@shikijs/themes/tokyo-night'),
  'solarized-dark': () => import('@shikijs/themes/solarized-dark'),
  'solarized-light': () => import('@shikijs/themes/solarized-light'),
  'vitesse-dark': () => import('@shikijs/themes/vitesse-dark'),
  'vitesse-light': () => import('@shikijs/themes/vitesse-light'),
  'material-theme-ocean': () => import('@shikijs/themes/material-theme-ocean'),
  'gruvbox-dark-medium': () => import('@shikijs/themes/gruvbox-dark-medium'),
}

const LANG_LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
  'typescript': () => import('@shikijs/langs/typescript'),
  'tsx': () => import('@shikijs/langs/tsx'),
  'javascript': () => import('@shikijs/langs/javascript'),
  'jsx': () => import('@shikijs/langs/jsx'),
  'json': () => import('@shikijs/langs/json'),
  'jsonc': () => import('@shikijs/langs/jsonc'),
  'css': () => import('@shikijs/langs/css'),
  'scss': () => import('@shikijs/langs/scss'),
  'less': () => import('@shikijs/langs/less'),
  'html': () => import('@shikijs/langs/html'),
  'markdown': () => import('@shikijs/langs/markdown'),
  'python': () => import('@shikijs/langs/python'),
  'go': () => import('@shikijs/langs/go'),
  'rust': () => import('@shikijs/langs/rust'),
  'java': () => import('@shikijs/langs/java'),
  'c': () => import('@shikijs/langs/c'),
  'cpp': () => import('@shikijs/langs/cpp'),
  'csharp': () => import('@shikijs/langs/csharp'),
  'ruby': () => import('@shikijs/langs/ruby'),
  'php': () => import('@shikijs/langs/php'),
  'shellscript': () => import('@shikijs/langs/shellscript'),
  'powershell': () => import('@shikijs/langs/powershell'),
  'yaml': () => import('@shikijs/langs/yaml'),
  'toml': () => import('@shikijs/langs/toml'),
  'xml': () => import('@shikijs/langs/xml'),
  'sql': () => import('@shikijs/langs/sql'),
  'vue': () => import('@shikijs/langs/vue'),
  'svelte': () => import('@shikijs/langs/svelte'),
  'swift': () => import('@shikijs/langs/swift'),
  'kotlin': () => import('@shikijs/langs/kotlin'),
  'dart': () => import('@shikijs/langs/dart'),
  'lua': () => import('@shikijs/langs/lua'),
  'graphql': () => import('@shikijs/langs/graphql'),
}

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  jsx: 'jsx',
  json: 'json', jsonc: 'jsonc',
  css: 'css', scss: 'scss', less: 'less',
  html: 'html', htm: 'html',
  md: 'markdown', markdown: 'markdown',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript',
  ps1: 'powershell',
  yaml: 'yaml', yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  sql: 'sql',
  vue: 'vue',
  svelte: 'svelte',
  swift: 'swift',
  kt: 'kotlin', kts: 'kotlin',
  dart: 'dart',
  lua: 'lua',
  graphql: 'graphql', gql: 'graphql',
}

// Temas nativos de Monaco: no pasan por shiki, setTheme directo.
const MONACO_BUILTIN_THEMES = new Set(['vs', 'vs-dark', 'hc-black', 'hc-light'])

export function isMonacoBuiltinTheme(name: string): boolean {
  return MONACO_BUILTIN_THEMES.has(name)
}

export function extToLang(ext: string): string | null {
  return EXT_TO_LANG[ext.replace(/^\./, '').toLowerCase()] ?? null
}

// --- Singleton lazy del highlighter ---------------------------------------

let highlighterPromise: Promise<HighlighterCore | null> | null = null

function getHighlighter(): Promise<HighlighterCore | null> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      try {
        const [{ createHighlighterCore }, { createOnigurumaEngine }] = await Promise.all([
          import('shiki/core'),
          import('shiki/engine/oniguruma'),
        ])
        return await createHighlighterCore({
          engine: createOnigurumaEngine(import('shiki/wasm')),
          themes: [],
          langs: [],
        })
      } catch (err) {
        // Sin highlighter no hay shiki en toda la sesión: Monarch queda a cargo
        console.warn('[shiki-monaco] highlighter creation failed, staying on Monarch:', err)
        return null
      }
    })()
  }
  return highlighterPromise
}

async function syncToMonaco(highlighter: HighlighterCore, monaco: MonacoLike): Promise<void> {
  const { shikiToMonaco } = await import('@shikijs/monaco')
  // shikiToMonaco re-registra tokenizers y temas para TODO lo cargado en el
  // highlighter — se re-corre después de cada load de grammar/tema.
  shikiToMonaco(highlighter, monaco as never)
}

// Carga (una vez) la grammar del lenguaje para la extensión dada y devuelve
// el id de lenguaje a usar en el modelo de Monaco, o null si no hay grammar
// (extensión desconocida o falla de carga) — en cuyo caso el caller deja que
// Monaco infiera el lenguaje y tokenice con Monarch.
export async function ensureLanguage(monaco: MonacoLike, ext: string): Promise<string | null> {
  const lang = extToLang(ext)
  if (!lang) return null
  const loader = LANG_LOADERS[lang]
  if (!loader) return null
  try {
    const highlighter = await getHighlighter()
    if (!highlighter) return null
    if (highlighter.getLoadedLanguages().includes(lang)) return lang
    const grammar = await loader()
    await highlighter.loadLanguage(grammar.default as never)
    await syncToMonaco(highlighter, monaco)
    return lang
  } catch (err) {
    console.warn(`[shiki-monaco] couldn't load grammar for .${ext}, falling back to Monarch:`, err)
    return null
  }
}

export interface ApplyThemeDeps {
  // Inyectable para tests; default: window.themes del preload.
  getInstalled?: () => Promise<InstalledThemeInfo[]>
}

// Aplica un tema por nombre: built-in de Monaco → setTheme directo; bundled
// → import dinámico + loadTheme; instalado → JSON desde el theme-bridge.
// Devuelve false (y deja vs-dark aplicado) ante nombre desconocido o falla.
export async function applyTheme(
  monaco: MonacoLike,
  themeName: string,
  deps: ApplyThemeDeps = {},
): Promise<boolean> {
  if (MONACO_BUILTIN_THEMES.has(themeName)) {
    monaco.editor.setTheme(themeName)
    return true
  }
  try {
    const highlighter = await getHighlighter()
    if (!highlighter) {
      monaco.editor.setTheme('vs-dark')
      return false
    }
    let theme: VSCodeThemeJson | null = null
    const bundledLoader = BUNDLED_THEME_LOADERS[themeName]
    if (bundledLoader) {
      theme = (await bundledLoader()).default as VSCodeThemeJson
    } else {
      const getInstalled = deps.getInstalled ?? (() => window.themes.listInstalled())
      const installed = (await getInstalled()).find((t) => t.name === themeName)
      // El name del JSON instalado puede tener espacios (display name);
      // defineTheme de Monaco los rechaza — se fuerza el slug como identidad.
      if (installed) theme = { ...installed.theme, name: themeName }
    }
    if (!theme) {
      console.warn(`[shiki-monaco] unknown theme '${themeName}', falling back to vs-dark`)
      monaco.editor.setTheme('vs-dark')
      return false
    }
    if (!highlighter.getLoadedThemes().includes(themeName)) {
      await highlighter.loadTheme(theme as never)
    }
    await syncToMonaco(highlighter, monaco)
    monaco.editor.setTheme(themeName)
    return true
  } catch (err) {
    console.warn(`[shiki-monaco] couldn't apply theme '${themeName}', falling back to vs-dark:`, err)
    monaco.editor.setTheme('vs-dark')
    return false
  }
}

// Solo para tests: resetea el singleton entre casos.
export function __resetShikiForTests(): void {
  highlighterPromise = null
}
