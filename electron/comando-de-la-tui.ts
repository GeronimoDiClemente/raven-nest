// El comando que el pane de la TUI de memoria escribe en su shell: el Electron de Nest en modo
// Node corriendo `dist-electron/memory-tui.js`.
//
// `ELECTRON_RUN_AS_NODE` va SÓLO en el comando, nunca en el env del pane: el shell sigue sin la
// variable, así que un `code` (o cualquier app Electron) lanzado después desde ese pane no
// arranca en modo Node. Cada familia de shell tiene su forma de acotarla a un comando.

export type FamiliaDeShell = 'posix' | 'powershell' | 'cmd'

/**
 * `launchCmd` se escribe literal en el shell con `ptyProcess.write()`, así que un path tiene
 * que ir citado para el shell de la plataforma: uno con una `"` literal se saldría del
 * argumento. PowerShell (y cmd) escapan la `"` adentro de comillas dobles como `""`; los shells
 * POSIX (bash/zsh), con `\"`.
 *
 * Vive acá y no en pty-manager.ts para que este módulo no arrastre node-pty; pty-manager.ts la
 * re-exporta para quien ya la importaba de ahí.
 */
export function quoteShellArg(value: string, isWinShell: boolean): string {
  const escaped = isWinShell ? value.replace(/"/g, '""') : value.replace(/(["\\$`])/g, '\\$1')
  return `"${escaped}"`
}

/** Por el nombre del binario, sin `.exe` y sin mirar mayúsculas: pwsh|powershell, cmd, o posix. */
export function familiaDeShell(bin: string): FamiliaDeShell {
  const base = (bin.split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.exe$/, '')
  if (base === 'pwsh' || base === 'powershell') return 'powershell'
  if (base === 'cmd') return 'cmd'
  return 'posix'
}

/** Un string literal de PowerShell entre comillas simples: no interpola `$` ni el backtick. */
const literalDePowerShell = (v: string) => `'${v.replace(/'/g, "''")}'`

/**
 * Las variantes de Windows ESPERAN a que la TUI termine: el `.exe` de Electron es de subsistema
 * GUI, y PowerShell interactivo (`& "exe"`) y cmd no esperan a un programa GUI. Sin esperar, el
 * prompt vuelve enseguida y el shell y la TUI se pelean la entrada de la consola.
 * `Start-Process -NoNewWindow -Wait` y `start "" /b /wait` esperan sea GUI o consola, así que
 * nunca son peores. Ojo: NO están verificadas en una máquina Windows real.
 */
export function comandoDeLaTui(execPath: string, script: string, familia: FamiliaDeShell): string {
  switch (familia) {
    case 'posix':
      return `ELECTRON_RUN_AS_NODE=1 ${quoteShellArg(execPath, false)} ${quoteShellArg(script, false)}`
    case 'powershell': {
      // El script va entre comillas dobles ADENTRO del ArgumentList, para que un path con
      // espacios siga siendo un solo argumento; una `"` adentro se escapa como `\"`. Sin
      // -RedirectStandard* ni `| Out-Null`: el hijo se queda con el TTY de la consola.
      const argumentos = literalDePowerShell(`"${script.replace(/"/g, '\\"')}"`)
      return `$env:ELECTRON_RUN_AS_NODE='1'; try { Start-Process -NoNewWindow -Wait -FilePath ${literalDePowerShell(execPath)} `
        + `-ArgumentList ${argumentos} } finally { Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }`
    }
    case 'cmd':
      // `&` y no `&&` al final: la variable se borra aunque la TUI salga con error.
      return `set "ELECTRON_RUN_AS_NODE=1" && start "" /b /wait ${quoteShellArg(execPath, true)} ${quoteShellArg(script, true)} `
        + '& set "ELECTRON_RUN_AS_NODE="'
  }
}
