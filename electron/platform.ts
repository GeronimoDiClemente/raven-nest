import { join } from 'path'

export const isWin = process.platform === 'win32'
export const isMac = process.platform === 'darwin'
export const isLinux = process.platform === 'linux'

export const SHELL = isWin
  ? 'powershell.exe'
  : isMac
    ? '/bin/zsh'
    : (process.env.SHELL || '/bin/bash')

// The initial cwd is set by pty.spawn() in pty-manager. Do NOT run
// `Set-Location $HOME` here on Windows — it overrides the spawn cwd and
// breaks AI panes that should start in repoPath (because $HOME is redirected
// to the per-account dir for AI panes, so a blind cd to $HOME lands the
// shell inside .raven-nest/accounts/... instead of the linked repo).
export const SHELL_ARGS: string[] = isWin
  ? ['-NoLogo', '-NoExit', '-Command',
     '$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")']
  : ['-l', '-i']

export const ICON_FILENAME = isWin ? 'icon.ico' : isMac ? 'icon.icns' : 'icon.png'

/**
 * Returns the icons directory path — works in both dev and packaged app.
 * In dev:       <project>/resources/icons/
 * In packaged:  <resources>/icons/   (via extraResources in electron-builder)
 *
 * `electron` is required lazily here (not imported at module scope) so every OTHER
 * export in this file — isWin/SHELL/SHELL_ARGS in particular, used by pty-manager.ts
 * and account-store.ts — stays loadable under plain Node (vitest), which cannot resolve
 * a real `electron` binary. Behaviorally identical: this function itself is only ever
 * called from actual Electron main-process code (tray.ts, main.ts window creation).
 */
export function getIconsDir(): string {
  const { app } = require('electron') as typeof import('electron')
  return app.isPackaged
    ? join(process.resourcesPath, 'icons')
    : join(__dirname, '../resources/icons')
}

export function getWindowOptions() {
  if (isMac) {
    return {
      titleBarStyle: 'hiddenInset' as const,
      trafficLightPosition: { x: 16, y: 16 },
    }
  }
  // Windows + Linux: native overlay controls. The OS/DE renders min/max/close on
  // the right per platform convention (GNOME/KDE/XFCE all default to right side
  // like Windows). titleBarOverlay is supported on Linux since Electron 30.
  return {
    titleBarStyle: 'hidden' as const,
    titleBarOverlay: {
      color: '#141414',
      symbolColor: '#e8e8e8',
      height: 44,
    },
  }
}
